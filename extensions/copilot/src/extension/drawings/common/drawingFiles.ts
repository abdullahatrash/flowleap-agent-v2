/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * The files of the Drawing Set tools in `drafting/<matter>/drawings/` (PRD 0023, slice D5):
 *
 * ```
 * drawings/
 *   FIG-1.scene.json         source of a Figure: the 3D scene, or for a 2D Figure the diagram input
 *   FIG-1.svg                the line art render_figure writes
 *   rounds.json              the review rounds per Figure, and whether the model saw the render
 *   review/FIG-1.round-2.png the review render of a round, never a deliverable
 * ```
 *
 * This module imports no kernel, no layout engine and no VS Code API: the editor tools (D5) and
 * the drawings CLI (D6) share it.
 */

import { basename } from '../../../util/vs/base/common/path';
import { DRAWING_RULES, DrawingRule } from './scene/drawingFaults';
import type { BlockDiagramInput } from './diagram/blockDiagram';
import type { FlowchartInput } from './diagram/flowchart';
import type { FigureReviewRecord } from './sheets/receipt';
import { NumeralScheme } from '../../tools/common/drafting/figures';
import { DraftFinding } from '../../tools/common/drafting/finding';
import { parseDraftingFrontmatter } from '../../tools/common/drafting/frontmatter';
import { figureHeadingNumbers, FigurePart, hasFigure, parseFigureSections } from '../../tools/common/drafting/specValidators';

/** Three review rounds per Figure (PRD 0023, D5 guardrail). */
export const MAX_REVIEW_ROUNDS = 3;

/** The file that records the review rounds, in `drawings/`. */
export const ROUNDS_FILE = 'rounds.json';

/** One Figure: its number, an optional partial-view letter, and the key `1` or `1A`. */
export interface FigureId {
	readonly number: number;
	readonly partial?: string;
	readonly key: string;
}

/** Reads the Figure number and the partial-view letter, or returns the reason they are not valid. */
export function figureId(number: number, partial?: string): FigureId | string {
	if (!Number.isInteger(number) || number < 1) {
		return `The figure number must be a positive integer, not ${number}.`;
	}
	const letter = partial?.trim().toUpperCase();
	if (letter && !/^[A-Z]$/.test(letter)) {
		return `A partial view takes one capital letter (FIG. ${number}A), not "${partial}" (37 CFR 1.84(u)(1)).`;
	}
	return letter ? { number, partial: letter, key: `${number}${letter}` } : { number, key: String(number) };
}

/** The Figure of a `FIG-N.svg` file name, or `undefined` for any other file. */
export function figureOfSvgFile(name: string): FigureId | undefined {
	const match = /^FIG-(?<number>[1-9]\d*)(?<partial>[A-Z])?\.svg$/.exec(name);
	if (!match?.groups) {
		return undefined;
	}
	const number = Number(match.groups.number);
	const partial = match.groups.partial;
	return partial ? { number, partial, key: `${number}${partial}` } : { number, key: String(number) };
}

/** The source file of a 2D Figure: the diagram input the Figure was drawn from. */
export type DiagramSource =
	| { readonly figure: string; readonly mode: 'flowchart'; readonly input: FlowchartInput }
	| { readonly figure: string; readonly mode: 'block'; readonly input: BlockDiagramInput };

/** The 3D-only SVG checks: a diagram has keywords per office, no parts, and its own lead rules. */
const NOT_FOR_DIAGRAMS: ReadonlySet<DrawingRule> = new Set<DrawingRule>(['text-beyond-keywords', 'lead-line-off-part', 'lead-ends-on-nothing', 'lead-along-edge']);

/**
 * The SVG checks of a 2D Figure. The diagram writer checks its own labels per office (a flowchart
 * box may carry a sentence) and has no parts, so the keyword and on-part checks do not apply. Its
 * lead lines end on the box edge by construction (`lead-line` and `lead-crosses-edge` in
 * diagramFaults.ts), so the 3D lead-end checks do not run either.
 */
