/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { writeDrawingsReceipt } from '../receipt';
import { layoutDrawingSheets } from '../sheetLayout';
import { figure, figureSvg } from './figureFixtures';

function sheetsOf(result: ReturnType<typeof layoutDrawingSheets>): string[] {
	if (!result.ok) {
		throw new Error(result.reason);
	}
	return result.sheets.map(sheet => sheet.svg);
}

describe('drawings-compliance.md receipt', () => {
	it('records one failing check: a frame drawn around the sight', async () => {
		const [first, second] = sheetsOf(layoutDrawingSheets('US', 'A4', [figure(1, 160, 120), figure(2, 160, 120)]));
		const framed = first.replace('<g class="figures"', '<rect x="25" y="25" width="170" height="262" fill="none" stroke="#000" stroke-width="0.4"/>\n<g class="figures"');
		const receipt = writeDrawingsReceipt({
			office: 'US',
			pageSize: 'A4',
			sheets: [framed, second],
			figureRules: { 'lead-lines-cross': '37 CFR 1.84(q) ("Lead lines must not cross each other")' },
			figureFindings: [],
			reviewRounds: [
				{ figure: '1', rounds: [{ round: 1, png: 'review/FIG-1.round-1.png' }, { round: 2, png: 'review/FIG-1.round-2.png' }] },
				{ figure: '2', rounds: [] },
			],
			pdf: { version: '1.4', pageCount: 2, fontsEmbedded: true, encrypted: false, pageSizes: [{ width: 210, height: 297 }, { width: 210, height: 297 }] },
			date: '2026-10-12',
		});
		await expect(receipt.markdown).toMatchFileSnapshot('fixtures/receipt-one-failing.md');
	});

	it('flags legend text beyond keywords on a 3D Figure and merges a Figure-level Error', () => {
		const sheets = sheetsOf(layoutDrawingSheets('EPO', 'A4', [{ number: 1, svg: figureSvg(1, 120, 90, { legend: 'water flows into the open tank' }) }]));
		const receipt = writeDrawingsReceipt({
			office: 'EPO',
			pageSize: 'A4',
			sheets,
			figureFindings: [{ severity: 'Error', rule: 'lead-line-off-part', message: 'Lead line of 12 ends 3 mm from part "housing".', file: 'FIG-1.svg', citation: '37 CFR 1.84(q)' }],
			reviewRounds: [],
			date: '2026-10-12',
		});
		expect(receipt.checks.filter(row => row.result !== 'pass')).toMatchInlineSnapshot(`
			[
			  {
			    "citation": "37 CFR 1.84(u)(1); GL A-IX 5.2; PCT Rule 11.13(k), IP 5.141 ("FIG." / "Fig.", consecutive Arabic numerals, partial views as number plus capital letter)",
			    "detail": "A single-figure Drawing Set has no labels.",
			    "id": "figure-labels",
			    "result": "not-checked",
			  },
			  {
			    "citation": "37 CFR 1.84(o); MPEP 507(C); OJ EPO 2025 A49 Art. 1(2)(j); PCT Rule 11.11 (a few short keywords; flowcharts and block diagrams excepted)",
			    "detail": "Figure 1 has 6 words of text",
			    "id": "text-keywords",
			    "result": "fail",
			  },
			  {
			    "citation": "USPTO Patent Center PDF Guidelines; PCT Annex F 3.1.2 (PDF 1.4 to 1.6, fonts embedded, unencrypted, one page per sheet, A4 or Letter)",
			    "detail": "No PDF read-back was given.",
			    "id": "pdf-format",
			    "result": "not-checked",
			  },
			  {
			    "citation": "37 CFR 1.84(q)",
			    "detail": "FIG-1.svg: Lead line of 12 ends 3 mm from part "housing".",
			    "id": "lead-line-off-part",
			    "result": "fail",
			  },
			]
		`);
	});

	it('a Figure-level Note passes its row and shows in the detail', () => {
		const sheets = sheetsOf(layoutDrawingSheets('US', 'A4', [figure(1, 120, 90)]));
		const receipt = writeDrawingsReceipt({
			office: 'US',
			pageSize: 'A4',
			sheets,
			figureRules: { 'hatch-same-as-neighbour': '37 CFR 1.84(h)(3)' },
			figureFindings: [{ severity: 'Note', rule: 'hatch-same-as-neighbour', message: 'Parts "b" and "c" touch and have the same hatch (45°, 2 mm); they read as one body.', file: 'FIG-1.svg', citation: '37 CFR 1.84(h)(3)' }],
			reviewRounds: [],
			date: '2026-10-16',
		});
		expect(receipt.checks.find(row => row.id === 'hatch-same-as-neighbour')).toEqual({
			id: 'hatch-same-as-neighbour',
			citation: '37 CFR 1.84(h)(3)',
			result: 'pass',
			detail: 'Note: FIG-1.svg: Parts "b" and "c" touch and have the same hatch (45°, 2 mm); they read as one body.',
		});
	});

	it('never writes the word "compliant"', () => {
		const sheets = sheetsOf(layoutDrawingSheets('PCT', 'A4', [figure(1, 80, 60)]));
		const receipt = writeDrawingsReceipt({ office: 'PCT', pageSize: 'A4', sheets, reviewRounds: [], date: '2026-10-12' });
		expect(/complian/i.test(receipt.markdown)).toBe(false);
	});
});
