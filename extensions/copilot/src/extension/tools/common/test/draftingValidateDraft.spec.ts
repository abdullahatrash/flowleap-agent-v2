/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { readFileSync } from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { DraftFinding } from '../drafting/finding';
import { parseDraftingFrontmatter } from '../drafting/frontmatter';
import { validateDraft } from '../drafting/validateDraft';

const claims = [
	'---',
	'approved: true',
	'---',
	'1. A hinge comprising a housing and a lever.',
	'2. The hinge of claim 1, wherein the lever is substantially straight.',
	'3. The hinge of claim 1 or 2, further comprising a spring.',
	'4. The hinge of claim 2 or 3, wherein the spring is coiled.',
	'5. A door comprising a frame.',
].join('\n');

const draft = [
	'---',
	'office: US',
	'---',
	'# Detailed Description',
	'',
	'<!-- src: feature:F1 -->',
	'The hinge 10 has a housing 12, a lever 14 and a spring 16.',
	'',
	'# Abstract',
	'',
	'<!-- src: template -->',
	'A hinge with a door frame.',
	'',
	'## Inventor Questions',
	'',
	'> **Inventor Question IQ-1:** What is the spring made of?',
].join('\n');

const figures = '- 10: hinge\n- 12: housing\n- 14: lever\n- 16: spring\n';

function summary(findings: readonly DraftFinding[]): string[] {
	return findings.map(finding => `${finding.severity} ${finding.rule} ${finding.file}:${finding.line ?? '-'}${finding.claim ? ` claim ${finding.claim}` : ''}`);
}

