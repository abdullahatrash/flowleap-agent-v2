/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createHash } from 'crypto';
import type * as vscode from 'vscode';
import { IVSCodeExtensionContext } from '../../../platform/extContext/common/extensionContext';
import { IFileSystemService } from '../../../platform/filesystem/common/fileSystemService';
import { createServiceIdentifier } from '../../../util/common/services';
import { generateUuid } from '../../../util/vs/base/common/uuid';
import { URI } from '../../../util/vs/base/common/uri';
import { parsePatentDocumentReference, PatentDocumentReference } from '../common/patentDocumentReference';

export interface PatentEvidenceSource {
	readonly anchor: string;
	/** Exact returned text for local recovery and quotation identity checks; absent in older records. */
	readonly text?: string;
	readonly reference: PatentDocumentReference;
	readonly language?: string;
	/**
	 * Set only on a figure source: the returned drawing page this source stands for. A drawing has
	 * no text, so such a source carries no `text` and is cited through its own {@link figureAnchor}.
	 * `file` is the workspace-relative posix path of the saved PNG, present only when the call passed
	 * `saveDir`; without it the page exists in the chat alone and a report can only name it.
	 */
	readonly figure?: { readonly page: number; readonly file?: string };
	/**
	 * `web` marks text read from a fetched patent page (Google Patents, Espacenet, a national office
	 * site), not the official full text the backend returns; absent means official text. The writer
	 * checks a quotation against web text exactly as against official text, labels the row, and
	 * prefers official text wherever both exist for the same publication and section (#750).
	 */
	readonly textSource?: 'web';
	/** The page a web source was read from; set only with {@link textSource}. */
	readonly url?: string;
	readonly retrieval: 'returned' | 'unsegmented';
	readonly review: 'unknown';
	readonly completeness: 'unknown';
}

/** The number-producing analytics tools whose outcomes the audit records. */
export type PatentAnalyticsTool = 'patstat_query' | 'patstat_portfolio' | 'patent_analytics_viz' | 'patstat_graph' | 'patent_api_request' | 'fetch_webpage' | 'run_in_terminal' | 'examiner_baseline';

/**
 * The legal-status tools whose outcomes the audit records. A memo states that a patent is in force,
 * lapsed on a date, or expires on another; without the returned text those dates are transcriptions
 * with nothing to check them against.
 */
export type PatentStatusTool = 'get_legal_status' | 'get_patent_family' | 'get_patent_term' | 'get_register_events';

/** Every retrieval tool identity a record may carry. */
export type PatentRecordedTool = PatentAnalyticsTool | PatentStatusTool;

/**
 * The writer, whose successful structured saves a `save` record marks. A save is not a retrieval:
 * it is outside {@link RECORDED_TOOLS}, which the report provenance audits, and exists so a Search
 * Round added in a later save can be checked against the position of the save before it.
 */
export type PatentSaveTool = 'write_patent_results';

/** The retrieval tool identities the reader accepts; anything else is a dropped field, not a new tool. */
export const RECORDED_TOOLS: readonly PatentRecordedTool[] = ['patstat_query', 'patstat_portfolio', 'patent_analytics_viz', 'patstat_graph', 'patent_api_request', 'fetch_webpage', 'run_in_terminal', 'examiner_baseline', 'get_legal_status', 'get_patent_family', 'get_patent_term', 'get_register_events'];

/** The kinds of outcome the ledger records; `save` is the writer's own mark, not a retrieval. */
const EXECUTION_KINDS: readonly PatentExecution['kind'][] = ['search', 'details', 'figures', 'analytics', 'status', 'save'];

/** Cap for a recorded request (SQL, a publication number, or the JSON of the request params). */
export const ANALYTICS_REQUEST_CAP = 2_000;

/**
 * Cap for the recorded result text a figure or quotation check searches. A file-wrapper document
 * or a fetched patent page runs to tens of thousands of characters, and a check that only sees
 * the first twenty thousand reports the figures and quotations past the cut as untraced.
 */
export const ANALYTICS_RESULT_CAP = 120_000;

