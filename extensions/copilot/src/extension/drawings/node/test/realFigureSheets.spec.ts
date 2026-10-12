/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { readFileSync } from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { writeDrawingsReceipt } from '../../common/sheets/receipt';
import { DrawingOffice, FigureInput, layoutDrawingSheets } from '../../common/sheets/sheetLayout';

/** Real Figure writer output: the D1 engine box fixture (PR #654) and the D3 flowchart snapshot (PR #655). */
const figures: readonly FigureInput[] = [
	{ number: 1, svg: readFileSync(path.join(__dirname, 'fixtures', 'input-box-two-numerals.svg'), 'utf8') },
	{ number: 2, svg: readFileSync(path.join(__dirname, 'fixtures', 'input-flowchart-us-linear.svg'), 'utf8') },
];

function sheetsOf(office: DrawingOffice): string[] {
	const result = layoutDrawingSheets(office, 'A4', figures);
	if (!result.ok) {
		throw new Error(result.reason);
	}
	return result.sheets.map(sheet => sheet.svg);
}

describe('Drawing Sheets from real Figure writer output', () => {
	for (const office of ['US', 'EPO'] as const) {
		sheetsOf(office).forEach((sheet, index) => {
			it(`${office} sheet ${index + 1}`, async () => {
				await expect(sheet).toMatchFileSnapshot(`fixtures/real-${office.toLowerCase()}.sheet-${index + 1}.svg`);
			});
		});
	}

	it('the receipt over the real Figures has no failing sheet check', () => {
		const receipt = writeDrawingsReceipt({ office: 'US', pageSize: 'A4', sheets: sheetsOf('US'), reviewRounds: [], date: '2026-10-12' });
		expect(receipt.checks.map(row => `${row.id}: ${row.result}`)).toMatchInlineSnapshot(`
			[
			  "page-size: pass",
			  "margins: pass",
			  "no-frame: pass",
			  "glyph-height: pass",
			  "label-larger-than-numerals: pass",
			  "single-figure-no-label: not-checked",
			  "figure-labels: pass",
			  "sheet-numbering: pass",
			  "orientation: pass",
			  "text-keywords: pass",
			  "no-scale-text: pass",
			  "pdf-format: not-checked",
			]
		`);
	});
});
