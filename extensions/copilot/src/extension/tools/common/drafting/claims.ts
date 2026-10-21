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

/** The lines of one claim in the body: the start line and the continuation lines, 0-based, end exclusive. */
interface ClaimBlock {
	readonly number: number;
	readonly start: number;
	end: number;
	readonly parts: string[];
}

/** The claim blocks of a claims body. A block ends after its last line with text. */
function readClaimBlocks(lines: readonly string[]): ClaimBlock[] {
	const blocks: ClaimBlock[] = [];
	let current: ClaimBlock | undefined;
	lines.forEach((content, index) => {
		const start = claimStartPattern.exec(content);
		if (start?.groups) {
			current = { number: Number(start.groups.number), start: index, end: index + 1, parts: [start.groups.text] };
			blocks.push(current);
		} else if (/^#{1,6}\s/.test(content)) {
			current = undefined;
		} else if (current && content.trim()) {
			current.parts.push(content);
			current.end = index + 1;
		}
	});
	return blocks;
}

/** Parses the claims of a claims file (with or without frontmatter). */
export function parseClaims(text: string): DraftClaim[] {
	const { body, bodyStartLine } = parseDraftingFrontmatter(text);
	return readClaimBlocks(body.split('\n')).map(({ number, start, parts }) => {
		const claimText = parts.map(part => part.replace(/<!--[\s\S]*?-->/g, '').trim()).filter(Boolean).join(' ');
		const dependsOn = readDependencies(claimText);
		return { number, line: bodyStartLine + start, text: claimText, dependsOn, category: readCategory(claimText) };
	});
}

/** The outcome of {@link removeClaim}. */
export type ClaimRemoval =
	| {
		readonly removed: true;
		/** The claims file without the claim, renumbered. */
		readonly text: string;
		/** The number of claims before the removal. */
		readonly before: number;
		/** Each claim after the removed claim: its old and its new number. */
		readonly renumbered: readonly { readonly from: number; readonly to: number }[];
	}
	| { readonly removed: false; readonly reason: 'no-claim' }
	| {
		readonly removed: false;
		readonly reason: 'dependents';
		/** The claims that refer to the claim, in ascending order. */
		readonly dependents: readonly number[];
	};

/**
 * Removes one claim from a claims file (PRD 0025, S5) and renumbers the claims after it:
 *
 * - The lines of the claim go, and the blank lines after it (after the last claim, before it).
 * - Each claim after it moves down by one: its number and each reference to it in a claim
 *   (`claim 5`, `claims 5 or 6`, `claims 5 to 7`) become one less.
 * - References to claims before it do not change.
 *
 * Refuses when the file has no claim with the number, and when another claim refers to it: the
 * attorney then decides about those claims first. The frontmatter and the lines that are not
 * part of a claim do not change.
 */
export function removeClaim(text: string, number: number): ClaimRemoval {
	const { body } = parseDraftingFrontmatter(text);
	const normalized = text.replace(/\r\n/g, '\n');
	const head = normalized.slice(0, normalized.length - body.length);
	const lines = body.split('\n');
	const blocks = readClaimBlocks(lines);
	const target = blocks.find(block => block.number === number);
	if (!target) {
		return { removed: false, reason: 'no-claim' };
	}
	const dependents = parseClaims(text).filter(claim => claim.number !== number && claim.dependsOn.includes(number)).map(claim => claim.number);
	if (dependents.length) {
		return { removed: false, reason: 'dependents', dependents };
	}
	const renumber = (n: number) => n > number ? n - 1 : n;
	for (const block of blocks) {
		if (block === target) {
			continue;
		}
		for (let index = block.start; index < block.end; index++) {
			let content = lines[index].replace(referencePattern, reference => reference.replace(/\d+/g, digits => String(renumber(Number(digits)))));
			if (index === block.start) {
				content = content.replace(/^(?<indent>\s*)\d+/, (_match, indent: string) => `${indent}${renumber(block.number)}`);
			}
			lines[index] = content;
		}
	}
	// The blank lines after the claim go with it; after the last claim, the blank lines before it.
	let start = target.start;
	let end = target.end;
	while (end < lines.length && !lines[end].trim()) {
		end++;
	}
	if (end === lines.length) {
		end = target.end;
		while (start > 0 && !lines[start - 1].trim()) {
			start--;
		}
	}
	lines.splice(start, end - start);
	const renumbered = blocks.filter(block => block.number > number).map(block => ({ from: block.number, to: block.number - 1 }));
	return { removed: true, text: `${head}${lines.join('\n')}`, before: blocks.length, renumbered };
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
