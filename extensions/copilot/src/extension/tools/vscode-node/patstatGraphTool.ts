/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  PATSTAT Graph Analytics Tool
 *
 *  Graph Analytics is the third PATSTAT engine (CONTEXT.md, ADR 0007): it answers questions about
 *  A NAMED NODE AND THE RELATIONSHIPS AROUND IT — who cites EP3477840, how two patents connect, who
 *  a company co-files with — as opposed to aggregate counts over a corpus (Portfolio: patstat_portfolio
 *  / patstat_query) or document discovery by subject (the search branches).
 *
 *  One tool, six operations, each a thin 1:1 relay of one `GET /v1/patstat/graph/*` route. Per
 *  ADR 0007 the backend's `/v1/analyst` agent loop is deliberately NOT wrapped — an agent calling a
 *  strictly weaker agent buys latency and a second inference bill while surrendering synthesis control.
 *
 *  Relay discipline mirrors the guarded-SQL tool:
 *  - The agent verbs (`neighborhood`/`path`/`explain`) return a token-budgeted, line-per-fact `text`
 *    where every edge already carries its confidence tag and `at=` provenance ref, the Data Edition
 *    rides in the header, and truncation is announced in-band. That string IS the deliverable, so it
 *    is relayed VERBATIM — reformatting it could only lose those guarantees.
 *  - The composites (`patent_view`/`applicant_view`) render bounded section tables, each printed even
 *    when empty (an empty section is a checked, empty result — never a silently skipped one), with the
 *    backend's TRUE totals on truncation, its data-quality flags, and the Data Edition footer.
 *  - The typed graph errors relay the backend envelope verbatim; `patstat_patent_ambiguous` presents
 *    the candidates as an interaction step and NEVER auto-picks.
 *
 *  Per-operation guidance comes from `patstat_api_guide` at runtime (the backend manifest documents
 *  all six routes and the `graph` workflow) — nothing is hardcoded here, so guidance never drifts.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import type * as vscode from 'vscode';
import { ILogService } from '../../../platform/log/common/logService';
import { CancellationToken } from '../../../util/vs/base/common/cancellation';
import { LanguageModelTextPart, LanguageModelToolResult } from '../../../vscodeTypes';
import { IPatentBackendClient, PatentBackendError } from '../../patentai/vscode-node/patentBackendClient';
import { handlePatentToolError } from './patentToolError';
import { ToolName } from '../common/toolNames';
import { ICopilotTool, ToolRegistry } from '../common/toolsRegistry';
import { renderMarkdownTable, ToolResponseBudgets } from './patentResponseFormatter';

/** The six graph operations, 1:1 with the backend's `/v1/patstat/graph/*` routes. */
type GraphOperation = 'resolve' | 'patent_view' | 'applicant_view' | 'neighborhood' | 'path' | 'explain';

interface IPatstatGraphParams {
	operation: GraphOperation;
	/** `resolve`: a publication number or an applicant name. */
	query?: string;
	/** `neighborhood`/`explain`: a `pat:<appln_id>` node id, or a publication number to resolve. */
	node?: string;
	/** `patent_view`: a publication number (e.g. EP3477840). */
	publication?: string;
	/** `applicant_view`: a harmonized entity id, only ever taken from a `resolve` entity candidate. */
	psnId?: number;
	/** `path`: first endpoint. */
	a?: string;
	/** `path`: second endpoint. */
	b?: string;
	/** `neighborhood`: hops to expand (backend bounds: 1 or 2). */
	depth?: number;
	/** `neighborhood`: comma-separated edge subset, e.g. `cites,cited_by`. */
	edgeTypes?: string;
	/** `path`: maximum hops to search (backend bounds: 1–4). */
	maxHops?: number;
	/** Agent verbs: token budget for the `text` serialization (backend clamps to 100–20000). */
	tokenBudget?: number;
}

// ── Backend response shapes ────────────────────────────────────────────────────

interface GraphConfidence {
	tag?: string;
	score?: number;
}

interface GraphPublication {
	publn?: string;
	kind?: string;
	date?: string;
	first_grant?: boolean;
	at?: string;
}

/** One application anchor: `resolve`'s `kind:'patent'` result, an ambiguity candidate, or a composite header. */
interface GraphAnchor {
	node?: string;
	application?: string;
	title?: string | null;
	/** Null when PATSTAT recorded the 9999 unknown-date sentinel — never quote either as a year. */
	filing_year?: number | null;
	filing_date?: string;
	earliest_publn_date?: string;
	granted?: boolean;
	docdb_family_id?: number;
	publications?: GraphPublication[];
	confidence?: GraphConfidence;
	at?: string;
}

/** One harmonized (PSN) applicant entity: a `resolve` entity candidate or `applicant_view`'s card. */
interface EntityCandidate {
	node?: string;
	psn_id?: number;
	name?: string;
	applications?: number;
	person_variants?: number;
	confidence?: GraphConfidence;
	at?: string;
	name_grouping?: { note?: string; confidence?: GraphConfidence };
}