export const DIAGRAM_SVG_CHECKS: readonly DrawingRule[] = (Object.keys(DRAWING_RULES) as DrawingRule[]).filter(rule => !NOT_FOR_DIAGRAMS.has(rule));

/** One review round of a Figure. `seen` is false when the model got the findings only. */
export interface ReviewRound {
	readonly round: number;
	/** The review render, relative to `drawings/`. */
	readonly png: string;
	readonly seen: boolean;
}

/** The review rounds per Figure key. */
export type ReviewRounds = Readonly<Record<string, readonly ReviewRound[]>>;

interface RoundsFileShape {
	readonly figures?: Record<string, readonly Partial<ReviewRound>[]>;
}

/** Reads `rounds.json`; a missing or broken file gives no rounds. */
export function parseReviewRounds(text: string | undefined): ReviewRounds {
	if (!text) {
		return {};
	}
	let parsed: RoundsFileShape;
	try {
		parsed = JSON.parse(text);
	} catch {
		return {};
	}
	const result: Record<string, ReviewRound[]> = {};
	for (const [key, rounds] of Object.entries(parsed?.figures ?? {})) {
		if (Array.isArray(rounds)) {
			result[key] = rounds
				.filter(round => typeof round.round === 'number' && typeof round.png === 'string')
				.map(round => ({ round: round.round!, png: round.png!, seen: round.seen !== false }));
		}
	}
	return result;
}

/** Writes `rounds.json`. */
export function renderReviewRounds(rounds: ReviewRounds): string {
	const figures = Object.fromEntries(Object.keys(rounds).sort().map(key => [key, rounds[key]]));
	return `${JSON.stringify({ figures }, null, '\t')}\n`;
}

/** The review records of the receipt: per Figure, the rounds whose render the model saw. */
export function reviewRecords(rounds: ReviewRounds, keys: readonly string[]): FigureReviewRecord[] {
	return keys.map(figure => ({ figure, rounds: (rounds[figure] ?? []).filter(round => round.seen).map(round => ({ round: round.round, png: round.png })) }));
}

/** One line per Figure finding, with its rule citation when it has one. */
export function drawingFindingLine(finding: DraftFinding & { readonly citation?: string }): string {
	const location = [finding.file, finding.line !== undefined ? `line ${finding.line}` : undefined].filter(Boolean).join(', ');
	return `- ${finding.severity} \`${finding.rule}\`${location ? ` (${location})` : ''}: ${finding.message.replace(/\s*\n\s*/g, ' ')}${finding.citation ? ` [${finding.citation}]` : ''}`;
}

/** The parts listed under the figure heading of `figures.md` that names the Figure. */
export function partsOfFigure(figures: string, figure: FigureId): FigurePart[] {
	return parseFigureSections(figures).figures
		.filter(section => {
			const numbers = figureHeadingNumbers(section.label);
			return hasFigure(numbers, figure.key) || hasFigure(numbers, String(figure.number));
		})
		.flatMap(section => section.parts);
}

/** The number of review renders of a Figure among the file names of `drawings/review/`. */
export function reviewPngCount(files: readonly string[], figure: FigureId): number {
	const pattern = new RegExp(`^FIG-${figure.key}\\.round-\\d+\\.png$`);
	return files.filter(name => pattern.test(name)).length;
}

/** File extensions a sketch may have. */
export const SKETCH_EXTENSIONS = /\.(png|jpe?g|gif|webp|bmp|tiff?|svg|pdf)$/i;

function leadingNumber(numeral: string): number {
	return Number.parseInt(numeral, 10);
}

/** The reason a numeral does not follow the scheme, or `undefined` when it does. */
export function schemeFault(numeral: string, scheme: NumeralScheme, figure: number): string | undefined {
	const value = leadingNumber(numeral);
	if (scheme === 'even') {
		return value % 2 ? `Numeral ${numeral} is odd; figures.md uses \`numerals: even\`.` : undefined;
	}
	return Math.floor(value / 100) !== figure ? `Numeral ${numeral} does not start with ${figure}; figures.md uses \`numerals: hundreds\`, so a part first drawn in FIG. ${figure} takes ${figure}02 to ${figure}98.` : undefined;
}

