/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { escapeXml, parseLength, parseSvg, parseViewBox, SvgNode, walkSvg } from './svgTree';

/**
 * Drawing Sheet layout: the office page geometry of
 * `docs/research/patent-drawings/01-formal-drawing-rules.md` sections 1 and 4. Every value in this
 * file is in millimetres; every output is deterministic for the same input.
 */

/** The office a Drawing Set is filed at. PCT follows the EPO landscape rule and the USPTO sheet-number format. */
export type DrawingOffice = 'US' | 'EPO' | 'PCT';

/** The page size of the Drawing Sheets. Letter is a USPTO size only (37 CFR 1.84(f)). */
export type DrawingPageSize = 'A4' | 'letter';

/** One Figure given to the layout: its number, an optional partial-view letter and its SVG. */
export interface FigureInput {
	readonly number: number;
	/** The capital letter of a partial view, e.g. `A` for FIG. 1A (37 CFR 1.84(u)(1)). */
	readonly partial?: string;
	/** The Figure SVG: root `width`/`height` in mm, `viewBox` in mm, inline attributes only. */
	readonly svg: string;
}

/** Page sizes, 01-formal-drawing-rules.md section 1: A4 21.0 x 29.7 cm, Letter 21.6 x 27.9 cm (8.5 x 11 in). */
export const PAGE_SIZES: { readonly [size in DrawingPageSize]: { readonly width: number; readonly height: number } } = {
	A4: { width: 210, height: 297 },
	letter: { width: 215.9, height: 279.4 },
};

/** Minimum margins, 37 CFR 1.84(g); OJ EPO 2025 A49 Art. 1(1); PCT Rule 11.6(c). A4 leaves a 170 x 262 mm sight. */
export const SHEET_MARGINS = { top: 25, left: 25, right: 15, bottom: 10 } as const;

/** Minimum glyph height, 37 CFR 1.84(p)(3); OJ EPO 2025 A49 Art. 1(2)(g); PCT Rule 11.13(h). */
export const MIN_GLYPH_HEIGHT = 3.2;

/** Digit and capital height as a fraction of the font size in Liberation Sans (the bundled font) and Arial. */
export const CAP_HEIGHT_RATIO = 0.716;

/** The font family every sheet text names; the bundled TTF is Liberation Sans. */
export const SHEET_FONT_FAMILY = 'Liberation Sans, Arial, Helvetica, sans-serif';

/** The smallest FIG label and sheet-number font size (4.3 mm capitals). */
const MIN_LABEL_FONT_SIZE = 6;
/** A FIG label or sheet number is at least this much larger than the largest numeral (37 CFR 1.84(t), (u)(2)). */
const LABEL_TO_NUMERAL_RATIO = 1.25;
/** Space at the top of the sight that holds the sheet number. */
const SHEET_NUMBER_GAP = 4;
/** Space between the bottom of a Figure and the top of its FIG label. */
const LABEL_GAP = 3;
/** Space between two Figures on one sheet. */
const FIGURE_GAP = 10;

/** One Figure placed on a sheet. */
export interface PlacedFigure {
	readonly number: number;
	readonly partial?: string;
	/** The FIG label, or undefined for a single-figure Drawing Set. */
	readonly label?: string;
	/** The Figure scale on the sheet (1 = the Figure's own millimetres). */
	readonly scale: number;
}

/** One Drawing Sheet. */
export interface DrawingSheet {
	/** 1-based sheet number. */
	readonly number: number;
	readonly orientation: 'portrait' | 'landscape';
	readonly figures: readonly PlacedFigure[];
	/** The sheet SVG (`sheet-N.svg`). */
	readonly svg: string;
}

/** The result of a layout: the sheets, or the reason the layout was refused. */
export type SheetLayoutResult =
	| { readonly ok: true; readonly office: DrawingOffice; readonly pageSize: DrawingPageSize; readonly sheets: readonly DrawingSheet[] }
	| { readonly ok: false; readonly reason: string };

interface ParsedFigure {
	readonly input: FigureInput;
	readonly key: string;
	readonly width: number;
	readonly height: number;
	readonly viewBox: readonly [number, number, number, number];
	readonly kind: string;
	readonly inner: string;
	/** The smallest text font size in the Figure's own millimetres. */
	readonly minFont: number;
	/** The largest numeral font size in the Figure's own millimetres. */
	readonly maxNumeralFont: number;
}

