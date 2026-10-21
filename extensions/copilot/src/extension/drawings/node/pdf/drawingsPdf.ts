/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { promises as fs } from 'fs';
import * as path from 'path';
import type { PdfFacts } from '../../common/sheets/receipt';
import { Matrix, parseLength, parseSvg, SvgNode, walkSvg } from '../../common/sheets/svgTree';
import { drawingFontPath } from '../raster/drawingAssets';

/** PDF points per millimetre. */
const POINTS_PER_MM = 72 / 25.4;

/** The PDF version: 1.4 is inside the USPTO range 1.1 to 1.6 and is what PCT Annex F 3.1.2 names. */
const PDF_VERSION = '1.4';

type PdfDocument = PDFKit.PDFDocument;

function numbers(value: string | undefined): number[] {
	return (value ?? '').trim().split(/[\s,]+/).filter(item => item.length > 0).map(Number).filter(Number.isFinite);
}

/** Sets the stroke and fill state from the inherited style and paints the current path. */
function paint(doc: PdfDocument, style: ReadonlyMap<string, string>): void {
	const fill = style.get('fill') ?? '#000';
	const stroke = style.get('stroke') ?? 'none';
	const strokeWidth = parseLength(style.get('stroke-width')) ?? 1;
	const dash = numbers(style.get('stroke-dasharray'));
	doc.lineWidth(strokeWidth);
	doc.lineCap(style.get('stroke-linecap') ?? 'butt');
	doc.lineJoin(style.get('stroke-linejoin') ?? 'miter');
	if (dash.length > 0 && dash.some(value => value > 0)) {
		doc.dash(dash[0], { space: dash[1] ?? dash[0] });
	} else {
		doc.undash();
	}
	const filled = fill !== 'none' && fill !== 'transparent';
	const stroked = stroke !== 'none' && stroke !== 'transparent' && strokeWidth > 0;
	if (filled && stroked) {
		doc.fillAndStroke(fill, stroke);
	} else if (filled) {
		doc.fill(fill);
	} else if (stroked) {
		doc.stroke(stroke);
	}
}

/** Builds the path of one shape element; false when the element draws nothing. */
function shape(doc: PdfDocument, node: SvgNode): boolean {
	const attr = (name: string) => parseLength(node.attrs.get(name)) ?? 0;
	switch (node.name) {
		case 'path': {
			const data = node.attrs.get('d');
			if (!data) {
				return false;
			}
			doc.path(data);
			return true;
		}
		case 'line':
			doc.moveTo(attr('x1'), attr('y1')).lineTo(attr('x2'), attr('y2'));
			return true;
		case 'rect':
			doc.rect(attr('x'), attr('y'), attr('width'), attr('height'));
			return true;
		case 'circle':
			doc.circle(attr('cx'), attr('cy'), attr('r'));
			return true;
		case 'ellipse':
			doc.ellipse(attr('cx'), attr('cy'), attr('rx'), attr('ry'));
			return true;
		case 'polyline':
		case 'polygon': {
			const points = numbers(node.attrs.get('points'));
			if (points.length < 4) {
				return false;
			}
			doc.moveTo(points[0], points[1]);
			for (let index = 2; index + 1 < points.length; index += 2) {
				doc.lineTo(points[index], points[index + 1]);
			}
			if (node.name === 'polygon') {
				doc.closePath();
			}
			return true;
		}
		default:
			return false;
	}
}

function text(doc: PdfDocument, node: SvgNode, style: ReadonlyMap<string, string>): void {
	const content = node.text.trim();
	if (!content) {
		return;
	}
	const size = parseLength(style.get('font-size')) ?? 3.2;
	doc.fontSize(size);
	const width = doc.widthOfString(content);
	const anchor = style.get('text-anchor') ?? 'start';
	const x = (parseLength(node.attrs.get('x')) ?? 0) - (anchor === 'middle' ? width / 2 : anchor === 'end' ? width : 0);
	const y = parseLength(node.attrs.get('y')) ?? 0;
	const fill = style.get('fill') ?? '#000';
	doc.fillColor(fill === 'none' ? '#000' : fill);
	doc.text(content, x, y, { lineBreak: false, baseline: 'alphabetic' });
}

/**
 * Draws one sheet SVG as vector paths on the current page. The translator covers the subset the
 * drawings engine writes: `path`, `line`, `rect`, `circle`, `ellipse`, `polyline`, `polygon`,
 * `text`, `g` with `transform`, nested `svg` with `viewBox`, and the presentation attributes
 * fill, stroke, stroke-width, stroke-dasharray, line caps and joins, font-size and text-anchor.
 */
