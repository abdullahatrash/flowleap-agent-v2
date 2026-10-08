/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Deterministic validators of the Draft Application text (ADR 0012 decision 4): abstract
 * length, defined-term consistency, reference numerals against `figures.md`, source markers
 * and open Inventor Questions. No model call.
 *
 * `figures.md` lists one part per line, as a list item `- 12: housing` or a table row
 * `| 12 | housing |`. In the draft, a reference numeral follows its part name: `the housing 12`
 * or `the housing (12)`.
 */

import { DraftFinding, INVENTOR_QUESTION } from './finding';
import { DRAFTING_FILE_NAMES } from './folderContract';
import { DraftingOffice, parseDraftingFrontmatter } from './frontmatter';
import { DraftParagraph, parseInventorQuestions } from './sourceMarkers';

const draftFile = DRAFTING_FILE_NAMES.draft;
const figuresFile = DRAFTING_FILE_NAMES.figures;

/** One part of `figures.md` with its reference numeral. */
export interface FigurePart {
	readonly numeral: string;
	readonly part: string;
	readonly line: number;
}

/** True for a paragraph in the Abstract section. */
export function isAbstractParagraph(paragraph: DraftParagraph): boolean {
	return /abstract/i.test(paragraph.section ?? '');
}

/** True for a paragraph in a claims section ("Claims", "What is claimed is"). */
export function isClaimsParagraph(paragraph: DraftParagraph): boolean {
	return /claim/i.test(paragraph.section ?? '');
}

function wordCount(text: string): number {
	return text.split(/\s+/).filter(Boolean).length;
}

/** The Abstract heading and its text paragraphs, or `undefined` when the draft has no Abstract section. */
function readAbstract(paragraphs: readonly DraftParagraph[]): { readonly heading: DraftParagraph; readonly text: string } | undefined {
	const heading = paragraphs.find(paragraph => paragraph.kind === 'heading' && isAbstractParagraph(paragraph));
	if (!heading) {
		return undefined;
	}
	const text = paragraphs
		.filter(paragraph => paragraph.kind === 'text' && paragraph.section === heading.section)
		.map(paragraph => paragraph.text)
		.join('\n\n');
	return { heading, text };
}

/**
 * Finding when the Abstract has more than 150 words: an Error for US (37 CFR 1.72(b) "may not
 * exceed"), a Note for EPO (Rule 47(3) EPC "preferably"). Error for both offices when there is
 * no Abstract section.
 */
export function checkAbstractLength(paragraphs: readonly DraftParagraph[], office: DraftingOffice): DraftFinding[] {
	const abstract = readAbstract(paragraphs);
	if (!abstract) {
		return [{ severity: 'Error', rule: 'abstract-length', file: draftFile, message: 'The draft has no Abstract section (a heading that contains "Abstract").' }];
	}
	const words = wordCount(abstract.text);
	if (words <= 150) {
		return [];
	}
	const line = abstract.heading.line;
	return office === 'US'
		? [{ severity: 'Error', rule: 'abstract-length', file: draftFile, line, message: `The Abstract has ${words} words; it must have at most 150 (37 CFR 1.72(b)).` }]
		: [{ severity: 'Note', rule: 'abstract-length', file: draftFile, line, message: `The Abstract has ${words} words; Rule 47(3) EPC asks for preferably at most 150.` }];
}

const definitionPatterns = [
	/\bhereinafter(?:\s+referred\s+to\s+as)?\s+["“](?<term>[^"”]+)["”]/gi,
	/\breferred\s+to\s+(?:herein\s+)?as\s+["“](?<term>[^"”]+)["”]/gi,
	/["“](?<term>[^"”]+)["”]\s+(?:means|refers\s+to|is\s+defined\s+as)\b/gi,
];

function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The 1-based file line of a character index inside a paragraph. */
function lineAt(paragraph: DraftParagraph, index: number): number {
	return paragraph.line + (paragraph.text.slice(0, index).match(/\n/g)?.length ?? 0);
}

