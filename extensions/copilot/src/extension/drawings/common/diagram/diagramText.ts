/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * The office whose text rules a diagram follows. Typed here, not imported from the drafting
 * layer: the caller maps the matter's office to one of these.
 */
export type DiagramOffice = 'US' | 'EPO';

/**
 * The reference numeral scheme of the matter: `even` gives 2, 4, 6 ...; `hundreds` gives the
 * figure-prefixed series 302, 304, 306 ... in FIG. 3.
 */
export type DiagramNumeralScheme = 'even' | 'hundreds';

/**
 * The font size in mm at figure scale of every label and numeral, the same as the 3D engine.
 * The 0.32 cm minimum (37 CFR 1.84(p)(3); OJ EPO 2025 A49 Art. 1(2)(g); PCT Rule 11.13(h)) is a
 * character HEIGHT, and Liberation Sans capitals and digits are 0.716 em tall: font size 3.2
 * gives 2.29 mm glyphs that would not file, font size 4.5 gives 3.22 mm.
 */
export const FONT_SIZE = 4.5;
/** The numeral font size in mm at figure scale, the same as the label size. */
export const NUMERAL_FONT_SIZE = FONT_SIZE;
/** The font family of all text, the same as the 3D engine. */
export const FONT_FAMILY = 'Liberation Sans, Arial, Helvetica, sans-serif';
/** The estimated advance of one character in mm (a monospace-ish 0.55 em). */
export const CHAR_WIDTH = 0.55 * FONT_SIZE;
/** The distance between two text baselines in mm (1.3 em). */
export const LINE_HEIGHT = 1.3 * FONT_SIZE;
/** The most words of a US label: keywords only (37 CFR 1.84(o); MPEP 608.02). */
export const US_MAX_WORDS = 4;
/** The most words of an EPO step sentence: "a short sentence" (Guidelines A-IX 8). */
export const EPO_MAX_WORDS = 12;

/** The width in mm of a text line at `fontSize`, estimated from its character count. */
export function textWidth(text: string, fontSize = FONT_SIZE): number {
	return [...text].length * 0.55 * fontSize;
}

/** The words of a label, as the fault check counts them. */
export function countWords(text: string): number {
	return text.split(/\s+/).filter(word => /[\p{L}\p{N}]/u.test(word)).length;
}

/** Wraps a text into lines of at most `maxChars` characters, at word boundaries. */
export function wrapText(text: string, maxChars: number): string[] {
	const lines: string[] = [];
	let line = '';
	for (const word of text.split(/\s+/).filter(Boolean)) {
		if (line && line.length + 1 + word.length > maxChars) {
			lines.push(line);
			line = word;
		} else {
			line = line ? `${line} ${word}` : word;
		}
	}
	if (line) {
		lines.push(line);
	}
	return lines;
}

/** Words that end the first noun phrase of a step. */
const PHRASE_END = new Set([
	'about', 'above', 'according', 'after', 'against', 'along', 'and', 'as', 'at', 'based', 'before', 'below', 'between',
	'by', 'during', 'for', 'from', 'if', 'in', 'into', 'of', 'on', 'onto', 'or', 'over', 'so', 'such', 'than', 'that',
	'through', 'to', 'toward', 'towards', 'under', 'until', 'upon', 'using', 'via', 'when', 'whereby', 'wherein',
	'which', 'while', 'with', 'within', 'without',
]);

/** Words a keyword label drops. */
const ARTICLES = new Set(['a', 'an', 'the', 'said']);

/** The step text without a leading step marker such as `(a)` and without trailing `; and` or a period. */
export function cleanStepText(text: string): string {
	return text
		.replace(/^\s*\((?:[a-z]|\d+)\)\s*/i, '')
		.replace(/[\s;,.:]*(?:\band)?[\s;,.:]*$/i, '')
		.trim();
}

function capitalize(text: string): string {
	return text ? text[0].toUpperCase() + text.slice(1) : text;
}

/**
 * The US keyword label of a step: the leading verb and its first noun phrase, without
 * articles, at most four words. An interjection such as `, by a processor,` is skipped.
 * Returns an empty string when the step has no words.
 */
export function keywordLabel(text: string): string {
	const question = /\?\s*$/.test(text);
	const body = cleanStepText(text)
		.replace(/\?\s*$/, '')
		.replace(/,\s*(?:at|by|from|in|on|through|using|via|with)\b[^,]*,/gi, ' ');
	const words: string[] = [];
	for (const token of body.split(/\s+/)) {
		const word = token.replace(/^[^\p{L}\p{N}]+/u, '');
		const stop = /[,;:.]$/.test(word);
		const bare = word.replace(/[^\p{L}\p{N}\-°%]+$/u, '');
		const lower = bare.toLowerCase();
		if (words.length > 0 && PHRASE_END.has(lower)) {
			break;
		}
		if (bare && !ARTICLES.has(lower)) {
			words.push(bare);
		}
		if (stop || words.length === US_MAX_WORDS) {
			break;
		}
	}
	const label = capitalize(words.join(' '));
	return label && question ? `${label}?` : label;
}

/**
 * The EPO sentence of a step (Guidelines A-IX 8 allow a short sentence per method step),
 * cut after twelve words. `truncated` is true when words were cut.
 */
export function shortSentence(text: string): { readonly text: string; readonly truncated: boolean } {
	const words = cleanStepText(text).split(/\s+/).filter(Boolean);
	if (words.length <= EPO_MAX_WORDS) {
		return { text: capitalize(words.join(' ')), truncated: false };
	}
	const kept = words.slice(0, EPO_MAX_WORDS).join(' ').replace(/[,;:]$/, '');
	return { text: `${capitalize(kept)}…`, truncated: true };
}

/**
 * The reference numeral of the item at `index` (0-based) in figure `figure` under `scheme`: the
 * series a diagram takes when the figure list does not list its numerals (see {@link diagramNumerals}).
 */
export function numeralFor(scheme: DiagramNumeralScheme, figure: number, index: number): number {
	return scheme === 'hundreds' ? figure * 100 + 2 * (index + 1) : 2 * (index + 1);
}

/**
 * The numerals of the `count` steps or blocks of a diagram, in order: the numerals the figure
 * list gives when `listed` is set (the figure list is the authority, #786), else the scheme
 * series of {@link numeralFor}. A `listed` of another length is the caller's refusal.
 */
export function diagramNumerals(scheme: DiagramNumeralScheme, figure: number, count: number, listed?: readonly number[]): number[] {
	return listed && listed.length === count ? [...listed] : Array.from({ length: count }, (_, index) => numeralFor(scheme, figure, index));
}
