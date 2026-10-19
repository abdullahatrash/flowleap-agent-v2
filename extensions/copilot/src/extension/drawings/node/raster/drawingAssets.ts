/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { existsSync, promises as fs } from 'fs';
import * as path from 'path';

/** The resvg WebAssembly file name in `dist/` (copied by `script/postinstall.ts`). */
export const RESVG_WASM_FILE = 'resvg.wasm';

/** The extension root: `dist/..` in the bundle, five folders up from this file in the sources. */
function extensionRoot(): string {
	return path.basename(__dirname) === 'dist' ? path.resolve(__dirname, '..') : path.resolve(__dirname, '../../../../..');
}

/** The bundled sans font (Liberation Sans, SIL OFL 1.1, license beside it) for review renders and the PDF. */
export function drawingFontPath(): string {
	return path.join(extensionRoot(), 'assets', 'fonts', 'LiberationSans-Regular.ttf');
}

/** The resvg WebAssembly file: `dist/resvg.wasm`, or the package file when running from the sources before a build. */
export function resvgWasmPath(): string {
	const built = path.join(extensionRoot(), 'dist', RESVG_WASM_FILE);
	return existsSync(built) ? built : path.join(extensionRoot(), 'node_modules', '@resvg', 'resvg-wasm', 'index_bg.wasm');
}

let font: Promise<Uint8Array> | undefined;

/** Reads the bundled font once. */
export function loadDrawingFont(): Promise<Uint8Array> {
	font ??= fs.readFile(drawingFontPath()).then(buffer => new Uint8Array(buffer));
	return font;
}
