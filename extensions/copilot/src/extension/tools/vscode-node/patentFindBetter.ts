/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { PatentEvidenceSource, PatentExecutionSnapshot } from '../../patentai/vscode-node/patentExecutionLedger';
import type { FindBetterSide, PatentCandidateReview } from './patentCandidateReview';

/**
 * The `find-better-report` template (ADR 0010): per independent claim of a granted patent, the
 * examiner's best art beside the best art a Find Better run found, both scored on the same element
 * rows. Each coverage row carries two sides that are checked exactly like an invalidity chart's rows;
 * this module projects them onto ordinary coverage rows, so quote validation, the element map, the
 * second read, the evidence companion and the working record run unchanged.
 */

type PatentCoverageRow = NonNullable<PatentCandidateReview['coverage']>[number];

/** One citation behind a Baseline cell, verbatim from its source (`flowleap patent examiner-baseline --json`). */
interface ExaminerBaselineCitation {
	readonly source?: string;
	readonly citing?: string;
	readonly citedBy?: string;
	readonly category?: string;
	readonly relevantClaims?: string;
	/**
	 * The cited document's publication date, when a Baseline source carries one (neither the CLI nor
	 * the backend sends it today). Read only to flag examiner's art published after the critical date.
	 */
	readonly publicationDate?: string;
}

/** One office's cell of a Baseline row. */
interface ExaminerBaselineCell {
	readonly text?: string;
	readonly citations?: readonly ExaminerBaselineCitation[];
}

/** One Baseline row: a cited document, keyed by DOCDB number without kind. */
interface ExaminerBaselineDocument {
	readonly document: string;
	readonly kinds?: readonly string[];
	readonly npl?: string;
	/** NPL rows only: the cited paper's OpenAlex record (backend get_npl_work), or why there is none. */
	readonly nplWork?: { readonly status?: string; readonly work?: { readonly title?: string; readonly doi?: string | null } | null };
	readonly cells?: Readonly<Record<string, ExaminerBaselineCell>>;
}

/** How many NPL rows the backend looked up in OpenAlex, by outcome. */
interface ExaminerBaselineNplResolution {
	readonly references?: number;
	readonly matched?: number;
	readonly candidates?: number;
	readonly notFound?: number;
	readonly failed?: number;
	readonly skipped?: number;
}

/** A member or source with no citation record. A gap is not "nothing cited". */
interface ExaminerBaselineGap {
	readonly office?: string;
	readonly member?: string;
	readonly source?: string;
	readonly reason?: string;
	readonly message?: string;
}

/** What one publication's biblio read returned, as the CLI counted it. */
interface ExaminerBaselinePublicationRead {
	readonly publication?: string;
	readonly status?: string;
	readonly citedCount?: number;
	readonly examinerCount?: number;
	readonly applicantCount?: number;
}

interface ExaminerBaselineMember {
	readonly office?: string;
	readonly representativePublication?: string;
	readonly publications?: readonly ExaminerBaselinePublicationRead[];
	readonly usptoEnriched?: { readonly applicationNumber?: string | null; readonly status?: string; readonly rows?: number; readonly unidentifiedRows?: number };
}

/**
 * The Examiner Baseline: the `--json` output of `flowleap patent examiner-baseline`, or the
 * examiner_baseline backend tool's result. Field names are the CLI's contract.
 */
export interface ExaminerBaseline {
	readonly publication?: string;
	readonly offices?: readonly string[];
	readonly membersWalked?: readonly ExaminerBaselineMember[];
	readonly documents?: readonly ExaminerBaselineDocument[];
	readonly gaps?: readonly ExaminerBaselineGap[];
	readonly dedupe?: string;
	readonly nplResolution?: ExaminerBaselineNplResolution;
	/**
	 * Never in a Baseline the CLI or the backend computed: `patent_api_request` adds it when it cuts a
	 * result at its character budget. A Baseline that carries it is refused (#526).
	 */
	readonly _truncation?: { readonly omittedItems?: number; readonly retainedItems?: number };
}

/** The publication(s) the agent picked as the examiner's best art for one independent claim. */
interface ExaminerBestArt {
	readonly claimNumber: string;
	readonly publications: readonly string[];
}

/**
 * One expansion track of a Find Better run and every query it ran, empty ones included. A query of
 * the backward-citation track carries `hop` (1 or 2): the hop of the two-hop walk it belongs to.
 */
interface FindBetterTrack {
	readonly name: string;
	readonly queries?: readonly { readonly query: string; readonly tool?: string; readonly count?: number; readonly hop?: number }[];
}

