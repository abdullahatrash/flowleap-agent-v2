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
	readonly cells?: Readonly<Record<string, ExaminerBaselineCell>>;
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
 * The Examiner Baseline: the `--json` output of `flowleap patent examiner-baseline`, or the same
 * shape built from the typed citation tools. Field names are the CLI's contract.
 */
export interface ExaminerBaseline {
	readonly publication?: string;
	readonly offices?: readonly string[];
	readonly membersWalked?: readonly ExaminerBaselineMember[];
	readonly documents?: readonly ExaminerBaselineDocument[];
	readonly gaps?: readonly ExaminerBaselineGap[];
	readonly dedupe?: string;
}

/** The publication(s) the agent picked as the examiner's best art for one independent claim. */
interface ExaminerBestArt {
	readonly claimNumber: string;
	readonly publications: readonly string[];
}

/** One expansion track of a Find Better run and every query it ran, empty ones included. */
interface FindBetterTrack {
	readonly name: string;
	readonly queries?: readonly { readonly query: string; readonly tool?: string; readonly count?: number }[];
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

/** The Baseline's shape: the fields this writer reads, each of the type the CLI prints. */
function baselineShapeErrors(baseline: ExaminerBaseline): string[] {
	const errors: string[] = [];
	if (!Array.isArray(baseline.offices) || !baseline.offices.every(office => typeof office === 'string')) { errors.push('baseline.offices must be the array of office codes the Baseline prints as matrix columns.'); }
	if (!Array.isArray(baseline.documents) || !baseline.documents.every(document => typeof document?.document === 'string')) { errors.push('baseline.documents must be the array of cited documents, each with its document key and per-office cells.'); }
	if (!Array.isArray(baseline.gaps)) { errors.push('baseline.gaps must be present: an empty array when every member returned a citation record, so a missing record is never read as "nothing cited".'); }
	return errors;
}

/**
 * The find-better checks that sit on top of the ordinary row checks: the Baseline's shape, the
 * examiner's best art against the Baseline, both sides on every row, a claim on every row, and the
 * examiner side citing only the examiner's best art of its claim.
 */
export function findBetterErrors(review: PatentCandidateReview, sources: Map<string, PatentEvidenceSource>): string[] {
	const baseline = review.baseline ?? {};
	const errors = baselineShapeErrors(baseline);
	if (errors.length) { return errors; }
	const bestArt = new Map<string, readonly string[]>();
	for (const entry of review.examinerBestArt ?? []) {
		const claim = entry?.claimNumber?.trim();
		if (!claim || !entry.publications?.length) { errors.push('Every examinerBestArt entry needs a claimNumber and at least one publication.'); continue; }
		bestArt.set(claim, entry.publications);
		for (const publication of entry.publications) {
			const document = baselineDocument(baseline, publication);
			if (!document) { errors.push(`examinerBestArt for claim ${claim} names ${publication}, which is not in baseline.documents[]. The examiner's best art must be a document the Baseline lists; pick one of its X or Y citations.`); continue; }
			const found = categories(document);
			if (!found.has('X') && !found.has('Y')) { errors.push(`examinerBestArt for claim ${claim} names ${publication}, which carries no X or Y category in any office of the Baseline (${[...found].join(', ') || 'no category'}). The examiner's best art must be an X or Y citation.`); }
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
			if (key === 'count' && /^tracks\[\d+\]\.queries\[\d+\]$/.test(path)) { continue; }
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

/** The sentence that states the claim's result. "No better art found" is a complete result, not an error. */
export function claimResultSentence(comparison: ClaimComparison, foundArt: readonly string[]): string {
	const examiner = comparison.examinerArt.join(', ');
	if (comparison.foundDisclosed > comparison.examinerDisclosed) {
		return `For claim ${comparison.claim}, the best art found (${foundArt.join(', ') || 'no publication'}) discloses ${comparison.foundDisclosed} of ${comparison.elements} elements; the examiner's best art ${examiner} discloses ${comparison.examinerDisclosed} of ${comparison.elements}.`;
	}
	return `No better art found for claim ${comparison.claim}; the examiner's best art remains ${examiner} (disclosed ${comparison.examinerDisclosed} of ${comparison.elements}).`;
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
		`Every document the examining offices cited across the family of ${baseline.publication ?? 'the target'}, by office, as the Baseline supplied to the writer reports it (\`flowleap patent examiner-baseline --json\` or the same shape built from the typed citation tools). Cell: relevance category and cited claims, or \`applicant\` where only the applicant cited the document; \`-\` where the office did not cite it. Rows deduplicated by ${baseline.dedupe ?? 'an unstated key'}. Claim numbers in a cell are those of the citing publication named beside them (the claim set that office searched or examined), not the granted claims of the target; a combined category such as X,A is shown as the office printed it.`,
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
				const name = (document.npl ? `NPL: ${document.npl}` : `${document.document}${document.kinds?.length ? ' ' + document.kinds.join(', ') : ''}`) + (claims.length ? ` (examiner's best art, claim ${claims.join(', ')})` : '');
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
				const total = recorded.get(queryKey(query.query));
				const hits = total !== undefined ? String(total) : typeof query.count === 'number' ? String(query.count) : 'not stated';
				const basis = total !== undefined ? 'execution record' : 'as reported by the agent; not in the execution record';
				return '| ' + [track.name, query.query, query.tool?.trim() || '—', hits, basis].map(cell).join(' | ') + ' |';
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
