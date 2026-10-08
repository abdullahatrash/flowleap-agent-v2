/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { parseClaims } from './claims';
import { checkAntecedentBasis, checkClaimCount, checkClaimNumbering, checkClaimOneSentence, checkClaimReferencesToDescription, checkDependencyTargets, checkEpoClaimReferenceSigns, checkEpoOneIndependentPerCategory, checkLiteralBasis, checkRelativeTerms, checkUsMultipleDependency } from './claimValidators';
import { checkPageCount, filingManifest } from './filingManifest';
import { DraftFinding } from './finding';
import { DraftingOffice } from './frontmatter';
import { parseInventorAnswers } from './inventorAnswers';
import { parseDraftParagraphs } from './sourceMarkers';
import { checkAbstractLength, checkDefinedTerms, checkEpoAbstractFigure, checkInventorQuestions, checkReferenceNumerals, checkSourceMarkers, isAbstractParagraph, isClaimsParagraph } from './specValidators';

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
}

/**
 * Runs the deterministic validator set of the office over one draft (ADR 0012 decision 4):
 * Errors first (claims, then draft text), then Notes. No model call; Advisory items are added
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
	];
	return [...findings.filter(finding => finding.severity === 'Error'), ...findings.filter(finding => finding.severity !== 'Error')];
}