/**
 * Cap for the feature a search says it tests. It is a label for a report column, not a passage, so
 * a few words is the whole of it and anything longer is a pasted paragraph.
 */
export const SEARCH_PURPOSE_CAP = 200;

export interface PatentExecution {
	readonly id: string;
	readonly recordedAt: string;
	/** `save`: a successful structured save of an invalidity chart; `request` is the report's workspace path. */
	readonly kind: 'search' | 'details' | 'figures' | 'analytics' | 'status' | 'save';
	readonly status: 'succeeded' | 'failed' | 'cancelled';
	readonly query?: string;
	readonly requestedRange?: string;
	readonly requestedCountries?: string;
	/** `search` only — the unresolved feature or coverage gap the model said the query tests. */
	readonly purpose?: string;
	readonly effectiveQuery?: string;
	readonly countryFilter?: readonly string[];
	readonly total?: number;
	readonly returned?: number;
	readonly totalClaims?: number;
	readonly returnedClaims?: number;
	readonly range?: { begin: number; end: number };
	readonly publicationTitle?: string;
	readonly publicationDate?: string;
	readonly publicationIds?: readonly string[];
	readonly sources?: readonly PatentEvidenceSource[];
	readonly unavailableSections?: readonly string[];
	/** `analytics` and `status` only: which tool produced the outcome; `save` only: the writer. */
	readonly tool?: PatentRecordedTool | PatentSaveTool;
	/** `analytics` and `status` only: the SQL, the publication number, or the JSON of the request params, capped at {@link ANALYTICS_REQUEST_CAP}; `save` only: the report's workspace-relative path. */
	readonly request?: string;
	/** `save` only: how many Search Rounds the saved chart recorded. */
	readonly rounds?: number;
	/** `save` only: the ids of the open points the saved chart's receipt listed, so the next save's Search Round can be checked against them (PRD 0024 C4). */
	readonly openPoints?: readonly string[];
	/** `analytics` and `status` only: the backend's own row count, or the number of events or family members returned. */
	readonly rowCount?: number;
	/** `analytics` only: the PATSTAT edition or corpus label the numbers belong to. */
	readonly dataEdition?: string;
	/** `analytics` and `status` only: the exact text returned to the model, capped at {@link ANALYTICS_RESULT_CAP}; a figure or date check searches this. */
	readonly resultText?: string;
	/** `analytics` only: the tool's own quotable summary line, when it has one. */
	readonly summary?: string;
}

export interface PatentExecutionSnapshot {
	readonly executions: readonly PatentExecution[];
	readonly limitation: string;
}

export const IPatentExecutionLedger = createServiceIdentifier<IPatentExecutionLedger>('IPatentExecutionLedger');
export interface IPatentExecutionLedger {
	readonly _serviceBrand: undefined;
	record(session: vscode.Uri | undefined, execution: Omit<PatentExecution, 'id' | 'recordedAt'>): Promise<string>;
	read(session: vscode.Uri | undefined): Promise<PatentExecutionSnapshot>;
}

const LIMITATION = 'Audit covers recorded search_patents, get_patent_details, get_patent_figures, analytics (patstat_query, patstat_portfolio, patent_analytics_viz, patstat_graph, patent_api_request, fetch_webpage, run_in_terminal, examiner_baseline) and legal-status (get_legal_status, get_patent_family, get_patent_term, get_register_events) outcomes in this session only. Earlier versions, other tools, uninvoked or skipped plans, and interrupted calls may be absent. Retrieval is not evidence that passages were read; review status is unknown. Missing totals and source metadata remain unknown.';

/** Durable, append-only outcome records owned by the patent workflow. Separate files avoid lost concurrent writes. */
export class PatentExecutionLedger implements IPatentExecutionLedger {
	declare readonly _serviceBrand: undefined;
	constructor(
		@IVSCodeExtensionContext private readonly context: vscode.ExtensionContext,
		@IFileSystemService private readonly fileSystem: IFileSystemService,
	) { }

