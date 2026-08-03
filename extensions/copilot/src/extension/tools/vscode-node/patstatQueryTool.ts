/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  PATSTAT Guarded SQL Tool (Layer 2)
 *
 *  Thin passthrough to the backend's `POST /v1/patstat/query` (flowleap-backend ADR 0010,
 *  docs/PATSTAT-LAYER2-SPEC.md): the AGENT writes one SELECT against the `flowleap.*` semantic
 *  views; the backend gates it deterministically (parse check, schema allowlist, EXPLAIN cost
 *  bands, hard row/byte caps, 20s timeout) and returns rows or a typed `patstat_sql_*` error
 *  whose message carries the exact parser/Postgres detail plus a recovery line. That error text
 *  IS the retry prompt — this tool relays it verbatim, never rephrased or swallowed, because the
 *  agent owns the one-retry loop (fix once, resubmit with `retryOf`, stop on a second failure).
 *  Schema/conventions/examples come from `patstat_api_guide` (sections `semantic-model` and
 *  `examples`) at runtime — nothing is hardcoded here, so guidance never drifts from the backend.
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

interface IPatstatQueryParams {
	/** Exactly one SELECT statement against `flowleap.*` views (every table schema-qualified). */
	sql: string;
	/** The user's question, verbatim — audit-only, feeds the backend's query-review pipeline. */
	question?: string;
	/** Correlation marker linking a retry to the rejected attempt it fixes. Audit-only. */
	retryOf?: string;
}

/** The `/v1/patstat/query` success body (spec §1). */
interface QueryResponse {
	success: boolean;
	rows?: Record<string, unknown>[];
	rowCount?: number;
	data_edition?: string;
	warnings?: { code: string; message: string; details?: Record<string, unknown> }[];
	error?: unknown;
}

/** The FlowLeap unified error envelope carried (as JSON text) in a 4xx/5xx {@link PatentBackendError}. */
interface GateErrorEnvelope {
	error?: { code?: string; message?: string } & Record<string, unknown>;
}

/** Rows rendered into the markdown table before the "and N more" cut. */
const MAX_RENDERED_ROWS = 50;

/**
 * Tool for agent-written guarded SQL over the backend's PATSTAT Layer-2 surface. Calls
 * `/v1/patstat/query` through the shared {@link IPatentBackendClient} seam, inheriting the
 * centralized `401 → re-sign-in` / `402 → start-trial` / `429 → rate-limited` gating. Success
 * renders a bounded markdown table plus `data_edition` and any warn-band warnings; gate failures
 * relay the typed error envelope verbatim (code, message, machine details) because the backend
 * message is the agent's fix-it instruction. `patstat_busy` is explicitly flagged as a back-off
 * signal, never a rewrite-the-SQL signal (the client's error body cap is 500 chars — gate
 * envelopes are written to fit).
 */
export class PatstatQueryTool implements ICopilotTool<IPatstatQueryParams> {

	public static readonly toolName = ToolName.PatstatQuery;

	constructor(
		@ILogService private readonly logService: ILogService,
		@IPatentBackendClient private readonly patentBackendClient: IPatentBackendClient,
	) { }

	prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<IPatstatQueryParams>, _token: CancellationToken): vscode.ProviderResult<vscode.PreparedToolInvocation> {
		const label = options.input.retryOf ? 'Retrying guarded PATSTAT SQL query' : 'Running guarded PATSTAT SQL query';
		return {
			invocationMessage: l10n.t`${label}`,
		};
	}

	async invoke(options: vscode.LanguageModelToolInvocationOptions<IPatstatQueryParams>, token: CancellationToken): Promise<vscode.LanguageModelToolResult> {
		this.logService.trace('[PatstatQueryTool] Running guarded SQL');

		const sql = typeof options.input.sql === 'string' ? options.input.sql.trim() : '';
		if (!sql) {
			return new LanguageModelToolResult([
				new LanguageModelTextPart('Error: Provide `sql` — exactly one SELECT statement against the flowleap.* views. Fetch the schema first: patstat_api_guide with action="section", section="semantic-model".')
			]);
		}

		const request: { sql: string; question?: string; retryOf?: string } = { sql };
		if (typeof options.input.question === 'string' && options.input.question.length > 0) {
			request.question = options.input.question;
		}
		if (typeof options.input.retryOf === 'string' && options.input.retryOf.length > 0) {
			request.retryOf = options.input.retryOf;
		}

		try {
			const result = await this.patentBackendClient.post<QueryResponse>('/patstat/query', request, token);

			if (!result.success || !Array.isArray(result.rows)) {
				const detail = typeof result.error === 'string' && result.error.length > 0
					? result.error
					: JSON.stringify(result.error ?? 'Unknown error from the PATSTAT query endpoint');
				return new LanguageModelToolResult([
					new LanguageModelTextPart(`Error: ${detail}`)
				]);
			}

			return new LanguageModelToolResult([
				new LanguageModelTextPart(this.formatResult(result))
			]);

		} catch (error) {
			return handlePatentToolError(
				error,
				this.logService,
				'[PatstatQueryTool]',
				err => this.formatGateError(err),
				err => err.status === 503
					? ' If the error code is patstat_busy, back off for the indicated seconds and retry the SAME SQL — the query itself is fine. If it is patstat_unavailable, the guarded-SQL layer is not configured: fall back to patstat_portfolio or the document tools.'
					: '',
			);
		}
	}

	/**
	 * Relay a gate rejection with its typed code, verbatim message, and machine details. The
	 * backend's message already ends with the recovery instruction (spec §3) — the agent should fix
	 * the SQL ONCE per that instruction, resubmit with `retryOf`, and stop after a second failure
	 * (never loop: the 10/min budget is the hard bound). Falls back to the raw status line when the
	 * body is not a parseable envelope.
	 */
	private formatGateError(error: PatentBackendError): string {
		try {
			const parsed = JSON.parse(error.message) as GateErrorEnvelope;
			if (parsed?.error?.message) {
				const { code, message, ...details } = parsed.error;
				const lines = [`Error${code ? ` (${code})` : ''}: ${message}`];
				const machineDetails = Object.entries(details)
					.filter(([, value]) => value !== undefined && value !== null)
					.map(([key, value]) => `${key}=${typeof value === 'string' ? value : JSON.stringify(value)}`);
				if (machineDetails.length > 0) {
					lines.push(`Details: ${machineDetails.join(', ')}`);
				}
				if (code?.startsWith('patstat_sql_')) {
					lines.push('Fix the SQL once per the instruction above and resubmit with retryOf set; after a second failure, stop and report the error to the user.');
				}
				return lines.join('\n');
			}
		} catch {
			// Not a JSON envelope (transient status line, truncated body, HTML) — fall through.
		}
		return `Error: PATSTAT query returned ${error.status}: ${error.message}`;
	}

	/**
	 * Render rows as a generic markdown table (columns from the first row), bounded by
	 * {@link MAX_RENDERED_ROWS} and {@link ToolResponseBudgets.PatstatQuery}, with `data_edition`,
	 * warn-band warnings, and the presentation contract (state the interpretation, cite the
	 * edition) appended.
	 */
	private formatResult(data: QueryResponse): string {
		const rows = data.rows ?? [];
		const lines: string[] = ['## PATSTAT Guarded SQL Result', ''];

		if (rows.length === 0) {
			lines.push('The query ran successfully and returned **0 rows** — the filters may be too narrow, or the entity/CPC prefix may not match. Probe candidates before assuming absence (see the guarded-sql workflow).', '');
		} else {
			const columns = Object.keys(rows[0]);
			const rendered = rows.slice(0, MAX_RENDERED_ROWS);
			lines.push(renderMarkdownTable(rendered, columns.map(column => ({
				header: column,
				cell: (row: Record<string, unknown>) => {
					const value = row[column];
					if (value === null || value === undefined) { return ''; }
					return typeof value === 'object' ? JSON.stringify(value) : String(value);
				},
			}))));
			if (rows.length > rendered.length) {
				lines.push('', `(${rendered.length} of ${data.rowCount ?? rows.length} rows shown — aggregate further or add ORDER BY + LIMIT to focus the result.)`);
			}
			lines.push('');
		}

		lines.push(`Rows: ${data.rowCount ?? rows.length} · Source: ${data.data_edition ?? 'PATSTAT (edition unknown)'} (self-hosted EPO PATSTAT Global; twice-yearly snapshot).`, '');

		for (const warning of data.warnings ?? []) {
			lines.push(`- Warning (${warning.code}): ${warning.message}`);
		}
		if (data.warnings?.length) {
			lines.push('');
		}

		lines.push(
			'Present the numbers with their interpretation stated explicitly (e.g. "counted as DOCDB families by earliest filing year") and always name the PATSTAT edition. ' +
			'For the CURRENT legal status of an individual patent, use get_legal_status — never present snapshot data as current.',
		);

		const body = lines.join('\n');
		const budget = ToolResponseBudgets.PatstatQuery;
		return body.length > budget
			? body.substring(0, budget) + '\n\n(Output truncated to fit the response budget — aggregate further or select fewer columns.)'
			: body;
	}
}

ToolRegistry.registerTool(PatstatQueryTool);
