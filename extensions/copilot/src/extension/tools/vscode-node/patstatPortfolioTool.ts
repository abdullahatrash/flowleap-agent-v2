/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  PATSTAT Portfolio Tool
 *
 *  "Show me {company}'s patent portfolio" — sends one applicant name (plus an optional filing-year
 *  window) to the FlowLeap backend's PATSTAT analytics layer (`/v1/patstat/portfolio`, self-hosted
 *  EPO PATSTAT Global) and renders the returned aggregates — totals, by filing year, by office —
 *  as markdown tables headed by the backend's quotable `summary` and `data_edition`. PATSTAT is a
 *  twice-yearly snapshot: the rendered output tells the agent to defer any CURRENT-legal-status
 *  question to the live document tools rather than presenting snapshot data as current.
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

interface IPatstatPortfolioParams {
	/** Applicant/company name or prefix, matched against harmonized PSN names (fuzzy, alias-grouped). */
	applicant: string;
	/** Earliest filing year, inclusive. Backend default: toYear - 9. */
	fromYear?: number;
	/** Latest filing year, inclusive. Backend default: the current year. */
	toYear?: number;
}

/** One `{ applications, granted }` cell; `granted` is null for authorities with unreliable grant status. */
interface PortfolioOfficeAggregate {
	office: string;
	applications: number;
	granted: number | null;
}

/** The `/v1/patstat/portfolio` success body (backend #141/#146 contract), spread over `{ success: true }`. */
interface PortfolioResponse {
	success: boolean;
	applicant?: {
		query: string;
		matched_name: string;
		matched_psn_names: string[];
		other_matches: { name: string; applications: number }[];
	};
	filters?: { from_year: number; to_year: number };
	totals?: { applications: number; granted: number };
	by_year?: { year: number; applications: number; granted: number }[];
	by_office?: PortfolioOfficeAggregate[];
	grant_status_caveats?: string[];
	notes?: string[];
	summary?: string;
	data_edition?: string;
	/** String in practice; typed loosely because a raw envelope would carry an object here. */
	error?: unknown;
}

/** The FlowLeap unified error envelope carried (as JSON text) in a 4xx {@link PatentBackendError}. */
interface PatstatErrorEnvelope {
	error?: { code?: string; message?: string };
}

/**
 * Render a `success: false` body's `error` field for the model. Defensive only — the backend
 * reports failures as non-2xx (handled in the catch path), but if a 2xx body ever carries the
 * envelope's error OBJECT rather than a string, stringify it instead of printing `[object Object]`.
 */
function describeBodyError(error: unknown): string {
	if (typeof error === 'string' && error.length > 0) {
		return error;
	}
	return error ? JSON.stringify(error) : 'Unknown error from the PATSTAT portfolio endpoint';
}

/**
 * Tool for aggregate portfolio analytics over the backend's self-hosted PATSTAT analytics layer.
 * Calls `/v1/patstat/portfolio` through the shared {@link IPatentBackendClient} seam, inheriting the
 * centralized `401 → re-sign-in` / `402 → start-trial` / `429 → rate-limited` gating. The backend
 * resolves the applicant against harmonized (PSN) names — fuzzy prefix matching with alias grouping,
 * never silently merging distinct entities — and returns application counts by filing year and
 * office plus a quotable `summary` and the loaded `data_edition`, which this tool surfaces verbatim
 * so the agent can caveat data freshness. Backend errors are actionable (not-found spelling
 * suggestions, ambiguous-name candidate lists): they are parsed out of the error envelope and
 * relayed, never swallowed.
 */
export class PatstatPortfolioTool implements ICopilotTool<IPatstatPortfolioParams> {

	public static readonly toolName = ToolName.PatstatPortfolio;

	constructor(
		@ILogService private readonly logService: ILogService,
		@IPatentBackendClient private readonly patentBackendClient: IPatentBackendClient,
	) { }

	prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<IPatstatPortfolioParams>, _token: CancellationToken): vscode.ProviderResult<vscode.PreparedToolInvocation> {
		const subject = options.input.applicant || 'applicant';
		return {
			invocationMessage: l10n.t`Fetching PATSTAT portfolio for: ${subject}`,
		};
	}

	async invoke(options: vscode.LanguageModelToolInvocationOptions<IPatstatPortfolioParams>, token: CancellationToken): Promise<vscode.LanguageModelToolResult> {
		this.logService.trace('[PatstatPortfolioTool] Fetching portfolio');

		const request = this.buildRequest(options.input);
		if (!request) {
			return new LanguageModelToolResult([
				new LanguageModelTextPart('Error: Provide `applicant` — the company/applicant name (at least 2 characters), matched against harmonized PSN names.')
			]);
		}

		try {
			const result = await this.patentBackendClient.post<PortfolioResponse>('/patstat/portfolio', request, token);

			if (!result.success || !result.summary) {
				return new LanguageModelToolResult([
					new LanguageModelTextPart(`Error: ${describeBodyError(result.error)}`)
				]);
			}

			return new LanguageModelToolResult([
				new LanguageModelTextPart(this.formatPortfolio(result))
			]);

		} catch (error) {
			return handlePatentToolError(
				error,
				this.logService,
				'[PatstatPortfolioTool]',
				err => this.formatBackendError(err),
				err => err.status === 503
					? ' If this persists, the PATSTAT analytics layer may be unavailable or not configured on this deployment — aggregate portfolio analytics are down, but individual documents are unaffected: use the OPS/USPTO document tools instead.'
					: '',
			);
		}
	}

	/**
	 * Map the tool inputs onto the `/v1/patstat/portfolio` contract, dropping unset year bounds.
	 * Returns undefined for a missing/too-short applicant so the caller can short-circuit before the
	 * network call (the backend would reject it with `400 patstat_invalid_request`).
	 */
	private buildRequest(input: IPatstatPortfolioParams): { applicant: string; fromYear?: number; toYear?: number } | undefined {
		const applicant = typeof input.applicant === 'string' ? input.applicant.trim() : '';
		if (applicant.length < 2) {
			return undefined;
		}
		// Send the trimmed name: the backend matches it as a harmonized-name PREFIX, so a leading
		// space would silently miss every candidate.
		const request: { applicant: string; fromYear?: number; toYear?: number } = { applicant };
		if (input.fromYear !== undefined) {
			request.fromYear = input.fromYear;
		}
		if (input.toYear !== undefined) {
			request.toYear = input.toYear;
		}
		return request;
	}

	/**
	 * Lead-in for a backend {@link PatentBackendError}. Unclassified 4xx errors carry the FlowLeap
	 * error envelope as raw JSON text — parse out `error.code`/`error.message` so the agent reads the
	 * actionable instruction ("try a shorter name prefix", the ambiguous-candidate list) instead of an
	 * escaped JSON blob. Falls back to the raw message when the body is not a parseable envelope
	 * (including a truncated one — the client caps bodies at 500 characters).
	 */
	private formatBackendError(error: PatentBackendError): string {
		try {
			const parsed = JSON.parse(error.message) as PatstatErrorEnvelope;
			if (parsed?.error?.message) {
				const code = parsed.error.code ? ` (${parsed.error.code})` : '';
				return `Error: PATSTAT portfolio returned ${error.status}${code}: ${parsed.error.message}`;
			}
		} catch {
			// Not a JSON envelope (transient status line, truncated body, HTML) — fall through.
		}
		return `Error: PATSTAT portfolio returned ${error.status}: ${error.message}`;
	}

	/**
	 * Render the portfolio aggregates as markdown: the backend's quotable `summary` first, then the
	 * counting semantics + edition, the by-year and by-office tables, and the backend's caveats and
	 * notes verbatim. Bounded by {@link ToolResponseBudgets.PatstatPortfolio} as a defensive ceiling.
	 */
	private formatPortfolio(data: PortfolioResponse): string {
		const lines: string[] = [`## Patent Portfolio: ${data.applicant?.matched_name ?? data.applicant?.query ?? 'applicant'}`, ''];

		lines.push(`**Summary**: ${data.summary}`, '');
		lines.push(
			`Source: ${data.data_edition ?? 'PATSTAT (edition unknown)'} — the EPO worldwide patent statistics database, self-hosted analytics layer. ` +
			'Counting semantics: patent APPLICATIONS counted by FILING year under the harmonized (PSN) applicant name — these legitimately differ from publication-level counts (patent_analytics_viz) and from live-register data.',
			'');

		if (data.applicant) {
			if (data.applicant.matched_psn_names.length > 0) {
				lines.push(`Harmonized name variants included: ${data.applicant.matched_psn_names.join(', ')}`);
			}
			if (data.applicant.other_matches.length > 0) {
				lines.push(`NOT included (distinct entities also matching "${data.applicant.query}"): ${data.applicant.other_matches.map(m => `${m.name} (${m.applications} applications)`).join(', ')} — query them separately if relevant.`);
			}
			lines.push('');
		}

		const grantedCell = (granted: number | null): string => granted === null ? 'n/a' : granted.toLocaleString();

		if (data.by_year && data.by_year.length > 0) {
			lines.push('### Filings by Year (filing year)');
			lines.push(renderMarkdownTable(data.by_year, [
				{ header: 'Year', cell: y => String(y.year) },
				{ header: 'Applications', cell: y => y.applications.toLocaleString(), align: 'right' },
				{ header: 'Granted', cell: y => y.granted.toLocaleString(), align: 'right' },
			]));
			lines.push('');
		}

		if (data.by_office && data.by_office.length > 0) {
			lines.push('### Filings by Office');
			lines.push(renderMarkdownTable(data.by_office, [
				{ header: 'Office', cell: o => o.office },
				{ header: 'Applications', cell: o => o.applications.toLocaleString(), align: 'right' },
				{ header: 'Granted', cell: o => grantedCell(o.granted), align: 'right' },
			]));
			lines.push('');
		}

		for (const caveat of data.grant_status_caveats ?? []) {
			lines.push(`- Grant-status caveat: ${caveat}`);
		}
		for (const note of data.notes ?? []) {
			lines.push(`- Note: ${note}`);
		}
		if ((data.grant_status_caveats?.length || data.notes?.length)) {
			lines.push('');
		}

		lines.push(
			`Snapshot caveat: these numbers are a snapshot from ${data.data_edition ?? 'the loaded PATSTAT edition'} (refreshed twice a year). ` +
			'For the CURRENT legal status of any individual patent (in force, lapsed, opposed), use get_legal_status or get_patent_summary — never present these snapshot grant counts as current status.',
			'');
		lines.push('Present the summary sentence and the tables directly — they are the deliverable — and always name the PATSTAT edition when quoting these numbers.');

		const body = lines.join('\n');
		const budget = ToolResponseBudgets.PatstatPortfolio;
		return body.length > budget
			? body.substring(0, budget) + '\n\n(Output truncated to fit the response budget.)'
			: body;
	}
}

ToolRegistry.registerTool(PatstatPortfolioTool);
