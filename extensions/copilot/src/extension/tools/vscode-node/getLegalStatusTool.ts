/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import type * as vscode from 'vscode';
import { ILogService } from '../../../platform/log/common/logService';
import { CancellationToken } from '../../../util/vs/base/common/cancellation';
import { LanguageModelTextPart, LanguageModelToolResult } from '../../../vscodeTypes';
import { IPatentBackendClient } from '../../patentai/vscode-node/patentBackendClient';
import { IPatentExecutionLedger } from '../../patentai/vscode-node/patentExecutionLedger';
import { ToolName } from '../common/toolNames';
import { ICopilotTool, ToolRegistry } from '../common/toolsRegistry';
import { callFacadeTool } from './patentFacade';
import { handlePatentToolError } from './patentToolError';
import { IMarkdownColumn, renderMarkdownTable } from './patentResponseFormatter';

interface IGetLegalStatusParams {
	publicationNumber: string;
}

/**
 * One INPADOC legal-status event, as returned by the `/tools/get_legal_status` facade `data` payload.
 *
 * `country` is the office that published the event and is `EP` for every post-grant event of an EP
 * patent, which is why it cannot answer "is this patent live in Germany". The optional fields are
 * add-only: a newer backend attaches the contracting `state` the post-grant event belongs to and the
 * dates/fee facts around it, an older one sends none of them.
 */
interface LegalStatusEvent {
	code: string;
	date: string;
	country: string | null;
	text: string | null;
	gazette?: { number: string | null; date: string | null };
	/** Contracting state an EP post-grant event applies to (e.g. `DE`, `FR`, `GB`). */
	state?: string;
	/** Date the national office says the event took effect (`YYYY-MM-DD`), which is not the gazette date. */
	effectiveDate?: string;
	/** Longer free-text detail attached to the event by the national office. */
	detail?: string;
	/** Date a renewal fee was paid (`YYYY-MM-DD`). */
	paymentDate?: string;
	/** Renewal-fee year a fee-payment event covers. */
	feeYear?: number;
	/** EPC states an `AK` event designates (OPS `L507EP`). */
	designatedStates?: string[];
	/** Extension/validation states an `AX` event requests (OPS `L524EP`). */
	extensionStates?: string[];
}

/**
 * The `get_legal_status` `data` payload.
 *
 * `designatedStates`/`extensionStates` are the roll-up of the `AK`/`AX` event with the latest
 * date. For an EP regional filing they ARE its designated-state coverage, and no other read
 * carries them — the patent family names the offices the invention published in, never the EPC
 * states an EP application designates. Both are add-only: a newer backend sends them, an older
 * one sends neither, which is why they are optional here and render nothing when absent.
 */
interface LegalStatusData {
	docId: string;
	events: LegalStatusEvent[];
	designatedStates?: string[];
	extensionStates?: string[];
}

/** Render a gazette reference (`number (date)`) for a table cell, or `—` when absent. */
function gazetteLabel(gazette: LegalStatusEvent['gazette']): string {
	if (!gazette || (!gazette.number && !gazette.date)) {
		return '—';
	}
	if (gazette.number && gazette.date) {
		return `${gazette.number} (${gazette.date})`;
	}
	return gazette.number || gazette.date || '—';
}

/** INPADOC code for a post-grant lapse recorded in one EP contracting state. */
const CONTRACTING_STATE_LAPSE_CODE = 'PG25';

/** INPADOC code for a post-grant renewal-fee payment recorded in one EP contracting state. */
const CONTRACTING_STATE_FEE_CODE = 'PGFP';

/**
 * Renders the `Event` cell: the INPADOC event text followed by the post-grant facts a newer backend
 * attaches to it (a longer detail line, the renewal-fee year, the payment date). An older backend
 * sends none of them, so the cell stays exactly the event text.
 */
function eventLabel(event: LegalStatusEvent): string {
	const parts: string[] = [event.text || '—'];
	if (event.detail && event.detail !== event.text) {
		parts.push(event.detail);
	}
	if (typeof event.feeYear === 'number') {
		parts.push(`fee year ${event.feeYear}`);
	}
	if (event.paymentDate) {
		parts.push(`paid ${event.paymentDate}`);
	}
	// An AK/AX row used to read "DESIGNATED CONTRACTING STATES" with the list gone. The codes
	// themselves would make the cell unreadable at 38 states, so the row carries the count and
	// the block above carries the list.
	if (event.designatedStates?.length) {
		parts.push(`${event.designatedStates.length} designated states`);
	}
	if (event.extensionStates?.length) {
		parts.push(`${event.extensionStates.length} extension states`);
	}
	return parts.join(' — ');
}

/**
 * Sort key deciding which event in a state is the most recent. The effective date is when the national
 * office says the change took effect; the gazette record date is the fallback when the feed carries no
 * effective date. ISO dates sort lexicographically, so plain string comparison is correct here.
 */
