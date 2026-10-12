/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { parseClaims } from '../drafting/claims';
import { DraftingOffice } from '../drafting/frontmatter';
import { parseInventorAnswers } from '../drafting/inventorAnswers';
import { parseDraftOutline } from '../drafting/outline';
import { checkDraftAgainstOutline, checkDuplicateSentences, checkItemCoverage, checkOutline, checkOutlineClaims, checkOutlineCoverage, checkOutlineSources } from '../drafting/outlineValidators';
import { parseDraftParagraphs } from '../drafting/sourceMarkers';

const hash = 'a'.repeat(64);
const otherHash = 'b'.repeat(64);

/** A Draft Outline with the table header on line 5 and the first row on line 7. */
function outlineText(office: DraftingOffice, ...rows: string[]) {
	return [
		'---',
		`office: ${office}`,
		`claims: ${hash}`,
		'---',
		'| Item | Section | Kind | Claims | Claim terms | Sources | Explain | Question |',
		'|---|---|---|---|---|---|---|---|',
		...rows,
	].join('\n');
}

const outline = (office: DraftingOffice, ...rows: string[]) => parseDraftOutline(outlineText(office, ...rows));

const claimsText = [
	'---',
	'approved: true',
	'---',
	'1. A hinge comprising a housing, a lever and a sealing ring.',
	'2. The hinge of claim 1, wherein the lever has a spring.',
	'3. The hinge of claim 2, wherein the spring is a coil.',
].join('\n');

const claims = parseClaims(claimsText);

const fullRows = [
	'| O1 | Technical Field | Template | | | | no | |',
	'| O2 | Detailed Description | Technical | 1 | a hinge, a housing, a lever | F1 | yes | |',
	'| O3 | Detailed Description | Technical | 1 | a sealing ring | F2, FIG. 1 | yes | |',
	'| O4 | Detailed Description | Technical | 1, 2 | springs | IQ-1, FIG. 3 | yes | |',
	'| O5 | Detailed Description | Technical | 1, 3 | a coil | | yes | What is the pitch of the coil? |',
];

const featureList = '---\noffice: EPO\nconfirmed: true\n---\n| ID | Feature | Span |\n|---|---|---|\n| F1 | A hinge with a housing and a lever. | §1 |\n| F2 | A sealing ring. | §2.1 |\n';

const figures = '## FIG. 1\n- 10: hinge\n\n## FIGS. 2 to 3\n- 12: sealing ring\n';

const answers = parseInventorAnswers([
	'## IQ-1',
	'',
	'**Question:** What is the spring made of?',
	'',
	'**Answer:**',
	'Spring steel.',
	'',
	'## IQ-2',
	'',
	'**Question:** How long is the lever?',
	'',
	'**Answer:**',
	'Not stated',
].join('\n'));