/**
 * A `resolve` candidate. `kind:'ambiguous'` lists {@link GraphAnchor}s, `kind:'entities'` lists
 * {@link EntityCandidate}s; the two shapes never mix within one response, and each renderer reads
 * only the fields its `kind` guarantees.
 */
type ResolveCandidate = GraphAnchor & EntityCandidate;

interface ResolveResponse {
	success: boolean;
	kind?: 'patent' | 'ambiguous' | 'entities';
	input?: string;
	anchor?: GraphAnchor;
	candidates?: ResolveCandidate[];
	/** `kind:'entities'` only: the TRUE match count behind a truncated candidate list. */
	total?: number;
	truncated?: boolean;
}

/**
 * An agent verb's body. `data` (the same facts as structured JSON) is deliberately not typed or
 * read: `text` is the product these verbs exist to produce, and re-deriving it from `data` would
 * discard the confidence tags, provenance refs and truncation notices baked into it.
 */
interface GraphVerbResponse {
	success: boolean;
	text?: string;
}

interface GraphTruncationInfo {
	truncated?: boolean;
	shown?: number;
	total?: number;
	ranking?: string;
}

interface GraphDataQualityFlag {
	node?: string;
	issue?: string;
	detail?: string;
}

interface GraphCompositeMeta {
	data_edition?: string;
	attribution?: string;
	truncation?: Record<string, GraphTruncationInfo>;
	data_quality?: GraphDataQualityFlag[];
}

interface PersonRow {
	name?: string;
	country?: string;
	confidence?: GraphConfidence;
	at?: string;
}

interface CpcRow {
	symbol?: string;
	confidence?: GraphConfidence;
	at?: string;
}

interface BackwardPatentRow {
	cited?: string;
	title?: string | null;
	date?: string;
	origin?: string;
	confidence?: GraphConfidence;
	at?: string;
}

interface BackwardNplRow {
	biblio?: string;
	origin?: string;
	confidence?: GraphConfidence;
	at?: string;
}

interface UnresolvedCitationRow {
	node?: string;
	origin?: string;
	note?: string;
	confidence?: GraphConfidence;
	at?: string;
}

interface ForwardCitationRow {
	citing?: string;
	title?: string | null;
	applicant?: string;
	date?: string;
	origin?: string;
	examiner_cited?: boolean;
	citing_family_size?: number;
	confidence?: GraphConfidence;
	at?: string;
}

interface FamilyRow {
	application?: string;
	office?: string;
	filing_year?: number | null;
	first_grant_date?: string | null;
	is_anchor?: boolean;
	confidence?: GraphConfidence;
	at?: string;
}

interface PriorityRow {
	prior_application?: string;
	prior_filing_date?: string;
	confidence?: GraphConfidence;
	at?: string;
}

interface PatentViewResponse {
	success: boolean;
	meta?: GraphCompositeMeta;
	anchor?: GraphAnchor;
	header?: { applicants?: PersonRow[]; inventors?: PersonRow[]; cpc?: CpcRow[] };
	citations?: {
		backward_patent?: BackwardPatentRow[];
		backward_npl?: BackwardNplRow[];
		backward_unresolved?: UnresolvedCitationRow[];
		forward?: ForwardCitationRow[];
	};
	family?: FamilyRow[];
	priorities?: PriorityRow[];
}

interface CoApplicantRow {
	name?: string;
	psn_id?: number;
	shared_applications?: number;
	confidence?: GraphConfidence;
	at?: string;
}

interface ApplicantViewResponse {
	success: boolean;
	meta?: GraphCompositeMeta;
	entity?: EntityCandidate;
	filings_by_year?: { year?: number; applications?: number }[];
	top_cpc?: { symbol?: string; applications?: number }[];
	jurisdictions?: { office?: string; applications?: number }[];
	co_applicants?: CoApplicantRow[];
}

/** The FlowLeap unified error envelope carried (as JSON text) in a non-2xx {@link PatentBackendError}. */
interface GraphErrorEnvelope {
	error?: {
		code?: string;
		message?: string;
		candidates?: GraphAnchor[];
	};
}

/** The typed graph error family — relayed verbatim, each with its own recovery instruction. */
const TYPED_GRAPH_ERROR_CODES: readonly string[] = [
	'patstat_patent_not_found',
	'patstat_entity_not_found',
	'patstat_patent_ambiguous',
	'patstat_invalid_request',
	'patstat_unavailable',
];

/** Rows rendered per composite section before the "and N more" cut (the backend's own caps are higher). */
const MAX_RENDERED_SECTION_ROWS = 40;

/**
 * `filings_by_year` is the FULL year distribution and the backend caps it at nothing, so it is
 * rendered whole up to this ceiling. Trimming it like the other sections would be actively wrong:
 * the rows are in ascending year order, so a head-cut would answer "how does this applicant file
 * today?" with the 1880s and hide every modern year.
 */
const MAX_RENDERED_YEAR_ROWS = 200;