interface Frame {
	readonly width: number;
	readonly height: number;
}

interface Cell {
	readonly figure: ParsedFigure;
	readonly scale: number;
	readonly width: number;
	readonly height: number;
}

interface Row {
	readonly cells: Cell[];
	width: number;
	height: number;
}

interface SheetDraft {
	readonly orientation: 'portrait' | 'landscape';
	readonly rows: Row[];
}

/** Rounds to 0.001 mm and prints without trailing zeros. */
function fmt(value: number): string {
	const rounded = Math.round(value * 1000) / 1000;
	return Object.is(rounded, -0) ? '0' : String(rounded);
}

/** The FIG label for an office: "FIG. 1" for the USPTO (37 CFR 1.84(u)(1)), "Fig. 1" for EPO and PCT (GL A-IX 5.2; PCT IP 5.141). */
export function figureLabel(office: DrawingOffice, number: number, partial?: string): string {
	return `${office === 'US' ? 'FIG.' : 'Fig.'} ${number}${partial ?? ''}`;
}

/** The sheet number text: `n/N` for US and PCT (37 CFR 1.84(t); PCT AI 207(b)(iii)), the integer for EPO (A49 Art. 2(5)). */
export function sheetNumberText(office: DrawingOffice, sheet: number, total: number): string {
	return office === 'EPO' ? String(sheet) : `${sheet}/${total}`;
}

function parseFigure(input: FigureInput): ParsedFigure | string {
	const label = `FIG. ${input.number}${input.partial ?? ''}`;
	if (!Number.isInteger(input.number) || input.number < 1) {
		return `${label}: the figure number must be a positive integer.`;
	}
	if (input.partial !== undefined && !/^[A-Z]$/.test(input.partial)) {
		return `${label}: a partial view takes one capital letter (37 CFR 1.84(u)(1)).`;
	}
	let root: SvgNode;
	try {
		root = parseSvg(input.svg);
	} catch {
		return `${label}: the SVG has no <svg> root element.`;
	}
	const width = parseLength(root.attrs.get('width'));
	const height = parseLength(root.attrs.get('height'));
	if (width === undefined || height === undefined || width <= 0 || height <= 0) {
		return `${label}: the SVG root needs a width and a height in millimetres.`;
	}
	const viewBox = parseViewBox(root.attrs.get('viewBox')) ?? [0, 0, width, height];
	const unit = width / viewBox[2];
	let minFont = Number.POSITIVE_INFINITY;
	let maxNumeralFont = 0;
	walkSvg(root, ({ node, style }) => {
		if (node.name !== 'text') {
			return;
		}
		const size = (parseLength(style.get('font-size')) ?? 0) * unit;
		minFont = Math.min(minFont, size);
		if ((node.attrs.get('class') ?? '').split(/\s+/).includes('numeral')) {
			maxNumeralFont = Math.max(maxNumeralFont, size);
		}
	});
	const open = /<svg\b[^>]*>/.exec(input.svg);
	const close = input.svg.lastIndexOf('</svg>');
	const inner = open && close > open.index ? input.svg.slice(open.index + open[0].length, close).trim() : '';
	return { input, key: `${input.number}${input.partial ?? ''}`, width, height, viewBox, kind: root.attrs.get('data-kind') ?? '3d', inner, minFont, maxNumeralFont };
}

/** The scale that fits a Figure in a frame, never above 1. */
function fitScale(figure: ParsedFigure, frame: Frame, labelBand: number): number {
	return Math.min(1, frame.width / figure.width, (frame.height - labelBand) / figure.height);
}

