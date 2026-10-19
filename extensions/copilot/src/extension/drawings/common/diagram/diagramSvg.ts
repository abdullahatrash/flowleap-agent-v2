/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { PlacedDiagram, PlacedNode, Point } from './diagramLayout';
import { FONT_FAMILY, FONT_SIZE, LINE_HEIGHT, NUMERAL_FONT_SIZE, textWidth } from './diagramText';

/** The padding in mm around the tight bounding box of the drawing. */
const PADDING = 2;
const ARROW_LENGTH = 2;
const ARROW_HALF_WIDTH = 0.8;
/** The baseline offset from the vertical centre of a text line, for a cap height of about 0.7 em. */
const BASELINE_OFFSET = FONT_SIZE * 0.35;

/**
 * Writes the `FIG-N.svg` contract of the 3D engine: user unit mm, the viewBox the tight
 * bounding box plus 2 mm, a white background rect, all strokes in one group, the text after
 * the group, inline attributes only, no CSS and no external resource.
 */
export function writeDiagramSvg(diagram: PlacedDiagram): string {
	const bounds = new Bounds();
	for (const node of diagram.nodes) {
		bounds.add(node.x, node.y);
		bounds.add(node.x + node.width, node.y + node.height);
		if (node.numeralAt && node.numeral !== undefined) {
			const half = textWidth(String(node.numeral), NUMERAL_FONT_SIZE) / 2;
			bounds.add(node.numeralAt.x - half, node.numeralAt.y - NUMERAL_FONT_SIZE * 0.8);
			bounds.add(node.numeralAt.x + half, node.numeralAt.y + NUMERAL_FONT_SIZE * 0.2);
		}
	}
	for (const edge of diagram.edges) {
		edge.points.forEach(point => bounds.add(point.x, point.y));
		if (edge.labelAt && edge.label !== undefined) {
			const half = textWidth(edge.label) / 2;
			bounds.add(edge.labelAt.x - half, edge.labelAt.y - FONT_SIZE / 2);
			bounds.add(edge.labelAt.x + half, edge.labelAt.y + FONT_SIZE / 2);
		}
	}
	const dx = PADDING - bounds.minX;
	const dy = PADDING - bounds.minY;
	const width = num(bounds.maxX - bounds.minX + 2 * PADDING);
	const height = num(bounds.maxY - bounds.minY + 2 * PADDING);
	const p = (point: Point) => `${num(point.x + dx)} ${num(point.y + dy)}`;
	const at = (point: Point) => `x="${num(point.x + dx)}" y="${num(point.y + dy)}"`;

	const out: string[] = [
		`<svg xmlns="http://www.w3.org/2000/svg" width="${width}mm" height="${height}mm" viewBox="0 0 ${width} ${height}" data-figure="FIG-${diagram.figure}" data-kind="${diagram.kind}">`,
		`<rect width="${width}" height="${height}" fill="#fff"/>`,
		'<g fill="none" stroke="#000" stroke-linecap="round" stroke-linejoin="round">',
	];
	for (const node of diagram.nodes) {
		out.push(`<path class="edge" data-node="${escape(node.id)}" data-role="${node.kind}" stroke-width="0.4" d="${outline(node, p)}"/>`);
	}
	for (const edge of diagram.edges) {
		if (edge.points.length < 2) {
			continue;
		}
		out.push(`<path class="edge" data-role="connector" data-from="${escape(edge.from)}" data-to="${escape(edge.to)}" stroke-width="0.4" d="M${edge.points.map(p).join(' L')}"/>`);
		if (edge.arrowEnd) {
			out.push(arrowhead(edge.points[edge.points.length - 2], edge.points[edge.points.length - 1], p));
		}
		if (edge.arrowStart) {
			out.push(arrowhead(edge.points[1], edge.points[0], p));
		}
	}
	for (const node of diagram.nodes) {
		if (node.numeral !== undefined && node.numeralAt) {
			// The lead line runs straight from the numeral to the right side of its box.
			const left = node.numeralAt.x - textWidth(String(node.numeral), NUMERAL_FONT_SIZE) / 2;
			const leadY = node.numeralAt.y - NUMERAL_FONT_SIZE * 0.3;
			out.push(`<path class="lead" data-numeral="${node.numeral}" data-node="${escape(node.id)}" stroke-width="0.2" d="M${p({ x: left - 0.5, y: leadY })} L${p({ x: node.x + node.width, y: leadY })}"/>`);
		}
	}
	out.push('</g>');

	const textAttrs = (size: number) => `font-size="${size}" font-family="${FONT_FAMILY}" text-anchor="middle" fill="#000"`;
	for (const node of diagram.nodes) {
		const cx = node.x + node.width / 2;
		const top = node.y + node.height / 2 - node.lines.length * LINE_HEIGHT / 2;
		node.lines.forEach((line, index) => {
			out.push(`<text class="label" data-node="${escape(node.id)}" ${at({ x: cx, y: top + LINE_HEIGHT * (index + 0.5) + BASELINE_OFFSET })} ${textAttrs(FONT_SIZE)}>${escape(line)}</text>`);
		});
	}
	for (const edge of diagram.edges) {
		if (edge.labelAt && edge.label !== undefined) {
			out.push(`<text class="label" data-edge="${escape(edge.id)}" ${at({ x: edge.labelAt.x, y: edge.labelAt.y + BASELINE_OFFSET })} ${textAttrs(FONT_SIZE)}>${escape(edge.label)}</text>`);
		}
	}
	for (const node of diagram.nodes) {
		if (node.numeral !== undefined && node.numeralAt) {
			out.push(`<text class="numeral" data-numeral="${node.numeral}" data-node="${escape(node.id)}" ${at(node.numeralAt)} ${textAttrs(NUMERAL_FONT_SIZE)}>${node.numeral}</text>`);
		}
	}
	out.push('</svg>');
	return out.join('\n') + '\n';
}