/** The find-better-only inputs of the writer. */
export interface FindBetterFields {
	readonly baseline?: ExaminerBaseline;
	readonly examinerBestArt?: readonly ExaminerBestArt[];
	readonly tracks?: readonly FindBetterTrack[];
	/**
	 * Workspace-relative or absolute path to the `--json` output of `flowleap patent examiner-baseline`
	 * on disk; the alternative to an inline `baseline`. Exactly one of the two is given.
	 */
	readonly baselinePath?: string;
}

export type FindBetterSideName = 'examiner' | 'found';

/** How a side is named in a projected row's feature, an error message and the report. */
const SIDE_LABEL: Readonly<Record<FindBetterSideName, string>> = {
	examiner: 'examiner\'s best art',
	found: 'best art found',
};

/** How each status word reads in a Find Better report: a count of disclosure, never a legal ground. */
export const FIND_BETTER_STATUS: Readonly<Record<FindBetterSide['status'], string>> = {
	supported: 'disclosed',
	partial: 'partially disclosed',
	unresolved: 'not found',
};

/** The feature a projected row carries, so every check and every second-read verdict names its side. */
export function sideFeature(feature: string, side: FindBetterSideName): string {
	return `${feature} — ${SIDE_LABEL[side]}`;
}

/** One side of a row as an ordinary coverage row, carrying the parent's element identity. */
function sideRow(row: PatentCoverageRow, side: FindBetterSideName): PatentCoverageRow | undefined {
	const value = row[side];
	if (!value) { return undefined; }
	return {
		feature: sideFeature(row.feature, side),
		kind: row.kind,
		importance: row.importance,
		claimNumber: row.claimNumber,
		status: value.status,
		sourceAnchors: value.sourceAnchors ?? [],
		gap: value.gap ?? '',
		evidence: value.evidence,
		elements: value.elements,
	};
}

/** Whether the review is a two-sided find-better review rather than a one-sided chart. */
function hasSides(review: PatentCandidateReview): boolean {
	return (review.coverage ?? []).some(row => !!row.examiner || !!row.found);
}

/**
 * Project every two-sided row onto two ordinary rows, examiner side first. A one-sided review is
 * returned unchanged, so the prior-art and invalidity paths never see this projection.
 */
export function flattenSides<T extends PatentCandidateReview>(review: T): T {
	if (!hasSides(review)) { return review; }
	return { ...review, coverage: (review.coverage ?? []).flatMap(row => [sideRow(row, 'examiner'), sideRow(row, 'found')].filter((value): value is PatentCoverageRow => !!value)) };
}

/**
 * The inputs a find-better-report cannot be saved without, named so the model knows what to add.
 * Checked before any path is resolved or any file is touched, like a missing report body.
 */
export function findBetterMissingInputs(input: PatentCandidateReview): string | undefined {
	const missing = [
		...(!input.coverage?.length ? ['coverage (element rows, each with an examiner side and a found side)'] : []),
		...(input.baselinePath?.trim() ? [] : !input.baseline || typeof input.baseline !== 'object' ? ['baseline or baselinePath (the Examiner Baseline JSON inline, or the workspace path of the --json output of flowleap patent examiner-baseline)'] : []),
		...(!input.examinerBestArt?.length ? ['examinerBestArt (per independent claim, the X or Y citation of the Baseline picked as the examiner\'s best art)'] : []),
		...(!input.tracks?.length ? ['tracks (every expansion track with its queries and hit counts, empty ones included)'] : []),
	];
	if (missing.length) { return `find-better-report is a structured save and needs ${missing.join('; ')}. Leave content empty.`; }
	return input.baselinePath?.trim() && input.baseline ? 'find-better-report takes exactly one of baseline and baselinePath. Give the inline Baseline or the path to the CLI\'s --json output, not both.' : undefined;
}

/** Where the Baseline came from, as the tool result and the working record state it. */
export function baselineSource(review: FindBetterFields): string {
	return review.baselinePath?.trim() ? `file ${review.baselinePath.trim()}` : 'inline';
}

/**
 * The key a publication is matched on against the Baseline: country and number without separators
 * and without kind code, so `US4964287A`, `US 4964287 A` and `US4964287` name one row.
 */
function documentKey(publication: string): string {
	const compact = publication.replace(/[-.\s/]/g, '').toUpperCase();
	return /^NPL:/i.test(publication.trim()) ? publication.trim().toUpperCase() : compact.replace(/^([A-Z]{2}\d+)[A-Z]\d?$/, '$1');
}

/**
 * Publications with one entry per document: `EP1162102A2` and `EP1162102` are one document (#537),
 * matched as the Baseline matches them. The fullest spelling is kept, in first-seen order.
 */
export function distinctDocuments(publications: readonly string[]): string[] {
	const byDocument = new Map<string, string>();
	for (const publication of publications) {
		const key = documentKey(publication);
		const kept = byDocument.get(key);
		if (kept === undefined || publication.length > kept.length) { byDocument.set(key, publication); }
	}
	return [...byDocument.values()];
}

