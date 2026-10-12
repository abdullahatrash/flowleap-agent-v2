/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Vec2 } from './drawingScene';
import { NUMERAL_FONT_SIZE, NumeralRequest, PlacedNumeral, placeNumerals } from './numeralPlacer';
import { hatch, Rect, Segment, toSegments } from './planar';

/** Visible edge width in sheet millimetres. */
export const EDGE_WIDTH = 0.4;
/** Lead line, hidden edge, hatching and underline width in sheet millimetres. */
export const THIN_WIDTH = 0.2;
/** Hatch spacing in sheet millimetres (37 CFR 1.84(h)(3): regularly spaced oblique lines). */
export const HATCH_SPACING = 2;
/** Default size the drawing is fitted into, in sheet millimetres, when the scene sets no scale. */
const FIT_WIDTH = 120;
const FIT_HEIGHT = 150;
/** Space around the drawing for numerals, in sheet millimetres. */
const MARGIN = 24;

/**
 * One part as the kernel projected it, in model millimetres on the drawing plane (y down).
 */
export interface ProjectedPart {
	readonly id: string;
	readonly visible: readonly (readonly Vec2[])[];
	readonly hidden: readonly (readonly Vec2[])[];
	/** Closed loops of the section cut faces of this part. */
	readonly cutFaces: readonly (readonly Vec2[])[];
}

/** A numeral port projected to the drawing plane; `anchor` is absent when the port does not resolve. */
export interface ProjectedPort {
	readonly numeral: string;
	readonly part: string;
	readonly anchor?: Vec2;
	readonly surface: boolean;
}

/** The kernel output for one Figure. */
export interface ProjectedFigure {
	readonly figure: string;
	readonly parts: readonly ProjectedPart[];
	readonly ports: readonly ProjectedPort[];
	readonly hiddenEdges: 'omit' | 'dashed';
	/** Sheet millimetres per model millimetre; omit to fit. */
	readonly scale?: number;
}

/** A Figure laid out on the sheet, in sheet millimetres; the SVG is written from it. */
export interface FigureLayout {
	readonly figure: string;
	readonly width: number;
	readonly height: number;
	readonly edges: readonly { readonly part: string; readonly line: readonly Vec2[] }[];
	readonly hidden: readonly { readonly part: string; readonly line: readonly Vec2[] }[];
	readonly hatching: readonly { readonly part: string; readonly line: Segment }[];
	readonly numerals: readonly PlacedNumeral[];
	readonly fontSize: number;
}

const round = (value: number) => Math.round(value * 100) / 100;

function dedupe(lines: readonly { readonly part: string; readonly line: readonly Vec2[] }[]): { part: string; line: Vec2[] }[] {
	const seen = new Set<string>();
	const result: { part: string; line: Vec2[] }[] = [];
	for (const { part, line } of lines) {
		const rounded = line.map(([x, y]): Vec2 => [round(x), round(y)]).filter((point, i, all) => i === 0 || point[0] !== all[i - 1][0] || point[1] !== all[i - 1][1]);
		if (rounded.length < 2) {
			continue;
		}
		const key = rounded.map(point => point.join(',')).join(' ');
		const reverse = [...rounded].reverse().map(point => point.join(',')).join(' ');
		if (seen.has(key) || seen.has(reverse)) {
			continue;
		}
		seen.add(key);
		result.push({ part, line: rounded });
	}
	return result;
}

/**
 * Scales the projected Figure to the sheet, hatches the cut faces at 45 degrees (adjacent parts
 * alternate 45 and 135 degrees, 37 CFR 1.84(h)(3)) and places the numerals.
 */