/**
 * Lays out the Drawing Sheets of a Drawing Set (01-formal-drawing-rules.md sections 1 and 4).
 *
 * - Page: A4 by default, Letter only for the USPTO (37 CFR 1.84(f); A49 Art. 2(2); PCT Rule 11.5).
 * - Margins 25 / 25 / 15 / 10 mm, no frame around the sight (37 CFR 1.84(g); A49 Art. 1(1); PCT Rule 11.6(c)).
 * - Sheet number centred at the top of the sight, "not in the margin", larger than the numerals:
 *   `n/N` for US (37 CFR 1.84(t)) and PCT (AI 207(b)(iii); Rule 11.7), an integer for EPO (A49 Art. 2(5)).
 * - Figures in number order, several per sheet when they fit, each at one uniform scale no larger than
 *   1 that keeps every glyph at 3.2 mm or more (37 CFR 1.84(p)(3); A49 Art. 1(2)(g); PCT Rule 11.13(h)).
 *   A Figure that cannot fit at that scale is refused with the reason.
 * - FIG label below each Figure, larger than the numerals (37 CFR 1.84(u)(2); GL A-IX 5.2); no label for
 *   a single-figure Drawing Set (37 CFR 1.84(u)(1); GL A-IX 5.2; PCT IP 5.141).
 * - Upright is preferred (37 CFR 1.84(i); A49 Art. 1(2)(h)). A Figure wider than tall that fits larger
 *   sideways goes on a landscape sheet: the page stays portrait and the content turns so the top of the
 *   Figure is at the right for the USPTO (37 CFR 1.84(i)) and at the left for EPO and PCT (A49
 *   Art. 1(2)(h); PCT Rule 11.13(j)). All Figures on one sheet share one orientation.
 */