function eventRecency(event: LegalStatusEvent): string {
	return event.effectiveDate || event.date || event.gazette?.date || '';
}

/**
 * Reads one event as a per-state conclusion. A post-grant lapse (`PG25`, or a national cessation code
 * such as `GBPC`) means the right is gone in that state; a `PGFP` renewal-fee payment means it was kept
 * alive for the named fee year. Any other code is not a status statement, so it reads `unknown` rather
 * than being guessed at.
 */
function perStateReading(event: LegalStatusEvent): string {
	const code = (event.code || '').toUpperCase();
	if (code === CONTRACTING_STATE_LAPSE_CODE || code.endsWith('PC')) {
		return 'lapsed';
	}
	if (code === CONTRACTING_STATE_FEE_CODE) {
		return typeof event.feeYear === 'number' ? `fee paid (year ${event.feeYear})` : 'fee paid';
	}
	return 'unknown';
}

/**
 * Picks the most recent event per contracting state. Events carrying no `state` — everything an older
 * backend returns — are ignored, so an old payload yields no per-state summary at all.
 */
function latestEventPerState(events: readonly LegalStatusEvent[]): Map<string, LegalStatusEvent> {
	const latest = new Map<string, LegalStatusEvent>();
	for (const event of events) {
		const state = event.state;
		if (!state) {
			continue;
		}
		const current = latest.get(state);
		if (!current || eventRecency(event) > eventRecency(current)) {
			latest.set(state, event);
		}
	}
	return latest;
}

/**
 * Renders the designated-state block: the EPC states the filing designates and the
 * extension/validation states it requested, as the backend rolls them up from the `AK`/`AX` event
 * with the latest date.
 *
 * This answers "which countries does this cover", which no other tool can: `get_patent_family`
 * names the offices the invention published in — one `EP` entry for a European regional filing —
 * never the states that filing designates. Designation is not the same as being in force, so the
 * block says to read the per-state summary below for what survives.
 *
 * Returns no lines when the payload carries neither list, which keeps an older backend's response
 * byte-identical to what it rendered before.
 */
function renderDesignatedStates(data: LegalStatusData): string[] {
	const designated = data.designatedStates ?? [];
	const extension = data.extensionStates ?? [];
	if (designated.length === 0 && extension.length === 0) {
		return [];
	}

	const lines = ['## Designated states', ''];
	if (designated.length > 0) {
		lines.push(`**Designated contracting states (${designated.length}):** ${designated.join(', ')}`);
		lines.push('');
	}
	if (extension.length > 0) {
		lines.push(`**Extension/validation states (${extension.length}):** ${extension.join(', ')}`);
		lines.push('');
	}
	lines.push('These are the states the filing DESIGNATES, not the states it is still in force in — subtract whatever the per-state summary below reads as lapsed. The set is rolled up from the AK/AX event with the latest date; if that event carried no readable list an older one answers, so check the AK rows in the event table when the answer must be exact.');
	lines.push('');
	return lines;
}

/**
 * Renders the per-state summary block shown above the event list: the latest post-grant event per EP
 * contracting state, with the status it reads as. Returns no lines when no event carries a state, which
 * keeps an older backend's response byte-identical to what it rendered before. States are ordered
 * alphabetically — the tool takes no state-of-interest parameter to order by.
 */
function renderPerStateSummary(events: readonly LegalStatusEvent[]): string[] {
	const latest = latestEventPerState(events);
	if (latest.size === 0) {
		return [];
	}
	const rows = [...latest.entries()]
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([state, event]) => ({ state, event }));
	return [
		'## Per-state summary',
		'',
		renderMarkdownTable(rows, [
			{ header: 'State', cell: r => r.state },
			{ header: 'Latest event', cell: r => r.event.date ? `${r.event.code || '—'} (${r.event.date})` : (r.event.code || '—') },
			{ header: 'Effective', cell: r => r.event.effectiveDate || '—' },
			{ header: 'Reading', cell: r => perStateReading(r.event) },
		]),
		'',
		'Per-state reading is derived from the latest recorded event per state; a state with no event listed has no post-grant event in this feed, which is not evidence it was validated there.',
		'',
	];
}

/**
 * Tool for retrieving a patent's INPADOC legal-status events (grants, lapses, oppositions, renewal
 * fees) per jurisdiction from EPO OPS, through the FlowLeap agent-first `/tools/get_legal_status`
 * facade. Routes through the shared {@link IPatentBackendClient} seam (via {@link callFacadeTool}), so
 * it inherits the centralized `401 → re-sign-in` / `402 → start-trial` / `429 → wait` gating. This is
 * the typed replacement for the raw `ops_api_guide` legal endpoints in FTO / portfolio workflows.
 */
export class GetLegalStatusTool implements ICopilotTool<IGetLegalStatusParams> {

	public static readonly toolName = ToolName.GetLegalStatus;

