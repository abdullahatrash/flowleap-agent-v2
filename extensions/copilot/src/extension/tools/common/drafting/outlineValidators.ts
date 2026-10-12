/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Deterministic validators of the Draft Outline (PRD 0022, ADR 0012 decision 4): the plan against
 * the Approved Claims and the matter files, and the Draft Application against the plan. No model
 * call, and no validator reads the content of a source: a source is checked only for existence.
 *
 * - `outline-claims`: the outline was made from the current Approved Claims.
 * - `outline-coverage`: every claim term is planned by a Technical item; every dependent claim is
 *   planned by a Technical item together with its independent claim.
 * - `outline-sources`: every Technical item has a source or a question; a Template item has no
 *   claim terms; every source names a Feature List row, a figure or an answered Inventor Question
 *   that exists.
 * - `item-coverage`: every item is realised by a paragraph (`item:O<n>`); every `item:` names a row.
 * - `duplicate-sentence`: one sentence written in two paragraphs.
 * - `outline-format`: a line of `draft-outline.md` that could not be read.
 */

import { DraftClaim, parseClaims } from './claims';
import { claimTermCovered, claimTermKey, independentRoots, introducedPhrases } from './claimValidators';
import { DraftFinding, errorsFirst } from './finding';
import { DRAFTING_FILE_NAMES } from './folderContract';
import { parseDraftingFrontmatter } from './frontmatter';
import { hasAnyAnswer, InventorAnswerSection, parseInventorAnswers } from './inventorAnswers';
import { DraftOutline, OutlineItem, OutlineSource, parseDraftOutline } from './outline';
import { DraftParagraph, parseDraftParagraphs } from './sourceMarkers';
import { figureNumbers, hasFigure, isClaimsParagraph } from './specValidators';
import { splitSentences } from './workingRecord';

const outlineFile = DRAFTING_FILE_NAMES.draftOutline;
const draftFile = DRAFTING_FILE_NAMES.draft;

/** A sentence shorter than this many words is never reported as a duplicate. */
const minimumDuplicateWords = 6;

function outlineFinding(severity: DraftFinding['severity'], rule: string, line: number, message: string, claim?: number): DraftFinding {
	return { severity, rule, file: outlineFile, line, ...(claim !== undefined ? { claim } : {}), message };
}

function shortHash(hash: string): string {
	return `${hash.slice(0, 12)}…`;
}

/** Error when the outline's `claims` hash is missing or is not the given Approved Claims hash. */
export function checkOutlineClaims(outline: DraftOutline, approvedClaimsHash: string): DraftFinding[] {
	const rewriteInstruction = 'Write the Draft Outline again for the current Approved Claims.';
	if (!outline.claimsHash) {
		return [outlineFinding('Error', 'outline-claims', 1, `${outlineFile} names no claims hash (claims: <SHA-256 of the Approved Claims>). ${rewriteInstruction}`)];
	}
	if (outline.claimsHash.toLowerCase() === approvedClaimsHash.trim().toLowerCase()) {
		return [];
	}
	return [outlineFinding('Error', 'outline-claims', 1, `${outlineFile} was made from claims with SHA-256 ${shortHash(outline.claimsHash)}, but the Approved Claims have SHA-256 ${shortHash(approvedClaimsHash.trim())}. ${rewriteInstruction}`)];
}

/**
 * Errors of the plan's coverage of the claims:
 *
 * - each claim term (the phrases {@link introducedPhrases} reads, compared by {@link claimTermKey})
 *   that no Technical item lists in `Claim terms`, reported once, at the first claim that
 *   introduces it. A listed term that contains the claim term as whole words covers it
 *   ({@link claimTermCovered}): `a channel for a cable` covers `channel`;
 * - each dependent claim that no Technical item lists together with an independent claim it
 *   depends on, directly or through other dependent claims: the combination has no plan.
 *
 * The findings are on the table header line. Without a table there are none: the
 * `outline-format` error of the missing table is the finding.
 */
export function checkOutlineCoverage(outline: DraftOutline, claims: readonly DraftClaim[]): DraftFinding[] {
	const line = outline.tableLine;
	if (line === undefined) {
		return [];
	}
	const technical = outline.items.filter(item => item.kind === 'Technical');
	const planned = technical.flatMap(item => item.claimTerms.map(claimTermKey));
	const findings: DraftFinding[] = [];
	const reported = new Set<string>();
	for (const claim of claims) {
		for (const phrase of introducedPhrases(claim.text)) {
			const key = claimTermKey(phrase);
			if (!reported.has(key) && !planned.some(listed => claimTermCovered(key, listed))) {
				findings.push(outlineFinding('Error', 'outline-coverage', line, `The claim term "${phrase}" (claim ${claim.number}) is in the Claim terms of no Technical item of ${outlineFile}.`, claim.number));
			}
			reported.add(key);
		}
	}
	const byNumber = new Map(claims.map(claim => [claim.number, claim]));
	for (const claim of claims.filter(entry => entry.dependsOn.length)) {
		for (const root of independentRoots(claim, byNumber)) {
			if (!technical.some(item => item.claims.includes(claim.number) && item.claims.includes(root))) {
				findings.push(outlineFinding('Error', 'outline-coverage', line, `Claim ${claim.number} depends on claim ${root}, but no Technical item of ${outlineFile} lists claims ${root} and ${claim.number} together: the combination has no plan.`, claim.number));
			}
		}
	}
	return findings;
}