/** The next free numeral of the scheme, or `undefined` when the series of the figure is full. */
export function nextNumeral(parts: readonly FigurePart[], scheme: NumeralScheme, figure: number): string | undefined {
	const values = parts.map(part => leadingNumber(part.numeral));
	if (scheme === 'even') {
		const highest = Math.max(0, ...values);
		return String(highest + (highest % 2 ? 1 : 2));
	}
	const base = figure * 100;
	const highest = Math.max(base, ...values.filter(value => Math.floor(value / 100) === figure));
	const next = highest + (highest % 2 ? 1 : 2);
	return next < base + 100 ? String(next) : undefined;
}

/** A file name safe to write in `sketches/`. */
export function sketchFileName(name: string, mimeType?: string): string {
	let file = basename(name.replace(/\\/g, '/')).replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'sketch';
	if (!SKETCH_EXTENSIONS.test(file)) {
		const extension = mimeType?.split('/')[1]?.replace('jpeg', 'jpg').replace('svg+xml', 'svg');
		file = `${file}.${extension && /^[a-z]+$/.test(extension) ? extension : 'png'}`;
	}
	return file;
}

/** True when two byte arrays are equal. */
export function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
	return a.length === b.length && a.every((value, index) => value === b[index]);
}

/**
 * Inserts a part line under the heading of the figure: after the last part line of its section,
 * or right after the heading. A figure without a heading gets one at the end of the file.
 */
export function insertPartLine(figures: string, figure: number, line: string): string {
	const section = parseFigureSections(figures).figures.find(item => hasFigure(figureHeadingNumbers(item.label), String(figure)));
	const lines = figures.replace(/\r\n/g, '\n').split('\n');
	if (!section) {
		const body = lines.join('\n').replace(/\n*$/, '');
		const empty = parseDraftingFrontmatter(figures).body.trim() === '';
		return `${body}${empty ? '\n' : '\n\n'}## FIG. ${figure}\n\n${line}\n`;
	}
	const after = section.parts.length ? section.parts[section.parts.length - 1].line : section.line;
	const insert = section.parts.length ? [line] : ['', line];
	lines.splice(after, 0, ...insert);
	return lines.join('\n');
}

/** The Figures the figure list names and the ones not drawn yet, as Figure keys (`1`, `2A`). */
export interface FigureSetStatus {
	readonly expected: readonly string[];
	readonly missing: readonly string[];
}

/**
 * Compares the Figures the headings of `figures.md` name (a range heading `FIGS. 7 to 10` names
 * each member) with the Figures drawn. A heading `FIG. 2` is drawn by `FIG-2.svg` or by a partial
 * view `FIG-2A.svg`; a heading `FIG. 2A` only by `FIG-2A.svg`.
 */
export function figureSetStatus(figures: string, drawn: readonly FigureId[]): FigureSetStatus {
	const expected = [...new Set(parseFigureSections(figures).figures.flatMap(section => figureHeadingNumbers(section.label)).map(number => number.trim().toUpperCase()))];
	expected.sort((a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10) || a.localeCompare(b));
	const missing = expected.filter(key => !drawn.some(figure => figure.key === key || (/^\d+$/.test(key) && figure.number === Number(key))));
	return { expected, missing };
}

/** Figure keys as text, ranges of whole numbers joined: `FIG. 1, 3–10, 12A`. */
export function figureListText(keys: readonly string[]): string {
	const parts: string[] = [];
	for (let index = 0; index < keys.length; index++) {
		const start = keys[index];
		let end = index;
		while (/^\d+$/.test(start) && /^\d+$/.test(keys[end + 1] ?? '') && Number(keys[end + 1]) === Number(keys[end]) + 1) {
			end++;
		}
		parts.push(end - index >= 2 ? `${start}–${keys[end]}` : start);
		if (end - index === 1) {
			parts.push(keys[end]);
		}
		index = end;
	}
	return parts.length ? `FIG. ${parts.join(', ')}` : '';
}