function outline(node: PlacedNode, p: (point: Point) => string): string {
	const { x, y, width: w, height: h } = node;
	if (node.kind === 'decision') {
		return `M${p({ x: x + w / 2, y })} L${p({ x: x + w, y: y + h / 2 })} L${p({ x: x + w / 2, y: y + h })} L${p({ x, y: y + h / 2 })} Z`;
	}
	if (node.kind === 'terminal') {
		const r = num(h / 2);
		return `M${p({ x: x + h / 2, y })} L${p({ x: x + w - h / 2, y })} A${r} ${r} 0 0 1 ${p({ x: x + w - h / 2, y: y + h })} L${p({ x: x + h / 2, y: y + h })} A${r} ${r} 0 0 1 ${p({ x: x + h / 2, y })} Z`;
	}
	return `M${p({ x, y })} L${p({ x: x + w, y })} L${p({ x: x + w, y: y + h })} L${p({ x, y: y + h })} Z`;
}

/** A filled arrowhead with its tip on `tip`, pointing away from `from`. */
function arrowhead(from: Point, tip: Point, p: (point: Point) => string): string {
	const length = Math.hypot(tip.x - from.x, tip.y - from.y) || 1;
	const ux = (tip.x - from.x) / length;
	const uy = (tip.y - from.y) / length;
	const base = { x: tip.x - ux * ARROW_LENGTH, y: tip.y - uy * ARROW_LENGTH };
	const left = { x: base.x - uy * ARROW_HALF_WIDTH, y: base.y + ux * ARROW_HALF_WIDTH };
	const right = { x: base.x + uy * ARROW_HALF_WIDTH, y: base.y - ux * ARROW_HALF_WIDTH };
	return `<path class="arrow" fill="#000" stroke-width="0.2" d="M${p(tip)} L${p(left)} L${p(right)} Z"/>`;
}

/** A number in mm with at most two decimals, never `-0`. */
function num(value: number): string {
	const rounded = Math.round(value * 100) / 100;
	return String(rounded === 0 ? 0 : rounded);
}

function escape(text: string): string {
	return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

class Bounds {
	minX = Infinity;
	minY = Infinity;
	maxX = -Infinity;
	maxY = -Infinity;

	add(x: number, y: number): void {
		this.minX = Math.min(this.minX, x);
		this.minY = Math.min(this.minY, y);
		this.maxX = Math.max(this.maxX, x);
		this.maxY = Math.max(this.maxY, y);
	}
}
