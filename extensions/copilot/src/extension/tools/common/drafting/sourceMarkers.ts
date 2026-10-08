/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Source markers of a Draft Application (ADR 0012 decision 1). This syntax is stable: the
 * `application-drafting` skill reference copies it.
 *
 * Every paragraph (a block of lines between blank lines) carries one marker as its first line,
 * or at the start of its first line:
 *
 * ```
 * <!-- src: feature:F3 -->
 * The housing 12 holds the lever 14.
 * ```
 *
 * One marker can name more than one source, separated by commas:
 * `<!-- src: feature:F3, disclosure:§2.1 -->`. The source kinds are:
 *
 * - `feature:<row id>` — a row of the Feature List, e.g. `feature:F3`.
 * - `disclosure:<span>` — a span of the invention disclosure, e.g. `disclosure:§2.1`.
 * - `instruction` — an attorney instruction.
 * - `template` — the office template (boilerplate).
 * - `model-proposed` — Model-Proposed text: structure only, never technical content.
 *
 * Headings (`#` lines) carry no marker. An Inventor Question is a blockquote paragraph that
 * starts with `> **Inventor Question IQ-<n>:**`, listed under a final `## Inventor Questions`
 * heading:
 *
 * ```
 * > **Inventor Question IQ-1:** What material is the spring made of?
 * ```
 */

import { parseDraftingFrontmatter } from './frontmatter';

/** The kind of source a paragraph traces to. */
export type DraftSourceKind = 'feature' | 'disclosure' | 'instruction' | 'template' | 'model-proposed';

/** One source named by a paragraph marker. `ref` is set for `feature` and `disclosure`. */
export interface DraftSource {
	readonly kind: DraftSourceKind;
	readonly ref?: string;
}

/** One paragraph of a Draft Application. */
export interface DraftParagraph {
	/** The 1-based line in the file where the paragraph text starts (after a marker on its own line). */
	readonly line: number;
	readonly kind: 'heading' | 'text' | 'inventor-question';
	/** The text of the nearest heading above, without the `#` characters. */
	readonly section?: string;
	/** The paragraph text without its marker. */
	readonly text: string;
	/** The sources of the marker; absent when the paragraph has no valid marker. */
	readonly sources?: readonly DraftSource[];
	/** Why the marker could not be read, when it is present but invalid. */
	readonly markerError?: string;
}

/** One Inventor Question block of a Draft Application. */
export interface InventorQuestion {
	readonly id: string;
	readonly line: number;
	/** The question text, joined to one line, without the blockquote and label. */
	readonly text: string;
}

const markerPattern = /^[ \t]*<!--\s*src:(?<sources>[\s\S]*?)-->[ \t]*\n?/;
const sourcePattern = /^(?<kind>feature|disclosure|instruction|template|model-proposed)(?:\s*:\s*(?<ref>.+))?$/;
const inventorQuestionPattern = /^>\s*\*\*Inventor Question (?<id>IQ-\d+):\*\*\s*(?<text>[\s\S]*)$/;

/**
 * Splits a Draft Application (with or without frontmatter) into paragraphs and reads the
 * source marker of each. Line numbers refer to the whole file.
 */
export function parseDraftParagraphs(text: string): DraftParagraph[] {
	const { body, bodyStartLine } = parseDraftingFrontmatter(text);
	const lines = body.split('\n');
	const paragraphs: DraftParagraph[] = [];
	let section: string | undefined;
	let block: string[] = [];
	let blockLine = 0;

	const flush = () => {
		if (block.length) {
			paragraphs.push(readParagraph(block.join('\n'), blockLine, section));
			block = [];
		}
	};

	lines.forEach((content, index) => {
		const line = bodyStartLine + index;
		const heading = /^#{1,6}\s+(?<title>.*)$/.exec(content);
		if (heading?.groups) {
			flush();
			section = heading.groups.title.trim();
			paragraphs.push({ line, kind: 'heading', section, text: content.trimEnd() });
		} else if (!content.trim()) {
			flush();
		} else {
			if (!block.length) {
				blockLine = line;
			}
			block.push(content);
		}
	});
	flush();
	return paragraphs;
}

function readParagraph(raw: string, blockLine: number, section: string | undefined): DraftParagraph {
	const marker = markerPattern.exec(raw);
	const text = (marker ? raw.slice(marker[0].length) : raw).trimEnd();
	const line = blockLine + (marker?.[0].endsWith('\n') ? 1 : 0);
	if (inventorQuestionPattern.test(text)) {
		return { line, kind: 'inventor-question', section, text };
	}
	if (!marker?.groups) {
		return { line, kind: 'text', section, text };
	}
	const sources: DraftSource[] = [];
	for (const entry of marker.groups.sources.split(',').map(part => part.trim()).filter(Boolean)) {
		const source = sourcePattern.exec(entry);
		const kind = source?.groups?.kind as DraftSourceKind | undefined;
		const ref = source?.groups?.ref?.trim();
		const needsRef = kind === 'feature' || kind === 'disclosure';
		if (!kind || needsRef !== Boolean(ref)) {
			return { line, kind: 'text', section, text, markerError: `Unknown source "${entry}". Use feature:<row>, disclosure:<span>, instruction, template or model-proposed.` };
		}
		sources.push(ref ? { kind, ref } : { kind });
	}
	if (!sources.length) {
		return { line, kind: 'text', section, text, markerError: 'The marker names no source.' };
	}
	return { line, kind: 'text', section, text, sources };
}

/** Lists the Inventor Question blocks of a Draft Application. */
export function parseInventorQuestions(text: string): InventorQuestion[] {
	const questions: InventorQuestion[] = [];
	for (const paragraph of parseDraftParagraphs(text)) {
		if (paragraph.kind !== 'inventor-question') {
			continue;
		}
		const joined = paragraph.text.split('\n').map(content => content.replace(/^>\s?/, '').trim()).join(' ');
		const match = inventorQuestionPattern.exec(`> ${joined}`);
		if (match?.groups) {
			questions.push({ id: match.groups.id, line: paragraph.line, text: match.groups.text.trim() });
		}
	}
	return questions;
}

/** Removes every source marker from a Draft Application, for the .docx export. */
export function stripSourceMarkers(text: string): string {
	return text.replace(new RegExp(markerPattern.source, 'gm'), '');
}
