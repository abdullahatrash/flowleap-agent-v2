/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { parseClaims } from '../drafting/claims';
import { checkAntecedentBasis, checkClaimCount, checkClaimNumbering, checkClaimOneSentence, checkClaimReferencesToDescription, checkDependencyTargets, checkEpoClaimReferenceSigns, checkEpoOneIndependentPerCategory, checkLiteralBasis, checkRelativeTerms, checkUsMultipleDependency, claimTermsToPlan } from '../drafting/claimValidators';

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

	it('antecedent basis: IDF-006 (EPO) claims verbatim: noun phrases, parent preambles, process steps and inherent properties need no "a" of their first word', () => {
		expect(checkAntecedentBasis(claims(
			'1. A photocurable dental composition comprising a polymerizable monomer and/or prepolymer, a polymerization initiator suitable for light curing, and a particulate composite filler, wherein the composite filler is present in an amount of 20-90 wt% of the overall composition, each composite filler particle is a composite granule containing inorganic filler in an organic polymer body, the composite granules have an average particle size of 20-50 µm, at most 10 wt% of the composite filler particles, based on the mass of the composite filler, have a particle size below 10 µm, and the overall composition is essentially free of filler having a particle size below 100 nm.',
			'2. The composition of claim 1, wherein the overall composition contains less than 1 wt% of filler having a particle size below 100 nm, based on the total composition.',
			'3. The composition of claim 1, wherein the polymerizable monomer comprises urethane dimethacrylate.',
			'4. The composition of claim 1, wherein the polymerization initiator comprises camphorquinone and an amine reducing agent.',
			'5. The composition of claim 1, wherein the inorganic filler comprises barium glass and/or strontium glass having a mean particle size of 0.4-1.5 µm.',
			'6. The composition of claim 1, wherein at most 8 wt% of the composite filler particles, based on the mass of the composite filler, have a particle size below 10 µm.',
			'7. The composition of claim 1, wherein the composite filler has a mean particle size of 30-40 µm and a maximum particle size of 70 µm.',
			'8. A method for producing a photocurable dental composition, comprising: curing an organic-inorganic composite; milling the cured composite to form composite granules; classifying the milled granules to remove particles below 10 µm and particles above 70 µm; and incorporating the retained composite granules into a polymerizable composition with a light-curing initiator.',
		))).toEqual([]);
	});

	it('antecedent basis: the head noun (the last noun of the phrase) must be introduced, not any noun of it', () => {
		expect(checkAntecedentBasis(claims(
			'1. A hinge comprising a lever.',
			'2. The hinge of claim 1, wherein the lever housing is steel.',
			'3. A door comprising a housing.',
			'4. The door of claim 3, wherein the housing cover is plastic.',
		))).toEqual([
			{ severity: 'Error', rule: 'antecedent-basis', file: 'claims.md', line: 2, claim: 2, message: 'Claim 2: "the lever housing" has no antecedent basis ("a lever housing") earlier in claim 2 or in the claims it depends on.' },
			{ severity: 'Error', rule: 'antecedent-basis', file: 'claims.md', line: 4, claim: 4, message: 'Claim 4: "the housing cover" has no antecedent basis ("a housing cover") earlier in claim 4 or in the claims it depends on.' },
		]);
	});

	it('antecedent basis: the head noun of the phrase must be introduced; an inherent property needs no antecedent, a missing part still errors', () => {
		expect(checkAntecedentBasis(claims(
			'1. A hinge comprising a lever of steel, wherein the total weight of the lever is low and the overall hinge is small.',
			'2. The hinge of claim 1, wherein the housing holds the steel lever and the thickness of the housing is 2 mm.',
			'3. The door of claim 1, wherein the second lever is long.',
		))).toEqual([
			{ severity: 'Error', rule: 'antecedent-basis', file: 'claims.md', line: 2, claim: 2, message: 'Claim 2: "the housing" has no antecedent basis ("a housing") earlier in claim 2 or in the claims it depends on.' },
			{ severity: 'Error', rule: 'antecedent-basis', file: 'claims.md', line: 3, claim: 3, message: 'Claim 3: "the door" has no antecedent basis ("a door") earlier in claim 3 or in the claims it depends on.' },
			{ severity: 'Error', rule: 'antecedent-basis', file: 'claims.md', line: 3, claim: 3, message: 'Claim 3: "the second lever" has no antecedent basis ("a second lever") earlier in claim 3 or in the claims it depends on.' },
		]);
	});

	it('antecedent basis: a phrase stops at an adverb, a particle, a preposition and a participle after its first word (#747 pipe clamp claims)', () => {
		expect(checkAntecedentBasis(claims(
			'1. A pipe clamp, comprising: a base having a saddle groove configured to receive a pipe; a cap having a cap groove facing the saddle groove, a first side of the cap being pivotally connected to a first side of the base; a spring arranged between the base and the cap and biasing the cap away from the base toward an open position; and a latch at a second side of the base, the latch being releasable and configured to hold the cap in a closed position against the spring.',
			'2. The pipe clamp of claim 1, wherein the spring is a compression spring seated in a pocket of the base.',
			'3. The pipe clamp of claim 2, wherein the pocket is located beside the saddle groove at the second side of the base.',
			'4. The pipe clamp of claim 1, wherein the base comprises a base plate and the spring is a leaf spring fixed to the base plate.',
			'5. The pipe clamp of claim 1, wherein the latch comprises a latch lug on the second side of the base, a cap latch lug on a second side of the cap, and a locking pin removably insertable through the latch lug and the cap latch lug when the cap is in the closed position.',
			'6. The pipe clamp of claim 5, wherein the latch lug has a hole receiving the locking pin, and the locking pin has a head at one end with a diameter larger than the hole.',
			'7. The pipe clamp of claim 1, wherein the latch is a quarter-turn latch.',
			'8. The pipe clamp of claim 1, further comprising a hinge pin extending through a hinge lug on the first side of the base and a cap hinge lug on the first side of the cap, the cap pivoting on the hinge pin.',
			'9. The pipe clamp of claim 1, wherein the base comprises a base plate having mounting holes and a saddle block on the base plate, and the saddle groove is a half-round groove in a top of the saddle block.',
			'10. The pipe clamp of claim 9, wherein the base plate and the saddle block are one machined part.',
			'11. The pipe clamp of claim 1, wherein the base and the cap are made of glass-filled nylon.',
			'12. A method of securing a pipe in a clamp, the clamp comprising a base having a saddle groove, a cap pivotally connected to the base by a hinge pin, and a spring biasing the cap away from the base, the method comprising, in the following order: placing the pipe in the saddle groove; pivoting the cap about the hinge pin onto the pipe; compressing the spring with the cap; pushing a locking pin through a latch lug of the base and a cap latch lug of the cap; and releasing the cap, the locking pin holding the cap closed against the spring.',
			'13. The method of claim 12, further comprising, before placing the pipe in the saddle groove, fastening the base to a wall with screws through mounting holes of the base.',
			'14. The method of claim 12, further comprising pulling the locking pin out of the latch lug and the cap latch lug, the spring then lifting the cap away from the pipe.',
		))).toEqual([]);
	});

	it('antecedent basis: a first word in -ing or -ed stays part of the term; a missing head noun still errors', () => {
		expect(checkAntecedentBasis(claims(
			'1. A tool comprising a lever, a locking pin, a threaded rod, a sealing ring and a plurality of mounting holes.',
			'2. The tool of claim 1, wherein the locking pin, the threaded rod, the sealing ring and the mounting holes are steel, and the lever arm is bent.',
		))).toEqual([
			{ severity: 'Error', rule: 'antecedent-basis', file: 'claims.md', line: 2, claim: 2, message: 'Claim 2: "the lever arm" has no antecedent basis ("a lever arm") earlier in claim 2 or in the claims it depends on.' },
		]);
	});

	it('claim terms to plan: the terms each claim introduces, in order, and the independent claims a dependent claim depends on through a chain', () => {
		expect(claimTermsToPlan(claims(
			'1. A cable clamp comprising a channel and a damping insert.',
			'2. The cable clamp of claim 1, wherein the damping insert has a plurality of ribs.',
			'3. The cable clamp of claim 2, further comprising a sealing ring.',
			'4. The cable clamp of claim 3, wherein the ribs are rubber.',
		))).toEqual([
			{ claim: 1, independentClaims: [], terms: ['cable clamp', 'channel', 'damping insert'] },
			{ claim: 2, independentClaims: [1], terms: ['ribs'] },
			{ claim: 3, independentClaims: [1], terms: ['sealing ring'] },
			{ claim: 4, independentClaims: [1], terms: [] },
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
