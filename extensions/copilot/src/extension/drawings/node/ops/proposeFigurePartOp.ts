/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { formatFigurePart, NumeralScheme, readFiguresSettings } from '../../../tools/common/drafting/figures';
import { DRAFTING_FILE_NAMES } from '../../../tools/common/drafting/folderContract';
import { parseDraftingFrontmatter } from '../../../tools/common/drafting/frontmatter';
import { figureHeadingNumbers, FigurePart, hasFigure, parseFigureParts, parseFigureSections } from '../../../tools/common/drafting/specValidators';
import { MatterFiles } from './matterFiles';

/** File extensions a sketch may have. */
export const SKETCH_EXTENSIONS = /\.(png|jpe?g|gif|webp|bmp|tiff?|svg|pdf)$/i;

/** A sketch the caller resolved: its original file name and its bytes. */
export interface SketchFile {
	/** The original file name or path; only its last segment is used. */
	readonly name: string;
	readonly bytes: Uint8Array;
	/** The MIME type, used for the extension when the name has none. */
	readonly mimeType?: string;
}

/** The part to propose. */
export interface ProposeFigurePartInput {
	/** The figure the part is drawn in. */
	readonly figure: number;
	/** The part name, e.g. `bracket`. */
	readonly part: string;
	/** The reference numeral; the next free numeral of the scheme when absent. */
	readonly numeral?: string;
	/** The Feature List rows the part shows, e.g. `F3`. */
	readonly features?: readonly string[];
	/** The sketch the part comes from; copied to `sketches/`. */
	readonly sketch?: SketchFile;
}

/** The result of a proposal: the line written, or the refusal reason (nothing was written). */
export type ProposeFigurePartResult =
	| {
		readonly ok: true;
		/** The result text for the model. */
		readonly text: string;
		/** The line written to `figures.md`. */
		readonly line: string;
		readonly numeral: string;
		/** The sketch, relative to the matter folder, e.g. `sketches/sketch-1.png`. */
		readonly sketch?: string;
	}
	| { readonly ok: false; readonly reason: string };

function leadingNumber(numeral: string): number {
	return Number.parseInt(numeral, 10);
}

/** The reason a numeral does not follow the scheme, or `undefined` when it does. */
function schemeFault(numeral: string, scheme: NumeralScheme, figure: number): string | undefined {
	const value = leadingNumber(numeral);
	if (scheme === 'even') {
		return value % 2 ? `Numeral ${numeral} is odd; figures.md uses \`numerals: even\`.` : undefined;
	}
	return Math.floor(value / 100) !== figure ? `Numeral ${numeral} does not start with ${figure}; figures.md uses \`numerals: hundreds\`, so a part first drawn in FIG. ${figure} takes ${figure}02 to ${figure}98.` : undefined;
}

/** The next free numeral of the scheme, or `undefined` when the series of the figure is full. */
function nextNumeral(parts: readonly FigurePart[], scheme: NumeralScheme, figure: number): string | undefined {
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
	let file = (name.replace(/\\/g, '/').split('/').pop() ?? '').replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'sketch';
	if (!SKETCH_EXTENSIONS.test(file)) {
		const extension = mimeType?.split('/')[1]?.replace('jpeg', 'jpg').replace('svg+xml', 'svg');
		file = `${file}.${extension && /^[a-z]+$/.test(extension) ? extension : 'png'}`;
	}
	return file;
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
	return a.length === b.length && a.every((value, index) => value === b[index]);
}

/** Writes the sketch to `sketches/`, reusing a file with the same bytes; returns its matter-relative path. */
async function storeSketch(files: MatterFiles, sketch: SketchFile): Promise<string> {
	const fileName = sketchFileName(sketch.name, sketch.mimeType);
	const dot = fileName.lastIndexOf('.');
	for (let index = 1; ; index++) {
		const candidate = `sketches/${index === 1 ? fileName : `${fileName.slice(0, dot)}-${index}${fileName.slice(dot)}`}`;
		const existing = await files.readBytes(candidate);
		if (!existing) {
			await files.write(candidate, sketch.bytes);
			return candidate;
		}
		if (sameBytes(existing, sketch.bytes)) {
			return candidate;
		}
	}
}