	private directory(session: vscode.Uri | undefined): URI | undefined {
		if (!session || !this.context.storageUri) {
			return undefined;
		}
		const key = createHash('sha256').update(session.toString()).digest('hex');
		return URI.joinPath(this.context.storageUri, 'patent-execution-ledger', key);
	}

	async record(session: vscode.Uri | undefined, execution: Omit<PatentExecution, 'id' | 'recordedAt'>): Promise<string> {
		const directory = this.directory(session);
		if (!directory) {
			return 'Execution audit unavailable: no session or workspace storage.';
		}
		const id = generateUuid();
		try {
			await this.fileSystem.createDirectory(directory);
			const temporary = URI.joinPath(directory, id + '.pending');
			await this.fileSystem.writeFile(temporary, new TextEncoder().encode(JSON.stringify({ ...capRecordedText(execution), id, recordedAt: new Date().toISOString() })));
			await this.fileSystem.rename(temporary, URI.joinPath(directory, id + '.json'));
			return `Execution audit recorded: ${id}. Retrieval does not establish passage review.`;
		} catch {
			return 'Execution audit could not be persisted. This outcome is not included in the generated audit; disclose the gap.';
		}
	}

	async read(session: vscode.Uri | undefined): Promise<PatentExecutionSnapshot> {
		const directory = this.directory(session);
		if (!directory) {
			return { executions: [], limitation: 'Execution audit unavailable: no session or workspace storage. ' + LIMITATION };
		}
		try {
			const files = await this.fileSystem.readDirectory(directory);
			const executions: PatentExecution[] = [];
			let unreadable = false;
			let partial = false;
			for (const [name] of files) {
				if (!name.endsWith('.json')) { unreadable = true; continue; }
				try {
					const value: unknown = JSON.parse(new TextDecoder().decode(await this.fileSystem.readFile(URI.joinPath(directory, name))));
					const recovered = readPatentExecution(value);
					if (!recovered) { throw new Error('Invalid record'); }
					if (recovered.dropped) { partial = true; }
					executions.push(recovered.execution);
				} catch { unreadable = true; }
			}
			executions.sort((a, b) => a.recordedAt.localeCompare(b.recordedAt) || a.id.localeCompare(b.id));
			const disclosure = (unreadable ? 'Some audit records are unreadable or incomplete. ' : '')
				+ (partial ? 'Some audit records were recovered with unreadable fields dropped; those fields are unknown, not zero. ' : '');
			return { executions, limitation: disclosure + LIMITATION };
		} catch {
			return { executions: [], limitation: 'No readable execution audit is available. ' + LIMITATION };
		}
	}
}

/**
 * Bound the free-text fields before they reach storage, so one oversized SQL, result or stated
 * purpose cannot make a session's audit unreadable. A cut is announced in the stored text: a figure
 * check that finds no number must be able to tell "not produced" from "beyond the recorded cut".
 */
function capRecordedText(execution: Omit<PatentExecution, 'id' | 'recordedAt'>): Omit<PatentExecution, 'id' | 'recordedAt'> {
	const request = capRecordedField(execution.request, ANALYTICS_REQUEST_CAP);
	const resultText = capRecordedField(execution.resultText, ANALYTICS_RESULT_CAP);
	const purpose = capRecordedField(execution.purpose, SEARCH_PURPOSE_CAP);
	if (request === execution.request && resultText === execution.resultText && purpose === execution.purpose) {
		return execution;
	}
	return { ...execution, request, resultText, purpose };
}

/** Cut a stored text at `limit` and say so in the text, so a check past the cut can tell "absent" from "beyond the cut". */
export function capRecordedField(value: string | undefined, limit: number): string | undefined {
	return value !== undefined && value.length > limit ? value.substring(0, limit) + '\n… [truncated for the audit record]' : value;
}

/**
 * Anchor to recorded source, the single index every pass over recorded sources shares. Official
 * text wins: a web source never replaces a source with official text at the same anchor, and an
 * official source always replaces a web one, so the chart quotes the backend's text wherever it
 * holds any; otherwise the latest record wins, as it always did.
 */
