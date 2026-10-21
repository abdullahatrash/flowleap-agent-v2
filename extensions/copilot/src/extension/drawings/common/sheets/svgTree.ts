/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * One element of the small SVG subset the drawings engine writes: no CSS, no external resources,
 * presentation as inline attributes, user unit millimetres.
 */
export interface SvgNode {
	readonly name: string;
	readonly attrs: ReadonlyMap<string, string>;
	readonly children: SvgNode[];
	/** The decoded character data directly inside the element (text elements only). */
	text: string;
}

/** A 2D affine matrix `[a, b, c, d, e, f]` in the SVG order. */
export type Matrix = readonly [number, number, number, number, number, number];

/** The identity matrix. */
export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** The presentation attributes a child inherits from its parent. */
const INHERITED = ['fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-linecap', 'stroke-linejoin', 'font-size', 'font-family', 'text-anchor'];

function decodeEntities(text: string): string {
	return text.replace(/&(?<entity>#x[0-9a-fA-F]+|#\d+|lt|gt|amp|quot|apos);/g, (_match, entity: string) => {
		switch (entity) {
			case 'lt': return '<';
			case 'gt': return '>';
			case 'amp': return '&';
			case 'quot': return '"';
			case 'apos': return '\'';
			default: return String.fromCodePoint(entity.startsWith('#x') ? Number.parseInt(entity.slice(2), 16) : Number.parseInt(entity.slice(1), 10));
		}
	});
}

/** Escapes text for an SVG attribute or character data. */
export function escapeXml(text: string): string {
	return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function parseAttributes(source: string): Map<string, string> {
	const attrs = new Map<string, string>();
	for (const match of source.matchAll(/(?<name>[\w:.-]+)\s*=\s*(?:"(?<double>[^"]*)"|'(?<single>[^']*)')/g)) {
		const groups = match.groups!;
		attrs.set(groups.name, decodeEntities(groups.double ?? groups.single ?? ''));
	}
	return attrs;
}

/**
 * Parses an SVG document of the subset into its root element. Comments, processing instructions
 * and a doctype are skipped. Throws when the document has no `<svg>` root.
 */
export function parseSvg(source: string): SvgNode {
	const cleaned = source.replace(/<!--[\s\S]*?-->/g, '').replace(/<\?[\s\S]*?\?>/g, '').replace(/<!DOCTYPE[^>]*>/gi, '');
	const stack: SvgNode[] = [];
	let root: SvgNode | undefined;
	for (const match of cleaned.matchAll(/<(?<closing>\/?)(?<name>[a-zA-Z][\w:.-]*)(?<attrs>[^>]*?)(?<selfClosing>\/?)>|(?<text>[^<]+)/g)) {
		const groups = match.groups!;
		if (groups.text !== undefined) {
			const parent = stack[stack.length - 1];
			if (parent && parent.name === 'text') {
				parent.text += decodeEntities(groups.text);
			}
			continue;
		}
		if (groups.closing) {
			stack.pop();
			continue;
		}
		const node: SvgNode = { name: groups.name, attrs: parseAttributes(groups.attrs), children: [], text: '' };
		const parent = stack[stack.length - 1];
		if (parent) {
			parent.children.push(node);
		} else if (!root) {
			root = node;
		}
		if (!groups.selfClosing) {
			stack.push(node);
		}
	}
	if (!root || root.name !== 'svg') {
		throw new Error('The document has no <svg> root element.');
	}
	return root;
}

/** Reads a length in millimetres: a bare number (user unit mm) or a number with `mm`. */
export function parseLength(value: string | undefined): number | undefined {
	if (value === undefined) {
		return undefined;
	}
	const match = /^\s*(?<number>-?\d*\.?\d+(?:e-?\d+)?)\s*(?<unit>mm)?\s*$/i.exec(value);
	return match ? Number.parseFloat(match.groups!.number) : undefined;
}

/** Reads a `viewBox` as `[x, y, width, height]`. */
export function parseViewBox(value: string | undefined): [number, number, number, number] | undefined {
	const numbers = value?.trim().split(/[\s,]+/).map(Number);
	return numbers && numbers.length === 4 && numbers.every(Number.isFinite) ? [numbers[0], numbers[1], numbers[2], numbers[3]] : undefined;
}

/** The product `left × right` (apply `right` first). */
export function multiply(left: Matrix, right: Matrix): Matrix {
	const [a, b, c, d, e, f] = left;
	const [g, h, i, j, k, l] = right;
	return [a * g + c * h, b * g + d * h, a * i + c * j, b * i + d * j, a * k + c * l + e, b * k + d * l + f];
}

/** Applies `matrix` to the point `(x, y)`. */
export function applyMatrix(matrix: Matrix, x: number, y: number): [number, number] {
	const [a, b, c, d, e, f] = matrix;
	return [a * x + c * y + e, b * x + d * y + f];
}

/** The linear scale factor of a matrix (square root of its determinant), for glyph heights. */
export function matrixScale(matrix: Matrix): number {
	return Math.sqrt(Math.abs(matrix[0] * matrix[3] - matrix[1] * matrix[2]));
}

/** Parses an SVG `transform` list of `translate`, `rotate`, `scale` and `matrix`. */
function parseTransform(value: string | undefined): Matrix {
	let result: Matrix = IDENTITY;
	if (!value) {
		return result;
	}
	for (const match of value.matchAll(/(?<kind>translate|rotate|scale|matrix)\s*\((?<args>[^)]*)\)/g)) {
		const args = match.groups!.args.trim().split(/[\s,]+/).filter(arg => arg.length > 0).map(Number);
		let step: Matrix = IDENTITY;
		switch (match.groups!.kind) {
			case 'translate':
				step = [1, 0, 0, 1, args[0] ?? 0, args[1] ?? 0];
				break;
			case 'scale':
				step = [args[0] ?? 1, 0, 0, args[1] ?? args[0] ?? 1, 0, 0];
				break;
			case 'rotate': {
				const radians = (args[0] ?? 0) * Math.PI / 180;
				const cos = Math.cos(radians);
				const sin = Math.sin(radians);
				const [cx, cy] = [args[1] ?? 0, args[2] ?? 0];
				step = multiply(multiply([1, 0, 0, 1, cx, cy], [cos, sin, -sin, cos, 0, 0]), [1, 0, 0, 1, -cx, -cy]);
				break;
			}
			case 'matrix':
				if (args.length === 6) {
					step = [args[0], args[1], args[2], args[3], args[4], args[5]];
				}
				break;
		}
		result = multiply(result, step);
	}
	return result;
}

