/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Deterministic graders of the drafting regression eval (PRD 0022 E4).
 *
 * Unlike the `.mjs` helpers of the other suites, this module is TypeScript: it imports the
 * Application Drafting validators from `src/extension/tools/common/drafting/` (pure code, no
 * VS Code API), so the eval grades with the same rules the app runs. promptfoo runs under tsx, so
 * a `javascript` assertion can `import()` it; the vitest spec imports it directly.
 *
 * Each `grade*` function takes the provider output (`{ skill, loadedFiles, finalText }`) and the
 * case vars, and returns a promptfoo grading result. The judge of unsupported technical
 * additions is an `llm-rubric` in the dataset, not here.
 */

import { claimTermKey } from '../../src/extension/tools/common/drafting/claimValidators';
import { missingParts } from '../../src/extension/tools/common/drafting/filingDocuments';
import { DraftFinding, isInventorQuestion } from '../../src/extension/tools/common/drafting/finding';
import { parseDraftingFrontmatter, writeDraftingFrontmatter } from '../../src/extension/tools/common/drafting/frontmatter';
import { checkOutline } from '../../src/extension/tools/common/drafting/outlineValidators';
import { DraftParagraph, parseDraftParagraphs, parseInventorQuestions } from '../../src/extension/tools/common/drafting/sourceMarkers';
import { hasFigures, isClaimsParagraph } from '../../src/extension/tools/common/drafting/specValidators';
import { validateDraft } from '../../src/extension/tools/common/drafting/validateDraft';
import { DraftingMatter, loadMatter, OUTLINE_REFERENCE, readCaseOffice } from '../datasets/drafting/drafting-matters';

/** What a grader returns to promptfoo. */
export interface GradingResult {
	readonly pass: boolean;
	readonly score: number;
	readonly reason: string;
}

/** The vars of a drafting case that the graders read. */
export interface DraftingCaseVars {
	readonly matter: string;
	readonly office: string;
	/** The claim term with no Feature List row (the missing-support case), e.g. `damping insert`. */
	readonly gapTerm: string;
	/** The source markers of the prophetic example, comma-separated, e.g. `feature:F7, disclosure:§4.2`. */
	readonly propheticSources: string;
	/** The source markers of the working example, comma-separated, e.g. `feature:F6, disclosure:§4.1`. */
	readonly workingSources: string;
}

/** The provider output of the skill-grounded provider. */
interface DraftingAnswer {
	readonly loadedFiles: readonly string[];
	readonly finalText: string;
}

function readAnswer(output: string): DraftingAnswer {
	const parsed = JSON.parse(output) as Partial<DraftingAnswer>;
	return { loadedFiles: parsed.loadedFiles ?? [], finalText: parsed.finalText ?? '' };
}

/** The closing line the skill puts under every deliverable in chat; in the app it is not part of the saved file. */
const disclaimerPattern = /^\s*[*_]*AI-assisted analysis for review by a registered patent attorney/i;

/**
 * The file content of an answer that was asked to be the file only. A model may still wrap it in
 * a code fence, put a sentence before it, or close with the skill's disclaimer line: the content
 * is the largest fenced block when there is one (a fence around only the frontmatter is not the
 * file), else the text from the first frontmatter,
 * heading or table line; a last paragraph that is the disclaimer is dropped, with a horizontal
 * rule above it.
 */