/** The Baseline row a publication names, if any. */
function baselineDocument(baseline: ExaminerBaseline, publication: string): ExaminerBaselineDocument | undefined {
	const key = documentKey(publication);
	return (baseline.documents ?? []).find(document => typeof document?.document === 'string' && documentKey(document.document) === key);
}

/** The relevance categories any office gave a Baseline row, read off its citations and cell text. */
function categories(document: ExaminerBaselineDocument): ReadonlySet<string> {
	const found = new Set<string>();
	for (const cell of Object.values(document.cells ?? {})) {
		for (const citation of cell?.citations ?? []) {
			for (const letter of (citation?.category ?? '').toUpperCase().split(/[^A-Z]+/)) { if (letter) { found.add(letter); } }
		}
		const leading = /^([A-Z](?:,[A-Z])*)(?:\s|$)/.exec(cell?.text ?? '');
		for (const letter of leading?.[1].split(',') ?? []) { found.add(letter); }
	}
	return found;
}

/** Why a Baseline document may be the examiner's best art, ranked: lower is stronger. */
interface ExaminerArtBasis {
	readonly rank: number;
	/** Shown beside the document in the per-claim header; empty for an X or Y citation. */
	readonly note: string;
}

/**
 * The basis on which a Baseline document is examiner's art (#531, amending ADR 0010 decision 3):
 * an X or Y category from any office; else any other category or an examiner citation (only an
 * examiner assigns a category, and a US grant's references-cited carries none unless an office
 * action exists); else a US office-action rejection (`uspto_enriched`). A document only the
 * applicant cited, with no category and no rejection, has no basis.
 */
function documentBasis(document: ExaminerBaselineDocument): ExaminerArtBasis | undefined {
	const found = categories(document);
	if (found.has('X')) { return { rank: 0, note: '' }; }
	if (found.has('Y')) { return { rank: 1, note: '' }; }
	const citations = Object.values(document.cells ?? {}).flatMap(cell => cell?.citations ?? []);
	if (found.size) { return { rank: 2, note: `category ${[...found].join(',')}` }; }
	if (citations.some(citation => citation?.citedBy === 'examiner')) { return { rank: 2, note: 'examiner-cited, no category' }; }
	if (citations.some(citation => citation?.source === 'uspto_enriched')) { return { rank: 3, note: 'US office-action rejection, no category' }; }
	return undefined;
}

/**
 * The examiner's best art of a claim as the per-claim header names it: strongest basis first (X,
 * then Y, then examiner-cited without category, then rejection only), each non-X/Y document with
 * its basis beside it, e.g. `US3980041 (examiner-cited, no category)`.
 */
export function examinerArtHeader(review: FindBetterFields, publications: readonly string[]): string[] {
	const based = publications.map(publication => {
		const document = baselineDocument(review.baseline ?? {}, publication);
		return { publication, basis: document ? documentBasis(document) : undefined };
	});
	return based.sort((a, b) => (a.basis?.rank ?? 9) - (b.basis?.rank ?? 9)).map(({ publication, basis }) => basis?.note ? `${publication} (${basis.note})` : publication);
}

/** The Baseline's shape: the fields this writer reads, each of the type the CLI prints. */
function baselineShapeErrors(baseline: ExaminerBaseline): string[] {
	const errors: string[] = [];
	if (!Array.isArray(baseline.offices) || !baseline.offices.every(office => typeof office === 'string')) { errors.push('baseline.offices must be the array of office codes the Baseline prints as matrix columns.'); }
	if (!Array.isArray(baseline.documents) || !baseline.documents.every(document => typeof document?.document === 'string')) { errors.push('baseline.documents must be the array of cited documents, each with its document key and per-office cells.'); }
	if (!Array.isArray(baseline.gaps)) { errors.push('baseline.gaps must be present: an empty array when every member returned a citation record, so a missing record is never read as "nothing cited".'); }
	return errors;
}

/** The instruction every Baseline integrity refusal ends with: get the whole Baseline again, by code. */
function rerunBaseline(baseline: ExaminerBaseline): string {
	const publication = baseline.publication?.trim() || '<publication>';
	return `Re-run the examiner_baseline tool (it writes the full JSON to references/${publication}.examiner-baseline.json), or the CLI (flowleap --json patent examiner-baseline ${publication} > references/${publication}.examiner-baseline.json), and pass that file unedited as baselinePath.`;
}

/**
 * Per citing publication, the number of citations `documents[]` holds from it, keyed by the
 * publication as `citing` names it (upper case, trimmed).
 */
