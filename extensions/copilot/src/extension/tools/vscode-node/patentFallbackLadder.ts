/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { RECORDED_TOOLS, type PatentEvidenceSource, type PatentExecution, type PatentExecutionSnapshot } from '../../patentai/vscode-node/patentExecutionLedger';
import type { ReceiptOpenPoint } from '../node/priorArtReportCompletion';
import type { PatentCandidateReview } from './patentCandidateReview';
import { queryKey } from './patentFindBetter';

/**
 * The Fallback Ladder of an invalidity chart (ADR 0016, PRD 0024 C1): per independent claim of the
 * challenged patent, every dependent claim that falls back from it, computed in code from the claims
 * `get_patent_details` recorded in the execution ledger. This module derives the ladder, checks the
 * chart's fallback rows and Search Rounds against it, and counts Fallback Coverage. It never calls a
 * model.
 */

type PatentCoverageRow = NonNullable<PatentCandidateReview['coverage']>[number];

/** The report wording when the challenged patent's claims were recorded without claim numbers. */
export const LADDER_UNAVAILABLE = 'claim numbers could not be established; no Fallback Ladder';

/** One rung of a ladder: a dependent claim and the path that leads to it from the independent claim. */
export interface FallbackRung {
	readonly claimNumber: string;
	/** The claims this claim refers to directly, in ascending order. */
	readonly dependsOn: readonly string[];
	/** The independent claim first, then each claim down to this one, e.g. `['1', '2', '3']`. */
	readonly chain: readonly string[];
	/** The claim text exactly as the ledger recorded it. */
	readonly text: string;
}

/** The Fallback Ladder of one independent claim: its rungs in claim order. */
export interface FallbackLadder {
	readonly claimNumber: string;
	readonly text: string;
	readonly rungs: readonly FallbackRung[];
}

/**
 * The outcome of deriving the ladders: the ladders of every independent claim, a reason why there is
 * none (claims recorded unsegmented), or nothing recorded at all for the challenged publication.
 */
export type FallbackLadderDerivation =
	| { readonly kind: 'ladder'; readonly publication: string; readonly ladders: readonly FallbackLadder[] }
	| { readonly kind: 'unavailable'; readonly publication: string; readonly ladderUnavailable: string }
	| { readonly kind: 'missing' };

/** Fallback Coverage of one independent claim, read off the validated fallback rows. */
export interface FallbackCoverage {
	/** The independent claim. */
	readonly claimNumber: string;
	/** The rungs of its ladder; empty when no ladder could be derived. */
	readonly rungs: readonly string[];
	/** Fallbacks the cited art discloses (status supported): a claim number, or a description fallback's feature. */
	readonly covered: readonly string[];
	/** Fallbacks the cited art partly discloses (status partial). */
	readonly partly: readonly string[];
	/** Fallbacks not found in the cited art (status unresolved). */
	readonly notCovered: readonly string[];
	/** Rungs the chart names in `fallbacksNotCharted` instead of charting them. */
	readonly notCharted: readonly string[];
}

/** Claim-word stems in English, German and French; `Patentanspruch`, `Ansprüchen` and `revendications` included. */
const CLAIM_WORD = String.raw`(?:claims?|(?:patent)?anspr(?:ü|ue|u)ch(?:e|en|es|s)?|revendications?)`;

/** Words that join the numbers of one reference: lists and ranges in the three languages. */
const JOINER = String.raw`(?:,|;|to|through|-|–|bis|à|a|or|and|oder|und|ou|et)`;

/** A claim word followed by a number list, e.g. `claims 1 to 3 or 5`, `Ansprüche 1 bis 3`, `revendications 1 à 3`. */
const NUMBERED_REFERENCE = new RegExp(String.raw`\b${CLAIM_WORD}\s+(?<numbers>\d+(?:\s*${JOINER}\s*(?:${CLAIM_WORD}\s+)?\d+)*)`, 'giu');

/** Joiners that open a range rather than continue a list. */
const RANGE_JOINER = /^(?:to|through|-|–|bis|à|a)$/i;

/** A reference to every earlier claim: "any one of the preceding claims", "einem der vorhergehenden Ansprüche", "revendications précédentes". */
const PRECEDING_REFERENCE = new RegExp(String.raw`\b(?:preceding|previous|foregoing|above)\s+claims?\b|\b(?:vorhergehenden|vorangehenden|vorstehenden|vorherigen)\s+${CLAIM_WORD}|\brevendications?\s+(?:précédentes?|precedentes?|antérieures?)`, 'iu');