	constructor(
		@ILogService private readonly logService: ILogService,
		@IPatentBackendClient private readonly patentBackendClient: IPatentBackendClient,
		@IPatentExecutionLedger private readonly ledger: IPatentExecutionLedger,
	) { }

	prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<IGetLegalStatusParams>, _token: CancellationToken): vscode.ProviderResult<vscode.PreparedToolInvocation> {
		const { publicationNumber } = options.input;
		return {
			invocationMessage: l10n.t`Fetching legal status for ${publicationNumber}...`,
		};
	}

	/**
	 * Normalize a publication number to the OPS epodoc format (US10000000B2). User input and search
	 * results may carry hyphens, dots, or spaces (US-10000000-B2); epodoc wants them stripped. Kind-code
	 * edge cases are handled server-side.
	 */
	private normalizePublicationNumber(pubNum: string): string {
		return pubNum.replace(/[-.\s/]/g, '').toUpperCase();
	}

	async invoke(options: vscode.LanguageModelToolInvocationOptions<IGetLegalStatusParams>, token: CancellationToken): Promise<vscode.LanguageModelToolResult> {
		this.logService.trace('[GetLegalStatusTool] Invoking legal-status fetch');

		const { publicationNumber } = options.input;
		const doc = this.normalizePublicationNumber(publicationNumber);
		this.logService.info(`[GetLegalStatusTool] Normalized: ${publicationNumber} -> ${doc}`);

		try {
			const data = await callFacadeTool<LegalStatusData>(this.patentBackendClient, 'get_legal_status', { patent_number: doc }, token);
			const formatted = this.formatLegalStatus(data, doc);
			this.logService.info(`[GetLegalStatusTool] Formatted response length: ${formatted.length} chars`);
			// A memo that calls a patent in force or lapsed on a date states what this text said; the
			// record is what lets that sentence be checked. Recorded for the audit only — the answer
			// the model reads is unchanged by the outcome of the write.
			await this.ledger.record(options.chatSessionResource, {
				kind: 'status', status: 'succeeded', tool: 'get_legal_status', request: doc,
				rowCount: data.events?.length, publicationIds: [doc], resultText: formatted,
			});
			return new LanguageModelToolResult([new LanguageModelTextPart(formatted)]);
		} catch (error) {
			await this.ledger.record(options.chatSessionResource, { kind: 'status', status: token.isCancellationRequested ? 'cancelled' : 'failed', tool: 'get_legal_status', request: doc });
			return handlePatentToolError(error, this.logService, '[GetLegalStatusTool]', err => `Error fetching legal status for ${publicationNumber}: ${err.status} - ${err.message}`);
		}
	}

	/**
	 * Columns for the event list. The `State` and `Effective` columns only appear when the payload
	 * actually carries those facts, so an older backend's response renders exactly as it did before.
	 */
	private eventColumns(events: readonly LegalStatusEvent[]): IMarkdownColumn<LegalStatusEvent>[] {
		const columns: IMarkdownColumn<LegalStatusEvent>[] = [
			{ header: 'Date', cell: e => e.date || '—' },
			{ header: 'Country', cell: e => e.country || '—' },
		];
		if (events.some(e => !!e.state)) {
			columns.push({ header: 'State', cell: e => e.state || '—' });
		}
		columns.push({ header: 'Code', cell: e => e.code || '—' });
		columns.push({ header: 'Event', cell: e => eventLabel(e) });
		if (events.some(e => !!e.effectiveDate)) {
			columns.push({ header: 'Effective', cell: e => e.effectiveDate || '—' });
		}
		columns.push({ header: 'Gazette', cell: e => gazetteLabel(e.gazette) });
		return columns;
	}

	private formatLegalStatus(data: LegalStatusData, doc: string): string {
		const events = data.events ?? [];
		const lines: string[] = [
			`# Legal Status: ${data.docId || doc}`,
			'',
		];

		if (events.length === 0) {
			lines.push('No INPADOC legal-status events found for this publication number.');
			lines.push('');
			lines.push('EPO OPS may not hold legal-status data for this document. Verify the number with get_patent_details, or for EP prosecution history try get_register_events.');
			return lines.join('\n');
		}

		lines.push(`${events.length} legal-status event(s) from EPO OPS (INPADOC), newest first.`);
		lines.push('');
		// Designation first, then what survives of it: a state can only lapse if it was designated.
		lines.push(...renderDesignatedStates(data));
		lines.push(...renderPerStateSummary(events));
		lines.push(renderMarkdownTable(events, this.eventColumns(events)));
		lines.push('');
		lines.push('These are raw INPADOC legal-status events. Read in-force vs. lapsed/expired from the event history (grant, lapse/withdrawal, renewal-fee and opposition codes). For family-wide status across jurisdictions use get_patent_family; for the EP register prosecution timeline use get_register_events.');
		return lines.join('\n');
	}
}

ToolRegistry.registerTool(GetLegalStatusTool);