function citationsByCiting(baseline: ExaminerBaseline): ReadonlyMap<string, number> {
	const counted = new Map<string, number>();
	for (const document of baseline.documents ?? []) {
		for (const cell of Object.values(document.cells ?? {})) {
			for (const citation of cell?.citations ?? []) {
				const citing = citation?.citing?.trim().toUpperCase();
				if (citing) { counted.set(citing, (counted.get(citing) ?? 0) + 1); }
			}
		}
	}
	return counted;
}

/** The publications `membersWalked` reports as read with an office count the matrix can be checked against. */
function countedReads(baseline: ExaminerBaseline): { readonly office: string; readonly publication: string; readonly citedCount: number }[] {
	return (baseline.membersWalked ?? []).flatMap(member => (member?.publications ?? []).flatMap(read =>
		read?.status === 'read' && typeof read.citedCount === 'number' && read.publication?.trim()
			? [{ office: member.office ?? '?', publication: read.publication.trim(), citedCount: read.citedCount }]
			: []));
}

/**
 * Whether the Baseline is the whole Baseline (#526). A Baseline that a tool cut at its character
 * budget carries `_truncation`, and is refused. One whose marker was stripped is caught by its own
 * counts: for every publication `membersWalked` reports as read, the office counted `citedCount`
 * entries in its references-cited block, and the CLI and the backend turn each entry into one
 * citation (whose `citing` is that publication) in `documents[].cells`. Two entries collapse into
 * one citation only when they are identical, so a publication whose citations in `documents[]`
 * number fewer than its `citedCount` lost rows. Citations are counted, not documents: one document
 * cited twice by the same block (two kinds, two phases) is one row but two citations.
 */
function baselineIntegrityErrors(baseline: ExaminerBaseline): string[] {
	if (baseline._truncation) {
		const omitted = baseline._truncation.omittedItems;
		return [`The Examiner Baseline carries _truncation: a tool cut it at its character budget${typeof omitted === 'number' ? ` and omitted ${omitted} item(s)` : ''}. A truncated Baseline is not the Baseline, and the report would state fewer cited documents than the offices cited. ${rerunBaseline(baseline)}`];
	}
	const counted = citationsByCiting(baseline);
	const short = countedReads(baseline).flatMap(read => {
		const held = counted.get(read.publication.toUpperCase()) ?? 0;
		return held < read.citedCount ? [`${read.publication} (${read.office}) cited ${read.citedCount}, documents[] holds ${held} citation(s) from it, ${read.citedCount - held} missing`] : [];
	});
	return short.length ? [`The Examiner Baseline is incomplete: membersWalked counts more citations than documents[] holds (${short.join('; ')}). A Baseline cut by a character budget or edited by hand loses rows this way. ${rerunBaseline(baseline)}`] : [];
}

/**
 * What the save result says when the completeness check had nothing to check: no publication in
 * `membersWalked` is read with a `citedCount`, so a missing row cannot be detected.
 */
export function baselineIntegrityNote(baseline: ExaminerBaseline | undefined): string | undefined {
	return baseline && countedReads(baseline).length === 0
		? 'Baseline completeness not checked: membersWalked reports no read publication with a citedCount, so the writer could not compare documents[] with the offices\' own counts.'
		: undefined;
}

/**
 * The find-better checks that sit on top of the ordinary row checks: the Baseline's shape, the
 * examiner's best art against the Baseline, both sides on every row, a claim on every row, and the
 * examiner side citing only the examiner's best art of its claim.
 */