/** Upper bound on one range, so a mis-parsed number never expands into thousands of parents. */
const RANGE_CAP = 500;

/**
 * The claims a claim refers to, read from its own text in English, German or French: "according to
 * claim 1", "as claimed in any one of claims 1 to 3", "of claim 2", "nach Anspruch 1", "nach einem der
 * Ansprüche 1 bis 3", "selon la revendication 1", "selon l'une des revendications 1 à 3". A reference
 * to the preceding claims names every claim before this one. An empty result is an independent claim.
 * The claim's own number, written at the start of its text or anywhere else, is never a parent.
 */
export function parseClaimDependency(text: string, claimNumber: number): readonly number[] {
	const parents = new Set<number>();
	if (PRECEDING_REFERENCE.test(text)) {
		for (let claim = 1; claim < claimNumber; claim++) { parents.add(claim); }
	}
	for (const match of text.matchAll(NUMBERED_REFERENCE)) {
		const tokens = (match.groups?.numbers ?? '').split(/(\d+)/).map(token => token.trim()).filter(Boolean);
		let previous: number | undefined;
		let range = false;
		for (const token of tokens) {
			if (!/^\d+$/.test(token)) {
				const joiner = token.replace(new RegExp(CLAIM_WORD, 'giu'), '').trim();
				range = RANGE_JOINER.test(joiner);
				continue;
			}
			const value = Number(token);
			if (range && previous !== undefined && value > previous && value - previous <= RANGE_CAP) {
				for (let claim = previous + 1; claim <= value; claim++) { parents.add(claim); }
			} else {
				parents.add(value);
			}
			previous = value;
			range = false;
		}
	}
	parents.delete(claimNumber);
	return [...parents].filter(parent => parent > 0).sort((first, second) => first - second);
}

/** Country and number without separators or kind code, so `EP2110298B1` and `EP 2110298` meet. */
export function documentKey(publication: string): string {
	return publication.replace(/[-.\s/]/g, '').toUpperCase().replace(/^([A-Z]{2}\d+)[A-Z]\d?$/, '$1');
}

/** Separators removed, kind code kept. */
function publicationKey(publication: string): string {
	return publication.replace(/[-.\s/]/g, '').toUpperCase();
}

/**
 * The ledger publication the chart's `challengedPublication` names: the exact publication when it
 * was recorded, else the most recently recorded publication of the same document whatever its kind.
 */
function recordedPublication(snapshot: PatentExecutionSnapshot, challenged: string): string | undefined {
	const recorded = snapshot.executions.flatMap(execution => (execution.sources ?? []).filter(source => source.reference.section === 'claims').map(source => source.reference.publicationNumber));
	const exact = recorded.find(publication => publicationKey(publication) === publicationKey(challenged));
	if (exact) { return exact; }
	const sameDocument = recorded.filter(publication => documentKey(publication) === documentKey(challenged));
	return sameDocument[sameDocument.length - 1];
}

/**
 * Derive the Fallback Ladder of every independent claim of the challenged publication from the per-claim
 * sources `get_patent_details` recorded (`reference.section === 'claims'` with a `claimNumber`). A claim
 * that refers to several parents is a rung under each independent claim it reaches. Claims recorded
 * only as unsegmented text give no ladder and a `ladderUnavailable` reason; no recorded claims at all
 * give `missing`.
 */
