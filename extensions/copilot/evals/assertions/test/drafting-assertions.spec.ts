/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Offline proof of the drafting suite's deterministic layer (PRD 0022 E4).
 *
 * No model, no judge: the fixtures are checked to be validator-clean, and the graders are run over
 * a hand-written draft that follows the skill and over copies of it that commit the error each
 * grader exists to catch.
 */

import { describe, expect, it } from 'vitest';
import { checkOutline } from '../../../src/extension/tools/common/drafting/outlineValidators';
import { parseDraftingFrontmatter } from '../../../src/extension/tools/common/drafting/frontmatter';
import { approvedClaimsHash, buildDraftingPrompt, loadMatter } from '../../datasets/drafting/drafting-matters';
import { checkMissingSupport, checkProphetic, draftGateErrors, extractFileContent, findPastTenseResults, gradeOutline, gradeSections, judgedDescription, outlineGateErrors } from '../drafting-assertions';

const MATTERS = ['cable-clamp', 'sync-scheduler', 'anti-fog-coating'] as const;
const OFFICES = ['US', 'EPO'] as const;

const cableClampVars = { matter: 'cable-clamp', office: 'US', gapTerm: 'damping insert', propheticSources: 'feature:F7, disclosure:§4.2', workingSources: 'feature:F6, disclosure:§4.1' };

/** A draft of the cable-clamp matter for the US that follows the skill and the fixed outline. */
const goodDraft = `---
office: US
---
# Cable clamp with a hinged lid

## BACKGROUND

<!-- src: disclosure:§2, item:O2 -->
Known cable clamps are two loose parts that the installer screws together around the cable.

## SUMMARY

<!-- src: feature:F1, feature:F2, feature:F3, item:O3 -->
A cable clamp has a clamp body with a channel for a cable, a lid that is hinged to the clamp body and closes over the channel, and a latch on the lid that engages a catch on the clamp body.

## BRIEF DESCRIPTION OF THE DRAWINGS

<!-- src: template, item:O4 -->
FIG. 1 is a perspective view of the cable clamp, closed, on a mounting rail. FIG. 2 is a side view of the cable clamp with the lid open.

## DETAILED DESCRIPTION

<!-- src: feature:F1, item:O5 -->
The cable clamp has a clamp body 10 made in one piece. The clamp body 10 has a channel that receives the cable.

<!-- src: feature:F2, feature:F3, item:O6 -->
A lid 12 is joined to the clamp body 10 by a film hinge and closes over the channel. A latch 14 on the free end of the lid 12 snaps behind a catch 16 on the clamp body 10.

<!-- src: feature:F4, item:O7 -->
A rail foot 18 under the clamp body 10 slides onto a standard mounting rail.

<!-- src: feature:F5, item:O8 -->
The lid 12 is made of polyamide. Polypropylene is an alternative material for the lid 12.

<!-- src: feature:F6, item:O10 -->
In Example 1, a batch of clamps was closed on a cable with a diameter of 12 mm and the cable was pulled with a force of 200 N. The latch 14 of every clamp stayed closed.

<!-- src: feature:F7, item:O11 -->
In Example 2, a clamp with a lid of polypropylene is expected to hold the cable at −30 °C.

## CLAIMS

1. A cable clamp comprising: a clamp body having a channel for a cable; a lid that is hinged to the clamp body and that closes over the channel; and a latch that is formed on the lid and that engages a catch that is formed on the clamp body.

2. The cable clamp of claim 1, further comprising a rail foot that is arranged below the clamp body.

3. The cable clamp of claim 1, wherein the lid is made of polyamide.

4. The cable clamp of claim 1, wherein the channel has a damping insert.

## ABSTRACT

<!-- src: feature:F1, feature:F2, feature:F3, item:O12 -->
A cable clamp has a clamp body with a channel, a lid hinged to the clamp body, and a latch that engages a catch on the clamp body.

## Inventor Questions

> **Inventor Question IQ-1:** Claim 4 recites a damping insert in the channel. What is the damping insert made of, and where in the channel does it sit?
> Belongs: DETAILED DESCRIPTION, after the paragraph on the clamp body 10.
`;

