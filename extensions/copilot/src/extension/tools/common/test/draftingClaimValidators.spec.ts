/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { parseClaims } from '../drafting/claims';
import { checkAntecedentBasis, checkClaimCount, checkClaimNumbering, checkClaimOneSentence, checkClaimReferencesToDescription, checkDependencyTargets, checkEpoClaimReferenceSigns, checkEpoOneIndependentPerCategory, checkLiteralBasis, checkRelativeTerms, checkUsMultipleDependency } from '../drafting/claimValidators';

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

	it('antecedent basis: pass for terms introduced by a bare quantifier and referred to with it', () => {
		expect(checkAntecedentBasis(claims(
			'1. A quick release wherein rotation of a shaft moves a head through at least three positions, the at least three positions comprising a first position.',
			'2. The quick release of claim 1, wherein a second head comprises two independently adjustable portions.',
			'3. The quick release of claim 2, wherein the two independently adjustable portions are two disks, and the at least three positions are discrete.',
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
				{ severity: 'Note', rule: 'claim-count', file: 'claims.md', message: '16 claims in total: the EPO claims fee is due for each claim over 15, at a higher rate from the 51st claim (Rule 45(1) EPC; RFees Art. 2(1) item 15).' },
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

	it('one sentence: pass with abbreviations, decimal numbers and one final period', () => {
		expect(checkClaimOneSentence(claims(
			'1. A hinge, e.g. for a door, with a lever of approx. 2.5 mm and 5 wt.% carbon, i.e. a steel lever.',
			'2. The hinge of claim 1, wherein the lever is of steel No. 3, cf. a known grade, etc.',
			'3. A method comprising the steps (i). heating, ii. cooling and (iv). drying the lever.',
			'4. A method comprising: 1. heating; 2. cooling, and (3). drying a lever of Acme Inc. or Foo Ltd. or Bar Co. or Baz Corp. in conc. acid, see pp. 3-4, of appr. 2.5 mm, resp. 3 mm, incl. a coating, eg. a steel lever.',
		))).toEqual([]);
	});

	it('one sentence: Error for a period that ends a sentence before the end of the claim', () => {
		expect(checkClaimOneSentence(claims('1. A hinge.', '2. The hinge of claim 1, comprising a housing. The housing is of steel.', '3. The hinge of claim 1, with a lever of length 12. The lever is of steel.'))).toEqual([
			{ severity: 'Error', rule: 'claim-one-sentence', file: 'claims.md', line: 2, claim: 2, message: 'Claim 2 has a period inside the claim, after "comprising a housing". A claim is one sentence with one period at its end (Guidelines F-IV, 4.1; MPEP 608.01(m)).' },
			{ severity: 'Error', rule: 'claim-one-sentence', file: 'claims.md', line: 3, claim: 3, message: 'Claim 3 has a period inside the claim, after "of length 12". A claim is one sentence with one period at its end (Guidelines F-IV, 4.1; MPEP 608.01(m)).' },
		]);
	});

	it('references to the description or drawings: pass for claims in words and references to other claims', () => {
		const text = claims('1. A hinge comprising a housing (12).', '2. The hinge as described in claim 1, wherein the housing is shown to the user.');
		expect([checkClaimReferencesToDescription(text, 'EPO'), checkClaimReferencesToDescription(text, 'US')]).toEqual([[], []]);
	});

	it('references to the description or drawings: pass for bare "as shown", "as represented", "as disclosed" and a lower-case figure word', () => {
		expect(checkClaimReferencesToDescription(claims(
			'1. A display showing a value as shown to the user.',
			'2. The display of claim 1, wherein the value is a signal as represented by a voltage.',
			'3. The display of claim 1, wherein the value is sent as disclosed to a server.',
			'4. A vehicle moving on a figure 8 track.',
		), 'EPO')).toEqual([]);
	});

	it('references to the description or drawings: Error for EPO (Rule 43(6) EPC), Note for US', () => {
		const text = claims('1. A hinge as shown in Fig. 2.', '2. The hinge of claim 1, with a lever as illustrated, and a cam according to FIG. 3a.', '3. The hinge of claim 1, as described in the description.');
		expect([checkClaimReferencesToDescription(text, 'EPO'), checkClaimReferencesToDescription(text, 'US')]).toEqual([
			[
				{ severity: 'Error', rule: 'claim-refers-to-description', file: 'claims.md', line: 1, claim: 1, message: 'Claim 1 relies on a reference to the description or drawings: "as shown in Fig. 2". Rule 43(6) EPC allows this only where absolutely necessary: state the feature in words, or waive with the reason.' },
				{ severity: 'Error', rule: 'claim-refers-to-description', file: 'claims.md', line: 2, claim: 2, message: 'Claim 2 relies on a reference to the description or drawings: "as illustrated", "FIG. 3a". Rule 43(6) EPC allows this only where absolutely necessary: state the feature in words, or waive with the reason.' },
				{ severity: 'Error', rule: 'claim-refers-to-description', file: 'claims.md', line: 3, claim: 3, message: 'Claim 3 relies on a reference to the description or drawings: "as described in the description". Rule 43(6) EPC allows this only where absolutely necessary: state the feature in words, or waive with the reason.' },
			],
			[
				{ severity: 'Note', rule: 'claim-refers-to-description', file: 'claims.md', line: 1, claim: 1, message: 'Claim 1 relies on a reference to the description or drawings: "as shown in Fig. 2". A US claim incorporates the description or drawings by reference only in exceptional cases (MPEP 2173.05(s)): state the feature in words.' },
				{ severity: 'Note', rule: 'claim-refers-to-description', file: 'claims.md', line: 2, claim: 2, message: 'Claim 2 relies on a reference to the description or drawings: "as illustrated", "FIG. 3a". A US claim incorporates the description or drawings by reference only in exceptional cases (MPEP 2173.05(s)): state the feature in words.' },
				{ severity: 'Note', rule: 'claim-refers-to-description', file: 'claims.md', line: 3, claim: 3, message: 'Claim 3 relies on a reference to the description or drawings: "as described in the description". A US claim incorporates the description or drawings by reference only in exceptional cases (MPEP 2173.05(s)): state the feature in words.' },
			],
		]);
	});

	it('EPO reference signs: pass with signs in parentheses, and without figures', () => {
		const figures = '- 10: hinge\n- 12: housing\n- 14: coil spring\n';
		expect([
			checkEpoClaimReferenceSigns(claims('1. A hinge (10) comprising a housing (12) and a coil spring (14) of 5 mm.', '2. The hinge (10) of claim 1, wherein the housing and spring (12, 14) are steel.'), figures),
			checkEpoClaimReferenceSigns(claims('1. A hinge comprising a housing 12.'), ''),
		]).toEqual([[], []]);
	});

	it('EPO reference signs: Note for a sign without parentheses (Rule 43(7) EPC), and when no claim has a sign', () => {
		const figures = '- 10: hinge\n- 12: housing\n- 14: coil spring\n';
		expect([
			checkEpoClaimReferenceSigns(claims('1. A hinge (10) comprising a housing 12 and a coil spring 14.', '2. The hinge of claim 1, wherein the housing 12 is steel.'), figures),
			checkEpoClaimReferenceSigns(claims('1. A hinge comprising a housing.'), figures),
		]).toEqual([
			[
				{ severity: 'Note', rule: 'epo-claim-reference-signs', file: 'claims.md', line: 1, claim: 1, message: 'Claim 1 writes "housing 12", "spring 14": Rule 43(7) EPC puts reference signs in parentheses after the feature, e.g. "housing (12)".' },
				{ severity: 'Note', rule: 'epo-claim-reference-signs', file: 'claims.md', line: 2, claim: 2, message: 'Claim 2 writes "housing 12": Rule 43(7) EPC puts reference signs in parentheses after the feature, e.g. "housing (12)".' },
			],
			[
				{ severity: 'Note', rule: 'epo-claim-reference-signs', file: 'claims.md', message: 'No claim has a reference sign, but figures.md lists parts. Rule 43(7) EPC: technical features in the claims are preferably followed by their reference signs in parentheses, e.g. "hinge (10)".' },
			],
		]);
	});

	it('EPO reference signs: only parts shown in a figure count, not parts under a heading that names no figure', () => {
		const figures = '# Figures\n\n## FIG. 1\n\n- 12: housing\n\n## Parts named in the answers, figure not stated\n\n- 16: spring\n';
		expect([
			checkEpoClaimReferenceSigns(claims('1. A hinge comprising a housing (12) and a spring 16.'), figures),
			checkEpoClaimReferenceSigns(claims('1. A hinge comprising a spring.'), '# Figures\n\n## Parts named in the answers, figure not stated\n\n- 16: spring\n'),
		]).toEqual([[], []]);
	});
});