/**
 * Inserts a part line under the heading of the figure: after the last part line of its section,
 * or right after the heading. A figure without a heading gets one at the end of the file.
 */
function insertPartLine(figures: string, figure: number, line: string): string {
	const section = parseFigureSections(figures).figures.find(item => hasFigure(figureHeadingNumbers(item.label), String(figure)));
	const lines = figures.replace(/\r\n/g, '\n').split('\n');
	if (!section) {
		const body = lines.join('\n').replace(/\n*$/, '');
		const empty = parseDraftingFrontmatter(figures).body.trim() === '';
		return `${body}${empty ? '\n' : '\n\n'}## FIG. ${figure}\n\n${line}\n`;
	}
	const after = section.parts.length ? section.parts[section.parts.length - 1].line : section.line;
	lines.splice(after, 0, ...(section.parts.length ? [line] : ['', line]));
	return lines.join('\n');
}

/**
 * Proposes a part the disclosure does not state (PRD 0023, slice D5): writes
 * `- NN: <part> (proposed from sketches/<file>)` under the figure heading of `figures.md`, with the
 * next free numeral of the scheme when none is given. It refuses a numeral already used, a numeral
 * outside the scheme and a malformed part or Feature List link. The sketch is copied to
 * `sketches/` first. Export stays blocked until the attorney confirms the part.
 */
export async function proposeFigurePartOp(files: MatterFiles, input: ProposeFigurePartInput): Promise<ProposeFigurePartResult> {
	const refuse = (reason: string): ProposeFigurePartResult => ({ ok: false, reason });
	const figuresPath = `${files.folder}/${DRAFTING_FILE_NAMES.figures}`;
	const part = input.part?.trim().replace(/\s+/g, ' ');
	if (!part || /[\[\]()]/.test(part)) {
		return refuse('Give the part name in `part`, without brackets or parentheses.');
	}
	if (!Number.isInteger(input.figure) || input.figure < 1) {
		return refuse('Give the figure number the part is drawn in, in `figure`.');
	}
	const features = (input.features ?? []).map(feature => feature.trim().toUpperCase());
	if (features.some(feature => !/^F\d+$/.test(feature))) {
		return refuse('A Feature List link is a row id such as `F3`.');
	}
	const figures = await files.read(DRAFTING_FILE_NAMES.figures);
	if (figures === undefined) {
		return refuse(`${figuresPath} does not exist.`);
	}
	const scheme = readFiguresSettings(figures).numerals;
	const parts = parseFigureParts(figures);
	let numeral = input.numeral?.trim();
	if (numeral) {
		if (!/^\d{1,4}[a-z]?$/.test(numeral)) {
			return refuse(`"${numeral}" is not a reference numeral (digits, then an optional small letter).`);
		}
		const used = parts.find(item => item.numeral === numeral);
		if (used) {
			return refuse(`Numeral ${numeral} is already used for "${used.part}" (${figuresPath}, line ${used.line}). One numeral names one part.`);
		}
		const fault = schemeFault(numeral, scheme, input.figure);
		if (fault) {
			return refuse(fault);
		}
	} else {
		numeral = nextNumeral(parts, scheme, input.figure);
		if (!numeral) {
			return refuse(`FIG. ${input.figure} has no free numeral left in the ${input.figure}02 to ${input.figure}98 series.`);
		}
	}

	const sketch = input.sketch ? await storeSketch(files, input.sketch) : undefined;
	const line = formatFigurePart({ numeral, part, ...(features.length ? { features } : {}), proposed: sketch ? { source: sketch } : {} });
	await files.write(DRAFTING_FILE_NAMES.figures, insertPartLine(figures, input.figure, line));
	const text = `Wrote to ${figuresPath}: \`${line}\`${sketch ? `. The sketch is at ${files.folder}/${sketch}` : ''}. This part is a proposal: build_drawing_set and the export stay blocked until the attorney confirms it by removing "(proposed)", or deletes the line. Tell the attorney what you proposed and why.`;
	return { ok: true, text, line, numeral, ...(sketch ? { sketch } : {}) };
}