function answer(finalText: string, outline = true): string {
	return JSON.stringify({ skill: 'application-drafting', loadedFiles: ['SKILL.md', ...(outline ? ['references/outline-format.md'] : [])], finalText });
}

describe('drafting fixtures', () => {
	it('every outline fixture is bound to its claims and validator-clean, for both offices', () => {
		const results = MATTERS.flatMap(name => OFFICES.map(office => {
			const matter = loadMatter(name, office);
			const findings = checkOutline({ outline: matter.outline, claims: matter.claims, approvedClaimsHash: approvedClaimsHash(matter.claims), featureList: matter.featureList, figures: matter.figures });
			return {
				case: `${name} ${office}`,
				featureListOffice: parseDraftingFrontmatter(matter.featureList).fields.office,
				outlineOffice: parseDraftingFrontmatter(matter.outline).fields.office,
				errors: findings.filter(finding => finding.severity === 'Error').map(finding => finding.message),
			};
		}));
		expect(results).toEqual(MATTERS.flatMap(name => OFFICES.map(office => ({ case: `${name} ${office}`, featureListOffice: office, outlineOffice: office, errors: [] }))));
	});

	it('the draft prompt carries the outline only for the outline skill, and the outline prompt never', () => {
		const matter = loadMatter('cable-clamp', 'EPO');
		const hasOutline = (prompt: string) => prompt.includes('## Draft Outline (drafting/cable-clamp/draft-outline.md)');
		expect({
			outlineCase: hasOutline(buildDraftingPrompt(matter, 'outline', true)),
			draftCase: hasOutline(buildDraftingPrompt(matter, 'draft', true)),
			preOutlineDraftCase: hasOutline(buildDraftingPrompt(matter, 'draft', false)),
			office: buildDraftingPrompt(matter, 'draft', true).includes('Office: EPO.'),
			disclosure: buildDraftingPrompt(matter, 'outline', true).includes('§4.2 Example 2 (not yet run)'),
			preOutlineClaimTerms: buildDraftingPrompt(matter, 'draft', false).includes('## Claim terms to plan'),
		}).toEqual({ outlineCase: false, draftCase: true, preOutlineDraftCase: false, office: true, disclosure: true, preOutlineClaimTerms: false });
	});

	it('the outline prompt renders the claim terms to plan after the Approved Claims, as start_application_draft does', () => {
		expect(buildDraftingPrompt(loadMatter('cable-clamp', 'US'), 'outline', true)).toMatchSnapshot();
	});
});

describe('extractFileContent', () => {
	it('takes the largest fenced block that is not only frontmatter, or the text from the first frontmatter, heading or table line, and drops the closing disclaimer and the rule above it', () => {
		expect([
			extractFileContent('Here is the outline:\n\n```markdown\n# Draft Outline\n\n| a |\n```\n\nSaved.'),
			extractFileContent('Here is the draft.\n\n---\noffice: US\n---\n# Title\n\ntext\n\nAI-assisted analysis for review by a registered patent attorney — not legal advice.'),
			extractFileContent('# Title\n\ntext\n\n---\n\n*AI-assisted analysis for review by a registered patent attorney — not legal advice.*'),
			extractFileContent('```yaml\n---\noffice: US\n---\n```\n\n# Title\n\nA long paragraph of the draft text that is longer than the fenced frontmatter.'),
		]).toEqual(['# Draft Outline\n\n| a |\n', '---\noffice: US\n---\n# Title\n\ntext\n', '# Title\n\ntext\n', '---\noffice: US\n---\n```\n\n# Title\n\nA long paragraph of the draft text that is longer than the fenced frontmatter.\n']);
	});
});

describe('outline case (outline_coverage)', () => {
	it('passes the fixture outline as the model writes it (no claims hash), and fails one that drops a claim term and a combination', () => {
		const matter = loadMatter('cable-clamp', 'US');
		const asWritten = matter.outline.replace(/^claims: .*\n/m, '');
		const withoutRailFoot = asWritten.replace(/^\| O7 .*\n/m, '');
		expect({
			good: gradeOutline(answer(asWritten), cableClampVars).pass,
			bad: outlineGateErrors(withoutRailFoot, matter).map(finding => `${finding.rule}: ${finding.message}`),
		}).toEqual({
			good: true,
			bad: [
				'outline-coverage: The claim term "rail foot" (claim 2) is in the Claim terms of no Technical item of draft-outline.md.',
				'outline-coverage: Claim 2 depends on claim 1, but no Technical item of draft-outline.md lists claims 1 and 2 together: the combination has no plan.',
			],
		});
	});
});