/**
 * Error when a term defined once (`(hereinafter "control unit")`, `referred to as "X"`,
 * `"X" means`), of one word or more, is written with other word separators elsewhere
 * (`control-unit`, `controlunit`), or, when the defined term is capitalised (`"Controller"`),
 * in another case (`controller`).
 */
export function checkDefinedTerms(paragraphs: readonly DraftParagraph[]): DraftFinding[] {
	const texts = paragraphs.filter(paragraph => paragraph.kind === 'text');
	const terms = new Map<string, string>();
	for (const paragraph of texts) {
		for (const pattern of definitionPatterns) {
			for (const match of paragraph.text.matchAll(pattern)) {
				const term = match.groups!.term.trim();
				if (!terms.has(term.toLowerCase())) {
					terms.set(term.toLowerCase(), term);
				}
			}
		}
	}
	const findings: DraftFinding[] = [];
	for (const term of terms.values()) {
		const words = term.split(/[\s-]+/).filter(Boolean).map(escapeRegExp);
		if (!words.length) {
			continue;
		}
		// A capitalised defined term ("Controller") is a name: a lower-case variant is another spelling.
		const capitalised = /^\p{Lu}/u.test(term);
		const variants = new RegExp(`(?<![\\w-])${words.join('[\\s-]*')}(?![\\w-])`, 'gi');
		for (const paragraph of texts) {
			for (const match of paragraph.text.matchAll(variants)) {
				if (capitalised ? match[0] !== term : match[0].toLowerCase() !== term.toLowerCase()) {
					const line = lineAt(paragraph, match.index ?? 0);
					findings.push({ severity: 'Error', rule: 'defined-term', file: draftFile, line, message: `Line ${line} writes "${match[0]}"; the defined term is "${term}".` });
				}
			}
		}
	}
	return findings.sort((a, b) => (a.line ?? 0) - (b.line ?? 0));
}

/** Parses the parts of `figures.md` (list items `- 12: housing`, table rows `| 12 | housing |`). */
export function parseFigureParts(figures: string): FigurePart[] {
	const { body, bodyStartLine } = parseDraftingFrontmatter(figures);
	const parts: FigurePart[] = [];
	body.split('\n').forEach((content, index) => {
		const match = /^\s*[-*]\s+(?<numeral>\d{1,4}[a-z]?)\s*[:–—-]?\s+(?<part>[^|\s].*?)\s*$/.exec(content)
			?? /^\s*\|\s*(?<numeral>\d{1,4}[a-z]?)\s*\|\s*(?<part>[^|]+?)\s*\|/.exec(content);
		if (match?.groups) {
			parts.push({ numeral: match.groups.numeral, part: match.groups.part, line: bodyStartLine + index });
		}
	});
	return parts;
}

/** Words that precede a number which is not a reference numeral (`claim 1`, `about 5`). */
const notNumeralWords = new Set(['fig', 'figs', 'figure', 'figures', 'claim', 'claims', 'about', 'approximately', 'around', 'nearly', 'than', 'of', 'to', 'and', 'or', 'by', 'at', 'in', 'on', 'from', 'between', 'within', 'over', 'under', 'up', 'per', 'for', 'with', 'the', 'a', 'an', 'is', 'are', 'be', 'has', 'have', 'comprises', 'includes', 'each', 'every', 'all', 'only', 'least', 'most', 'paragraph', 'paragraphs', 'example', 'examples', 'embodiment', 'table', 'section', 'rule', 'article', 'cfr', 'usc', 'page', 'line', 'column', 'version', 'iq', 'times']);

const numeralPattern = /\b(?<word>[A-Za-z][A-Za-z-]*)\s+(?<open>\()?(?<numeral>\d{1,4}[a-z]?)\)?(?![\d.,]*\d)(?!\s*(?:%|°|(?:mm|cm|m|µm|um|nm|km|mg|g|kg|ml|l|s|ms|min|h|hz|khz|mhz|ghz|v|mv|kv|ma|w|kw|mw|n|pa|kpa|mpa|bar|rpm|ppm|wt|vol|degrees?|percent)\b))/g;