export function extractFileContent(answer: string): string {
	const text = answer.replace(/\r\n/g, '\n');
	const fenced = [...text.matchAll(/^```[a-z]*\n(?<content>[\s\S]*?)\n```\s*$/gm)].map(match => match.groups?.content ?? '');
	const files = fenced.filter(block => !/^---\n[\s\S]*\n---\s*$/.test(block.trim()));
	let content = files.length ? files.reduce((longest, block) => block.length > longest.length ? block : longest) : text;
	const start = content.search(/^(?:---\s*$|#{1,6}\s|\|)/m);
	if (start > 0) {
		content = content.slice(start);
	}
	const paragraphs = content.trimEnd().split(/\n\s*\n/);
	if (paragraphs.length > 1 && disclaimerPattern.test(paragraphs[paragraphs.length - 1])) {
		paragraphs.pop();
		while (paragraphs.length > 1 && /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(paragraphs[paragraphs.length - 1])) {
			paragraphs.pop();
		}
	}
	return `${paragraphs.join('\n\n').trimEnd()}\n`;
}

function matterOf(vars: DraftingCaseVars): DraftingMatter {
	return loadMatter(vars.matter, readCaseOffice(vars.office));
}

function describeFindings(findings: readonly DraftFinding[], limit = 8): string {
	const shown = findings.slice(0, limit).map(finding => `[${finding.rule}${finding.line !== undefined ? ` ${finding.file ?? ''}:${finding.line}` : ''}] ${finding.message}`);
	return [...shown, ...(findings.length > limit ? [`... and ${findings.length - limit} more`] : [])].join(' | ');
}

/**
 * The description the judge reads: one block per text paragraph, without the claims section and
 * the Inventor Questions, each headed with its section and the sources its marker cites
 * (`[P3 | DETAILED DESCRIPTION | cites feature:F2, feature:F3]`), so the judge can check a sentence
 * against the cited sources first.
 */
export function judgedDescription(draft: string): string {
	const isQuestionSection = (paragraph: DraftParagraph) => /^inventor questions?$/i.test(paragraph.section ?? '');
	return descriptionParagraphs(draft)
		.filter(paragraph => !isQuestionSection(paragraph) && paragraph.text.trim().length > 0)
		.map((paragraph, index) => {
			const cites = paragraph.sources?.map(source => sourceKey(source.kind, source.ref)).join(', ') || 'no source';
			return `[P${index + 1} | ${paragraph.section ?? 'no section'} | cites ${cites}]\n${paragraph.text.trim()}`;
		})
		.join('\n\n');
}

/**
 * The text the judge of unsupported technical additions reads (`draft_unsupported`): the sources
 * of the matter, then the draft's description ({@link judgedDescription}). The Approved Claims are
 * a source too, so that a restatement of a claim is not read as an addition; the rubric itself is
 * in the dataset.
 */
export function judgeInput(output: string, vars: DraftingCaseVars): string {
	const matter = matterOf(vars);
	return [
		'SOURCES',
		`FEATURE LIST:\n${matter.featureList.trim()}`,
		`DISCLOSURE:\n${matter.disclosure.trim()}`,
		`FIGURES:\n${matter.figures.trim()}`,
		`APPROVED CLAIMS:\n${matter.claims.trim()}`,
		'INVENTOR ANSWERS: none',
		'DRAFT DESCRIPTION',
		judgedDescription(extractFileContent(readAnswer(output).finalText)),
	].join('\n\n');
}

/** The outline rules the outline case gates on (PRD 0022 E4). `outline-claims` is the save's job: the grader binds the hash as the save does. */
const OUTLINE_GATE_RULES: ReadonlySet<string> = new Set(['outline-format', 'outline-coverage', 'outline-sources']);

/**
 * Binds an outline answer to the Approved Claims the way the `draft-outline` save does: `office`
 * from the Feature List and `claims` set to the Approved Claims hash; other frontmatter fields kept.
 */
function bindOutline(content: string, matter: DraftingMatter): string {
	const { fields } = parseDraftingFrontmatter(content);
	const others = Object.fromEntries(Object.entries(fields).filter(([key]) => key !== 'office' && key !== 'claims'));
	return writeDraftingFrontmatter({ office: matter.office, claims: matter.claimsHash, ...others }, content);
}

/** The Errors of the outline rules that gate the outline case. */
export function outlineGateErrors(content: string, matter: DraftingMatter): DraftFinding[] {
	return checkOutline({ outline: bindOutline(content, matter), claims: matter.claims, approvedClaimsHash: matter.claimsHash, featureList: matter.featureList, figures: matter.figures })
		.filter(finding => finding.severity === 'Error' && OUTLINE_GATE_RULES.has(finding.rule));
}

/** `outline_coverage`: the outline answer has no `outline-format`, `outline-coverage` or `outline-sources` Error. Score 1 for pass, 0 for fail; the Error count is in the reason. */
export function gradeOutline(output: string, vars: DraftingCaseVars): GradingResult {
	const errors = outlineGateErrors(extractFileContent(readAnswer(output).finalText), matterOf(vars));
	return { pass: errors.length === 0, score: errors.length ? 0 : 1, reason: errors.length ? `${errors.length} outline Error(s): ${describeFindings(errors)}` : 'No outline-format, outline-coverage or outline-sources Error' };
}

/** The claim term of a `literal-basis` Error message. */
const literalBasisPattern = /^The claim term "(?<phrase>[^"]+)"/;