// ── Rendering helpers ──────────────────────────────────────────────────────────

/** A field as display text. Absent, null and the empty string all render as `?`, never as `null`. */
function textOf(value: string | number | null | undefined): string {
	return value === undefined || value === null || value === '' ? '?' : String(value);
}

/** PATSTAT stores an unknown filing year as the 9999 sentinel, which the backend maps to null. */
function filingYear(year: number | null | undefined): string {
	return year === undefined || year === null ? 'unknown' : String(year);
}

function yesNo(value: boolean | undefined): string {
	return value === true ? 'yes' : 'no';
}

/** The confidence TAG (EXTRACTED / INFERRED / AMBIGUOUS) — the part that changes how a fact may be stated. */
function confidenceTag(confidence: GraphConfidence | undefined): string {
	return confidence?.tag ?? '?';
}

/**
 * Render one composite section: its table, or an explicit "(none recorded)" line. An empty section is
 * a checked, empty result — printing the header either way is what stops the model from reading an
 * absent section as a parsing slip. Rows beyond `renderCap` are cut with a note saying so, and the
 * backend's own cap is reported separately with its TRUE total (`meta.truncation`) — the two
 * truncations are distinct and both are stated, so neither shown count can be read as a total.
 */
function renderSection<T>(
	title: string,
	rows: readonly T[] | undefined,
	columns: readonly { header: string; cell: (row: T) => string; align?: 'right' }[],
	meta: GraphCompositeMeta | undefined,
	section: string,
	label: string,
	renderCap: number = MAX_RENDERED_SECTION_ROWS,
): string[] {
	const lines: string[] = [`### ${title}`];
	const all = rows ?? [];

	if (all.length === 0) {
		lines.push('(none recorded)');
	} else {
		const rendered = all.slice(0, renderCap);
		lines.push(renderMarkdownTable(rendered, columns));
		if (all.length > rendered.length) {
			lines.push(`(${rendered.length} of the ${all.length} returned ${label} rendered here.)`);
		}
	}

	const truncation = meta?.truncation?.[section];
	if (truncation?.truncated) {
		const ranking = truncation.ranking ? ` (ranked by ${truncation.ranking})` : '';
		lines.push(`TRUNCATED: the backend returned ${truncation.shown ?? all.length} of ${truncation.total ?? '?'} ${label}${ranking} — quote the TRUE total, never the shown count, and narrow the query if you need the rest.`);
	}

	lines.push('');
	return lines;
}

/** The Data Edition, EPO attribution and snapshot caveat that close every composite. */
function renderProvenanceFooter(meta: GraphCompositeMeta | undefined): string[] {
	const lines: string[] = [];
	for (const flag of meta?.data_quality ?? []) {
		lines.push(`- Data-quality flag (${textOf(flag.node)}): ${textOf(flag.issue)} — ${textOf(flag.detail)}`);
	}
	if (meta?.data_quality?.length) {
		lines.push('');
	}
	lines.push(`Source: ${meta?.data_edition ?? 'PATSTAT (edition unknown)'} — cite this Data Edition with every number you quote; two figures are only comparable within one edition.`);
	if (meta?.attribution) {
		lines.push(meta.attribution);
	}
	lines.push(
		'CONFIDENCE DISCIPLINE: EXTRACTED is a direct PATSTAT row — state it as fact. INFERRED is a derived join (harmonized-name grouping, extended family) — hedge it ("grouped under the harmonized entity…"). AMBIGUOUS is an unresolved reference — flag it, never build a conclusion on it. Carry the `at=` provenance ref when the user needs to verify a relationship.',
	);
	lines.push('This is PATSTAT SNAPSHOT data. For an individual patent\'s CURRENT legal status (in force, lapsed, opposed), use get_legal_status or get_patent_summary — never present snapshot data as current.');
	return lines;
}

/**
 * Tool for Graph Analytics over the backend's self-hosted PATSTAT snapshot. Calls the six
 * `/v1/patstat/graph/*` routes through the shared {@link IPatentBackendClient} seam, inheriting the
 * centralized `401 → re-sign-in` / `402 → start-trial` / `400 → data keys` / `429 → rate-limited`
 * gating and the shared {@link handlePatentToolError} catch path.
 *
 * PATSTAT is keyless — it needs no EPO OPS or USPTO data key — so this tool stays live while an
 * office is key-gated.
 */
export class PatstatGraphTool implements ICopilotTool<IPatstatGraphParams> {

	public static readonly toolName = ToolName.PatstatGraph;

	constructor(
		@ILogService private readonly logService: ILogService,
		@IPatentBackendClient private readonly patentBackendClient: IPatentBackendClient,
	) { }

	prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<IPatstatGraphParams>, _token: CancellationToken): vscode.ProviderResult<vscode.PreparedToolInvocation> {
		const { operation } = options.input;
		const subject = options.input.query ?? options.input.publication ?? options.input.node ?? options.input.a ?? (options.input.psnId !== undefined ? String(options.input.psnId) : undefined);
		const message = subject
			? `Walking the PATSTAT graph (${operation}): ${subject}`
			: `Walking the PATSTAT graph (${operation})`;
		return {
			invocationMessage: l10n.t`${message}`,
		};
	}

	async invoke(options: vscode.LanguageModelToolInvocationOptions<IPatstatGraphParams>, token: CancellationToken): Promise<vscode.LanguageModelToolResult> {
		this.logService.trace(`[PatstatGraphTool] Graph operation: ${options.input.operation}`);

		const route = buildRoute(options.input);
		if (typeof route === 'string') {
			// A malformed call is answered before any network round-trip: the string IS the fix instruction.
			return new LanguageModelToolResult([new LanguageModelTextPart(route)]);
		}

		try {
			switch (options.input.operation) {
				case 'resolve': {
					const result = await this.patentBackendClient.get<ResolveResponse>(route.path, token);
					return this.textResult(this.formatResolve(result));
				}
				case 'patent_view': {
					const result = await this.patentBackendClient.get<PatentViewResponse>(route.path, token);
					return this.textResult(this.formatPatentView(result));
				}
				case 'applicant_view': {
					const result = await this.patentBackendClient.get<ApplicantViewResponse>(route.path, token);
					return this.textResult(this.formatApplicantView(result));
				}
				default: {
					const result = await this.patentBackendClient.get<GraphVerbResponse>(route.path, token);
					return this.textResult(this.formatVerb(options.input.operation, result));
				}
			}
		} catch (error) {
			return handlePatentToolError(
				error,
				this.logService,
				'[PatstatGraphTool]',
				err => this.formatGraphError(err),
			);
		}
	}

	private textResult(body: string): LanguageModelToolResult {
		const budget = ToolResponseBudgets.PatstatGraph;
		const bounded = body.length > budget
			? body.substring(0, budget) + '\n\n(Output truncated to fit the response budget — scope the call with edge_types, a smaller depth, or a lower token_budget.)'
			: body;
		return new LanguageModelToolResult([new LanguageModelTextPart(bounded)]);
	}

	/**
	 * An agent verb's answer is the backend's `text`, VERBATIM. That string is already the product:
	 * a token-budgeted, line-per-fact serialization where every edge carries its confidence tag and
	 * `at=` provenance ref, labels are quoted as inert data, the Data Edition rides in the header,
	 * and truncation is announced in-band. Nothing here reformats, summarizes or reorders it —
	 * only a relay instruction is appended, outside the quoted block.
	 */
	private formatVerb(operation: GraphOperation, data: GraphVerbResponse): string {
		if (typeof data.text !== 'string') {
			return `Error: The ${operation} verb returned no \`text\` field — the response did not match the graph verb contract. Retry, or use patstat_api_guide action="endpoint" endpoint="${operation}" to check the request shape.`;
		}
		return [
			`## PATSTAT Graph — ${operation}`,
			'',
			data.text,
			'',
			'Quote these lines WITH their confidence tag and `at=` provenance ref rather than re-deriving the facts, and carry the Data Edition named in the header. Do not present a TRUNCATED listing as complete.',
			operation === 'path'
				? 'A `NOT FOUND` result is an ANSWER, not a failure: the search ran and found no path within the hop limit. Absence of a path is not proof of unrelatedness — unrelated technology areas commonly have none.'
				: '',
		].filter(Boolean).join('\n');
	}

	/**
	 * `resolve` answers one of three questions the caller may not know they asked: a number that
	 * names exactly one application (an anchor), a number behind several (a pick-one list), or a
	 * name (always a pick-one list of harmonized entities). The last two are INTERACTION steps —
	 * the candidates are presented and nothing is auto-picked.
	 */
	private formatResolve(data: ResolveResponse): string {
		switch (data.kind) {
			case 'patent':
				return this.formatAnchor(data.anchor);
			case 'ambiguous':
				return this.formatAmbiguous(
					`"${textOf(data.input)}" matches ${data.candidates?.length ?? 0} distinct applications.`,
					data.candidates,
				);
			case 'entities':
				return this.formatEntities(data);
			default:
				return `Error: resolve returned an unrecognized result kind (${textOf(data.kind)}). Check the input, or use patstat_api_guide action="endpoint" endpoint="resolve".`;
		}
	}

	/**
	 * One resolved anchor. The publications are listed because several publications of ONE
	 * application collapse into a single anchor — seeing the number the user typed among them is how
	 * the collapse is confirmed as the intended one.
	 */
	private formatAnchor(anchor: GraphAnchor | undefined): string {
		if (!anchor) {
			return 'Error: resolve reported a patent match but returned no anchor.';
		}
		const lines: string[] = [
			'## PATSTAT Graph — resolved anchor',
			'',
			`Node: \`${textOf(anchor.node)}\` — pass THIS id to the other operations.`,
			`Application: ${textOf(anchor.application)}`,
			`Title: ${textOf(anchor.title)}`,
			`Filed: ${filingYear(anchor.filing_year)} · Granted: ${yesNo(anchor.granted)} · DOCDB family: ${textOf(anchor.docdb_family_id)}`,
			'',
		];

		if (anchor.publications?.length) {
			lines.push('Publications of this one application:');
			for (const publication of anchor.publications) {
				const firstGrant = publication.first_grant ? ' — first grant' : '';
				lines.push(`- ${textOf(publication.publn)} (${textOf(publication.date)})${firstGrant} at=${textOf(publication.at)}`);
			}
			lines.push('');
		}

		lines.push(`Confidence: ${confidenceTag(anchor.confidence)} (at=${textOf(anchor.at)}) — PATSTAT snapshot data; for CURRENT legal status use get_legal_status.`);
		return lines.join('\n');
	}

	/**
	 * One publication number behind several distinct applications. The backend never picks between
	 * them and neither does this tool: the candidates are presented so the USER chooses, and the
	 * chosen `pat:` id is what the next call takes.
	 */
	private formatAmbiguous(headline: string, candidates: GraphAnchor[] | undefined): string {
		const lines: string[] = ['## PATSTAT Graph — ambiguous publication number', '', headline, ''];

		if (!candidates?.length) {
			lines.push('The backend returned no candidate list with this ambiguity. Re-run this tool with operation="resolve" and the same number — resolve returns the complete candidate list in a 200 response.');
			return lines.join('\n');
		}

		lines.push(renderMarkdownTable(candidates, [
			{ header: 'Node id', cell: candidate => textOf(candidate.node) },
			{ header: 'Application', cell: candidate => textOf(candidate.application) },
			{ header: 'Title', cell: candidate => textOf(candidate.title) },
			{ header: 'Filed', cell: candidate => filingYear(candidate.filing_year) },
			{ header: 'Granted', cell: candidate => yesNo(candidate.granted) },
			{ header: 'Publications', cell: candidate => (candidate.publications ?? []).map(publication => `${textOf(publication.publn)} (${textOf(publication.date)})`).join(', ') || '?' },
		]));
		lines.push('');
		lines.push('DO NOT PICK ONE YOURSELF. Present these candidates to the user and ask which application they mean, then re-call with that candidate\'s `pat:` node id. Picking silently would attach every downstream citation and family fact to the wrong invention.');
		return lines.join('\n');
	}

	/** Ranked harmonized-entity candidates, largest portfolio first, with the TRUE match total. */
	private formatEntities(data: ResolveResponse): string {
		const candidates = data.candidates ?? [];
		const lines: string[] = [`## PATSTAT Graph — applicant entities matching "${textOf(data.input)}"`, ''];

		if (candidates.length === 0) {
			lines.push('No harmonized (PSN) entity matches that name in the loaded edition. Try a shorter prefix — the company name without its legal form ("Siemens", not "Siemens AG").');
			return lines.join('\n');
		}

		const rendered = candidates.slice(0, MAX_RENDERED_SECTION_ROWS);
		lines.push(
			data.truncated
				? `Showing ${rendered.length} of ${textOf(data.total)} matching entities — quote the TRUE total, and narrow the name if the one you want is not here.`
				: `${rendered.length} matching ${rendered.length === 1 ? 'entity' : 'entities'}.`,
			'',
		);
		lines.push(renderMarkdownTable(rendered, [
			{ header: 'psn_id', cell: candidate => textOf(candidate.psn_id) },
			{ header: 'Name', cell: candidate => textOf(candidate.name) },
			{ header: 'Applications', cell: candidate => textOf(candidate.applications), align: 'right' },
			{ header: 'Name variants', cell: candidate => textOf(candidate.person_variants), align: 'right' },
			{ header: 'Confidence', cell: candidate => confidenceTag(candidate.confidence) },
		]));
		lines.push('');
		lines.push('This is a PICK-ONE LIST, not an answer. Harmonized-name grouping is an INFERENCE, not a recorded fact — never merge entities. Pick ONE psn_id (ask the user when the choice is not obvious) and pass it to operation="applicant_view".');
		return lines.join('\n');
	}

	/** The full citation picture of one patent, section by section, each with its own truncation notice. */
	private formatPatentView(data: PatentViewResponse): string {
		const meta = data.meta;
		const anchor = data.anchor;
		const citations = data.citations;

		const lines: string[] = [
			'## PATSTAT Graph — patent view',
			'',
			`Anchor: \`${textOf(anchor?.node)}\` · Application: ${textOf(anchor?.application)}`,
			`Title: ${textOf(anchor?.title)}`,
			`Filed: ${filingYear(anchor?.filing_year)} · Granted: ${yesNo(anchor?.granted)} · DOCDB family: ${textOf(anchor?.docdb_family_id)} · Earliest publication: ${textOf(anchor?.earliest_publn_date)}`,
			`Publications: ${(anchor?.publications ?? []).map(publication => textOf(publication.publn)).join(', ') || '?'}`,
			'',
		];

		const personColumns = [
			{ header: 'Name', cell: (row: PersonRow) => textOf(row.name) },
			{ header: 'Country', cell: (row: PersonRow) => textOf(row.country) },
			{ header: 'Confidence', cell: (row: PersonRow) => confidenceTag(row.confidence) },
			{ header: 'Provenance', cell: (row: PersonRow) => textOf(row.at) },
		];

		lines.push(...renderSection('Applicants', data.header?.applicants, personColumns, undefined, 'applicants', 'applicants'));
		lines.push(...renderSection('Inventors', data.header?.inventors, personColumns, meta, 'persons', 'person rows (applicants + inventors share one cap)'));
		lines.push(...renderSection('CPC Classifications', data.header?.cpc, [
			{ header: 'CPC Symbol', cell: (row: CpcRow) => textOf(row.symbol) },
			{ header: 'Confidence', cell: (row: CpcRow) => confidenceTag(row.confidence) },
			{ header: 'Provenance', cell: (row: CpcRow) => textOf(row.at) },
		], meta, 'cpc', 'CPC classifications'));

		lines.push(...renderSection('Backward Citations — Patents (what this patent cites)', citations?.backward_patent, [
			{ header: 'Cited', cell: (row: BackwardPatentRow) => textOf(row.cited) },
			{ header: 'Title', cell: (row: BackwardPatentRow) => textOf(row.title) },
			{ header: 'Date', cell: (row: BackwardPatentRow) => textOf(row.date) },
			{ header: 'Origin', cell: (row: BackwardPatentRow) => textOf(row.origin) },
			{ header: 'Confidence', cell: (row: BackwardPatentRow) => confidenceTag(row.confidence) },
			{ header: 'Provenance', cell: (row: BackwardPatentRow) => textOf(row.at) },
		], meta, 'backward_patent', 'backward patent citations'));

		lines.push(...renderSection('Backward Citations — Non-Patent Literature', citations?.backward_npl, [
			{ header: 'Reference', cell: (row: BackwardNplRow) => textOf(row.biblio) },
			{ header: 'Origin', cell: (row: BackwardNplRow) => textOf(row.origin) },
			{ header: 'Confidence', cell: (row: BackwardNplRow) => confidenceTag(row.confidence) },
			{ header: 'Provenance', cell: (row: BackwardNplRow) => textOf(row.at) },
		], meta, 'backward_npl', 'backward NPL citations'));

		lines.push(...renderSection('Backward Citations — Unresolved (flagged, not dropped)', citations?.backward_unresolved, [
			{ header: 'Node', cell: (row: UnresolvedCitationRow) => textOf(row.node) },
			{ header: 'Origin', cell: (row: UnresolvedCitationRow) => textOf(row.origin) },
			{ header: 'Note', cell: (row: UnresolvedCitationRow) => textOf(row.note) },
			{ header: 'Confidence', cell: (row: UnresolvedCitationRow) => confidenceTag(row.confidence) },
			{ header: 'Provenance', cell: (row: UnresolvedCitationRow) => textOf(row.at) },
		], meta, 'backward_unresolved', 'unresolved backward citations'));

		lines.push(...renderSection('Forward Citations (who cites this patent)', citations?.forward, [
			{ header: 'Citing', cell: (row: ForwardCitationRow) => textOf(row.citing) },
			{ header: 'Title', cell: (row: ForwardCitationRow) => textOf(row.title) },
			{ header: 'Applicant', cell: (row: ForwardCitationRow) => textOf(row.applicant) },
			{ header: 'Date', cell: (row: ForwardCitationRow) => textOf(row.date) },
			{ header: 'Origin', cell: (row: ForwardCitationRow) => textOf(row.origin) },
			{ header: 'Examiner-cited', cell: (row: ForwardCitationRow) => yesNo(row.examiner_cited) },
			{ header: 'Citing family size', cell: (row: ForwardCitationRow) => textOf(row.citing_family_size), align: 'right' },
			{ header: 'Confidence', cell: (row: ForwardCitationRow) => confidenceTag(row.confidence) },
			{ header: 'Provenance', cell: (row: ForwardCitationRow) => textOf(row.at) },
		], meta, 'forward', 'forward citations'));

		lines.push(...renderSection('DOCDB Family', data.family, [
			{ header: 'Application', cell: (row: FamilyRow) => textOf(row.application) },
			{ header: 'Office', cell: (row: FamilyRow) => textOf(row.office) },
			{ header: 'Filed → Granted', cell: (row: FamilyRow) => `${filingYear(row.filing_year)} → ${row.first_grant_date ?? 'not yet granted'}` },
			{ header: 'Anchor?', cell: (row: FamilyRow) => yesNo(row.is_anchor) },
			{ header: 'Confidence', cell: (row: FamilyRow) => confidenceTag(row.confidence) },
			{ header: 'Provenance', cell: (row: FamilyRow) => textOf(row.at) },
		], meta, 'family', 'family members'));

		lines.push(...renderSection('Priority Claims', data.priorities, [
			{ header: 'Prior Application', cell: (row: PriorityRow) => textOf(row.prior_application) },
			{ header: 'Prior Filing Date', cell: (row: PriorityRow) => textOf(row.prior_filing_date) },
			{ header: 'Confidence', cell: (row: PriorityRow) => confidenceTag(row.confidence) },
			{ header: 'Provenance', cell: (row: PriorityRow) => textOf(row.at) },
		], meta, 'priorities', 'priority claims'));

		lines.push(...renderProvenanceFooter(meta));
		lines.push('Origin codes on citations: SEA = found by the examiner\'s search, APP = supplied by the applicant. Examiner-origin citations are the stronger signal of legal relevance. This is the WORLDWIDE DOCDB citation network — for USPTO office-action citations with X/Y/A relevance categories, use search_citations / search_forward_citations instead; neither is a superset of the other.');
		return lines.join('\n');
	}

	/** One harmonized applicant's network: entity card, filings by year, top CPC, jurisdictions, co-applicants. */
	private formatApplicantView(data: ApplicantViewResponse): string {
		const meta = data.meta;
		const entity = data.entity;

		const lines: string[] = [
			`## PATSTAT Graph — applicant view: ${textOf(entity?.name)}`,
			'',
			`Entity: \`${textOf(entity?.node)}\` (psn_id ${textOf(entity?.psn_id)})`,
			`Applications as applicant: ${textOf(entity?.applications)} · Recorded name variants: ${textOf(entity?.person_variants)}`,
			`Confidence: ${confidenceTag(entity?.confidence)} (at=${textOf(entity?.at)})`,
		];
		if (entity?.name_grouping?.note) {
			lines.push(`Name grouping: ${confidenceTag(entity.name_grouping.confidence)} — ${entity.name_grouping.note}`);
		}
		lines.push('');

		// filings_by_year is the full distribution (9999-sentinel rows are excluded and flagged in
		// meta.data_quality instead), so it carries no backend cap — never imply one, and never
		// trim it to the section default: the rows run oldest-first, so a 40-row cut would answer a
		// question about today's filing activity with the 1880s.
		lines.push(...renderSection('Filings by Year', data.filings_by_year, [
			{ header: 'Year', cell: row => textOf(row.year) },
			{ header: 'Applications', cell: row => textOf(row.applications), align: 'right' },
		], undefined, 'filings_by_year', 'filing years', MAX_RENDERED_YEAR_ROWS));

		lines.push(...renderSection('Top CPC', data.top_cpc, [
			{ header: 'CPC Symbol', cell: row => textOf(row.symbol) },
			{ header: 'Applications', cell: row => textOf(row.applications), align: 'right' },
		], meta, 'top_cpc', 'top CPC classes'));

		lines.push(...renderSection('Jurisdictions', data.jurisdictions, [
			{ header: 'Office', cell: row => textOf(row.office) },
			{ header: 'Applications', cell: row => textOf(row.applications), align: 'right' },
		], meta, 'jurisdictions', 'jurisdictions'));

		lines.push(...renderSection('Co-Applicants', data.co_applicants, [
			{ header: 'Name', cell: (row: CoApplicantRow) => textOf(row.name) },
			{ header: 'psn_id', cell: (row: CoApplicantRow) => textOf(row.psn_id) },
			{ header: 'Shared applications', cell: (row: CoApplicantRow) => textOf(row.shared_applications), align: 'right' },
			{ header: 'Confidence', cell: (row: CoApplicantRow) => confidenceTag(row.confidence) },
			{ header: 'Provenance', cell: (row: CoApplicantRow) => textOf(row.at) },
		], meta, 'co_applicants', 'co-applicants'));

		lines.push(...renderProvenanceFooter(meta));
		lines.push('ENTITY BOUNDARY: this view is ONE harmonized psn_id; patstat_portfolio groups by name-prefix alias instead. The two legitimately disagree about where one company ends and another begins — say which one a number came from, and never merge their figures.');
		return lines.join('\n');
	}

	/**
	 * Relay a graph failure with its typed code and VERBATIM message — the backend message already
	 * states the recovery action (resolve first, a fuller number form, the valid bound range), so
	 * rephrasing it would only lose the fix.
	 *
	 * `patstat_patent_ambiguous` additionally carries structured candidates. That 422 body can exceed
	 * the shared client's 500-character error-body cap, in which case the truncated prefix no longer
	 * parses as JSON — so the fallback names the recovery that always works: `operation="resolve"` on
	 * the same number returns the complete candidate list in a 200. Either way nothing is auto-picked.
	 */
	private formatGraphError(error: PatentBackendError): string {
		try {
			const parsed = JSON.parse(error.message) as GraphErrorEnvelope;
			const code = parsed?.error?.code;
			const message = parsed?.error?.message;
			if (code && message && TYPED_GRAPH_ERROR_CODES.includes(code)) {
				if (code === 'patstat_patent_ambiguous') {
					return this.formatAmbiguous(message, parsed.error?.candidates);
				}
				return `Error (${code}): ${message}${this.recoverySteer(code)}`;
			}
			if (message) {
				return `Error: PATSTAT graph returned ${error.status}: ${message}`;
			}
		} catch {
			// Not a parseable envelope (a transient status line, an HTML page, or a 422 candidate list
			// truncated by the client's 500-character body cap) — fall through to the raw relay below.
			if (error.status === 422) {
				return `Error (patstat_patent_ambiguous): that publication number matches several distinct applications, and the candidate list did not survive the response size limit. Re-call this tool with operation="resolve" and the same number — resolve returns the complete candidate list in a 200 response. Present those candidates to the user and let them pick; never choose one yourself. Backend detail: ${error.message}`;
			}
		}
		return `Error: PATSTAT graph returned ${error.status}: ${error.message}`;
	}

	/** The per-code steer appended after the backend's own (already actionable) message. */
	private recoverySteer(code: string): string {
		switch (code) {
			case 'patstat_invalid_request':
				return ' Fix the parameter exactly as the message states. If the input was a name or an ambiguous number, call operation="resolve" first and pass the resulting `pat:` node id or psn_id — the graph verbs refuse rather than guess.';
			case 'patstat_patent_not_found':
			case 'patstat_entity_not_found':
				return ' The loaded PATSTAT edition has no such node — a very recent publication may simply postdate the snapshot. Do not retry the same input; verify the number through the live document tools, or resolve a different form of it.';
			case 'patstat_unavailable':
				return ' Graph Analytics is not configured on this deployment. Report that plainly and do NOT retry-loop — individual documents are unaffected, so use the OPS/USPTO document tools instead.';
			default:
				return '';
		}
	}
}