describe('Application Drafting validateDraft', () => {

	it('runs the US validator set', () => {
		expect(summary(validateDraft({ office: 'US', draft, claims, figures }))).toEqual([
			'Error us-multiple-dependency claims.md:7 claim 4',
			'Error antecedent-basis claims.md:7 claim 4',
			'Error literal-basis claims.md:8 claim 5',
			'Error literal-basis claims.md:8 claim 5',
			'Error inventor-question draft-application.md:16',
			'Note relative-term claims.md:5 claim 2',
		]);
	});

	it('runs the EPO validator set', () => {
		expect(summary(validateDraft({ office: 'EPO', draft, claims, figures }))).toEqual([
			'Error epo-one-independent-per-category claims.md:8 claim 5',
			'Error antecedent-basis claims.md:7 claim 4',
			'Error literal-basis claims.md:8 claim 5',
			'Error literal-basis claims.md:8 claim 5',
			'Error inventor-question draft-application.md:16',
			'Note relative-term claims.md:5 claim 2',
			'Note epo-claim-reference-signs claims.md:-',
			'Note epo-abstract-figure draft-application.md:9',
			'Note epo-abstract-figure draft-application.md:9',
		]);
	});

	it('gives the EPC claim and abstract rules their office severity', () => {
		const formal = [
			'1. A hinge comprising a housing 12. The housing is as shown in Fig. 1.',
		].join('\n');
		const longAbstract = draft.replace('A hinge with a door frame.', Array.from({ length: 151 }, () => 'hinge').join(' '));
		const severities = (office: 'US' | 'EPO') => summary(validateDraft({ office, draft: longAbstract, claims: formal, figures }))
			.filter(line => /one-sentence|refers-to-description|reference-signs|abstract/.test(line));
		expect({ US: severities('US'), EPO: severities('EPO') }).toEqual({
			US: [
				'Error claim-one-sentence claims.md:1 claim 1',
				'Error abstract-length draft-application.md:9',
				'Note claim-refers-to-description claims.md:1 claim 1',
			],
			EPO: [
				'Error claim-one-sentence claims.md:1 claim 1',
				'Error claim-refers-to-description claims.md:1 claim 1',
				'Note abstract-length draft-application.md:9',
				'Note epo-claim-reference-signs claims.md:1 claim 1',
				'Note epo-abstract-figure draft-application.md:9',
				'Note epo-abstract-figure draft-application.md:9',
			],
		});
	});

	it('runs the Draft Outline rules with the others when given the outline inputs; a missing outline is one outline-claims Error', () => {
		const outline = [
			'---',
			'office: US',
			'claims: c1',
			'---',
			'| Item | Section | Kind | Claims | Claim terms | Sources | Explain | Question |',
			'|---|---|---|---|---|---|---|---|',
			'| O1 | Detailed Description | Technical | 1, 2, 3, 4 | a hinge, a housing, a lever, a spring | F1 | yes |  |',
		].join('\n');
		const run = (text: string | undefined) => summary(validateDraft({ office: 'US', draft, claims, figures, outline: { text, approvedClaimsHash: 'c1', featureList: '| F1 | A hinge. |' } })).filter(line => /outline|item-coverage|duplicate/.test(line));
		expect({ withOutline: run(outline), withoutOutline: run(undefined) }).toEqual({
			withOutline: [
				'Error outline-coverage draft-outline.md:5 claim 5',
				'Error outline-coverage draft-outline.md:5 claim 5',
				'Error item-coverage draft-outline.md:7',
			],
			withoutOutline: ['Error outline-claims draft-outline.md:-'],
		});
	});

	it('runs the figures.md rules for both offices: numeral set, sheet size, scheme, proposals and claimed-feature coverage', () => {
		const drawn = [
			'---',
			'pageSize: letter',
			'---',
			'## FIG. 1',
			'- 10: hinge [F1]',
			'- 12: housing [F2]',
			'- 14: lever',
			'- 16: spring (proposed)',
			'- 17: pin',
		].join('\n');
		const outline = [
			'---',
			'office: US',
			'claims: c1',
			'---',
			'| Item | Section | Kind | Claims | Claim terms | Sources | Explain | Question |',
			'|---|---|---|---|---|---|---|---|',
			'| O1 | Detailed Description | Technical | 1, 2 | a hinge, a housing, a lever | F2, F3 | yes |  |',
			'| O2 | Detailed Description | Technical | 3, 4 | a spring | F3 | yes |  |',
		].join('\n');
		const run = (office: 'US' | 'EPO') => summary(validateDraft({ office, draft, claims, figures: drawn, outline: { text: outline, approvedClaimsHash: 'c1', featureList: '| F1 | A hinge. |\n| F2 | A housing. |\n| F3 | A lever. |' } }))
			.filter(line => /figure-|numeral|figures-settings|page-size/.test(line));
		expect({ US: run('US'), EPO: run('EPO') }).toEqual({
			US: [
				'Error reference-numeral figures.md:9',
				'Error figure-proposal figures.md:8',
				'Error figure-coverage figures.md:- claim 3',
				'Note numeral-scheme figures.md:9',
			],
			EPO: [
				'Error reference-numeral figures.md:9',
				'Error page-size-mismatch figures.md:-',
				'Error figure-proposal figures.md:8',
				'Error figure-coverage figures.md:- claim 3',
				'Note numeral-scheme figures.md:9',
			],
		});
	});

	it('raises no Error on the D7 pipe-clamp matter: flowchart steps are cited as "step 44", alternatives and tests need no drawn part (#782, #783)', () => {
		// A copy of the IDF-D7 drafting folder of the 2026-10-19 live run (docs/reviews/2026-10-19-drawings-d7-acceptance-pipe-clamp.md).
		const matter = (name: string) => readFileSync(path.join(__dirname, 'fixtures/pipe-clamp', name), 'utf8');
		const claimsText = matter('claims.md');
		const findings = validateDraft({
			office: 'US',
			draft: matter('draft-application.md'),
			claims: claimsText,
			figures: matter('figures.md'),
			inventorAnswers: matter('inventor-answers.md'),
			outline: { text: matter('draft-outline.md'), approvedClaimsHash: String(parseDraftingFrontmatter(claimsText).fields.approvedHash), featureList: matter('feature-list.md') },
		});
		expect(findings.filter(finding => finding.severity === 'Error').map(finding => `${finding.rule} ${finding.file}:${finding.line ?? '-'}${finding.claim ? ` claim ${finding.claim}` : ''} ${finding.message}`)).toEqual([]);
	});
});