export function deriveFallbackLadder(snapshot: PatentExecutionSnapshot, challengedPublication: string | undefined): FallbackLadderDerivation {
	const publication = challengedPublication?.trim() ? recordedPublication(snapshot, challengedPublication.trim()) : undefined;
	if (!publication) { return { kind: 'missing' }; }
	const claims = new Map<number, string>();
	for (const execution of snapshot.executions) {
		for (const source of execution.sources ?? []) {
			const { reference } = source;
			if (reference.section !== 'claims' || publicationKey(reference.publicationNumber) !== publicationKey(publication) || !reference.claimNumber || source.text === undefined) { continue; }
			claims.set(Number(reference.claimNumber), source.text);
		}
	}
	if (!claims.size) { return { kind: 'unavailable', publication, ladderUnavailable: LADDER_UNAVAILABLE }; }
	const numbers = [...claims.keys()].sort((first, second) => first - second);
	const parents = new Map(numbers.map(claim => [claim, parseClaimDependency(claims.get(claim) ?? '', claim).filter(parent => claims.has(parent))]));
	// The first path from a claim up to each independent claim it reaches, lowest-numbered parent first.
	const chains = new Map<number, Map<number, readonly number[]>>();
	const chainsOf = (claim: number, visiting: ReadonlySet<number>): Map<number, readonly number[]> => {
		const known = chains.get(claim);
		if (known) { return known; }
		const result = new Map<number, readonly number[]>();
		const direct = parents.get(claim) ?? [];
		if (!direct.length) {
			result.set(claim, [claim]);
		} else {
			for (const parent of direct) {
				if (visiting.has(parent)) { continue; }
				for (const [root, chain] of chainsOf(parent, new Set([...visiting, parent]))) {
					if (!result.has(root)) { result.set(root, [...chain, claim]); }
				}
			}
		}
		chains.set(claim, result);
		return result;
	};
	const ladders = numbers.filter(claim => !(parents.get(claim) ?? []).length).map(root => ({
		claimNumber: String(root),
		text: claims.get(root) ?? '',
		rungs: numbers.flatMap(claim => {
			const chain = claim === root ? undefined : chainsOf(claim, new Set([claim])).get(root);
			return chain ? [{ claimNumber: String(claim), dependsOn: (parents.get(claim) ?? []).map(String), chain: chain.map(String), text: claims.get(claim) ?? '' }] : [];
		}),
	}));
	return { kind: 'ladder', publication, ladders };
}

/** The ladder of one independent claim, when the derivation produced one. */
export function ladderOf(derivation: FallbackLadderDerivation, claimNumber: string): FallbackLadder | undefined {
	return derivation.kind === 'ladder' ? derivation.ladders.find(ladder => ladder.claimNumber === claimNumber.trim()) : undefined;
}

/** The independent claims the chart charts: the claim numbers of its `feature` rows. */
function chartedClaims(review: PatentCandidateReview): Set<string> {
	return new Set((review.coverage ?? []).flatMap(row => row.kind === 'feature' && row.claimNumber?.trim() ? [row.claimNumber.trim()] : []));
}

/** Collapse whitespace so a line-wrapped passage still contains its quotation. */
function normalizeText(value: string): string {
	return value.replace(/\s+/g, ' ').trim();
}

/**
 * The tool identities a recorded execution answers to. A search record carries no tool name of its
 * own; a save record is the writer's own mark, not a query a round can cite.
 */
function executionTools(execution: PatentExecution): readonly string[] {
	return execution.kind === 'save' ? [] : execution.kind === 'search' ? ['search_patents', 'search_register'] : execution.tool ? [execution.tool] : [];
}

/** The query texts a recorded execution ran, whitespace-normalised. */
function executionQueries(execution: PatentExecution): readonly string[] {
	return [execution.query, execution.effectiveQuery, execution.request].flatMap(value => value?.trim() ? [queryKey(value)] : []);
}

/** The search tools the ledger records under `kind: 'search'`, which carries no tool name of its own. */
const SEARCH_TOOLS: readonly string[] = ['search_patents', 'search_register'];

/** Every tool name whose executions the ledger records; a round query through any other tool cannot be confirmed. */
const LEDGER_TOOLS: ReadonlySet<string> = new Set<string>([...SEARCH_TOOLS, ...RECORDED_TOOLS]);

/** How the ledger stands to one Search Round query: confirmed by a recorded execution, or run through a tool the ledger does not record. */
export type RoundQueryLedgerStatus = 'matched' | 'unrecorded';

/** The `tool + query` key of every recorded execution, each with the `recordedAt` of its latest run. */
function executedKeys(snapshot: PatentExecutionSnapshot): ReadonlyMap<string, string> {
	const latest = new Map<string, string>();
	for (const execution of snapshot.executions) {
		for (const tool of executionTools(execution)) {
			for (const query of executionQueries(execution)) {
				const key = `${tool}\u0000${query}`;
				const known = latest.get(key);
				if (known === undefined || execution.recordedAt.localeCompare(known) > 0) { latest.set(key, execution.recordedAt); }
			}
		}
	}
	return latest;
}

/** One round query's tool, lower-cased and trimmed. */
function roundTool(entry: { readonly tool?: string } | undefined): string {
	return entry?.tool?.trim().toLowerCase() ?? '';
}