/**
 * The Errors of the draft that gate the draft case: the D1 validators and, when the run planned
 * with an outline, the outline rules (`validateDraft` with the fixed outline). Two Errors are the
 * expected result of the deliberate gap and do not count: the open Inventor Questions, and the
 * `literal-basis` Error of the gap term (the description has no text for it, by design).
 */
export function draftGateErrors(draft: string, matter: DraftingMatter, withOutline: boolean, gapTerm: string): DraftFinding[] {
	const gapKey = claimTermKey(gapTerm);
	const findings = validateDraft({
		office: matter.office,
		draft,
		claims: matter.claims,
		figures: matter.figures,
		...(withOutline ? { outline: { text: matter.outline, approvedClaimsHash: matter.claimsHash, featureList: matter.featureList } } : {}),
	});
	return findings.filter(finding => finding.severity === 'Error'
		&& !isInventorQuestion(finding)
		&& !(finding.rule === 'literal-basis' && claimTermKey(literalBasisPattern.exec(finding.message)?.groups?.phrase ?? '') === gapKey));
}

/** `draft_validators`: no Error of the D1 validators (and of the outline rules, for the outline skill). Notes are allowed. */
export function gradeDraftValidators(output: string, vars: DraftingCaseVars): GradingResult {
	const answer = readAnswer(output);
	const withOutline = answer.loadedFiles.includes(OUTLINE_REFERENCE);
	const errors = draftGateErrors(extractFileContent(answer.finalText), matterOf(vars), withOutline, vars.gapTerm);
	const rules = withOutline ? 'D1 and outline validators' : 'D1 validators (pre-outline skill: no outline rules)';
	return { pass: errors.length === 0, score: errors.length ? 0 : 1, reason: errors.length ? `${errors.length} Error(s) of the ${rules}: ${describeFindings(errors)}` : `No Error of the ${rules}` };
}

