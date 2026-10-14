/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { promises as fs } from 'fs';
import * as path from 'path';
import { loadDrawingFont, resvgWasmPath } from './drawingAssets';

/** Review renders are 300 dpi: the resolution OJ EPO 2025 A49 Art. 1(2)(a) and PCT Annex F 3.1.3 name. */
export const REVIEW_DPI = 300;

type ResvgModule = typeof import('@resvg/resvg-wasm');

let resvg: Promise<ResvgModule> | undefined;

/** Loads the resvg module and its WebAssembly once, on the first render. */
function loadResvg(): Promise<ResvgModule> {
	resvg ??= (async () => {
		// `require` keeps the CommonJS build in the bundle, like pdfkit in drawingsPdf.ts.
		const module: ResvgModule = require('@resvg/resvg-wasm');
		await module.initWasm(await fs.readFile(resvgWasmPath()));
		return module;
	})();
	return resvg;
}

/** A rendered PNG. */
export interface RasterImage {
	readonly png: Uint8Array;
	readonly width: number;
	readonly height: number;
}

/**
 * Renders a Figure or sheet SVG (millimetre units) to a PNG at 300 dpi, black on white, with the
 * bundled sans font as the only font. For the model's review loop only; never part of the PDF.
 */
export async function rasterizeSvg(svg: string): Promise<RasterImage> {
	const [module, font] = await Promise.all([loadResvg(), loadDrawingFont()]);
	const renderer = new module.Resvg(svg, {
		dpi: REVIEW_DPI,
		background: '#ffffff',
		font: { fontBuffers: [font], defaultFontFamily: 'Liberation Sans', sansSerifFamily: 'Liberation Sans' },
	});
	try {
		const image = renderer.render();
		try {
			return { png: image.asPng(), width: image.width, height: image.height };
		} finally {
			image.free();
		}
	} finally {
		renderer.free();
	}
}

/** The review render path of a Figure round, relative to `drawings/`: `review/FIG-1A.round-2.png`. */
export function figureReviewPath(figure: string, round: number): string {
	return `review/FIG-${figure}.round-${round}.png`;
}

/** The review render path of a sheet, relative to `drawings/`: `review/sheet-1.png`. */
export function sheetReviewPath(sheet: number): string {
	return `review/sheet-${sheet}.png`;
}

/** Renders `svg` and writes the PNG to `drawingsDir/relativePath` (a path under `review/`). */
export async function writeReviewPng(drawingsDir: string, relativePath: string, svg: string): Promise<RasterImage> {
	if (!relativePath.startsWith('review/')) {
		throw new Error(`Review renders stay under review/: ${relativePath}`);
	}
	const image = await rasterizeSvg(svg);
	const target = path.join(drawingsDir, relativePath);
	await fs.mkdir(path.dirname(target), { recursive: true });
	await fs.writeFile(target, image.png);
	return image;
}