/** The `tool + query` key of one round query, as {@link executedKeys} keys an execution. */
function roundKey(entry: { readonly tool?: string; readonly query?: string } | undefined): string {
	return `${roundTool(entry)}\u0000${queryKey(entry?.query ?? '')}`;
}

/**
 * Per Search Round, in the order of `rounds[].queries`, whether each query matches a recorded
 * execution (`matched`) or the ledger cannot confirm it (`unrecorded`): a query through a tool the
 * ledger never records (search_npl, search_academic, a web search). Call it on a review that passed
 * {@link fallbackLadderErrors}, where a recorded tool's query always matches.
 */
export function roundLedgerStatus(review: PatentCandidateReview, snapshot: PatentExecutionSnapshot): readonly { readonly round: number; readonly queries: readonly RoundQueryLedgerStatus[] }[] {
	const executed = executedKeys(snapshot);
	return (review.rounds ?? []).map(round => ({
		round: round.round,
		queries: (round.queries ?? []).map(entry => executed.has(roundKey(entry)) ? 'matched' : 'unrecorded'),
	}));
}

/** The latest recorded save of the chart at `reportPath`, or nothing when this is its first save. */
function previousSave(snapshot: PatentExecutionSnapshot, reportPath: string): PatentExecution | undefined {
	return snapshot.executions
		.filter(execution => execution.kind === 'save' && execution.status === 'succeeded' && execution.request === reportPath)
		.reduce<PatentExecution | undefined>((latest, execution) => !latest || execution.recordedAt.localeCompare(latest.recordedAt) > 0 ? execution : latest, undefined);
}

/**
 * A Search Round is a new search after the receipt (ADR 0016 decision 5), so a round that first
 * appears in a re-save of `reportPath` must hold at least one query whose execution the ledger
 * recorded after that chart's previous save. The first save of a path has no previous save and no
 * order check: running the round before saving is honest. Rounds the previous save already recorded
 * (index below its round count) are not re-checked. A round with no confirmed query at all is left
 * to {@link fallbackLadderErrors}, which refuses it on its own ground.
 */
export function roundOrderErrors(review: PatentCandidateReview, snapshot: PatentExecutionSnapshot, reportPath: string): string[] {
	const previous = previousSave(snapshot, reportPath);
	if (!previous) { return []; }
	const executed = executedKeys(snapshot);
	const errors: string[] = [];
	(review.rounds ?? []).forEach((round, index) => {
		if (index < (previous.rounds ?? 0)) { return; }
		const ranAt = (round?.queries ?? []).flatMap(entry => { const at = executed.get(roundKey(entry)); return at === undefined ? [] : [at]; });
		if (ranAt.length && !ranAt.some(at => at.localeCompare(previous.recordedAt) > 0)) {
			errors.push(`Round ${round.round} lists only queries that ran before the previous save of this chart (${previous.recordedAt}); a Search Round is a new search after the receipt. Run at least one new query aimed at the not-covered limitations and record it in the round, or save without the round.`);
		}
	});
	return errors;
}

/**
 * A Search Round runs on the expert's answer to a Round Report (ADR 0016 amendment, PRD 0024 C4), so
 * a round that first appears in a re-save of `reportPath` must name in `answers` at least one open
 * point of the receipt the previous save printed; the save record keeps those ids. A first save, a
 * previous save from before open points were recorded, and a previous receipt with no open points
 * are not checked. Rounds the previous save already recorded are not re-checked.
 */
export function roundAnswerErrors(review: PatentCandidateReview, snapshot: PatentExecutionSnapshot, reportPath: string): string[] {
	const previous = previousSave(snapshot, reportPath);
	const open = previous?.openPoints;
	if (!previous || !open?.length) { return []; }
	const known = new Set(open.map(id => id.trim().toLowerCase()));
	const errors: string[] = [];
	(review.rounds ?? []).forEach((round, index) => {
		if (index < (previous.rounds ?? 0)) { return; }
		const answers = (round?.answers ?? []).map(id => id.trim()).filter(Boolean);
		if (!answers.some(id => known.has(id.toLowerCase()))) {
			errors.push(`Round ${round.round} answers no open point of the previous receipt${answers.length ? ` (it names ${answers.join(', ')})` : ''}. A Search Round runs only on the expert's answer to the Round Report. In answers, give the ids of the open points the expert chose (the previous receipt listed ${open.join(', ')}). If the expert has not answered yet, save without the new round, write the Round Report and wait.`);
		}
	});
	return errors;
}