export function findBetterErrors(review: PatentCandidateReview, sources: Map<string, PatentEvidenceSource>): string[] {
	const baseline = review.baseline ?? {};
	const errors = baseline._truncation ? [] : baselineShapeErrors(baseline);
	if (errors.length) { return errors; }
	errors.push(...baselineIntegrityErrors(baseline));
	if (errors.length) { return errors; }
	const bestArt = new Map<string, readonly string[]>();
	for (const entry of review.examinerBestArt ?? []) {
		const claim = entry?.claimNumber?.trim();
		if (!claim || !entry.publications?.length) { errors.push('Every examinerBestArt entry needs a claimNumber and at least one publication.'); continue; }
		bestArt.set(claim, entry.publications);
		for (const publication of entry.publications) {
			const document = baselineDocument(baseline, publication);
			if (!document) { errors.push(`examinerBestArt for claim ${claim} names ${publication}, which is not in baseline.documents[]. The examiner's best art must be a document the Baseline lists; pick one of its X or Y citations, or, where none exists, an examiner-cited document.`); continue; }
			if (!documentBasis(document)) { errors.push(`examinerBestArt for claim ${claim} names ${publication}, which only the applicant cited: the Baseline gives it no category, no examiner citation and no US office-action rejection. The examiner's best art must be an X or Y citation, or, where none exists, a document an examiner cited or a US office action rejected claims with.`); }
		}
	}
	const claims = new Set<string>();
	for (const row of review.coverage ?? []) {
		const claim = row.claimNumber?.trim();
		if (!claim) { errors.push(`Row "${row.feature}" names no claimNumber. Every find-better row is an element of one independent claim.`); continue; }
		claims.add(claim);
		if (!row.examiner || !row.found) { errors.push(`Row "${row.feature}" needs both sides: examiner (the examiner's best art on this element) and found (the best art found on this element). A side with nothing disclosed is status unresolved, not absent.`); }
		const allowed = bestArt.get(claim);
		if (!allowed) { continue; }
		const keys = new Set(allowed.map(documentKey));
		const anchors = [...(row.examiner?.sourceAnchors ?? []), ...(row.examiner?.evidence ?? []).map(item => item.anchor), ...(row.examiner?.elements ?? []).flatMap(element => element.anchor ? [element.anchor] : [])];
		for (const anchor of new Set(anchors)) {
			const publication = sources.get(anchor)?.reference.publicationNumber;
			if (publication && !keys.has(documentKey(publication))) { errors.push(`Row "${row.feature}" cites ${anchor} (${publication}) on the examiner side, but the examiner's best art for claim ${claim} is ${allowed.join(', ')}. Cite that art on the examiner side, or name ${publication} in examinerBestArt if the Baseline supports it.`); }
		}
	}
	for (const claim of claims) {
		if (!bestArt.has(claim)) { errors.push(`Claim ${claim} has rows but no examinerBestArt entry. Name the examiner's best art for every claim the report compares.`); }
		if (!(review.coverage ?? []).some(row => row.claimNumber?.trim() === claim && row.kind === 'feature')) { errors.push(`Claim ${claim} has no element rows (kind feature); the comparison counts disclosed elements, so list each element of the claim.`); }
	}
	for (const claim of bestArt.keys()) {
		if (!claims.has(claim)) { errors.push(`examinerBestArt names claim ${claim}, but no coverage row charts it. Chart its elements or remove the entry.`); }
	}
	for (const track of review.tracks ?? []) {
		if (!track?.name?.trim()) { errors.push('Every track needs a name.'); }
		for (const query of track?.queries ?? []) { if (!query?.query?.trim()) { errors.push(`Track "${track.name}" lists a query with no text.`); } }
	}
	return errors;
}

/**
 * Every number the model put in the input that a Find Better report has no field for. The comparison
 * is a count over validated rows, so a typed score is dropped and named, never rendered. The Baseline
 * is the CLI's output and a track query's count is a recorded hit count, so neither is scanned.
 */
export function ignoredNumericFields(input: object): string[] {
	const found: string[] = [];
	const walk = (value: unknown, path: string): void => {
		if (typeof value === 'number') { found.push(path); return; }
		if (Array.isArray(value)) { value.forEach((item, index) => walk(item, `${path}[${index}]`)); return; }
		if (!value || typeof value !== 'object') { return; }
		for (const [key, child] of Object.entries(value)) {
			if (!path && key === 'baseline') { continue; }
			if ((key === 'count' || key === 'hop') && /^tracks\[\d+\]\.queries\[\d+\]$/.test(path)) { continue; }
			walk(child, path ? `${path}.${key}` : key);
		}
	};
	walk(input, '');
	return found;
}

/** One claim's comparison, counted from validated rows. */
export interface ClaimComparison {
	readonly claim: string;
	readonly examinerArt: readonly string[];
	readonly elements: number;
	readonly examinerDisclosed: number;
	readonly foundDisclosed: number;
}

/**
 * Per claim, how many element rows each side discloses. Only element rows (kind feature) are counted;
 * a combination row reads the others and is not an element. Only `supported` counts as disclosed: a
 * partial element is shown in the table but is not a disclosed element.
 */
export function claimComparisons(review: PatentCandidateReview): readonly ClaimComparison[] {
	const claims = [...new Set((review.coverage ?? []).flatMap(row => row.claimNumber?.trim() ? [row.claimNumber.trim()] : []))];
	return claims.map(claim => {
		const rows = (review.coverage ?? []).filter(row => row.claimNumber?.trim() === claim && row.kind === 'feature');
		return {
			claim,
			examinerArt: review.examinerBestArt?.find(entry => entry.claimNumber.trim() === claim)?.publications ?? [],
			elements: rows.length,
			examinerDisclosed: rows.filter(row => row.examiner?.status === 'supported').length,
			foundDisclosed: rows.filter(row => row.found?.status === 'supported').length,
		};
	});
}