function drawSheet(doc: PdfDocument, root: SvgNode): void {
	walkSvg(root, ({ node, matrix, style }) => {
		if (node.name === 'g' || node.name === 'svg') {
			return;
		}
		doc.save();
		const [a, b, c, d, e, f]: Matrix = matrix;
		doc.transform(a, b, c, d, e, f);
		if (node.name === 'text') {
			text(doc, node, style);
		} else if (shape(doc, node)) {
			paint(doc, style);
		}
		doc.restore();
	});
}

/**
 * Loads pdfkit on first use. `require`, not `import()`: the "require" export condition selects
 * pdfkit's CommonJS build, whose data paths resolve from `__filename` inside the bundle; the ESM
 * build reads `import.meta.url` and fails when bundled to CommonJS.
 */
function loadPdfKit(): typeof import('pdfkit') {
	return require('pdfkit');
}

/** Options for {@link renderDrawingsPdf}. */
export interface DrawingsPdfOptions {
	/** The document date; fixed for a deterministic file. */
	readonly date?: Date;
	readonly title?: string;
}

/**
 * Renders the Drawing Sheets into one PDF: one page per sheet at the sheet's page size, every line
 * a vector path, the bundled sans font embedded, PDF 1.4, no encryption, no compression, no
 * annotations or layers (USPTO Patent Center PDF Guidelines; PCT Annex F 3.1.2). Review PNGs never
 * enter this file.
 */
export async function renderDrawingsPdf(sheets: readonly string[], options: DrawingsPdfOptions = {}): Promise<Uint8Array> {
	const PDFDocument = loadPdfKit();
	const date = options.date ?? new Date();
	const doc = new PDFDocument({
		autoFirstPage: false,
		pdfVersion: PDF_VERSION,
		compress: false,
		font: drawingFontPath(),
		info: { Title: options.title ?? 'Drawings', Producer: 'FlowLeap', Creator: 'FlowLeap', CreationDate: date, ModDate: date },
	});
	const chunks: Buffer[] = [];
	const done = new Promise<void>((resolve, reject) => {
		doc.on('data', (chunk: Buffer) => chunks.push(chunk));
		doc.on('end', () => resolve());
		doc.on('error', reject);
	});
	for (const source of sheets) {
		const root = parseSvg(source);
		const width = parseLength(root.attrs.get('width')) ?? 210;
		const height = parseLength(root.attrs.get('height')) ?? 297;
		doc.addPage({ size: [width * POINTS_PER_MM, height * POINTS_PER_MM], margin: 0 });
		doc.save();
		doc.scale(POINTS_PER_MM);
		drawSheet(doc, root);
		doc.restore();
	}
	doc.end();
	await done;
	return new Uint8Array(Buffer.concat(chunks));
}

/** Writes `drawings.pdf` into `drawingsDir` and returns its read-back for the receipt. */
export async function writeDrawingsPdf(drawingsDir: string, sheets: readonly string[], options: DrawingsPdfOptions = {}): Promise<PdfFacts> {
	const bytes = await renderDrawingsPdf(sheets, options);
	await fs.mkdir(drawingsDir, { recursive: true });
	await fs.writeFile(path.join(drawingsDir, 'drawings.pdf'), bytes);
	return inspectPdf(bytes);
}

/** Reads the facts the receipt records from PDF bytes: version, pages, page sizes, font embedding, encryption. */
export function inspectPdf(bytes: Uint8Array): PdfFacts {
	const source = Buffer.from(bytes).toString('latin1');
	const version = /^%PDF-(?<version>\d\.\d)/.exec(source)?.groups?.version ?? '?';
	const pageSizes = [...source.matchAll(/\/Type\s*\/Page\b[\s\S]*?\/MediaBox\s*\[\s*(?<x0>[\d.-]+)\s+(?<y0>[\d.-]+)\s+(?<x1>[\d.-]+)\s+(?<y1>[\d.-]+)\s*\]/g)]
		.map(match => ({ width: (Number(match.groups!.x1) - Number(match.groups!.x0)) / POINTS_PER_MM, height: (Number(match.groups!.y1) - Number(match.groups!.y0)) / POINTS_PER_MM }));
	const fonts = [...source.matchAll(/\/Type\s*\/FontDescriptor\b[\s\S]*?>>/g)].map(match => match[0]);
	// Simple and descendant fonts each need a descriptor; a Type0 font points at its descendant.
	const fontObjects = (source.match(/\/Subtype\s*\/(?:TrueType|Type1|MMType1|Type3|CIDFontType0|CIDFontType2)\b/g) ?? []).length;
	return {
		version,
		pageCount: (source.match(/\/Type\s*\/Page\b(?!s)/g) ?? []).length,
		pageSizes,
		fontsEmbedded: fonts.length > 0 && fonts.length === fontObjects && fonts.every(font => /\/FontFile[23]?\b/.test(font)),
		encrypted: /\/Encrypt\b/.test(source),
	};
}
