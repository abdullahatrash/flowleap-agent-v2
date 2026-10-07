/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { DraftFinding } from '../drafting/finding';
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
		]);
	});
});