/**
 * A round query through a tool the ledger records must match one of its executions (same tool, same
 * query text); a query through any other tool is accepted as unrecorded. Every round needs at least
 * one query the ledger confirms.
 */
function roundErrors(review: PatentCandidateReview, snapshot: PatentExecutionSnapshot): string[] {
	const errors: string[] = [];
	const executed = executedKeys(snapshot);
	for (const round of review.rounds ?? []) {
		let matched = 0;
		for (const entry of round?.queries ?? []) {
			const tool = roundTool(entry);
			const query = entry?.query?.trim() ?? '';
			if (!tool || !query) { errors.push(`Search Round ${round.round} lists a query without its tool or its text. Name the tool and copy the query exactly as it ran.`); continue; }
			if (executed.has(`${tool}\u0000${queryKey(query)}`)) { matched++; continue; }
			if (LEDGER_TOOLS.has(tool)) { errors.push(`Search Round ${round.round} lists ${entry.tool.trim()} query "${query}", which matches no tool execution recorded this session. Run the query, or copy it exactly as it ran (same tool, same text), or remove it from the round.`); }
		}
		if (!matched) { errors.push(`Round ${round.round} has no query the ledger can confirm; include at least one search_patents, search_register, patent_api_request or fetch_webpage query exactly as run.`); }
	}
	return errors;
}

/** A description fallback's basis: a verbatim quote of the challenged patent's description at a recorded anchor. */
function basisErrors(row: PatentCoverageRow, sources: Map<string, PatentEvidenceSource>, publication: string | undefined): string[] {
	const anchor = row.basis?.anchor?.trim();
	const quote = row.basis?.quote?.trim();
	if (!anchor || !quote) { return [`Description fallback "${row.feature}" needs basis.anchor (a description anchor of the challenged patent) and basis.quote (the verbatim passage that supports the fallback), or a claimNumber naming a dependent claim.`]; }
	const source = sources.get(anchor);
	if (!source) { return [`Description fallback "${row.feature}" cites basis.anchor ${anchor}, which is not a recorded source. Copy the anchor that get_patent_details printed for the challenged patent's description.`]; }
	if (!publication || documentKey(source.reference.publicationNumber) !== documentKey(publication) || source.reference.section !== 'description') { return [`Description fallback "${row.feature}" cites basis.anchor ${anchor}, which is not a description passage of the challenged patent${publication ? ` ${publication}` : ''}. A fallback rests on the challenged patent's own description.`]; }
	if (!source.text) { return [`No recorded text for ${anchor} (older record): retrieve it once with get_patent_details so the basis quote of "${row.feature}" can be checked.`]; }
	if (!normalizeText(source.text).includes(normalizeText(quote))) { return [`basis.quote of description fallback "${row.feature}" is not found in the recorded text of ${anchor}. Copy the passage verbatim; do not paraphrase or merge lines.`]; }
	return [];
}

/**
 * The invalidity checks of the Fallback Ladder, on top of the ordinary row checks: the challenged
 * patent's claims are recorded; every rung under a charted independent claim is charted exactly once
 * or named in `fallbacksNotCharted`; a fallback row's claim is a rung of its `fallbackOf`; a
 * description fallback quotes the challenged patent's description verbatim; `fallbackOf` names a
 * charted claim; and every Search Round query matches a recorded tool execution. Unsegmented claims
 * give no ladder and no refusal.
 */