/** A reference sign after a word of the text: `housing 12` or `housing (12)`. */
export interface ReferenceSign {
	readonly word: string;
	readonly numeral: string;
	/** True when the sign is in parentheses, `housing (12)`. */
	readonly parenthesised: boolean;
	/** The character index of `word` in the text. */
	readonly index: number;
}

/**
 * The reference signs of a text: a number of at most four digits (with an optional letter) after a
 * word. Numbers after words such as `claim`, `Fig.` or `about`, decimal numbers and numbers with a
 * unit (`5 mm`, `90 degrees`) are left out.
 */
export function readReferenceSigns(text: string): ReferenceSign[] {
	const signs: ReferenceSign[] = [];
	for (const match of text.matchAll(numeralPattern)) {
		const { word, numeral, open } = match.groups!;
		if (!notNumeralWords.has(word.toLowerCase())) {
			signs.push({ word, numeral, parenthesised: !!open, index: match.index ?? 0 });
		}
	}
	return signs;
}

function stemWord(word: string): string {
	return word.toLowerCase().replace(/(?<!s)s$/, '');
}

/**
 * Error when a numeral in the draft text is not in `figures.md`, a numeral of `figures.md`
 * does not appear in the text, the text names a numeral as another part, or `figures.md` gives
 * one numeral to two parts or two numerals to one part.
 */
export function checkReferenceNumerals(paragraphs: readonly DraftParagraph[], figures: string): DraftFinding[] {
	const parts = parseFigureParts(figures);
	const findings: DraftFinding[] = [];
	const partsByNumeral = new Map<string, FigurePart[]>();
	const numeralByPart = new Map<string, FigurePart>();
	for (const part of parts) {
		const same = partsByNumeral.get(part.numeral) ?? [];
		if (same.length && !same.some(other => other.part.toLowerCase() === part.part.toLowerCase())) {
			findings.push({ severity: 'Error', rule: 'reference-numeral', file: figuresFile, line: part.line, message: `Numeral ${part.numeral} names two parts in figures.md: "${same[0].part}" and "${part.part}". Use one numeral per part.` });
		}
		partsByNumeral.set(part.numeral, [...same, part]);
		const earlier = numeralByPart.get(part.part.toLowerCase());
		if (earlier && earlier.numeral !== part.numeral) {
			findings.push({ severity: 'Error', rule: 'reference-numeral', file: figuresFile, line: part.line, message: `Part "${part.part}" has two numerals in figures.md: ${earlier.numeral} and ${part.numeral}. Use one numeral per part.` });
		} else if (!earlier) {
			numeralByPart.set(part.part.toLowerCase(), part);
		}
	}

	const used = new Set<string>();
	const reported = new Set<string>();
	for (const paragraph of paragraphs.filter(candidate => candidate.kind === 'text')) {
		for (const { word, numeral, index } of readReferenceSigns(paragraph.text)) {
			used.add(numeral);
			const line = lineAt(paragraph, index);
			const known = partsByNumeral.get(numeral);
			if (!known) {
				if (!reported.has(numeral)) {
					reported.add(numeral);
					findings.push({ severity: 'Error', rule: 'reference-numeral', file: draftFile, line, message: `Line ${line} uses numeral ${numeral} ("${word} ${numeral}"), which figures.md does not list.` });
				}
				continue;
			}
			const named = known.some(part => part.part.split(/[\s-]+/).some(partWord => stemWord(partWord) === stemWord(word)));
			const key = `${numeral}:${word.toLowerCase()}`;
			if (!named && !reported.has(key)) {
				reported.add(key);
				findings.push({ severity: 'Error', rule: 'reference-numeral', file: draftFile, line, message: `Line ${line} writes "${word} ${numeral}", but figures.md names numeral ${numeral} "${known[0].part}".` });
			}
		}
	}

	const unusedReported = new Set<string>();
	for (const part of parts) {
		if (!used.has(part.numeral) && !unusedReported.has(part.numeral + part.part)) {
			unusedReported.add(part.numeral + part.part);
			findings.push({ severity: 'Error', rule: 'reference-numeral', file: figuresFile, line: part.line, message: `Numeral ${part.numeral} ("${part.part}") in figures.md does not appear in the draft text.` });
		}
	}
	return findings;
}

