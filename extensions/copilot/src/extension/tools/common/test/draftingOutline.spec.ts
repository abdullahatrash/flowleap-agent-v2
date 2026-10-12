/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { DraftOutline, parseDraftOutline, writeDraftOutline } from '../drafting/outline';

const hash = 'a'.repeat(64);

const outline = [
	'---',
	'office: EPO',
	`claims: ${hash}`,
	'---',
	'# Draft Outline',
	'',
	'| Item | Section | Kind | Claims | Claim terms | Sources | Explain | Question |',
	'|------|---------|------|--------|-------------|---------|---------|----------|',
	'| O1 | Technical Field | Template | | | | no | |',
	'| O2 | Detailed Description | Technical | 1 | a housing, a lever | F1, §2.1, FIG. 1 | yes | |',
	'| O3 | Detailed Description | Technical | 1, 3 | a sealing ring | IQ-4 | yes | |',
	'| O4 | Detailed Description | Technical | 1, 2 | a spring | | yes | What is the spring made of? |',
].join('\n');

/** The parts of a parsed outline that survive a write: everything but the file lines. */
function withoutLines({ office, claimsHash, items, errors }: DraftOutline) {
	return { office, claimsHash, items: items.map(({ line: _line, ...item }) => item), errors };
}

describe('Application Drafting Draft Outline', () => {

	it('parses the frontmatter and one typed Outline Item per table row, with file lines', () => {
		expect(parseDraftOutline(outline)).toEqual({
			office: 'EPO',
			claimsHash: hash,
			tableLine: 7,
			items: [
				{ id: 'O1', line: 9, section: 'Technical Field', kind: 'Template', claims: [], claimTerms: [], sources: [], explain: false },
				{ id: 'O2', line: 10, section: 'Detailed Description', kind: 'Technical', claims: [1], claimTerms: ['a housing', 'a lever'], sources: [{ kind: 'feature', ref: 'F1' }, { kind: 'disclosure', ref: '§2.1' }, { kind: 'figure', ref: '1' }], explain: true },
				{ id: 'O3', line: 11, section: 'Detailed Description', kind: 'Technical', claims: [1, 3], claimTerms: ['a sealing ring'], sources: [{ kind: 'answer', ref: 'IQ-4' }], explain: true },
				{ id: 'O4', line: 12, section: 'Detailed Description', kind: 'Technical', claims: [1, 2], claimTerms: ['a spring'], sources: [], explain: true, question: 'What is the spring made of?' },
			],
			errors: [],
		});
	});

	it('reports a parse error with its line for each bad row, a bad office and a missing table', () => {
		const bad = [
			'---',
			'office: JP',
			'---',
			'| Item | Section | Kind | Claims | Claim terms | Sources | Explain | Question |',
			'|---|---|---|---|---|---|---|---|',
			'| 7 | Summary | Template | | | | no | |',
			'| O2 | Summary | Concept | one | | F1 | maybe | |',
			'| O3 | Summary | Technical | 1 | a lever | F1, the web | yes | |',
			'| O3 | Summary | Technical | 1 | a lever | F1 | yes |',
			'| O3 | Summary | Technical | 1 | a lever | F1 | yes | |',
		].join('\n');
		expect([parseDraftOutline(bad), parseDraftOutline('---\noffice: US\n---\nNo table.\n')]).toEqual([
			{
				tableLine: 4,
				items: [],
				errors: [
					{ line: 1, message: 'The frontmatter names no office (office: US or office: EPO).' },
					{ line: 6, message: 'Item "7" is not an Outline Item id (O1, O2, ...).' },
					{ line: 7, message: 'Item O2: Kind "Concept" is not Template or Technical.' },
					{ line: 7, message: 'Item O2: Claims "one" is not a list of claim numbers (1, 3).' },
					{ line: 7, message: 'Item O2: Explain "maybe" is not yes or no.' },
					{ line: 8, message: 'Item O3: source "the web" is not a Feature List row (F3), a disclosure span (§2.1), a figure (FIG. 2) or an Inventor Question (IQ-4).' },
					{ line: 9, message: 'The row has 7 cells; the Outline table has 8 columns: Item | Section | Kind | Claims | Claim terms | Sources | Explain | Question.' },
					{ line: 10, message: 'Item O3 is listed more than once.' },
				],
			},
			{
				office: 'US',
				items: [],
				errors: [
					{ line: 3, message: 'draft-outline.md has no Outline table with the columns Item | Section | Kind | Claims | Claim terms | Sources | Explain | Question.' },
				],
			},
		]);
	});

	it('writes an outline that parses back to the same items, for both offices', () => {
		const parsed = [parseDraftOutline(outline.replace('office: EPO', 'office: US')), parseDraftOutline(outline)];
		const written = parsed.map(({ office, claimsHash, items }) => parseDraftOutline(writeDraftOutline({ office: office ?? 'US', claimsHash: claimsHash ?? '', items })));
		expect(written.map(withoutLines)).toEqual(parsed.map(withoutLines));
	});

	it('writes the frontmatter and the table, escaping a pipe in a cell', () => {
		expect(writeDraftOutline({
			office: 'US',
			claimsHash: hash,
			items: [
				{ id: 'O1', line: 0, section: 'Field', kind: 'Template', claims: [], claimTerms: [], sources: [], explain: false },
				{ id: 'O2', line: 0, section: 'Detailed Description', kind: 'Technical', claims: [1, 2], claimTerms: ['a lever'], sources: [{ kind: 'figure', ref: '2' }], explain: true, question: 'Steel | aluminium?' },
			],
		})).toBe([
			'---',
			'office: US',
			`claims: ${hash}`,
			'---',
			'# Draft Outline',
			'',
			'| Item | Section | Kind | Claims | Claim terms | Sources | Explain | Question |',
			'|------|---------|------|--------|-------------|---------|---------|----------|',
			'| O1 | Field | Template |  |  |  | no |  |',
			'| O2 | Detailed Description | Technical | 1, 2 | a lever | FIG. 2 | yes | Steel \\| aluminium? |',
			'',
		].join('\n'));
	});
});
