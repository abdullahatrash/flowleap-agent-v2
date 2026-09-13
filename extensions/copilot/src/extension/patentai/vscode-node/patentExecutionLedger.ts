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
	readonly retrieval: 'returned' | 'unsegmented';
	readonly review: 'unknown';
	readonly completeness: 'unknown';
}

/** The number-producing analytics tools whose outcomes the audit records. */
export type PatentAnalyticsTool = 'patstat_query' | 'patstat_portfolio' | 'patent_analytics_viz' | 'patstat_graph' | 'patent_api_request';

/** Cap for a recorded request (SQL or the JSON of the request params). */
export const ANALYTICS_REQUEST_CAP = 2_000;

/** Cap for the recorded result text a figure check searches. */
export const ANALYTICS_RESULT_CAP = 20_000;

export interface PatentExecution {
	readonly id: string;
	readonly recordedAt: string;
	readonly kind: 'search' | 'details' | 'analytics';
	readonly status: 'succeeded' | 'failed' | 'cancelled';
	readonly query?: string;
	readonly requestedRange?: string;
	readonly requestedCountries?: string;
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
	/** `analytics` only: which analytics tool produced the outcome. */
	readonly tool?: PatentAnalyticsTool;
	/** `analytics` only: the SQL, or the JSON of the request params, capped at {@link ANALYTICS_REQUEST_CAP}. */
	readonly request?: string;
	/** `analytics` only: the backend's own row count, when it reported one. */
	readonly rowCount?: number;
	/** `analytics` only: the PATSTAT edition or corpus label the numbers belong to. */
	readonly dataEdition?: string;
	/** `analytics` only: the exact text returned to the model, capped at {@link ANALYTICS_RESULT_CAP}; a figure check searches this. */
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

const LIMITATION = 'Audit covers recorded search_patents, get_patent_details and analytics (patstat_query, patstat_portfolio, patent_analytics_viz, patstat_graph, patent_api_request) outcomes in this session only. Earlier versions, other tools, uninvoked or skipped plans, and interrupted calls may be absent. Retrieval is not evidence that passages were read; review status is unknown. Missing totals and source metadata remain unknown.';

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
			await this.fileSystem.writeFile(temporary, new TextEncoder().encode(JSON.stringify({ ...capAnalyticsText(execution), id, recordedAt: new Date().toISOString() })));
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
 * Bound the two free-text analytics fields before they reach storage, so one oversized SQL or
 * result cannot make a session's audit unreadable. A cut is announced in the stored text: a figure
 * check that finds no number must be able to tell "not produced" from "beyond the recorded cut".
 */
function capAnalyticsText(execution: Omit<PatentExecution, 'id' | 'recordedAt'>): Omit<PatentExecution, 'id' | 'recordedAt'> {
	const cap = (value: string | undefined, limit: number): string | undefined =>
		value !== undefined && value.length > limit ? value.substring(0, limit) + '\n… [truncated for the audit record]' : value;
	const request = cap(execution.request, ANALYTICS_REQUEST_CAP);
	const resultText = cap(execution.resultText, ANALYTICS_RESULT_CAP);
	if (request === execution.request && resultText === execution.resultText) {
		return execution;
	}
	return { ...execution, request, resultText };
}

/** Stable section/claim identity; never infer a claim or paragraph number from prose. */
export function evidenceAnchor(reference: PatentDocumentReference, language?: string): string {
	return [reference.publicationNumber, reference.section, reference.claimNumber, language].filter(Boolean).join(':');
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
	const source = value as { anchor?: unknown; text?: unknown; reference?: unknown; language?: unknown; retrieval?: unknown; review?: unknown; completeness?: unknown };
	const reference = parsePatentDocumentReference(source.reference);
	const text = typeof source.text === 'string' ? source.text : undefined;
	const language = typeof source.language === 'string' ? source.language : undefined;
	if (!reference || (source.text !== undefined && text === undefined) || (source.language !== undefined && language === undefined)) { return undefined; }
	if (source.anchor !== evidenceAnchor(reference, language) || source.review !== 'unknown' || source.completeness !== 'unknown') { return undefined; }
	if (source.retrieval !== 'returned' && source.retrieval !== 'unsegmented') { return undefined; }
	return { anchor: evidenceAnchor(reference, language), text, reference, language, retrieval: source.retrieval, review: 'unknown', completeness: 'unknown' };
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
	if (typeof record.kind !== 'string' || !['search', 'details', 'analytics'].includes(record.kind) || typeof record.status !== 'string' || !['succeeded', 'failed', 'cancelled'].includes(record.status)) { return undefined; }
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
	const analyticsTool = (raw: unknown): PatentAnalyticsTool | undefined => {
		if (absent(raw)) { return undefined; }
		if (raw !== 'patstat_query' && raw !== 'patstat_portfolio' && raw !== 'patent_analytics_viz' && raw !== 'patstat_graph' && raw !== 'patent_api_request') { dropped = true; return undefined; }
		return raw;
	};
	const execution: PatentExecution = {
		id: text(record.id) ?? '',
		recordedAt: text(record.recordedAt) ?? '',
		kind: record.kind === 'details' ? 'details' : record.kind === 'analytics' ? 'analytics' : 'search',
		status: record.status === 'failed' ? 'failed' : record.status === 'cancelled' ? 'cancelled' : 'succeeded',
		query: text(record.query),
		requestedRange: text(record.requestedRange),
		requestedCountries: text(record.requestedCountries),
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
		tool: analyticsTool(record.tool),
		request: text(record.request),
		rowCount: count(record.rowCount),
		dataEdition: text(record.dataEdition),
		resultText: text(record.resultText),
		summary: text(record.summary),
	};
	return { execution, dropped };
}