export function layoutFigure(projected: ProjectedFigure): FigureLayout {
	const all = projected.parts.flatMap(part => [...part.visible, ...part.hidden, ...part.cutFaces].flat());
	const xs = all.map(point => point[0]);
	const ys = all.map(point => point[1]);
	const minX = xs.length ? Math.min(...xs) : 0;
	const minY = ys.length ? Math.min(...ys) : 0;
	const spanX = xs.length ? Math.max(...xs) - minX : 0;
	const spanY = ys.length ? Math.max(...ys) - minY : 0;
	const scale = projected.scale ?? Math.min(FIT_WIDTH / Math.max(spanX, 1e-6), FIT_HEIGHT / Math.max(spanY, 1e-6));
	const toSheet = (point: Vec2): Vec2 => [(point[0] - minX) * scale + MARGIN, (point[1] - minY) * scale + MARGIN];
	const mapLines = (pick: (part: ProjectedPart) => readonly (readonly Vec2[])[]) => projected.parts.flatMap(part => pick(part).map(line => ({ part: part.id, line: line.map(toSheet) })));
	const edges = dedupe(mapLines(part => part.visible));
	const hidden = projected.hiddenEdges === 'dashed' ? dedupe(mapLines(part => part.hidden)) : [];
	const hatching: { part: string; line: Segment }[] = [];
	projected.parts.filter(part => part.cutFaces.length > 0).forEach((part, index) => {
		const boundary = toSegments(part.cutFaces.map(loop => loop.map(toSheet)));
		for (const line of hatch(boundary, index % 2 === 0 ? 45 : 135, HATCH_SPACING)) {
			hatching.push({ part: part.id, line: [[round(line[0][0]), round(line[0][1])], [round(line[1][0]), round(line[1][1])]] });
		}
	});
	const drawing: Rect = { x: MARGIN, y: MARGIN, width: spanX * scale, height: spanY * scale };
	const requests: NumeralRequest[] = projected.ports
		.filter((port): port is ProjectedPort & { anchor: Vec2 } => port.anchor !== undefined)
		.map(port => ({ numeral: port.numeral, part: port.part, surface: port.surface, anchor: toSheet(port.anchor) }));
	const obstacles = [...toSegments(edges.map(edge => edge.line)), ...toSegments(hidden.map(edge => edge.line)), ...hatching.map(item => item.line)];
	const numerals = placeNumerals(requests, obstacles, drawing).map(numeral => ({
		...numeral,
		x: round(numeral.x),
		y: round(numeral.y),
		lead: numeral.lead && [[round(numeral.lead[0][0]), round(numeral.lead[0][1])], [round(numeral.lead[1][0]), round(numeral.lead[1][1])]] as Segment,
	}));
	return { figure: projected.figure, width: round(spanX * scale + 2 * MARGIN), height: round(spanY * scale + 2 * MARGIN), edges, hidden, hatching, numerals, fontSize: NUMERAL_FONT_SIZE };
}

function pathData(line: readonly Vec2[]): string {
	return line.map((point, i) => `${i === 0 ? 'M' : 'L'}${point[0]} ${point[1]}`).join(' ');
}

function escapeXml(text: string): string {
	return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Writes `FIG-N.svg`: black line art on white, units in sheet millimetres. Visible edges 0.4 mm,
 * lead lines, hatching and dashed hidden edges 0.2 mm, numerals at 4.5 mm font size (3.2 mm digit
 * height), surface numerals underlined without a lead line. The `class` and `data-*` attributes let
 * the mechanical fault list read the file back.
 */
export function writeFigureSvg(layout: FigureLayout): string {
	const lines: string[] = [];
	lines.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${layout.width}mm" height="${layout.height}mm" viewBox="0 0 ${layout.width} ${layout.height}" data-figure="${escapeXml(layout.figure)}">`);
	lines.push(`<rect width="${layout.width}" height="${layout.height}" fill="#fff"/>`);
	lines.push(`<g fill="none" stroke="#000" stroke-linecap="round" stroke-linejoin="round">`);
	for (const edge of layout.edges) {
		lines.push(`<path class="edge" data-part="${escapeXml(edge.part)}" stroke-width="${EDGE_WIDTH}" d="${pathData(edge.line)}"/>`);
	}
	for (const edge of layout.hidden) {
		lines.push(`<path class="hidden" data-part="${escapeXml(edge.part)}" stroke-width="${THIN_WIDTH}" stroke-dasharray="1.5 1" d="${pathData(edge.line)}"/>`);
	}
	for (const item of layout.hatching) {
		lines.push(`<path class="hatch" data-part="${escapeXml(item.part)}" stroke-width="${THIN_WIDTH}" d="${pathData(item.line)}"/>`);
	}
	for (const numeral of layout.numerals) {
		if (numeral.lead) {
			lines.push(`<path class="lead" data-numeral="${escapeXml(numeral.numeral)}" data-part="${escapeXml(numeral.part)}" stroke-width="${THIN_WIDTH}" d="${pathData(numeral.lead)}"/>`);
		}
		if (numeral.surface) {
			const underlineY = round(numeral.y + 0.6);
			lines.push(`<path class="underline" data-numeral="${escapeXml(numeral.numeral)}" stroke-width="${THIN_WIDTH}" d="M${round(numeral.box.x)} ${underlineY} L${round(numeral.box.x + numeral.box.width)} ${underlineY}"/>`);
		}
	}
	lines.push(`</g>`);
	for (const numeral of layout.numerals) {
		lines.push(`<text class="numeral" data-numeral="${escapeXml(numeral.numeral)}" data-part="${escapeXml(numeral.part)}"${numeral.surface ? ' data-surface="true"' : ''} x="${numeral.x}" y="${numeral.y}" font-size="${layout.fontSize}" font-family="Liberation Sans, Arial, Helvetica, sans-serif" text-anchor="middle" fill="#000">${escapeXml(numeral.numeral)}</text>`);
	}
	lines.push(`</svg>`);
	return lines.join('\n') + '\n';
}