/** The count line under a claim's table; also the line the chat summary has to repeat. */
export function countLine(comparison: ClaimComparison): string {
	return `examiner's best art: disclosed ${comparison.examinerDisclosed} of ${comparison.elements} · best art found: disclosed ${comparison.foundDisclosed} of ${comparison.elements}`;
}

/**
 * The sentence that states the claim's result. "No better art found" is a complete result, not an
 * error, but only over a complete search: while `incomplete` names a skipped mandatory part, the
 * sentence says the search is incomplete instead (#529). `examinerArt` names only the examiner's
 * best art that an examiner-side row cites, each with its critical-date flag, because the count is
 * a property of those documents alone.
 */
export function claimResultSentence(comparison: ClaimComparison, foundArt: readonly string[], examinerArt: readonly string[], incomplete: readonly string[]): string {
	const examiner = examinerArt.join(', ');
	if (comparison.foundDisclosed > comparison.examinerDisclosed) {
		const examinerSide = examinerArt.length ? `the examiner's best art ${examiner} discloses ${comparison.examinerDisclosed} of ${comparison.elements}` : 'no examiner-side row cites the examiner\'s best art';
		return `For claim ${comparison.claim}, the best art found (${foundArt.join(', ') || 'no publication'}) discloses ${comparison.foundDisclosed} of ${comparison.elements} elements; ${examinerSide}.`;
	}
	const remains = examinerArt.length
		? `the examiner's best art remains ${examiner} (disclosed ${comparison.examinerDisclosed} of ${comparison.elements})`
		: `no examiner-side row cites the examiner's best art (disclosed ${comparison.examinerDisclosed} of ${comparison.elements})`;
	return incomplete.length
		? `Search incomplete for claim ${comparison.claim}: ${incomplete.join('; ')}. The queries that ran found no better art; ${remains}.`
		: `No better art found for claim ${comparison.claim}; ${remains}.`;
}

/** The mandatory tracks of ADR 0010 decision 4. */
const MANDATORY_TRACKS = 3;

/**
 * The backward-citation track (Track 1): the track whose name says "backward", else the first one.
 * Its hop-2 queries carry `hop: 2`.
 */
function backwardTrack(review: FindBetterFields): FindBetterTrack | undefined {
	const tracks = review.tracks ?? [];
	return tracks.find(track => /backward/i.test(track?.name ?? '')) ?? tracks[0];
}

/**
 * Why the search behind a claim's result is incomplete; empty when every mandatory part ran. All
 * three tracks are mandatory and Track 1 is two hops (ADR 0010 decision 4), so a track with no query,
 * a missing track, or a Track 1 with no `hop: 2` query each make "no better art found" unearned.
 */
export function incompleteSearch(review: FindBetterFields): string[] {
	const tracks = review.tracks ?? [];
	const reasons = tracks.filter(track => !track?.queries?.length).map(track => `track ${track?.name?.trim() || '(unnamed)'} ran no query`);
	if (tracks.length < MANDATORY_TRACKS) { reasons.push(`only ${tracks.length} of the ${MANDATORY_TRACKS} mandatory tracks is logged`); }
	const first = backwardTrack(review);
	if (first?.queries?.length && !first.queries.some(query => query?.hop === 2)) { reasons.push('Track 1 has no second-hop entry'); }
	return reasons;
}

/** The examiner's best art of one claim, split by whether at least one examiner-side row cites it. */
export function examinerArtReading(comparison: ClaimComparison, examinerCited: readonly string[]): { readonly scored: readonly string[]; readonly unscored: readonly string[] } {
	const cited = new Set(examinerCited.map(documentKey));
	const named = distinctDocuments(comparison.examinerArt);
	return {
		scored: named.filter(publication => cited.has(documentKey(publication))),
		unscored: named.filter(publication => !cited.has(documentKey(publication))),
	};
}

/** The flag an examiner document gets when it may postdate the critical date. */
const AFTER_CRITICAL_DATE = 'published after the critical date; not prior art for this claim unless the priority claim fails';

/** `YYYY-MM-DD` from a `YYYY-MM-DD` or `YYYYMMDD` date, or undefined. */
function isoDate(value: string | undefined): string | undefined {
	const match = /(?<year>\d{4})-?(?<month>0[1-9]|1[0-2])-?(?<day>0[1-9]|[12]\d|3[01])/.exec(value ?? '');
	return match?.groups ? `${match.groups.year}-${match.groups.month}-${match.groups.day}` : undefined;
}

/**
 * The critical date: the earliest date `objective` states. The skill puts the earliest priority date
 * there as `YYYY-MM-DD`; any later date the sentence names (a filing or grant date) is not the one
 * art is measured against.
 */
function criticalDate(objective: string | undefined): string | undefined {
	const dates = [...(objective ?? '').matchAll(/\b(?<year>\d{4})-?(?<month>0[1-9]|1[0-2])-?(?<day>0[1-9]|[12]\d|3[01])\b/g)].map(match => isoDate(match[0])!).sort();
	return dates[0];
}

