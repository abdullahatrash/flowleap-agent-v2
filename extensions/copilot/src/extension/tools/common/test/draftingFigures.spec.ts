/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { formatFigurePart, readFiguresSettings, readPartMarkers } from '../drafting/figures';
import { officeDrawingPageSize } from '../drafting/filingDocuments';

describe('Application Drafting figures.md contract', () => {

	it('part markers: reads Feature List links and the proposal marker after the name, in any order', () => {
		expect([
			'housing',
			'housing [F3]',
			'mounting bracket [F3, F5]',
			'bracket (proposed)',
			'bracket (proposed from sketches/sketch-2.png)',
			'bracket [F5] (Proposed from sketches/sketch 2.png)',
			'bracket (proposed) [F5]',
			'lever [arm]',
		].map(readPartMarkers)).toEqual([
			{ part: 'housing' },
			{ part: 'housing', features: ['F3'] },
			{ part: 'mounting bracket', features: ['F3', 'F5'] },
			{ part: 'bracket', proposed: {} },
			{ part: 'bracket', proposed: { source: 'sketches/sketch-2.png' } },
			{ part: 'bracket', features: ['F5'], proposed: { source: 'sketches/sketch 2.png' } },
			{ part: 'bracket', features: ['F5'], proposed: {} },
			{ part: 'lever [arm]' },
		]);
	});

	it('part writer: writes the line the parser reads back', () => {
		const lines = [
			{ numeral: '12', part: 'housing' },
			{ numeral: '14', part: 'bracket', features: ['F3', 'F5'] },
			{ numeral: '16', part: 'spring', proposed: {} },
			{ numeral: '18', part: 'clip', features: ['F7'], proposed: { source: 'sketches/sketch-2.png' } },
		];
		const written = lines.map(formatFigurePart);
		expect({ written, readBack: written.map(line => readPartMarkers(line.replace(/^- \d+: /, ''))) }).toEqual({
			written: [
				'- 12: housing',
				'- 14: bracket [F3, F5]',
				'- 16: spring (proposed)',
				'- 18: clip [F7] (proposed from sketches/sketch-2.png)',
			],
			readBack: lines.map(line => ({ part: line.part, features: line.features, proposed: line.proposed })),
		});
	});

	it('settings: numerals and pageSize with their defaults; an unknown value gives the default and is listed', () => {
		expect([
			readFiguresSettings('## FIG. 1\n- 12: housing\n'),
			readFiguresSettings('---\nnumerals: hundreds\npageSize: Letter\n---\n'),
			readFiguresSettings('---\nnumerals: odd\npageSize: 11\ndrawingSheets: 2\n---\n'),
		]).toEqual([
			{ numerals: 'even', pageSize: 'A4', invalid: [] },
			{ numerals: 'hundreds', pageSize: 'letter', invalid: [] },
			{ numerals: 'even', pageSize: 'A4', invalid: ['numerals', 'pageSize'] },
		]);
	});

	it('settings: pageSize defaults to the page of the office export; a value in the frontmatter wins', () => {
		const bare = '## FIG. 1\n- 12: housing\n';
		expect([
			readFiguresSettings(bare, officeDrawingPageSize('US')).pageSize,
			readFiguresSettings(bare, officeDrawingPageSize('EPO')).pageSize,
			readFiguresSettings('---\npageSize: A4\n---\n', officeDrawingPageSize('US')).pageSize,
			readFiguresSettings('---\npageSize: letter\n---\n', officeDrawingPageSize('EPO')).pageSize,
		]).toEqual(['letter', 'A4', 'A4', 'letter']);
	});
});