describe('draft case graders', () => {
	const matter = loadMatter('cable-clamp', 'US');

	it('a draft that follows the skill has no gating Error, with or without the outline rules', () => {
		expect({
			withOutline: draftGateErrors(goodDraft, matter, true, 'damping insert'),
			preOutline: draftGateErrors(goodDraft, matter, false, 'damping insert'),
		}).toEqual({ withOutline: [], preOutline: [] });
	});

	it('a numeral outside figures.md, a defined term used two ways and an unwritten item are Errors', () => {
		const defective = goodDraft
			.replace('A rail foot 18 under the clamp body 10 slides onto a standard mounting rail.', 'A rail foot 18 under the clamp body 10 slides onto a standard mounting rail 20.')
			.replace('The lid 12 is made of polyamide.', 'The lid 12 (hereinafter "Cover") is made of polyamide; the cover is stiff.')
			.replace('<!-- src: feature:F4, item:O7 -->', '<!-- src: feature:F4 -->');
		expect(draftGateErrors(defective, matter, true, 'damping insert').map(finding => finding.rule)).toEqual(['defined-term', 'reference-numeral', 'item-coverage']);
	});

	it('missing support: the gap term must be asked, and no sourced paragraph may state it', () => {
		const invented = goodDraft.replace('The clamp body 10 has a channel that receives the cable.', 'The clamp body 10 has a channel that receives the cable. A damping insert of foam lines the channel.');
		const notAsked = goodDraft.replace(/> \*\*Inventor Question IQ-1:\*\*[\s\S]*$/, '');
		expect([checkMissingSupport(goodDraft, 'damping insert'), checkMissingSupport(invented, 'damping insert'), checkMissingSupport(notAsked, 'damping insert')]).toEqual([
			{ asked: true, attributedLines: [] },
			{ asked: true, attributedLines: [24] },
			{ asked: false, attributedLines: [] },
		]);
	});

	it('prophetic example: a past-tense result fails; the working example is not read', () => {
		const pastTense = goodDraft.replace('a clamp with a lid of polypropylene is expected to hold the cable at −30 °C.', 'a clamp with a lid of polypropylene held the cable at −30 °C and stayed flexible.');
		const sources = ['feature:F7, disclosure:§4.2', 'feature:F6, disclosure:§4.1'] as const;
		expect({
			good: checkProphetic(goodDraft, ...sources),
			pastTense: checkProphetic(pastTense, ...sources).pastTense,
			phrases: findPastTenseResults('The lens was measured, showed no fog and remained clear; it is expected to stay clear and will be tested.'),
		}).toEqual({
			good: { lines: [39], pastTense: [] },
			pastTense: [{ line: 39, phrase: 'stayed' }],
			phrases: ['was measured', 'showed', 'remained'],
		});
	});

	it('the judge reads the description without markers, claims and Inventor Questions', () => {
		const description = judgedDescription(goodDraft);
		expect({
			markers: description.includes('<!--'),
			claims: description.includes('wherein the channel has a damping insert'),
			question: description.includes('Inventor Question'),
			first: description.split('\n\n')[0],
		}).toEqual({ markers: false, claims: false, question: false, first: '[P1 | BACKGROUND | cites disclosure:§2]\nKnown cable clamps are two loose parts that the installer screws together around the cable.' });
	});

	it('end-to-end completion: every required section of the office order is present', () => {
		const withoutSummary = goodDraft.replace(/## SUMMARY\n\n[^\n]*\n[^\n]*\n\n/, '');
		expect([
			gradeSections(answer(goodDraft), cableClampVars).pass,
			gradeSections(answer(withoutSummary), cableClampVars).reason,
			gradeSections(answer(goodDraft), { ...cableClampVars, office: 'EPO' }).reason,
		]).toEqual([
			true,
			'Missing US part(s): Summary',
			'Missing EPO part(s): Technical Field',
		]);
	});
});