export function layoutDrawingSheets(office: DrawingOffice, pageSize: DrawingPageSize, figures: readonly FigureInput[]): SheetLayoutResult {
	if (pageSize === 'letter' && office !== 'US') {
		return { ok: false, reason: `Letter is a USPTO page size only. The ${office === 'EPO' ? 'EPO accepts A4 only (OJ EPO 2025 A49 Art. 2(2))' : 'PCT accepts A4 only (PCT Rule 11.5)'}. Use A4.` };
	}
	if (figures.length === 0) {
		return { ok: false, reason: 'The Drawing Set has no Figure.' };
	}
	const parsed: ParsedFigure[] = [];
	for (const input of figures) {
		const figure = parseFigure(input);
		if (typeof figure === 'string') {
			return { ok: false, reason: figure };
		}
		if (parsed.some(other => other.key === figure.key)) {
			return { ok: false, reason: `FIG. ${figure.key} is given twice.` };
		}
		parsed.push(figure);
	}
	parsed.sort((a, b) => a.input.number - b.input.number || (a.input.partial ?? '').localeCompare(b.input.partial ?? ''));

	const page = PAGE_SIZES[pageSize];
	const sight = { width: page.width - SHEET_MARGINS.left - SHEET_MARGINS.right, height: page.height - SHEET_MARGINS.top - SHEET_MARGINS.bottom };
	const maxNumeralFont = Math.max(0, ...parsed.map(figure => figure.maxNumeralFont));
	const labelFont = Math.max(MIN_LABEL_FONT_SIZE, Math.ceil(maxNumeralFont * LABEL_TO_NUMERAL_RATIO * 10) / 10);
	const labelCap = labelFont * CAP_HEIGHT_RATIO;
	const numberBand = labelCap + SHEET_NUMBER_GAP;
	const labelled = parsed.length > 1;
	const labelBand = labelled ? LABEL_GAP + labelCap : 0;
	const portrait: Frame = { width: sight.width, height: sight.height - numberBand };
	const landscape: Frame = { width: portrait.height, height: portrait.width };

	const drafts: SheetDraft[] = [];
	for (const figure of parsed) {
		const upright = fitScale(figure, portrait, labelBand);
		const sideways = fitScale(figure, landscape, labelBand);
		const orientation = figure.width > figure.height && sideways > upright ? 'landscape' : 'portrait';
		const frame = orientation === 'portrait' ? portrait : landscape;
		const scale = orientation === 'landscape' ? sideways : upright;
		const minScale = figure.minFont === Number.POSITIVE_INFINITY ? 0 : MIN_GLYPH_HEIGHT / (figure.minFont * CAP_HEIGHT_RATIO);
		if (scale < minScale - 1e-9) {
			const glyph = figure.minFont * CAP_HEIGHT_RATIO * scale;
			return { ok: false, reason: `FIG. ${figure.key} is ${fmt(figure.width)} x ${fmt(figure.height)} mm. To fit the ${fmt(sight.width)} x ${fmt(sight.height)} mm sight it needs scale ${scale.toFixed(3)}, which makes its smallest text ${glyph.toFixed(2)} mm high, under the ${MIN_GLYPH_HEIGHT} mm minimum (37 CFR 1.84(p)(3); OJ EPO 2025 A49 Art. 1(2)(g); PCT Rule 11.13(h)). Split it into partial views or draw it smaller with the same numeral size.` };
		}
		const cell: Cell = { figure, scale, width: figure.width * scale, height: figure.height * scale + labelBand };
		let sheet = drafts[drafts.length - 1];
		if (!sheet || sheet.orientation !== orientation) {
			sheet = { orientation, rows: [] };
			drafts.push(sheet);
		}
		const row = sheet.rows[sheet.rows.length - 1];
		if (row && row.width + FIGURE_GAP + cell.width <= frame.width + 1e-9) {
			row.cells.push(cell);
			row.width += FIGURE_GAP + cell.width;
			row.height = Math.max(row.height, cell.height);
			continue;
		}
		const used = sheet.rows.reduce((total, other) => total + other.height, 0) + FIGURE_GAP * sheet.rows.length;
		if (row && used + cell.height > frame.height + 1e-9) {
			sheet = { orientation, rows: [] };
			drafts.push(sheet);
		}
		sheet.rows.push({ cells: [cell], width: cell.width, height: cell.height });
	}

	const sheets = drafts.map((draft, index): DrawingSheet => {
		const number = index + 1;
		const frame = draft.orientation === 'portrait' ? portrait : landscape;
		const lines: string[] = [];
		lines.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${fmt(page.width)}mm" height="${fmt(page.height)}mm" viewBox="0 0 ${fmt(page.width)} ${fmt(page.height)}" data-sheet="${number}" data-sheets="${drafts.length}" data-office="${office}" data-page-size="${pageSize}" data-orientation="${draft.orientation}">`);
		lines.push(`<text class="sheet-number" x="${fmt(SHEET_MARGINS.left + sight.width / 2)}" y="${fmt(SHEET_MARGINS.top + labelCap)}" font-size="${fmt(labelFont)}" font-family="${SHEET_FONT_FAMILY}" text-anchor="middle" fill="#000">${sheetNumberText(office, number, drafts.length)}</text>`);
		const frameTop = SHEET_MARGINS.top + numberBand;
		const transform = draft.orientation === 'portrait'
			? `translate(${fmt(SHEET_MARGINS.left)} ${fmt(frameTop)})`
			: office === 'US'
				? `translate(${fmt(SHEET_MARGINS.left + sight.width)} ${fmt(frameTop)}) rotate(90)`
				: `translate(${fmt(SHEET_MARGINS.left)} ${fmt(frameTop + landscape.width)}) rotate(-90)`;
		lines.push(`<g class="figures" transform="${transform}">`);
		const placed: PlacedFigure[] = [];
		const blockHeight = draft.rows.reduce((total, row) => total + row.height, 0) + FIGURE_GAP * (draft.rows.length - 1);
		let y = (frame.height - blockHeight) / 2;
		for (const row of draft.rows) {
			let x = (frame.width - row.width) / 2;
			for (const cell of row.cells) {
				const { figure, scale } = cell;
				const label = labelled ? figureLabel(office, figure.input.number, figure.input.partial) : undefined;
				const top = y + row.height - cell.height; // bottom-aligned: labels in a row share one baseline
				const width = figure.width * scale;
				const height = figure.height * scale;
				lines.push(`<svg class="figure" data-figure="${escapeXml(figure.key)}" data-kind="${escapeXml(figure.kind)}" data-scale="${fmt(scale)}" x="${fmt(x)}" y="${fmt(top)}" width="${fmt(width)}" height="${fmt(height)}" viewBox="${figure.viewBox.map(fmt).join(' ')}">`);
				if (figure.inner) {
					lines.push(figure.inner);
				}
				lines.push(`</svg>`);
				if (label) {
					lines.push(`<text class="fig-label" data-figure="${escapeXml(figure.key)}" x="${fmt(x + width / 2)}" y="${fmt(top + height + LABEL_GAP + labelCap)}" font-size="${fmt(labelFont)}" font-family="${SHEET_FONT_FAMILY}" text-anchor="middle" fill="#000">${escapeXml(label)}</text>`);
				}
				placed.push({ number: figure.input.number, partial: figure.input.partial, label, scale });
				x += cell.width + FIGURE_GAP;
			}
			y += row.height + FIGURE_GAP;
		}
		lines.push(`</g>`);
		lines.push(`</svg>`);
		return { number, orientation: draft.orientation, figures: placed, svg: lines.join('\n') + '\n' };
	});
	return { ok: true, office, pageSize, sheets };
}