/** What a visitor receives for each element: its full transform to the root and its inherited style. */
export interface SvgVisit {
	readonly node: SvgNode;
	/** Element coordinates to root (page) millimetres. */
	readonly matrix: Matrix;
	/** The presentation attributes in effect: inherited, then the element's own. */
	readonly style: ReadonlyMap<string, string>;
	/** The nearest enclosing nested `<svg>` (a placed Figure), if any. */
	readonly viewport?: SvgNode;
}

/** The transform a nested `<svg>` viewport adds: position, then `viewBox` to width and height. */
function viewportMatrix(node: SvgNode): Matrix {
	const x = parseLength(node.attrs.get('x')) ?? 0;
	const y = parseLength(node.attrs.get('y')) ?? 0;
	const viewBox = parseViewBox(node.attrs.get('viewBox'));
	const width = parseLength(node.attrs.get('width'));
	const height = parseLength(node.attrs.get('height'));
	if (!viewBox || width === undefined || height === undefined) {
		return [1, 0, 0, 1, x, y];
	}
	return multiply([1, 0, 0, 1, x, y], [width / viewBox[2], 0, 0, height / viewBox[3], -viewBox[0] * width / viewBox[2], -viewBox[1] * height / viewBox[3]]);
}

/**
 * Visits every element below `root` in document order with its matrix to the root coordinate
 * system (the root's own `viewBox` is taken as the page in millimetres) and its inherited style.
 */
export function walkSvg(root: SvgNode, visit: (item: SvgVisit) => void): void {
	const recurse = (node: SvgNode, parentMatrix: Matrix, parentStyle: ReadonlyMap<string, string>, viewport: SvgNode | undefined) => {
		let matrix = multiply(parentMatrix, parseTransform(node.attrs.get('transform')));
		if (node.name === 'svg') {
			matrix = multiply(matrix, viewportMatrix(node));
			viewport = node;
		}
		const style = new Map(parentStyle);
		for (const name of INHERITED) {
			const value = node.attrs.get(name);
			if (value !== undefined) {
				style.set(name, value);
			}
		}
		visit({ node, matrix, style, viewport });
		for (const child of node.children) {
			recurse(child, matrix, style, viewport);
		}
	};
	for (const child of root.children) {
		recurse(child, IDENTITY, new Map(INHERITED.flatMap(name => root.attrs.has(name) ? [[name, root.attrs.get(name)!] as const] : [])), undefined);
	}
}