/** True when `figures.md` has content after its frontmatter, i.e. the application has figures. */
export function hasFigures(figures: string): boolean {
	return parseDraftingFrontmatter(figures).body.trim().length > 0;
}

const figureNamePattern = /\b(?:figs?\.?|figures?)\s*\d+[a-z]?\b/i;

/**
 * EPO, Rule 47(4) EPC: Notes when the application has figures and the Abstract does not name the
 * figure to publish with it (`Fig. 1`), or mentions a part of `figures.md` without its reference
 * sign in parentheses (`housing (12)`). No finding without figures or without an Abstract.
 */
export function checkEpoAbstractFigure(paragraphs: readonly DraftParagraph[], figures: string): DraftFinding[] {
	const abstract = readAbstract(paragraphs);
	if (!abstract || !hasFigures(figures)) {
		return [];
	}
	const line = abstract.heading.line;
	const findings: DraftFinding[] = [];
	if (!figureNamePattern.test(abstract.text)) {
		findings.push({ severity: 'Note', rule: 'epo-abstract-figure', file: draftFile, line, message: 'The Abstract names no figure to publish with it. Rule 47(4) EPC: name the figure, e.g. "(Fig. 1)".' });
	}
	const missing: FigurePart[] = [];
	for (const part of parseFigureParts(figures)) {
		const name = part.part.split(/\s+/).map(escapeRegExp).join('\\s+');
		const mentioned = new RegExp(`(?<![\\w-])${name}(?:s|es)?(?![\\w-])`, 'i').test(abstract.text);
		const signed = new RegExp(`\\([^)]*(?<![\\w.])${escapeRegExp(part.numeral)}(?![\\w.])[^)]*\\)`).test(abstract.text);
		if (mentioned && !signed && !missing.some(other => other.part.toLowerCase() === part.part.toLowerCase())) {
			missing.push(part);
		}
	}
	if (missing.length) {
		const example = `${missing[0].part} (${missing[0].numeral})`;
		findings.push({ severity: 'Note', rule: 'epo-abstract-figure', file: draftFile, line, message: `The Abstract mentions ${missing.map(part => `"${part.part}"`).join(', ')} without their reference signs in parentheses. Rule 47(4) EPC: follow each main feature shown in a figure by its reference sign in parentheses, e.g. "${example}".` });
	}
	return findings;
}

/** Error for each text paragraph outside the claims without a valid source marker. */
export function checkSourceMarkers(paragraphs: readonly DraftParagraph[]): DraftFinding[] {
	const findings: DraftFinding[] = [];
	for (const paragraph of paragraphs) {
		if (paragraph.kind !== 'text' || isClaimsParagraph(paragraph) || paragraph.sources) {
			continue;
		}
		const message = paragraph.markerError
			? `The paragraph at line ${paragraph.line} has an invalid source marker: ${paragraph.markerError}`
			: `The paragraph at line ${paragraph.line} has no source marker (<!-- src: ... -->).`;
		findings.push({ severity: 'Error', rule: 'source-marker', file: draftFile, line: paragraph.line, message });
	}
	return findings;
}

/** Error for each open Inventor Question in the draft; export refuses until it is resolved or waived. */
export function checkInventorQuestions(draft: string): DraftFinding[] {
	return parseInventorQuestions(draft).map(question => ({
		severity: 'Error',
		rule: INVENTOR_QUESTION,
		file: draftFile,
		line: question.line,
		message: `Inventor Question ${question.id} is open: ${question.text}`,
	}));
}