export function fallbackLadderErrors(review: PatentCandidateReview, snapshot: PatentExecutionSnapshot, sources: Map<string, PatentEvidenceSource>): string[] {
	const derivation = deriveFallbackLadder(snapshot, review.challengedPublication);
	if (derivation.kind === 'missing') {
		return [`No claims of the challenged patent${review.challengedPublication?.trim() ? ` ${review.challengedPublication.trim()}` : ''} are recorded this session: fetch the challenged patent's claims with get_patent_details first, and name it in challengedPublication. The writer builds the Fallback Ladder from that call.`];
	}
	const errors: string[] = [];
	const charted = chartedClaims(review);
	const fallbackRows = (review.coverage ?? []).filter(row => row.kind === 'fallback');
	for (const row of fallbackRows) {
		const parent = row.fallbackOf?.trim();
		const claim = row.claimNumber?.trim();
		if (!parent) { errors.push(`Fallback row "${row.feature}" names no fallbackOf. Give the independent claim it falls back from.`); continue; }
		if (!charted.has(parent)) { errors.push(`Fallback row "${row.feature}" falls back from claim ${parent}, which has no feature rows. Chart the elements of claim ${parent} first, or name the charted independent claim in fallbackOf.`); }
		if (!claim) { errors.push(...basisErrors(row, sources, derivation.publication)); continue; }
		const ladder = ladderOf(derivation, parent);
		if (derivation.kind === 'ladder' && !ladder?.rungs.some(rung => rung.claimNumber === claim)) {
			const rungs = ladder?.rungs.map(rung => rung.claimNumber) ?? [];
			errors.push(`Fallback row "${row.feature}" charts claim ${claim}, which is not a rung of claim ${parent}'s Fallback Ladder${rungs.length ? ` (rungs: claims ${rungs.join(', ')})` : ' (claim ' + parent + ' has no dependent claims)'}. Name the independent claim claim ${claim} depends on in fallbackOf, or chart a rung of claim ${parent}.`);
		}
	}
	const notCharted = new Map<string, number>();
	for (const entry of review.fallbacksNotCharted ?? []) {
		const claim = entry?.claimNumber?.trim();
		if (!claim || !entry.reason?.trim()) { errors.push('Every fallbacksNotCharted entry needs the claimNumber of the rung and the reason it is not charted.'); continue; }
		notCharted.set(claim, (notCharted.get(claim) ?? 0) + 1);
	}
	if (derivation.kind === 'ladder') {
		const rungsOfCharted = new Set<string>();
		for (const independent of [...charted].sort((first, second) => Number(first) - Number(second))) {
			for (const rung of ladderOf(derivation, independent)?.rungs ?? []) {
				rungsOfCharted.add(rung.claimNumber);
				const rows = fallbackRows.filter(row => row.claimNumber?.trim() === rung.claimNumber && row.fallbackOf?.trim() === independent).length;
				const count = rows + (notCharted.get(rung.claimNumber) ?? 0);
				if (count === 0) { errors.push(`Claim ${rung.claimNumber} (chain ${rung.chain.join(' → ')}) is a rung of claim ${independent}'s Fallback Ladder but has no fallback row and no fallbacksNotCharted entry. Chart the limitation it adds in one row (kind fallback, claimNumber ${rung.claimNumber}, fallbackOf ${independent}), or name it in fallbacksNotCharted with the reason.`); }
				if (count > 1) { errors.push(`Claim ${rung.claimNumber} is charted ${rows} time(s) under claim ${independent} and named ${notCharted.get(rung.claimNumber) ?? 0} time(s) in fallbacksNotCharted. Give each rung exactly one fallback row or one fallbacksNotCharted entry.`); }
			}
		}
		for (const claim of notCharted.keys()) {
			if (!rungsOfCharted.has(claim)) { errors.push(`fallbacksNotCharted names claim ${claim}, which is not a rung of any charted independent claim. Remove the entry, or chart the independent claim it depends on.`); }
		}
	}
	errors.push(...roundErrors(review, snapshot));
	return errors;
}

/**
 * Fallback Coverage per independent claim: the rungs of its ladder, and its fallback rows sorted by
 * status (supported = covered, partial = partly covered, unresolved = not covered) beside the rungs the
 * chart names as not charted. Read off the rows exactly as the element count is; call it on a review
 * that passed {@link fallbackLadderErrors}.
 */
export function fallbackCoverage(review: PatentCandidateReview, derivation: FallbackLadderDerivation): readonly FallbackCoverage[] {
	const rows = (review.coverage ?? []).filter(row => row.kind === 'fallback' && row.fallbackOf?.trim());
	const claims = [...new Set([...chartedClaims(review), ...rows.map(row => row.fallbackOf!.trim())])].sort((first, second) => Number(first) - Number(second));
	const notCharted = new Set((review.fallbacksNotCharted ?? []).map(entry => entry.claimNumber.trim()));
	return claims.map(claimNumber => {
		const rungs = ladderOf(derivation, claimNumber)?.rungs.map(rung => rung.claimNumber) ?? [];
		const own = rows.filter(row => row.fallbackOf!.trim() === claimNumber);
		const label = (row: PatentCoverageRow) => row.claimNumber?.trim() || row.feature;
		return {
			claimNumber,
			rungs,
			covered: own.filter(row => row.status === 'supported').map(label),
			partly: own.filter(row => row.status === 'partial').map(label),
			notCovered: own.filter(row => row.status === 'unresolved').map(label),
			notCharted: rungs.filter(rung => notCharted.has(rung)),
		};
	});
}