/**
 * The row ids of `feature-list.md`: an `F<n>` at the start of a table row, a list item or a
 * heading (`| F3 | ...`, `- F3: ...`, `## F3 ...`), optionally in bold.
 */
function featureRowIds(featureList: string): Set<string> {
	const { body } = parseDraftingFrontmatter(featureList);
	const ids = new Set<string>();
	for (const content of body.split('\n')) {
		const id = /^\s*(?:\|\s*|[-*]\s+|#{1,6}\s+)?(?:\*\*)?(?<id>F\d+)\b/.exec(content)?.groups?.id;
		if (id) {
			ids.add(id);
		}
	}
	return ids;
}

function quoteList(texts: readonly string[]): string {
	return texts.map(text => `"${text}"`).join(', ');
}

/** The reason a source does not exist in the matter files, or `undefined` when it does. */
function missingSource(source: OutlineSource, featureIds: ReadonlySet<string>, numbers: readonly string[], answers: readonly InventorAnswerSection[]): string | undefined {
	switch (source.kind) {
		case 'feature':
			return featureIds.has(source.ref) ? undefined : `${source.ref}, which is not a row of ${DRAFTING_FILE_NAMES.featureList}`;
		case 'figure':
			return hasFigure(numbers, source.ref) ? undefined : `FIG. ${source.ref}, which is not a figure of ${DRAFTING_FILE_NAMES.figures}`;
		case 'answer':
			return hasAnyAnswer(answers.find(section => section.id === source.ref)) ? undefined : `${source.ref}, which has no answer in ${DRAFTING_FILE_NAMES.inventorAnswers}`;
		case 'disclosure':
			return undefined;
	}
}

/**
 * Errors of the items' sources: a Template item that lists claim terms; a Technical item with
 * neither a source nor a question; a source that names a Feature List row not in
 * `feature-list.md`, a figure no heading of `figures.md` names, or an Inventor Question with no
 * answer in `inventor-answers.md`. A disclosure span is not checked: the disclosure is not a
 * matter file.
 */
export function checkOutlineSources(outline: DraftOutline, featureList: string, figures: string, answers: readonly InventorAnswerSection[]): DraftFinding[] {
	const featureIds = featureRowIds(featureList);
	const numbers = figureNumbers(figures);
	const findings: DraftFinding[] = [];
	for (const item of outline.items) {
		if (item.kind === 'Template' && item.claimTerms.length) {
			findings.push(outlineFinding('Error', 'outline-sources', item.line, `Item ${item.id} is a Template item but lists the claim terms ${quoteList(item.claimTerms)}: a Template item has no claim terms. Make it a Technical item, or remove the terms.`));
		}
		if (item.kind === 'Technical' && !item.sources.length && !item.question) {
			findings.push(outlineFinding('Error', 'outline-sources', item.line, `Technical item ${item.id} names no source and no question. Name a Feature List row, a disclosure span, a figure or an answered Inventor Question, or write the open question.`));
		}
		for (const source of item.sources) {
			const missing = missingSource(source, featureIds, numbers, answers);
			if (missing) {
				findings.push(outlineFinding('Error', 'outline-sources', item.line, `Item ${item.id} names ${missing}.`));
			}
		}
	}
	return findings;
}

function itemLabel(item: OutlineItem): string {
	return item.claimTerms.length ? `${item.section}; ${quoteList(item.claimTerms)}` : item.section;
}

/**
 * Findings of the draft's coverage of the plan, over the draft paragraphs:
 *
 * - Error for a Technical item no paragraph names with `item:`; a Note instead when the item has
 *   no source and an open question, because its gap goes to the draft as an Inventor Question;
 * - Note for a Template item no paragraph names;
 * - Error for an `item:` that names no row of the outline.
 *
 * Errors first.
 */
export function checkItemCoverage(outline: DraftOutline, paragraphs: readonly DraftParagraph[]): DraftFinding[] {
	const named = new Set(paragraphs.flatMap(paragraph => paragraph.items ?? []));
	const findings: DraftFinding[] = [];
	for (const item of outline.items) {
		if (named.has(item.id)) {
			continue;
		}
		const unnamed = `is realised by no paragraph of ${draftFile}: no source marker names item:${item.id}.`;
		if (item.kind === 'Template') {
			findings.push(outlineFinding('Note', 'item-coverage', item.line, `Template item ${item.id} (${itemLabel(item)}) ${unnamed}`));
		} else if (!item.sources.length && item.question) {
			findings.push(outlineFinding('Note', 'item-coverage', item.line, `Technical item ${item.id} (${itemLabel(item)}) has no source and no paragraph names item:${item.id}; its open question goes to the draft as an Inventor Question: ${item.question}`));
		} else {
			findings.push(outlineFinding('Error', 'item-coverage', item.line, `Technical item ${item.id} (${itemLabel(item)}) ${unnamed}`));
		}
	}
	const ids = new Set(outline.items.map(item => item.id));
	for (const paragraph of paragraphs) {
		for (const id of new Set(paragraph.items ?? [])) {
			if (!ids.has(id)) {
				findings.push({ severity: 'Error', rule: 'item-coverage', file: draftFile, line: paragraph.line, message: `The paragraph at line ${paragraph.line} names item:${id}, which is not a row of ${outlineFile}.` });
			}
		}
	}
	return errorsFirst(findings);
}

/** A sentence for comparison: lower case, white space collapsed, trailing punctuation removed. */
function normaliseSentence(sentence: string): string {
	return sentence.toLowerCase().replace(/\s+/g, ' ').trim().replace(/[.?!;:,]+$/, '').trim();
}

/**
 * Note when one sentence (split as the Working Record splits it, then normalised: lower case,
 * white space collapsed, trailing punctuation removed) is in two different text paragraphs. A
 * sentence of fewer than 6 words, a repeat inside one paragraph and the claims are not reported.
 * The Note is on the later paragraph and names the line of both.
 */
export function checkDuplicateSentences(paragraphs: readonly DraftParagraph[]): DraftFinding[] {
	const first = new Map<string, number>();
	const findings: DraftFinding[] = [];
	for (const paragraph of paragraphs) {
		if (paragraph.kind !== 'text' || isClaimsParagraph(paragraph)) {
			continue;
		}
		const own = new Set<string>();
		for (const sentence of splitSentences(paragraph.text).map(normaliseSentence)) {
			if (sentence.split(' ').length < minimumDuplicateWords || own.has(sentence)) {
				continue;
			}
			own.add(sentence);
			const earlier = first.get(sentence);
			if (earlier === undefined) {
				first.set(sentence, paragraph.line);
			} else {
				findings.push({ severity: 'Note', rule: 'duplicate-sentence', file: draftFile, line: paragraph.line, message: `The sentence "${sentence}" is in the paragraphs at lines ${earlier} and ${paragraph.line}. Keep it in one place.` });
			}
		}
	}
	return findings;
}

/** The files the outline rules read. */
export interface OutlineValidationInput {
	/** `draft-outline.md`. */
	readonly outline: string;
	/** `claims.md`. */
	readonly claims: string;
	/** The SHA-256 of the Approved Claims, as the tools compute it. */
	readonly approvedClaimsHash: string;
	/** `feature-list.md`. */
	readonly featureList: string;
	/** `figures.md`; absent or empty when the application has no figures. */
	readonly figures?: string;
	/** `inventor-answers.md`; absent when there are no Inventor Questions yet. */
	readonly inventorAnswers?: string;
}

/**
 * Runs the rules of the plan: `outline-format` (parse errors), `outline-claims`,
 * `outline-coverage` and `outline-sources`. Errors first; no model call.
 */
export function checkOutline(input: OutlineValidationInput): DraftFinding[] {
	const outline = parseDraftOutline(input.outline);
	return errorsFirst([
		...outline.errors.map(error => outlineFinding('Error', 'outline-format', error.line, error.message)),
		...checkOutlineClaims(outline, input.approvedClaimsHash),
		...checkOutlineCoverage(outline, parseClaims(input.claims)),
		...checkOutlineSources(outline, input.featureList, input.figures ?? '', parseInventorAnswers(input.inventorAnswers ?? '')),
	]);
}

/** The files the rules of the draft against the plan read. */
export interface DraftOutlineValidationInput {
	/** `draft-outline.md`. */
	readonly outline: string;
	/** `draft-application.md`. */
	readonly draft: string;
}

/** Runs the rules of the draft against the plan: `item-coverage` and `duplicate-sentence`. Errors first; no model call. */
export function checkDraftAgainstOutline(input: DraftOutlineValidationInput): DraftFinding[] {
	const paragraphs = parseDraftParagraphs(input.draft);
	return errorsFirst([
		...checkItemCoverage(parseDraftOutline(input.outline), paragraphs),
		...checkDuplicateSentences(paragraphs),
	]);
}
