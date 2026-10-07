/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { diffDraftParagraphs } from '../drafting/draftDiff';
import { addRecordLine, APPROVAL_CLEARED, renderDraftWorkingRecord, resaveWorkingRecord, splitSentences, withAttorneyEdits } from '../drafting/workingRecord';

const header = { matter: 'hinge', office: 'US', model: 'claude-sonnet-5', provider: 'anthropic', version: 1, savedAt: '2026-10-07T10:00:00.000Z' };

const draft = (summary: string) => [
	'# Hinge',
	'',
	'## SUMMARY',
	'',
	'<!-- src: feature:F1, disclosure:§2 -->',
	summary,
	'',
	'## CLAIMS',
	'',
	'1. A hinge comprising a housing.',
	'',
	'## Inventor Questions',
	'',
	'> **Inventor Question IQ-1:** Which steel grade? Any grade?',
].join('\n');

describe('Application Drafting Working Record', () => {

	it('splits a paragraph into sentences, keeping abbreviations and numbers inside a sentence', () => {
		expect(splitSentences('As shown in FIG. 1, the lever 14 is steel, e.g. grade No. 5 at approx. 2.5 mm. Is it hard? Yes!\nThe housing i.e. the casing holds it.')).toEqual([
			'As shown in FIG. 1, the lever 14 is steel, e.g. grade No. 5 at approx. 2.5 mm.',
			'Is it hard?',
			'Yes!',
			'The housing i.e. the casing holds it.',
		]);
	});

	it('maps every sentence of a paragraph to the paragraph\'s sources', () => {
		const record = renderDraftWorkingRecord(header, draft('A hinge has a housing. The lever is steel.'));
		expect(record.slice(record.indexOf('| Line'))).toBe([
			'| Line | Section | Sources | Sentence |',
			'| --- | --- | --- | --- |',
			'| 6 | SUMMARY | feature:F1, disclosure:§2 | A hinge has a housing. |',
			'| 6 | SUMMARY | feature:F1, disclosure:§2 | The lever is steel. |',
			'| 10 | CLAIMS | Approved Claims | 1. A hinge comprising a housing. |',
			'| 14 | Inventor Questions | Inventor Question | > **Inventor Question IQ-1:** Which steel grade? Any grade? |',
			'',
		].join('\n'));
	});

	it('a re-save keeps the header, the approval and edit lines, adds a Re-saved line and refreshes the source map', () => {
		let record = renderDraftWorkingRecord(header, draft('A hinge has a housing.'));
		record = addRecordLine(record, APPROVAL_CLEARED, '2026-10-07T10:30:00.000Z (claims.md changed after approval)');
		record = withAttorneyEdits(record, diffDraftParagraphs(draft('A hinge has a housing.'), draft('A hinge has a steel housing.')), '2026-10-07T11:00:00.000Z');
		const resaved = resaveWorkingRecord(record, draft('A hinge has a housing. It is new.'), '2026-10-07T12:00:00.000Z');
		expect({
			header: resaved.slice(resaved.indexOf('## Header'), resaved.indexOf('## Source map')),
			sourceMap: resaved.slice(resaved.indexOf('| 6'), resaved.indexOf('| 10')),
			attorneyEditsKept: resaved.includes('A hinge has a steel housing.'),
			attorneyEditsLast: resaved.indexOf('## Attorney edits') > resaved.indexOf('## Source map'),
		}).toEqual({
			header: [
				'## Header',
				'',
				'- **Matter:** hinge',
				'- **Office:** US',
				'- **Model:** claude-sonnet-5',
				'- **Provider:** anthropic',
				'- **Version:** 1',
				'- **Saved:** 2026-10-07T10:00:00.000Z',
				'- **Approval cleared:** 2026-10-07T10:30:00.000Z (claims.md changed after approval)',
				'- **Re-saved:** 2026-10-07T12:00:00.000Z',
				'',
				'',
			].join('\n'),
			sourceMap: '| 6 | SUMMARY | feature:F1, disclosure:§2 | A hinge has a housing. |\n| 6 | SUMMARY | feature:F1, disclosure:§2 | It is new. |\n',
			attorneyEditsKept: true,
			attorneyEditsLast: true,
		});
	});
});