describe('Application Drafting Draft Outline validators', () => {

	it('outline-claims: pass when the outline hash is the Approved Claims hash (case-insensitive); Error when it differs or is missing', () => {
		expect([
			checkOutlineClaims(outline('US', ...fullRows), hash.toUpperCase()),
			checkOutlineClaims(outline('EPO', ...fullRows), otherHash),
			checkOutlineClaims(parseDraftOutline(outlineText('US', ...fullRows).replace(`claims: ${hash}\n`, '')), hash),
		]).toEqual([
			[],
			[{ severity: 'Error', rule: 'outline-claims', file: 'draft-outline.md', line: 1, message: 'draft-outline.md was made from claims with SHA-256 aaaaaaaaaaaa…, but the Approved Claims have SHA-256 bbbbbbbbbbbb…. Write the Draft Outline again for the current Approved Claims.' }],
			[{ severity: 'Error', rule: 'outline-claims', file: 'draft-outline.md', line: 1, message: 'draft-outline.md names no claims hash (claims: <SHA-256 of the Approved Claims>). Write the Draft Outline again for the current Approved Claims.' }],
		]);
	});

	it('outline-coverage: pass when every claim term is listed by a Technical item and every dependent claim is planned with its independent claim, in both offices', () => {
		expect([checkOutlineCoverage(outline('US', ...fullRows), claims), checkOutlineCoverage(outline('EPO', ...fullRows), claims)]).toEqual([[], []]);
	});

	it('outline-coverage: Error for a claim term no Technical item lists, and for a dependent claim no Technical item plans with its independent claim', () => {
		const rows = [
			'| O1 | Summary | Template | 1, 2, 3 | a sealing ring | | no | |',
			'| O2 | Detailed Description | Technical | 1 | a hinge, a housing, a lever | F1 | yes | |',
			'| O3 | Detailed Description | Technical | 1, 2 | a spring | IQ-1 | yes | |',
			'| O4 | Detailed Description | Technical | 2, 3 | a coil | F2 | yes | |',
		];
		expect(checkOutlineCoverage(outline('EPO', ...rows), claims)).toEqual([
			{ severity: 'Error', rule: 'outline-coverage', file: 'draft-outline.md', line: 5, claim: 1, message: 'The claim term "sealing ring" (claim 1) is in the Claim terms of no Technical item of draft-outline.md.' },
			{ severity: 'Error', rule: 'outline-coverage', file: 'draft-outline.md', line: 5, claim: 3, message: 'Claim 3 depends on claim 1, but no Technical item of draft-outline.md lists claims 1 and 3 together: the combination has no plan.' },
		]);
	});

	it('outline-coverage: a listed phrase that contains the claim term as whole words covers it; a part of a word does not', () => {
		const rows = [
			'| O1 | Detailed Description | Technical | 1, 2, 3 | the hinge with a housing, a lever arm, an annular sealing ring for the door | F1 | yes | |',
			'| O2 | Detailed Description | Technical | 1, 2, 3 | springs, a coiled wire | F2 | yes | |',
		];
		expect(checkOutlineCoverage(outline('US', ...rows), claims)).toEqual([
			{ severity: 'Error', rule: 'outline-coverage', file: 'draft-outline.md', line: 5, claim: 3, message: 'The claim term "coil" (claim 3) is in the Claim terms of no Technical item of draft-outline.md.' },
		]);
	});

	it('outline-coverage: no finding without an Outline table (the outline-format error is the finding)', () => {
		expect(checkOutlineCoverage(parseDraftOutline(`---\noffice: US\nclaims: ${hash}\n---\nNo table.\n`), claims)).toEqual([]);
	});

	it('outline-sources: pass when each source names a Feature List row, a figure of figures.md (also in a range) or an answered Inventor Question', () => {
		expect([
			checkOutlineSources(outline('US', ...fullRows), featureList, figures, answers),
			checkOutlineSources(outline('EPO', ...fullRows), featureList, figures, answers),
		]).toEqual([[], []]);
	});

	it('outline-sources: Error for a Technical item with neither source nor question, a Template item with claim terms, and a source that does not exist or is unanswered', () => {
		const rows = [
			'| O1 | Summary | Template | | a lever | | no | |',
			'| O2 | Detailed Description | Technical | 1 | a hinge | | yes | |',
			'| O3 | Detailed Description | Technical | 1 | a housing | F9, FIG. 5, IQ-2, IQ-3, §4 | yes | |',
		];
		expect(checkOutlineSources(outline('US', ...rows), featureList, figures, answers)).toEqual([
			{ severity: 'Error', rule: 'outline-sources', file: 'draft-outline.md', line: 7, message: 'Item O1 is a Template item but lists the claim terms "a lever": a Template item has no claim terms. Make it a Technical item, or remove the terms.' },
			{ severity: 'Error', rule: 'outline-sources', file: 'draft-outline.md', line: 8, message: 'Technical item O2 names no source and no question. Name a Feature List row, a disclosure span, a figure or an answered Inventor Question, or write the open question.' },
			{ severity: 'Error', rule: 'outline-sources', file: 'draft-outline.md', line: 9, message: 'Item O3 names F9, which is not a row of feature-list.md.' },
			{ severity: 'Error', rule: 'outline-sources', file: 'draft-outline.md', line: 9, message: 'Item O3 names FIG. 5, which is not a figure of figures.md.' },
			{ severity: 'Error', rule: 'outline-sources', file: 'draft-outline.md', line: 9, message: 'Item O3 names IQ-2, which has no answer in inventor-answers.md.' },
			{ severity: 'Error', rule: 'outline-sources', file: 'draft-outline.md', line: 9, message: 'Item O3 names IQ-3, which has no answer in inventor-answers.md.' },
		]);
	});

	it('item-coverage: pass when a paragraph names each item', () => {
		const draft = parseDraftParagraphs([
			'# Technical Field',
			'',
			'<!-- src: template, item:O1 -->',
			'The invention relates to hinges.',
			'',
			'<!-- src: feature:F1, item:O2 -->',
			'The hinge 10 has a housing and a lever.',
		].join('\n'));
		expect(checkItemCoverage(outline('EPO', fullRows[0], fullRows[1]), draft)).toEqual([]);
	});

	it('item-coverage: Error for a Technical item no paragraph names and for an item: that names no row; Note for a Template item and for an item planned as an open question', () => {
		const draft = parseDraftParagraphs([
			'# Detailed Description',
			'',
			'<!-- src: feature:F1, item:O2 -->',
			'The hinge 10 has a housing and a lever.',
			'',
			'<!-- src: model-proposed, item:O9, item:O9 -->',
			'The following describes the seal.',
		].join('\n'));
		expect(checkItemCoverage(outline('US', ...fullRows), draft)).toEqual([
			{ severity: 'Error', rule: 'item-coverage', file: 'draft-outline.md', line: 9, message: 'Technical item O3 (Detailed Description; "a sealing ring") is realised by no paragraph of draft-application.md: no source marker names item:O3.' },
			{ severity: 'Error', rule: 'item-coverage', file: 'draft-outline.md', line: 10, message: 'Technical item O4 (Detailed Description; "springs") is realised by no paragraph of draft-application.md: no source marker names item:O4.' },
			{ severity: 'Error', rule: 'item-coverage', file: 'draft-application.md', line: 7, message: 'The paragraph at line 7 names item:O9, which is not a row of draft-outline.md.' },
			{ severity: 'Note', rule: 'item-coverage', file: 'draft-outline.md', line: 7, message: 'Template item O1 (Technical Field) is realised by no paragraph of draft-application.md: no source marker names item:O1.' },
			{ severity: 'Note', rule: 'item-coverage', file: 'draft-outline.md', line: 11, message: 'Technical item O5 (Detailed Description; "a coil") has no source and no paragraph names item:O5; its open question goes to the draft as an Inventor Question: What is the pitch of the coil?' },
		]);
	});

	it('duplicate-sentence: Note when one normalised sentence of 6 or more words is in two paragraphs; not within one paragraph, not short ones, not in the claims', () => {
		const draft = parseDraftParagraphs([
			'# Summary',
			'',
			'<!-- src: feature:F1 -->',
			'The hinge 10 has a housing and a lever. It is new. It is new.',
			'',
			'# Detailed Description',
			'',
			'<!-- src: feature:F1 -->',
			'First, the details of the hinge follow. The HINGE 10  has a housing and a lever!  It is new.',
			'',
			'<!-- src: feature:F2 -->',
			'The sealing ring 12 seals the housing against water. The sealing ring 12 seals the housing against water.',
			'',
			'# Claims',
			'',
			'The hinge 10 has a housing and a lever.',
			'',
			'<!-- src: feature:F1 -->',
			'The hinge 10 has a housing and a lever',
		].join('\n'));
		expect(checkDuplicateSentences(draft)).toEqual([
			{ severity: 'Note', rule: 'duplicate-sentence', file: 'draft-application.md', line: 9, message: 'The sentence "the hinge 10 has a housing and a lever" is in the paragraphs at lines 4 and 9. Keep it in one place.' },
		]);
	});

	it('checkOutline and checkDraftAgainstOutline compose the rules, Errors first', () => {
		const outlineFile = outlineText('EPO',
			'| O1 | Summary | Template | | a lever | | no | |',
			'| O2 | Detailed Description | Technical | 1, 2, 3 | a hinge, a housing, a lever, a sealing ring, a spring, a coil | F1 | yes | |',
			'| O3 | Detailed Description | Concept | 1 | | F1 | yes | |',
		);
		const draft = [
			'# Detailed Description',
			'',
			'<!-- src: feature:F1, item:O2 -->',
			'The hinge 10 has a housing and a lever.',
			'',
			'<!-- src: feature:F1 -->',
			'The hinge 10 has a housing and a lever.',
		].join('\n');
		expect({
			outline: checkOutline({ outline: outlineFile, claims: claimsText, approvedClaimsHash: otherHash, featureList, figures, inventorAnswers: '' }),
			draft: checkDraftAgainstOutline({ outline: outlineFile, draft }),
		}).toEqual({
			outline: [
				{ severity: 'Error', rule: 'outline-format', file: 'draft-outline.md', line: 9, message: 'Item O3: Kind "Concept" is not Template or Technical.' },
				{ severity: 'Error', rule: 'outline-claims', file: 'draft-outline.md', line: 1, message: 'draft-outline.md was made from claims with SHA-256 aaaaaaaaaaaa…, but the Approved Claims have SHA-256 bbbbbbbbbbbb…. Write the Draft Outline again for the current Approved Claims.' },
				{ severity: 'Error', rule: 'outline-sources', file: 'draft-outline.md', line: 7, message: 'Item O1 is a Template item but lists the claim terms "a lever": a Template item has no claim terms. Make it a Technical item, or remove the terms.' },
			],
			draft: [
				{ severity: 'Note', rule: 'item-coverage', file: 'draft-outline.md', line: 7, message: 'Template item O1 (Summary; "a lever") is realised by no paragraph of draft-application.md: no source marker names item:O1.' },
				{ severity: 'Note', rule: 'duplicate-sentence', file: 'draft-application.md', line: 7, message: 'The sentence "the hinge 10 has a housing and a lever" is in the paragraphs at lines 4 and 7. Keep it in one place.' },
			],
		});
	});
});