/** The number of fallbacks not covered across every independent claim; the receipt's `fallbacksNotCovered`. */
export function fallbacksNotCovered(coverage: readonly FallbackCoverage[]): number {
	return coverage.reduce((total, claim) => total + claim.notCovered.length, 0);
}

/** A model-written phrase cut to one short line, so an open point stays one line in the receipt. */
export function shortPhrase(value: string, limit = 160): string {
	const line = value.replace(/\s+/g, ' ').trim();
	return line.length > limit ? `${line.slice(0, limit - 1).trimEnd()}…` : line;
}

/**
 * A short reference to each coverage row that stays the same across saves of one chart: a dependent
 * claim's rung is its claim number (`3`), a description fallback is `d1`, `d2` in row order, an
 * element row is its claim and its place among that claim's element rows (`1.2`), a combination row
 * is `1.whole`, and any other row is its place in the chart (`row4`).
 */
export function rowReferences(review: PatentCandidateReview): readonly string[] {
	const counts = new Map<string, number>();
	const next = (key: string) => { const value = (counts.get(key) ?? 0) + 1; counts.set(key, value); return value; };
	return (review.coverage ?? []).map((row, index) => {
		const claim = row.claimNumber?.trim();
		if (row.kind === 'fallback') { return claim || `d${next('description')}`; }
		if (row.kind === 'combination' && claim) { return `${claim}.whole`; }
		if (row.kind === 'feature' && claim) { return `${claim}.${next(`claim ${claim}`)}`; }
		return `row${index + 1}`;
	});
}

/** The chart wording of a status that leaves a point open. */
const OPEN_STATUS_TEXT = { partial: 'is partly disclosed in the cited art', unresolved: 'is not found in the cited art' } as const;

/**
 * The open points a chart's own rows give (PRD 0024 C4), in a stable order: rungs partly disclosed or
 * not found, per independent claim in claim order and description fallbacks after the dependent
 * claims; then independent-claim elements not found, in claim and row order. The writer adds the
 * open points that only the record gives (scope, date, drawing, failed search) after these.
 */
export function rowOpenPoints(review: PatentCandidateReview): readonly ReceiptOpenPoint[] {
	const rows = review.coverage ?? [];
	const references = rowReferences(review);
	const claimOrder = (value: string | undefined) => { const number = Number(value?.trim()); return value?.trim() && Number.isFinite(number) ? number : Number.MAX_SAFE_INTEGER; };
	const indexes = rows.map((_, index) => index);
	const rungs = indexes.filter(index => rows[index].kind === 'fallback' && rows[index].status !== 'supported')
		.sort((first, second) => claimOrder(rows[first].fallbackOf) - claimOrder(rows[second].fallbackOf) || claimOrder(rows[first].claimNumber) - claimOrder(rows[second].claimNumber) || first - second);
	const elements = indexes.filter(index => rows[index].kind === 'feature' && rows[index].status === 'unresolved')
		.sort((first, second) => claimOrder(rows[first].claimNumber) - claimOrder(rows[second].claimNumber) || first - second);
	return [
		...rungs.map(index => {
			const row = rows[index];
			const parent = row.fallbackOf?.trim() || '?';
			const subject = row.claimNumber?.trim() ? `Claim ${row.claimNumber.trim()} (fallback of claim ${parent})` : `Description fallback of claim ${parent}`;
			return { id: `rung-${references[index]}`, text: `${subject} ${row.status === 'partial' ? OPEN_STATUS_TEXT.partial : OPEN_STATUS_TEXT.unresolved}: ${shortPhrase(row.feature ?? '')}` };
		}),
		...elements.map(index => {
			const row = rows[index];
			return { id: `element-${references[index]}`, text: `${row.claimNumber?.trim() ? `Claim ${row.claimNumber.trim()} element` : 'Element'} ${OPEN_STATUS_TEXT.unresolved}: ${shortPhrase(row.feature ?? '')}` };
		}),
	];
}