/** A pattern for a claim term in prose: its words in order, any case, hyphen or space between, an optional plural `s`. */
function termPattern(term: string): RegExp {
	const words = claimTermKey(term).split(' ').map(word => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
	return new RegExp(`(?<![\\w-])${words.join('[\\s-]+')}(?:e?s)?(?![\\w-])`, 'i');
}

/** Source kinds that state a fact: a paragraph with one of them presents its text as taken from the matter. */
const FACT_SOURCES: ReadonlySet<string> = new Set(['feature', 'disclosure', 'inventor', 'instruction']);

/** The text paragraphs of the description (not the claims), with their sources. */
function descriptionParagraphs(draft: string): DraftParagraph[] {
	return parseDraftParagraphs(draft).filter(paragraph => paragraph.kind === 'text' && !isClaimsParagraph(paragraph));
}

/** What the missing-support check found. */
export interface MissingSupport {
	/** True when an Inventor Question names the gap term. */
	readonly asked: boolean;
	/** The lines of description paragraphs that name the gap term under a source that states a fact. */
	readonly attributedLines: readonly number[];
}

/**
 * The missing-support regression: the claim term with no Feature List row must be asked as an
 * Inventor Question (`parseInventorQuestions`) and must not appear in a description paragraph whose
 * marker names a source that states a fact (`feature`, `disclosure`, `inventor`, `instruction`).
 * A Model-Proposed or Template paragraph may name it (a transition, a restated claim); whether such
 * text adds a fact is the judge's question.
 */
export function checkMissingSupport(draft: string, gapTerm: string): MissingSupport {
	const pattern = termPattern(gapTerm);
	return {
		asked: parseInventorQuestions(draft).some(question => pattern.test(question.text)),
		attributedLines: descriptionParagraphs(draft)
			.filter(paragraph => paragraph.sources?.some(source => FACT_SOURCES.has(source.kind)) && pattern.test(paragraph.text))
			.map(paragraph => paragraph.line),
	};
}

/** `draft_missing_support`: the gap term is an Inventor Question and no sourced paragraph states it. */
export function gradeMissingSupport(output: string, vars: DraftingCaseVars): GradingResult {
	const { asked, attributedLines } = checkMissingSupport(extractFileContent(readAnswer(output).finalText), vars.gapTerm);
	const problems = [
		...(asked ? [] : [`no Inventor Question names "${vars.gapTerm}"`]),
		...(attributedLines.length ? [`"${vars.gapTerm}" is stated in sourced paragraph(s) at line(s) ${attributedLines.join(', ')}`] : []),
	];
	return { pass: problems.length === 0, score: problems.length ? 0 : 1, reason: problems.length ? problems.join('; ') : `"${vars.gapTerm}" is an Inventor Question and no sourced paragraph states it` };
}

/**
 * A past-tense statement of a result: `was measured`, `were observed`, `showed`, `stayed`, ...
 *
 * Limits, by design of a small regex: it knows only the verbs listed, so a result in another past
 * tense verb passes; it does not see negation or quotation, so "it was not measured" fails; and a
 * listed verb used for a non-result ("the lid remained open during assembly") fails too.
 */
const pastTenseResultPattern = /\b(?:was|were)\s+(?:measured|observed|found|obtained|recorded|achieved|shown|confirmed|tested|determined|reduced|extended|improved)\b|\b(?:showed|exhibited|demonstrated|resulted|yielded|achieved|remained|stayed|withstood|fogged|fell|dropped)\b/gi;

/** The past-tense result phrases of a text. */
export function findPastTenseResults(text: string): string[] {
	return [...text.matchAll(pastTenseResultPattern)].map(match => match[0]);
}

function readSourceList(list: string): Set<string> {
	return new Set(list.split(',').map(entry => entry.replace(/\s+/g, '')).filter(Boolean));
}

function sourceKey(kind: string, ref?: string): string {
	return `${kind}${ref ? `:${ref.replace(/\s+/g, '')}` : ''}`;
}

/** What the prophetic-example check found. */
export interface PropheticCheck {
	/** The lines of the paragraphs that cite the prophetic example and not the working one. */
	readonly lines: readonly number[];
	/** The past-tense result phrases found in them, with their paragraph line. */
	readonly pastTense: readonly { readonly line: number; readonly phrase: string }[];
}

/**
 * The hallucinated-result regression: the description paragraphs whose marker cites the
 * prophetic example (and not the working example: a paragraph that cites both is left out, so its
 * working results in past tense are not counted) must state no result in past tense.
 */
export function checkProphetic(draft: string, propheticSources: string, workingSources: string): PropheticCheck {
	const prophetic = readSourceList(propheticSources);
	const working = readSourceList(workingSources);
	const selected = descriptionParagraphs(draft).filter(paragraph => {
		const keys = (paragraph.sources ?? []).map(source => sourceKey(source.kind, source.ref));
		return keys.some(key => prophetic.has(key)) && !keys.some(key => working.has(key));
	});
	return {
		lines: selected.map(paragraph => paragraph.line),
		pastTense: selected.flatMap(paragraph => findPastTenseResults(paragraph.text).map(phrase => ({ line: paragraph.line, phrase }))),
	};
}

/** `draft_prophetic`: the prophetic example is in the draft, and none of its paragraphs states a result in past tense. */
export function gradeProphetic(output: string, vars: DraftingCaseVars): GradingResult {
	const { lines, pastTense } = checkProphetic(extractFileContent(readAnswer(output).finalText), vars.propheticSources, vars.workingSources);
	if (!lines.length) {
		return { pass: false, score: 0, reason: `No description paragraph cites the prophetic example alone (${vars.propheticSources})` };
	}
	return pastTense.length
		? { pass: false, score: 0, reason: `Past-tense result in the prophetic example: ${pastTense.map(found => `line ${found.line} "${found.phrase}"`).join(', ')}` }
		: { pass: true, score: 1, reason: `Prophetic example at line(s) ${lines.join(', ')} states no result in past tense` };
}

/** `draft_sections`: every required section of the office order is present (`missingParts`, the check of the export). */
export function gradeSections(output: string, vars: DraftingCaseVars): GradingResult {
	const matter = matterOf(vars);
	const missing = missingParts(extractFileContent(readAnswer(output).finalText), matter.office, hasFigures(matter.figures));
	return { pass: missing.length === 0, score: missing.length ? 0 : 1, reason: missing.length ? `Missing ${matter.office} part(s): ${missing.join(', ')}` : `Every required ${matter.office} part is present` };
}