/**
 * Map the tool inputs onto one `/patstat/graph/*` route, or return the model-facing error string that
 * short-circuits the call. Bounds (`depth` 1–2, `max_hops` 1–4, `token_budget` 100–20000) are
 * deliberately NOT re-checked here: the backend owns them, and relaying its typed
 * `patstat_invalid_request` keeps one source of truth instead of two that can drift.
 */
function buildRoute(input: IPatstatGraphParams): { path: string } | string {
	const text = (value: string | undefined): string => typeof value === 'string' ? value.trim() : '';

	switch (input.operation) {
		case 'resolve': {
			const query = text(input.query);
			return query
				? { path: `/patstat/graph/resolve?q=${encodeURIComponent(query)}` }
				: 'Error: Provide `query` — a publication number (EP3477840) or an applicant name (Siemens) to map onto a graph node.';
		}
		case 'patent_view': {
			const publication = text(input.publication);
			return publication
				? { path: `/patstat/graph/patent/${encodeURIComponent(publication)}` }
				: 'Error: Provide `publication` — the publication number whose citation picture you want (e.g. EP3477840).';
		}
		case 'applicant_view': {
			return Number.isInteger(input.psnId) && (input.psnId as number) > 0
				? { path: `/patstat/graph/applicant/${input.psnId}` }
				: 'Error: Provide `psnId` — a positive integer harmonized-entity id. It comes ONLY from operation="resolve" on the company name; a company name will not work here, and psn_ids must never be guessed.';
		}
		case 'neighborhood': {
			const node = text(input.node);
			if (!node) {
				return 'Error: Provide `node` — a `pat:<appln_id>` id (from operation="resolve") or a publication number.';
			}
			return { path: `/patstat/graph/neighborhood?${queryString([['node', node], ['depth', input.depth], ['edge_types', text(input.edgeTypes)], ['token_budget', input.tokenBudget]])}` };
		}
		case 'path': {
			const a = text(input.a);
			const b = text(input.b);
			if (!a || !b) {
				return 'Error: Provide both `a` and `b` — the two endpoints (each a `pat:<appln_id>` id or a publication number) whose connection you want.';
			}
			return { path: `/patstat/graph/path?${queryString([['a', a], ['b', b], ['max_hops', input.maxHops], ['token_budget', input.tokenBudget]])}` };
		}
		case 'explain': {
			const node = text(input.node);
			if (!node) {
				return 'Error: Provide `node` — a `pat:<appln_id>` id (from operation="resolve") or a publication number.';
			}
			return { path: `/patstat/graph/explain?${queryString([['node', node], ['token_budget', input.tokenBudget]])}` };
		}
		default:
			return 'Error: Provide `operation` — one of resolve, patent_view, applicant_view, neighborhood, path, explain.';
	}
}

/**
 * Query string from the parameters that are actually set. Unset parameters are omitted entirely
 * rather than sent as defaults, so the backend's documented defaults stay the single source of truth.
 */
function queryString(params: readonly [string, string | number | undefined][]): string {
	return params
		.filter((entry): entry is [string, string | number] => entry[1] !== undefined && entry[1] !== '')
		.map(([key, value]) => `${key}=${encodeURIComponent(String(value))}`)
		.join('&');
}

ToolRegistry.registerTool(PatstatGraphTool);
