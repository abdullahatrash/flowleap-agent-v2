/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { layoutDrawingSheets } from '../../common/sheets/sheetLayout';
import { figure } from '../../common/sheets/test/figureFixtures';
import { writeDrawingsPdf } from '../pdf/drawingsPdf';
import { figureReviewPath, sheetReviewPath, writeReviewPng } from '../raster/rasterize';

function sheetsOf(result: ReturnType<typeof layoutDrawingSheets>): string[] {
	if (!result.ok) {
		throw new Error(result.reason);
	}
	return result.sheets.map(sheet => sheet.svg);
}

/** Width and height from the PNG IHDR chunk. */
function pngSize(bytes: Buffer): { width: number; height: number } {
	return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

describe('drawings output files', () => {
	let dir: string;

	beforeEach(async () => {
		dir = await fs.mkdtemp(path.join(os.tmpdir(), 'drawings-'));
	});

	afterEach(async () => {
		await fs.rm(dir, { recursive: true, force: true });
	});

	it('writes drawings.pdf with one A4 page per sheet and the font embedded', async () => {
		const sheets = sheetsOf(layoutDrawingSheets('US', 'A4', [figure(1, 160, 120), figure(2, 240, 100)]));
		await writeDrawingsPdf(dir, sheets, { date: new Date(Date.UTC(2026, 9, 12)) });
		const source = (await fs.readFile(path.join(dir, 'drawings.pdf'))).toString('latin1');
		expect({
			header: source.slice(0, 8),
			pages: (source.match(/\/Type\s*\/Page\b(?!s)/g) ?? []).length,
			mediaBoxes: [...source.matchAll(/\/MediaBox\s*\[(?<box>[^\]]*)\]/g)].map(match => match.groups!.box.trim()),
			baseFonts: [...new Set([...source.matchAll(/\/BaseFont\s*\/(?<name>[^\s/>]+)/g)].map(match => match.groups!.name.replace(/^[A-Z]{6}\+/, '')))],
			fontFile2: /\/FontFile2\b/.test(source),
			encrypted: /\/Encrypt\b/.test(source),
		}).toMatchInlineSnapshot(`
			{
			  "baseFonts": [
			    "LiberationSans",
			  ],
			  "encrypted": false,
			  "fontFile2": true,
			  "header": "%PDF-1.4",
			  "mediaBoxes": [
			    "0 0 595.275591 841.889764",
			    "0 0 595.275591 841.889764",
			  ],
			  "pages": 2,
			}
		`);
	});

	it('renders a review PNG of an A4 sheet at 300 dpi under review/', async () => {
		const [sheet] = sheetsOf(layoutDrawingSheets('EPO', 'A4', [figure(1, 120, 90)]));
		await writeReviewPng(dir, sheetReviewPath(1), sheet);
		await writeReviewPng(dir, figureReviewPath('1', 2), figure(1, 120, 90).svg);
		expect({
			sheet: pngSize(await fs.readFile(path.join(dir, 'review', 'sheet-1.png'))),
			figure: pngSize(await fs.readFile(path.join(dir, 'review', 'FIG-1.round-2.png'))),
		}).toMatchInlineSnapshot(`
			{
			  "figure": {
			    "height": 1063,
			    "width": 1417,
			  },
			  "sheet": {
			    "height": 3508,
			    "width": 2480,
			  },
			}
		`);
	});
});