/**
 * A publication's date: from its Baseline citations when one carries `publicationDate`, else from
 * the get_patent_details record of it in this session, else unknown.
 */
function publicationDate(baseline: ExaminerBaseline, publication: string, snapshot: PatentExecutionSnapshot): string | undefined {
	const document = baselineDocument(baseline, publication);
	const fromBaseline = Object.values(document?.cells ?? {}).flatMap(cell => cell?.citations ?? []).map(citation => isoDate(citation?.publicationDate)).find(date => !!date);
	if (fromBaseline) { return fromBaseline; }
	const key = documentKey(publication);
	return snapshot.executions.filter(execution => execution.kind === 'details' && execution.status === 'succeeded' && execution.publicationIds?.some(id => documentKey(id) === key)).map(execution => isoDate(execution.publicationDate)).find(date => !!date);
}

/**
 * An examiner document as the result sentence names it: flagged when the Baseline gives it a P or E
 * category (published between priority and filing, or on or after filing) or its publication date
 * is after the critical date stated in `objective`.
 */
export function examinerArtLabel(review: PatentCandidateReview, publication: string, snapshot: PatentExecutionSnapshot): string {
	const document = baselineDocument(review.baseline ?? {}, publication);
	const found = document ? categories(document) : new Set<string>();
	const date = publicationDate(review.baseline ?? {}, publication, snapshot);
	const critical = criticalDate(review.objective);
	const late = found.has('P') || found.has('E') || (!!date && !!critical && date > critical);
	return late ? `${publication} (${AFTER_CRITICAL_DATE})` : publication;
}

function cell(value: string): string { return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' '); }

/** Which claims name a Baseline row as the examiner's best art, so the matrix marks the row. */
function bestArtClaims(review: FindBetterFields, document: ExaminerBaselineDocument): readonly string[] {
	return (review.examinerBestArt ?? []).filter(entry => entry.publications.some(publication => documentKey(publication) === documentKey(document.document))).map(entry => entry.claimNumber);
}

/**
 * The Examiner Baseline section: what was walked, the matrix of documents by office, and the gaps,
 * each rendered as a gap. Every value is read off the Baseline as supplied; nothing is computed by a
 * model here.
 */
export function renderBaseline(review: FindBetterFields): string[] {
	const baseline = review.baseline ?? {};
	const offices = baseline.offices ?? [];
	const documents = baseline.documents ?? [];
	const gaps = baseline.gaps ?? [];
	const members = baseline.membersWalked ?? [];
	return [
		'## Examiner Baseline',
		`Every document the examining offices cited across the family of ${baseline.publication ?? 'the target'}, by office, as the Baseline supplied to the writer reports it (\`flowleap patent examiner-baseline --json\` or the examiner_baseline backend tool's result). Cell: relevance category and cited claims, or \`applicant\` where only the applicant cited the document; \`-\` where the office did not cite it. Rows deduplicated by ${baseline.dedupe ?? 'an unstated key'}. Claim numbers in a cell are those of the citing publication named beside them (the claim set that office searched or examined), not the granted claims of the target; a combined category such as X,A is shown as the office printed it.`,
		'',
		...(members.length ? [
			`Family members walked: ${members.length}. Offices: ${offices.join(', ') || 'none'}.`,
			'',
			'| Office | Member | Read | Cited (examiner / applicant) |',
			'| --- | --- | --- | --- |',
			...members.flatMap(member => [
				...(member.publications ?? []).map(read => '| ' + [member.office ?? '?', member.representativePublication ?? '?', `${read.publication ?? '?'}: ${read.status ?? 'unknown'}`, read.status === 'read' ? `${read.citedCount ?? 0} (${read.examinerCount ?? 0} / ${read.applicantCount ?? 0})` : '—'].map(value => cell(String(value))).join(' | ') + ' |'),
				...(member.usptoEnriched ? ['| ' + [member.office ?? '?', member.representativePublication ?? '?', `USPTO enriched, application ${member.usptoEnriched.applicationNumber ?? 'not resolved'}: ${member.usptoEnriched.status ?? 'unknown'}`, member.usptoEnriched.status === 'read' ? `${member.usptoEnriched.rows ?? 0} rows` : '—'].map(value => cell(String(value))).join(' | ') + ' |'] : []),
			]),
			'',
		] : []),
		`Cited documents: ${documents.length}.`,
		'',
		...(documents.length ? [
			'| Document | ' + offices.map(cell).join(' | ') + ' |',
			'| --- | ' + offices.map(() => '---').join(' | ') + ' |',
			...documents.map(document => {
				const claims = bestArtClaims(review, document);
				const doi = document.nplWork?.status === 'matched' ? document.nplWork.work?.doi : undefined;
				const name = (document.npl ? `NPL: ${document.npl}${doi ? ` (DOI ${doi})` : ''}` : `${document.document}${document.kinds?.length ? ' ' + document.kinds.join(', ') : ''}`) + (claims.length ? ` (examiner's best art, claim ${claims.join(', ')})` : '');
				return '| ' + [name, ...offices.map(office => baselineCell(document.cells?.[office]))].map(cell).join(' | ') + ' |';
			}),
			'',
		] : ['No office cited any document in the records the Baseline read.', '']),
		'### Gaps in the offices\' records',
		'A gap is a member or source that returned no citation record. It is not "nothing cited": that office\'s citations for that member are unknown.',
		...(gaps.length ? gaps.map(gap => '- Gap: ' + cell(gap.message?.trim() || `no citation record from ${gap.office ?? '?'} (${gap.member ?? '?'})`) + (gap.reason ? ` (${gap.reason})` : '')) : ['- The Baseline reports no gaps.']),
		'',
	];
}

