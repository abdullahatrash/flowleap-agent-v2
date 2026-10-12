/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { checkClaimedFeatureCoverage, checkFigureProposals, checkFiguresSettings, checkNumeralScheme } from '../drafting/figureValidators';
import { parseDraftOutline } from '../drafting/outline';

const featureList = [
	'---',
	'office: US',
	'confirmed: true',
	'---',
	'| F1 | A hinge. |',
	'| F2 | A housing. |',
	'| F3 | A lever. |',
	'| F4 | A spring. |',
].join('\n');

const outline = parseDraftOutline([
	'---',
	'office: US',
	'claims: c1',
	'---',
	'# Draft Outline',
	'',
	'| Item | Section | Kind | Claims | Claim terms | Sources | Explain | Question |',
	'|------|---------|------|--------|-------------|---------|---------|----------|',
	'| O1 | Technical Field | Template |  |  |  | no |  |',
	'| O2 | Detailed Description | Technical | 1 | a housing | F2, FIG. 1 | yes |  |',
	'| O3 | Detailed Description | Technical | 1, 2 | a lever | F3 | yes |  |',
	'| O4 | Detailed Description | Technical | 1, 3 | a spring | F4 | yes |  |',
].join('\n'));

describe('Application Drafting figures.md validators', () => {

	it('settings: Notes for unknown values; for EPO an Error for letter sheets (OJ EPO 2025 A49 Art. 2(2))', () => {
		expect([
			checkFiguresSettings('---\nnumerals: hundreds\npageSize: letter\n---\n', 'US'),
			checkFiguresSettings('---\npageSize: letter\n---\n', 'EPO'),
			checkFiguresSettings('---\nnumerals: odd\npageSize: A3\n---\n', 'EPO'),
		]).toEqual([
			[],
			[{ severity: 'Error', rule: 'figures-settings', file: 'figures.md', message: 'figures.md sets `pageSize: letter`, but the EPO accepts A4 sheets only (OJ EPO 2025 A49 Art. 2(2)). Set `pageSize: A4`.' }],
			[
				{ severity: 'Note', rule: 'figures-settings', file: 'figures.md', message: 'figures.md sets `numerals: odd`; use `even` or `hundreds`. The checks use `even`.' },
				{ severity: 'Note', rule: 'figures-settings', file: 'figures.md', message: 'figures.md sets `pageSize: A3`; use `A4` or `letter`. The sheets use `A4`.' },
			],
		]);
	});

	it('numeral scheme even (the default): a Note once per odd numeral; a letter suffix is not read', () => {
		expect(checkNumeralScheme('## FIG. 1\n\n- 10: hinge\n- 12a: housing\n- 13: lever\n\n## FIG. 2\n\n- 13: lever\n- 15b: pin\n')).toEqual([
			{ severity: 'Note', rule: 'numeral-scheme', file: 'figures.md', line: 5, message: 'Numeral 13 ("lever") is odd, but figures.md uses the `numerals: even` scheme. Give the part an even numeral.' },
			{ severity: 'Note', rule: 'numeral-scheme', file: 'figures.md', line: 10, message: 'Numeral 15b ("pin") is odd, but figures.md uses the `numerals: even` scheme. Give the part an even numeral.' },
		]);
	});

	it('numeral scheme hundreds: the hundreds digit is the figure of first appearance; a range takes any of its figures; no figure heading, no check', () => {
		const figures = [
			'---',
			'numerals: hundreds',
			'---',
			'## FIG. 1',
			'- 102: housing',
			'- 104: lever',
			'- 204: bracket',
			'## FIG. 2',
			'- 104: lever',
			'- 202: pin',
			'- 12: clip',
			'## FIGS. 3 to 4',
			'- 402: gear',
			'## Parts named in the answers',
			'- 999: washer',
		].join('\n');
		expect(checkNumeralScheme(figures)).toEqual([
			{ severity: 'Note', rule: 'numeral-scheme', file: 'figures.md', line: 7, message: 'Numeral 204 ("bracket") first appears in FIG. 1, but figures.md uses the `numerals: hundreds` scheme: its hundreds digit must be the figure number, e.g. 102.' },
			{ severity: 'Note', rule: 'numeral-scheme', file: 'figures.md', line: 11, message: 'Numeral 12 ("clip") first appears in FIG. 2, but figures.md uses the `numerals: hundreds` scheme: its hundreds digit must be the figure number, e.g. 202.' },
		]);
	});

	it('proposals: an Error for each (proposed) line, with its source; none for confirmed parts', () => {
		expect(checkFigureProposals('## FIG. 1\n\n- 12: housing [F2]\n- 14: bracket (proposed)\n| 16 | clip [F3] (proposed from sketches/sketch-2.png) |\n')).toEqual([
			{ severity: 'Error', rule: 'figure-proposal', file: 'figures.md', line: 4, message: 'Part 14 ("bracket") is a proposal: the disclosure does not state it. The attorney confirms it by removing "(proposed)", or deletes the line.' },
			{ severity: 'Error', rule: 'figure-proposal', file: 'figures.md', line: 5, message: 'Part 16 ("clip") is a proposal from sketches/sketch-2.png: the disclosure does not state it. The attorney confirms it by removing "(proposed)", or deletes the line.' },
		]);
	});

	it('coverage: pass when every row the claims cite has a confirmed part in a figure', () => {
		const figures = '## FIG. 1\n\n- 12: housing [F2]\n- 14: lever [F3, F4]\n';
		expect([
			checkClaimedFeatureCoverage({ office: 'US', figures, outline, featureList }),
			checkClaimedFeatureCoverage({ office: 'US', figures: '', outline, featureList }),
		]).toEqual([[], []]);
	});

	it('coverage: Errors for a cited row with no drawn part and for a link to no row, per office (37 CFR 1.83(a))', () => {
		const figures = [
			'## FIG. 1',
			'',
			'- 10: hinge [F1]',
			'- 12: housing [F2]',
			'- 14: lever [F3]',
			'- 16: spring [F4] (proposed from sketches/sketch-1.png)',
			'- 18: pin [F9]',
			'',
			'## Parts named in the answers',
			'',
			'- 20: coil [F4]',
		].join('\n');
		const linkError = { severity: 'Error', rule: 'figure-coverage', file: 'figures.md', line: 7, message: 'Part 18 ("pin") links F9, which is not a row of feature-list.md.' };
		expect({
			US: checkClaimedFeatureCoverage({ office: 'US', figures, outline, featureList }),
			EPO: checkClaimedFeatureCoverage({ office: 'EPO', figures, outline, featureList }),
		}).toEqual({
			US: [
				linkError,
				{ severity: 'Error', rule: 'figure-coverage', file: 'figures.md', claim: 1, message: 'Feature List row F4, which the Draft Outline cites for claims 1, 3, has no drawn part in figures.md. Link a confirmed part under a figure heading to it, e.g. "- 20: <part> [F4]" (37 CFR 1.83(a): the drawings must show every feature specified in the claims).' },
			],
			EPO: [
				linkError,
				{ severity: 'Error', rule: 'figure-coverage', file: 'figures.md', claim: 1, message: 'Feature List row F4, which the Draft Outline cites for claims 1, 3, has no drawn part in figures.md. Link a confirmed part under a figure heading to it, e.g. "- 20: <part> [F4]" (the Drawing Set gate; the EPC has no rule like 37 CFR 1.83(a)).' },
			],
		});
	});

	it('coverage: one Note when figures.md links no part, so the coverage was not checked', () => {
		expect(checkClaimedFeatureCoverage({ office: 'US', figures: '## FIG. 1\n\n- 12: housing\n', outline, featureList })).toEqual([
			{ severity: 'Note', rule: 'figure-coverage', file: 'figures.md', message: 'figures.md links no part to a Feature List row (`- 12: housing [F3]`), so the claimed-feature coverage was not checked. The Approved Claims cite F2, F3, F4.' },
		]);
	});
});
