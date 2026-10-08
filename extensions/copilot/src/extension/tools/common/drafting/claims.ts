/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Claim parsing for the Application Drafting validators. A claim starts on a line
 * `<n>. <text>` (or `<n>) <text>`); the lines up to the next claim or heading continue it.
 * Dependencies are read from `claim <n>`, `claims <n> or <m>`, `claims <n> to <m>` and
 * `claims <n>-<m>`.
 */

import { parseDraftingFrontmatter } from './frontmatter';

/** The claim category used for the EPO one-independent-claim-per-category rule. */
export type ClaimCategory = 'product' | 'process' | 'use';

/** One parsed claim. */
export interface DraftClaim {
	readonly number: number;
	/** The 1-based line in the file where the claim starts. */
	readonly line: number;
	/** The claim text joined to one line, without its number and source markers. */
	readonly text: string;
	/** The claims it refers to, in ascending order; empty for an independent claim. */
	readonly dependsOn: readonly number[];
	readonly category: ClaimCategory;
}

const claimStartPattern = /^\s*(?<number>\d+)\s*[.)]\s+(?<text>.*)$/;
const referencePattern = /\bclaims?\s+(?<refs>\d+(?:\s*(?:,|\bor\b|\band\b|\bto\b|-|–)\s*(?:claims?\s+)?\d+)*)/gi;

/** Parses the claims of a claims file (with or without frontmatter). */
export function parseClaims(text: string): DraftClaim[] {
	const { body, bodyStartLine } = parseDraftingFrontmatter(text);
	const claims: { number: number; line: number; parts: string[] }[] = [];
	let current: { number: number; line: number; parts: string[] } | undefined;
	body.split('\n').forEach((content, index) => {
		const start = claimStartPattern.exec(content);
		if (start?.groups) {
			current = { number: Number(start.groups.number), line: bodyStartLine + index, parts: [start.groups.text] };
			claims.push(current);
		} else if (/^#{1,6}\s/.test(content)) {
			current = undefined;
		} else if (current && content.trim()) {
			current.parts.push(content);
		}
	});
	return claims.map(({ number, line, parts }) => {
		const claimText = parts.map(part => part.replace(/<!--[\s\S]*?-->/g, '').trim()).filter(Boolean).join(' ');
		const dependsOn = readDependencies(claimText);
		return { number, line, text: claimText, dependsOn, category: readCategory(claimText) };
	});
}

function readDependencies(text: string): number[] {
	const targets = new Set<number>();
	for (const match of text.matchAll(referencePattern)) {
		const refs = match.groups?.refs ?? '';
		for (const range of refs.matchAll(/(?<from>\d+)(?:\s*(?:\bto\b|-|–)\s*(?<to>\d+))?/g)) {
			const from = Number(range.groups?.from);
			const to = range.groups?.to ? Number(range.groups.to) : from;
			for (let n = from; n <= to && n - from < 1000; n++) {
				targets.add(n);
			}
		}
	}
	return [...targets].sort((a, b) => a - b);
}

function readCategory(text: string): ClaimCategory {
	const preamble = text.split(/[,:;]|\bcompris|\bconsist|\bwherein\b/i)[0].toLowerCase();
	if (/^(?:the\s+)?use\b/.test(preamble)) {
		return 'use';
	}
	return /^(?:\S+\s+){0,4}?(?:method|process)\b/.test(preamble) ? 'process' : 'product';
}