/**
 * One Baseline cell as the office printed it, with the publication or application whose claim set
 * its claim numbers refer to. An EP search report cites the application's claims and a US office
 * action the pending claims, so the numbers are never equated with the granted claims.
 */
function baselineCell(value: ExaminerBaselineCell | undefined): string {
	const text = value?.text?.trim();
	if (!text) { return '-'; }
	const citing = [...new Set((value?.citations ?? []).flatMap(citation => citation?.relevantClaims?.trim() && citation.citing?.trim() ? [citation.citing.trim()] : []))];
	return citing.length ? `${text} (claims of ${citing.join(', ')})` : text;
}

/** A query as the execution record keys it: whitespace collapsed, case kept. */
function queryKey(value: string): string { return value.replace(/\s+/g, ' ').trim(); }

/**
 * The keys a logged query is looked up under: the query itself, then the query without a trailing
 * note in parentheses, e.g. `in="CHEN" AND pd<20080416 (inventor of X reference US2007052285)` (#537).
 * Only a parenthetical after a space with no `=` in it is a note; a CQL group such as
 * `(ta=cam OR ta=lobe)` is query text, and the exact query is always tried first.
 */
function queryKeys(value: string): string[] {
	const key = queryKey(value);
	const withoutNote = key.replace(/\s\([^()=]*\)$/, '').trim();
	return withoutNote && withoutNote !== key ? [key, withoutNote] : [key];
}

/**
 * The tracks log: every query each track ran with its hit count, empty ones included, so a reviewer
 * sees what was searched and what was not. A count the execution record holds is taken from it; any
 * other count is shown as the agent reported it, labelled so.
 */
export function renderTracks(review: FindBetterFields, snapshot: PatentExecutionSnapshot): string[] {
	const recorded = new Map<string, number>();
	for (const execution of snapshot.executions) {
		if (execution.kind !== 'search' || execution.status !== 'succeeded' || execution.total === undefined) { continue; }
		for (const query of [execution.query, execution.effectiveQuery]) { if (query?.trim() && !recorded.has(queryKey(query))) { recorded.set(queryKey(query), execution.total); } }
	}
	return [
		'## Tracks log',
		'Every expansion track of this run with each query it ran and its hit count, including queries that returned nothing. A track with no query was not searched.',
		'| Track | Query | Tool | Hits | Count basis |',
		'| --- | --- | --- | --- | --- |',
		...(review.tracks ?? []).flatMap(track => track.queries?.length
			? track.queries.map(query => {
				const total = queryKeys(query.query).map(key => recorded.get(key)).find(count => count !== undefined);
				const hits = total !== undefined ? String(total) : typeof query.count === 'number' ? String(query.count) : 'not stated';
				const basis = total !== undefined ? 'execution record' : 'as reported by the agent; not in the execution record';
				return '| ' + [query.hop === 1 || query.hop === 2 ? `${track.name} (hop ${query.hop})` : track.name, query.query, query.tool?.trim() || '—', hits, basis].map(cell).join(' | ') + ' |';
			})
			: ['| ' + [track.name, 'no query run', '—', '—', '—'].map(cell).join(' | ') + ' |']),
		'',
	];
}

/** The status word a side's cell shows, or a dash where the row has no such side. */
export function sideStatus(row: PatentCoverageRow, side: FindBetterSideName): string {
	const value = row[side];
	return value ? FIND_BETTER_STATUS[value.status] : '—';
}

/** The number of gaps the Baseline reports; the chat summary has to state it. */
export function gapCount(review: FindBetterFields): number {
	return review.baseline?.gaps?.length ?? 0;
}