export function evidenceSourceIndex(sources: Iterable<PatentEvidenceSource>): Map<string, PatentEvidenceSource> {
	const index = new Map<string, PatentEvidenceSource>();
	for (const source of sources) {
		const known = index.get(source.anchor);
		if (known && source.textSource === 'web' && known.textSource !== 'web' && known.text !== undefined) { continue; }
		index.set(source.anchor, source);
	}
	return index;
}

/** The host of a web source's page, for the label a web row carries; a URL that does not parse is just `web`. */
export function webPageHost(url: string | undefined): string {
	try {
		return new URL(url ?? '').hostname.toLowerCase() || 'web';
	} catch {
		return 'web';
	}
}

/** Stable section/claim identity; never infer a claim or paragraph number from prose. */
export function evidenceAnchor(reference: PatentDocumentReference, language?: string): string {
	return [reference.publicationNumber, reference.section, reference.claimNumber, language].filter(Boolean).join(':');
}

/**
 * Stable identity of one returned drawing page. A figure carries no text and no language, so it
 * gets its own anchor shape rather than a section anchor that would promise a quotable passage.
 */
export function figureAnchor(publicationNumber: string, page: number): string {
	return `${publicationNumber}:figure:${page}`;
}

/**
 * A recovered record together with whether any stored field was unusable, so the reader can
 * disclose partial recovery without discarding the outcome.
 */
interface RecoveredExecution {
	readonly execution: PatentExecution;
	readonly dropped: boolean;
}

/**
 * A source whose anchor does not match its own reference cannot be cited, so it is dropped on its
 * own rather than taking the surrounding outcome with it.
 */
function readEvidenceSource(value: unknown): PatentEvidenceSource | undefined {
	if (!value || typeof value !== 'object') { return undefined; }
	const source = value as { anchor?: unknown; text?: unknown; reference?: unknown; language?: unknown; figure?: unknown; textSource?: unknown; url?: unknown; retrieval?: unknown; review?: unknown; completeness?: unknown };
	const reference = parsePatentDocumentReference(source.reference);
	const text = typeof source.text === 'string' ? source.text : undefined;
	const language = typeof source.language === 'string' ? source.language : undefined;
	const figure = readFigurePage(source.figure);
	const url = typeof source.url === 'string' && source.url.trim() ? source.url : undefined;
	if (!reference || (source.text !== undefined && text === undefined) || (source.language !== undefined && language === undefined) || (source.figure !== undefined && source.figure !== null && !figure)) { return undefined; }
	// A web source is one that says so and names its page; any other text-source value is not a source.
	if (source.textSource !== undefined && source.textSource !== null && (source.textSource !== 'web' || !url)) { return undefined; }
	const anchor = figure ? figureAnchor(reference.publicationNumber, figure.page) : evidenceAnchor(reference, language);
	if (source.anchor !== anchor || source.review !== 'unknown' || source.completeness !== 'unknown') { return undefined; }
	if (source.retrieval !== 'returned' && source.retrieval !== 'unsegmented') { return undefined; }
	return { anchor, text, reference, language, figure, ...(source.textSource === 'web' ? { textSource: 'web' as const, url } : {}), retrieval: source.retrieval, review: 'unknown', completeness: 'unknown' };
}

/**
 * The drawing page a figure source stands for; anything but a positive whole page is not a page. A
 * saved file is recovered beside it when the record holds one, so a report written in a later
 * session can still link the PNG the page was saved to.
 */
function readFigurePage(value: unknown): { readonly page: number; readonly file?: string } | undefined {
	if (!value || typeof value !== 'object') { return undefined; }
	const { page, file } = value as { page?: unknown; file?: unknown };
	if (typeof page !== 'number' || !Number.isInteger(page) || page < 1) { return undefined; }
	return typeof file === 'string' && file.trim() ? { page, file } : { page };
}

/**
 * Storage is untrusted across upgrades or interrupted writes. Recover each field on its own: one
 * unusable value must not discard an outcome the audit would otherwise report, and a dropped value
 * stays unknown rather than being coerced into a number or an identity. Only `kind` and `status`
 * are required, because they carry the outcome itself.
 */
