/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { parseClaims } from '../drafting/claims';
import { checkAntecedentBasis, checkClaimCount, checkClaimNumbering, checkDependencyTargets, checkEpoOneIndependentPerCategory, checkLiteralBasis, checkRelativeTerms, checkUsMultipleDependency } from '../drafting/claimValidators';

function claims(...lines: string[]) {
	return parseClaims(lines.join('\n'));
}

describe('Application Drafting claim validators', () => {

	it('dependency targets: pass when every target exists and precedes', () => {
		expect(checkDependencyTargets(claims('1. A hinge.', '2. The hinge of claim 1.'))).toEqual([]);
	});

	it('dependency targets: Error for a missing, later or self target', () => {
		expect(checkDependencyTargets(claims('1. A hinge.', '2. The hinge of claim 3.', '3. The hinge of claim 3.', '4. The hinge of claim 9.'))).toEqual([
			{ severity: 'Error', rule: 'dependency-target', file: 'claims.md', line: 2, claim: 2, message: 'Claim 2 depends on claim 3, which does not precede it.' },
			{ severity: 'Error', rule: 'dependency-target', file: 'claims.md', line: 3, claim: 3, message: 'Claim 3 depends on claim 3, which does not precede it.' },
			{ severity: 'Error', rule: 'dependency-target', file: 'claims.md', line: 4, claim: 4, message: 'Claim 4 depends on claim 9, which does not exist.' },
		]);
	});

	it('numbering: pass when claims run 1..n', () => {
		expect(checkClaimNumbering(claims('1. A hinge.', '2. The hinge of claim 1.'))).toEqual([]);
	});

	it('numbering: Error for a gap and a duplicate', () => {
		expect(checkClaimNumbering(claims('1. A hinge.', '3. The hinge of claim 1.', '3. A door.'))).toEqual([
			{ severity: 'Error', rule: 'claim-numbering', file: 'claims.md', line: 2, claim: 3, message: 'Claim 3 follows claim 1; claims must be numbered 1 to 3 without gaps.' },
			{ severity: 'Error', rule: 'claim-numbering', file: 'claims.md', line: 3, claim: 3, message: 'Claim number 3 is used more than once.' },
		]);
	});

	it('EPO one independent claim per category: pass with one per category', () => {
		expect(checkEpoOneIndependentPerCategory(claims('1. A hinge.', '2. A method of making a hinge.', '3. Use of the hinge of claim 1 in a door.'))).toEqual([]);
	});

	it('EPO one independent claim per category: Error for two independent product claims', () => {
		expect(checkEpoOneIndependentPerCategory(claims('1. A hinge.', '2. A door.', '3. The door of claim 2.'))).toEqual([
			{ severity: 'Error', rule: 'epo-one-independent-per-category', file: 'claims.md', line: 2, claim: 2, message: 'Claims 1 and 2 are both independent product claims. Rule 43(2) EPC allows more than one independent claim in a category only for interrelated products, different uses of a product or a known substance, or alternative solutions where one claim is not appropriate. Waive with the exception that applies, or combine the claims.' },
		]);
	});

	it('US multiple dependency: pass when a multiple dependent claim depends on single dependent claims', () => {
		expect(checkUsMultipleDependency(claims('1. A hinge.', '2. The hinge of claim 1.', '3. The hinge of claim 1 or 2.'))).toEqual([]);
	});

	it('US multiple dependency: Error when a multiple dependent claim depends on another', () => {
		expect(checkUsMultipleDependency(claims('1. A hinge.', '2. The hinge of claim 1.', '3. The hinge of claim 1 or 2.', '4. The hinge of claim 2 or 3.'))).toEqual([
			{ severity: 'Error', rule: 'us-multiple-dependency', file: 'claims.md', line: 4, claim: 4, message: 'Claim 4 is a multiple dependent claim and depends on claim 3, which is also a multiple dependent claim (35 U.S.C. 112(e), 37 CFR 1.75(c)).' },
		]);
	});

	it('antecedent basis: pass when every "the" term is introduced earlier in the claim chain', () => {
		expect(checkAntecedentBasis(claims(
			'1. A hinge, comprising a housing, a first lever and a plurality of arms, the first lever attached to the housing.',
			'2. The hinge of claim 1, wherein said arms are fixed, at least one spring is coiled, and the at least one spring is steel.',
			'3. The hinge of claim 1 or 2, wherein the first lever is the same as the other lever.',
		))).toEqual([]);
	});

	it('antecedent basis: Error per missing term, checked along every dependency path', () => {
		expect(checkAntecedentBasis(claims(
			'1. A hinge comprising a housing.',
			'2. The hinge of claim 1, further comprising a spring.',
			'3. The hinge of claim 1 or 2, wherein the spring and the second lever are steel, and the second lever is long.',
		))).toEqual([
			{ severity: 'Error', rule: 'antecedent-basis', file: 'claims.md', line: 3, claim: 3, message: 'Claim 3: "the spring" has no antecedent basis ("a spring") earlier in claim 3 or in the claims it depends on (dependency path 1 → 3).' },
			{ severity: 'Error', rule: 'antecedent-basis', file: 'claims.md', line: 3, claim: 3, message: 'Claim 3: "the second lever" has no antecedent basis ("a second lever") earlier in claim 3 or in the claims it depends on.' },
		]);
	});

	it('literal basis: pass when every claim term appears in the description', () => {
		expect(checkLiteralBasis(claims('1. A hinge comprising a housing and a plurality of arms.'), 'The hinge 10 has a housing 12 and an arm 14.')).toEqual([]);
	});

	it('literal basis: Error for a claim term the description does not contain', () => {
		expect(checkLiteralBasis(claims('1. A hinge comprising a housing and a first lever.', '2. The hinge of claim 1, further comprising a damper.'), 'The hinge 10 has a housing 12 and a lever 14.')).toEqual([
			{ severity: 'Error', rule: 'literal-basis', file: 'claims.md', line: 1, claim: 1, message: 'The claim term "first lever" (claim 1) does not appear in the description.' },
			{ severity: 'Error', rule: 'literal-basis', file: 'claims.md', line: 2, claim: 2, message: 'The claim term "damper" (claim 2) does not appear in the description.' },
		]);
	});

	it('literal basis: checks the whole claim term phrase, plural-normalised, up to the next connecting word', () => {
		const description = 'The hinges 10 have a lower lever arm 16 of steel, and a spring biasing plates 18. The coil housings 12 hold it (see FIG. 1).';
		expect(checkLiteralBasis(claims(
			'1. A hinge comprising a lower lever arm that pivots, a coil housing (12) and a spring biasing plate.',
			'2. The hinge of claim 1, wherein a lower lever arm of steel has an upper lever arm configured to turn.',
			'3. The hinge of claim 1, further comprising a lever of steel; and a spring cap.',
		), description)).toEqual([
			{ severity: 'Error', rule: 'literal-basis', file: 'claims.md', line: 2, claim: 2, message: 'The claim term "upper lever arm" (claim 2) does not appear in the description.' },
			{ severity: 'Error', rule: 'literal-basis', file: 'claims.md', line: 3, claim: 3, message: 'The claim term "spring cap" (claim 3) does not appear in the description.' },
		]);
	});

	it('claim count: no Note at the US and EPO thresholds', () => {
		const twenty = Array.from({ length: 20 }, (_, i) => i < 3 ? `${i + 1}. A hinge ${i}.` : `${i + 1}. The hinge of claim 1.`);
		expect([checkClaimCount(claims(...twenty), 'US'), checkClaimCount(claims(...twenty.slice(0, 15)), 'EPO')]).toEqual([[], []]);
	});

	it('claim count: Note over 20 total or 3 independent (US) and over 15 (EPO)', () => {
		const many = Array.from({ length: 21 }, (_, i) => i < 4 ? `${i + 1}. A hinge ${i}.` : `${i + 1}. The hinge of claim 1.`);
		expect([checkClaimCount(claims(...many), 'US'), checkClaimCount(claims(...many.slice(0, 16)), 'EPO')]).toEqual([
			[
				{ severity: 'Note', rule: 'claim-count', file: 'claims.md', message: '21 claims in total: the US fee covers 20; each further claim incurs an excess-claims fee (37 CFR 1.16(i)).' },
				{ severity: 'Note', rule: 'claim-count', file: 'claims.md', message: '4 independent claims: the US fee covers 3; each further independent claim incurs an excess-claims fee (37 CFR 1.16(h)).' },
			],
			[
				{ severity: 'Note', rule: 'claim-count', file: 'claims.md', message: '16 claims in total: the EPO claims fee is due for each claim over 15 (Rule 45 EPC).' },
			],
		]);
	});

	it('relative terms: no Note when claims use none', () => {
		expect(checkRelativeTerms(claims('1. A hinge comprising a lever of 5 mm.'))).toEqual([]);
	});

	it('relative terms: Note per claim naming the relative terms', () => {
		expect(checkRelativeTerms(claims('1. A hinge comprising a substantially flat lever of about 5 mm.', '2. The hinge of claim 1.'))).toEqual([
			{ severity: 'Note', rule: 'relative-term', file: 'claims.md', line: 1, claim: 1, message: 'Claim 1 uses relative terms: "substantially", "about". Check that the description gives them a definite meaning.' },
		]);
	});
});
