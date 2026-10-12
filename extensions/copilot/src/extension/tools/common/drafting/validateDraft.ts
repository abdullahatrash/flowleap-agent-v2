/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { parseClaims } from './claims';
import { checkAntecedentBasis, checkClaimCount, checkClaimNumbering, checkClaimOneSentence, checkClaimReferencesToDescription, checkDependencyTargets, checkEpoClaimReferenceSigns, checkEpoOneIndependentPerCategory, checkLiteralBasis, checkRelativeTerms, checkUsMultipleDependency } from './claimValidators';
import { checkPageCount, filingManifest } from './filingManifest';
import { DraftFinding, errorsFirst } from './finding';
import { DRAFTING_FILE_NAMES } from './folderContract';
import { DraftingOffice } from './frontmatter';
import { parseInventorAnswers } from './inventorAnswers';
import { checkDraftAgainstOutline, checkOutline } from './outlineValidators';
import { parseDraftParagraphs } from './sourceMarkers';
import { checkAbstractLength, checkDefinedTerms, checkEpoAbstractFigure, checkInventorQuestions, checkReferenceNumerals, checkSourceMarkers, isAbstractParagraph, isClaimsParagraph } from './specValidators';

/** The inputs of the Draft Outline rules (PRD 0022). */
export interface DraftOutlineRulesInput {
	/** `draft-outline.md`; absent when the file does not exist. */
	readonly text?: string;
	/** The SHA-256 of the Approved Claims, as the tools compute it. */
	readonly approvedClaimsHash: string;
	/** `feature-list.md`. */
	readonly featureList: string;
}

/** The file contents of one draft folder that the validators read. */
export interface DraftValidationInput {
	readonly office: DraftingOffice;
	/** `draft-application.md`. */
	readonly draft: string;
	/** `claims.md`. */
	readonly claims: string;
	/** `figures.md`; absent or empty when the application has no figures. */
	readonly figures?: string;
	/** `inventor-answers.md`; absent when the draft has no Inventor Questions yet. */
	readonly inventorAnswers?: string;
	/** The inputs of the Draft Outline rules; absent = those rules do not run. */
	readonly outline?: DraftOutlineRulesInput;
}

/**
 * The Draft Outline rules (E1): the plan against the claims and the matter files, and the draft
 * against the plan. Without `draft-outline.md`, one `outline-claims` Error: the draft has no plan
 * for the Approved Claims.
 */
function outlineFindings(input: DraftValidationInput, outline: DraftOutlineRulesInput): DraftFinding[] {
	if (outline.text === undefined) {
		return [{ severity: 'Error', rule: 'outline-claims', file: DRAFTING_FILE_NAMES.draftOutline, message: `${DRAFTING_FILE_NAMES.draftOutline} does not exist: there is no Draft Outline for the Approved Claims. Save the outline with write_patent_results, template draft-outline.` }];
	}
	return [
		...checkOutline({ outline: outline.text, claims: input.claims, approvedClaimsHash: outline.approvedClaimsHash, featureList: outline.featureList, figures: input.figures, inventorAnswers: input.inventorAnswers }),
		...checkDraftAgainstOutline({ outline: outline.text, draft: input.draft }),
	];
}

/**
 * Runs the deterministic validator set of the office over one draft (ADR 0012 decision 4), and
 * the Draft Outline rules when `outline` is given: Errors first (claims, then draft text, then
 * the outline), then Notes. No model call; Advisory items are added
 * by the caller.
 */
export function validateDraft(input: DraftValidationInput): DraftFinding[] {
	const claims = parseClaims(input.claims);
	const paragraphs = parseDraftParagraphs(input.draft);
	const description = paragraphs
		.filter(paragraph => paragraph.kind === 'text' && !isAbstractParagraph(paragraph) && !isClaimsParagraph(paragraph))
		.map(paragraph => paragraph.text)
		.join('\n\n');
	const figures = input.figures ?? '';
	const answers = parseInventorAnswers(input.inventorAnswers ?? '');
	const epo = input.office === 'EPO';
	const findings = [
		...checkClaimNumbering(claims),
		...checkDependencyTargets(claims),
		...(epo ? checkEpoOneIndependentPerCategory(claims) : checkUsMultipleDependency(claims)),
		...checkClaimOneSentence(claims),
		...checkClaimReferencesToDescription(claims, input.office),
		...checkAntecedentBasis(claims),
		...checkLiteralBasis(claims, description),
		...checkAbstractLength(paragraphs, input.office),
		...checkDefinedTerms(paragraphs),
		...checkReferenceNumerals(paragraphs, figures),
		...checkSourceMarkers(paragraphs, answers),
		...checkInventorQuestions(input.draft, answers),
		...checkClaimCount(claims, input.office),
		...checkPageCount(filingManifest(input)),
		...checkRelativeTerms(claims),
		...(epo ? [...checkEpoClaimReferenceSigns(claims, figures), ...checkEpoAbstractFigure(paragraphs, figures)] : []),
		...(input.outline ? outlineFindings(input, input.outline) : []),
	];
	return errorsFirst(findings);
}