function readPatentExecution(value: unknown): RecoveredExecution | undefined {
	if (!value || typeof value !== 'object') { return undefined; }
	const record = value as Record<string, unknown>;
	const kind = EXECUTION_KINDS.find(known => known === record.kind);
	if (!kind || typeof record.status !== 'string' || !['succeeded', 'failed', 'cancelled'].includes(record.status)) { return undefined; }
	let dropped = false;
	// `null` is an absent value from JSON, not a corrupt one, so it never counts as a dropped field.
	const absent = (raw: unknown) => raw === undefined || raw === null;
	const text = (raw: unknown): string | undefined => {
		if (absent(raw)) { return undefined; }
		if (typeof raw !== 'string') { dropped = true; return undefined; }
		return raw;
	};
	const count = (raw: unknown): number | undefined => {
		if (absent(raw)) { return undefined; }
		if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) { dropped = true; return undefined; }
		return raw;
	};
	const list = (raw: unknown): readonly string[] | undefined => {
		if (absent(raw)) { return undefined; }
		if (!Array.isArray(raw)) { dropped = true; return undefined; }
		// `Array.isArray` narrows an unknown to `any[]`; restate the element type instead of using it.
		const items = (raw as readonly unknown[]).filter((item): item is string => typeof item === 'string');
		if (items.length !== raw.length) { dropped = true; }
		return items;
	};
	const span = (raw: unknown): { begin: number; end: number } | undefined => {
		if (absent(raw)) { return undefined; }
		const value = raw as { begin?: unknown; end?: unknown };
		if (typeof raw !== 'object' || typeof value.begin !== 'number' || typeof value.end !== 'number' || !Number.isFinite(value.begin) || !Number.isFinite(value.end)) { dropped = true; return undefined; }
		return { begin: value.begin, end: value.end };
	};
	const evidence = (raw: unknown): readonly PatentEvidenceSource[] | undefined => {
		if (absent(raw)) { return undefined; }
		if (!Array.isArray(raw)) { dropped = true; return undefined; }
		const items = (raw as readonly unknown[]).map(readEvidenceSource).filter((source): source is PatentEvidenceSource => !!source);
		if (items.length !== raw.length) { dropped = true; }
		return items;
	};
	// A save record names the writer; every other record names a retrieval tool.
	const recordedTool = (raw: unknown): PatentRecordedTool | PatentSaveTool | undefined => {
		if (absent(raw)) { return undefined; }
		if (kind === 'save') {
			if (raw === 'write_patent_results') { return raw; }
			dropped = true;
			return undefined;
		}
		const named = RECORDED_TOOLS.find(tool => tool === raw);
		if (!named) { dropped = true; return undefined; }
		return named;
	};
	const execution: PatentExecution = {
		id: text(record.id) ?? '',
		recordedAt: text(record.recordedAt) ?? '',
		kind,
		status: record.status === 'failed' ? 'failed' : record.status === 'cancelled' ? 'cancelled' : 'succeeded',
		query: text(record.query),
		requestedRange: text(record.requestedRange),
		requestedCountries: text(record.requestedCountries),
		purpose: text(record.purpose),
		effectiveQuery: text(record.effectiveQuery),
		countryFilter: list(record.countryFilter),
		total: count(record.total),
		returned: count(record.returned),
		totalClaims: count(record.totalClaims),
		returnedClaims: count(record.returnedClaims),
		range: span(record.range),
		publicationTitle: text(record.publicationTitle),
		publicationDate: text(record.publicationDate),
		publicationIds: list(record.publicationIds),
		sources: evidence(record.sources),
		unavailableSections: list(record.unavailableSections),
		tool: recordedTool(record.tool),
		request: text(record.request),
		rowCount: count(record.rowCount),
		rounds: count(record.rounds),
		openPoints: list(record.openPoints),
		dataEdition: text(record.dataEdition),
		resultText: text(record.resultText),
		summary: text(record.summary),
	};
	return { execution, dropped };
}
