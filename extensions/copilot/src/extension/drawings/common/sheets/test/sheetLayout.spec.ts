/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { DrawingOffice, FigureInput, layoutDrawingSheets } from '../sheetLayout';
import { figure } from './figureFixtures';

/** The single sheet of a layout, or the refusal reason. */
function onlySheet(office: DrawingOffice, figures: readonly FigureInput[]): string {
	const result = layoutDrawingSheets(office, 'A4', figures);
	if (!result.ok) {
		return result.reason;
	}
	return result.sheets.length === 1 ? result.sheets[0].svg : `${result.sheets.length} sheets`;
}

const cases: { name: string; figures: readonly FigureInput[] }[] = [
	{ name: 'portrait-single', figures: [figure(1, 120, 90)] },
	{ name: 'portrait-multi', figures: [figure(2, 70, 70), figure(1, 80, 60), figure(3, 60, 40, 'A'), figure(3, 60, 40, 'B')] },
	{ name: 'landscape-single', figures: [figure(1, 240, 120)] },
	{ name: 'landscape-multi', figures: [figure(1, 230, 60), figure(2, 200, 70)] },
];

describe('Drawing Sheet layout', () => {
	for (const office of ['US', 'EPO'] as const) {
		for (const { name, figures } of cases) {
			it(`${office} ${name}`, async () => {
				await expect(onlySheet(office, figures)).toMatchFileSnapshot(`fixtures/${office.toLowerCase()}-${name}.sheet.svg`);
			});
		}
	}

	it('refuses Letter for the EPO with the reason', () => {
		expect(layoutDrawingSheets('EPO', 'letter', [figure(1, 80, 60)])).toMatchInlineSnapshot(`
			{
			  "ok": false,
			  "reason": "Letter is a USPTO page size only. The EPO accepts A4 only (OJ EPO 2025 A49 Art. 2(2)). Use A4.",
			}
		`);
	});

	it('refuses a Figure whose numerals would go under 3.2 mm', () => {
		expect(layoutDrawingSheets('US', 'A4', [figure(1, 80, 60), figure(2, 420, 300)])).toMatchInlineSnapshot(`
			{
			  "ok": false,
			  "reason": "FIG. 2 is 420 x 300 mm. To fit the 170 x 262 mm sight it needs scale 0.542, which makes its smallest text 1.75 mm high, under the 3.2 mm minimum (37 CFR 1.84(p)(3); OJ EPO 2025 A49 Art. 1(2)(g); PCT Rule 11.13(h)). Split it into partial views or draw it smaller with the same numeral size.",
			}
		`);
	});

	it('puts several sheets in number order with n/N numbering', () => {
		const result = layoutDrawingSheets('PCT', 'A4', [figure(1, 160, 120), figure(2, 160, 120), figure(3, 240, 100)]);
		expect(result.ok ? result.sheets.map(sheet => ({ number: sheet.number, orientation: sheet.orientation, figures: sheet.figures.map(item => item.label), heading: /class="sheet-number"[^>]*>(?<text>[^<]*)</.exec(sheet.svg)?.groups?.text })) : result.reason).toMatchInlineSnapshot(`
			[
			  {
			    "figures": [
			      "Fig. 1",
			    ],
			    "heading": "1/3",
			    "number": 1,
			    "orientation": "portrait",
			  },
			  {
			    "figures": [
			      "Fig. 2",
			    ],
			    "heading": "2/3",
			    "number": 2,
			    "orientation": "portrait",
			  },
			  {
			    "figures": [
			      "Fig. 3",
			    ],
			    "heading": "3/3",
			    "number": 3,
			    "orientation": "landscape",
			  },
			]
		`);
	});
});
