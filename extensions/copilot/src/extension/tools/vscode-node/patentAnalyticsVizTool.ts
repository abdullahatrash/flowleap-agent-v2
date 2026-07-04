/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  Patent Analytics Tool
 *
 *  Builds a CQL query from structured criteria, runs it against EPO OPS via the FlowLeap
 *  backend (`/ops/search`), and aggregates the results client-side. The agent uses this data
 *  to create visualizations.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import type * as vscode from 'vscode';
import { ILogService } from '../../../platform/log/common/logService';
import { CancellationToken } from '../../../util/vs/base/common/cancellation';
import { LanguageModelTextPart, LanguageModelToolResult } from '../../../vscodeTypes';
import { IPatentBackendClient, PatentBackendError, patentBackendErrorRecoveryHint } from '../../patentai/vscode-node/patentBackendClient';
import { ToolName } from '../common/toolNames';
import { ICopilotTool, ToolRegistry } from '../common/toolsRegistry';

interface IPatentAnalyticsParams {
	query?: string;           // Legacy - deprecated, use keywords/phrases instead
	keywords?: string[];      // Individual keywords with OR logic (e.g., ["AI", "5G", "healthcare"])
	phrases?: string[];       // Exact phrase matches (e.g., ["machine learning", "deep learning"])
	assignee?: string;
	cpc?: string[];           // CPC classification codes (e.g., ["G06N", "A61B"])
	ipc?: string[];           // IPC classification codes
	classification?: string;  // Legacy - deprecated, use cpc/ipc instead
	dateFrom?: string;
	dateTo?: string;
	countryCode?: string;
}

interface OpsEnvelope<T> {
	success: boolean;
	data?: T;
	error?: string;
}

interface OpsSearchResultItem {
	docId: string;
	title: string | null;
	abstract: string | null;
	applicants: string[];
	publicationDate: string | null;
}

interface OpsSearchData {
	total: number;
	range: { begin: number; end: number };
	docs: string[] | OpsSearchResultItem[];
}

interface AnalyticsData {
	byYear: { year: number; count: number }[];
	byCountry: { country: string; count: number }[];
	topAssignees: { assignee: string; count: number }[];
}

/** Sample size for the distribution aggregations — the OPS search page we fetch with biblio details. */
const SAMPLE_SIZE = 100;

/** The backend staggers per-doc biblio fetches for the sample, so allow well beyond the 30s default. */
const SEARCH_TIMEOUT_MS = 90_000;

/**
 * Tool for fetching patent analytics. Builds a CQL query from the structured criteria, searches
 * EPO OPS via the FlowLeap backend (through the shared {@link IPatentBackendClient} seam, so it
 * inherits the centralized `401 → re-sign-in` / `402 → start-trial` gating), and aggregates
 * yearly/country/assignee distributions from the top matches. The exact total match count comes
 * from OPS; the distributions are computed over the first {@link SAMPLE_SIZE} results.
 */
export class PatentAnalyticsVizTool implements ICopilotTool<IPatentAnalyticsParams> {

	public static readonly toolName = ToolName.PatentAnalyticsViz;

	constructor(
		@ILogService private readonly logService: ILogService,
		@IPatentBackendClient private readonly patentBackendClient: IPatentBackendClient,
	) { }

	prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<IPatentAnalyticsParams>, _token: CancellationToken): vscode.ProviderResult<vscode.PreparedToolInvocation> {
		const { assignee, keywords, phrases } = options.input;
		const subject = assignee || keywords?.[0] || phrases?.[0] || 'patents';
		return {
			invocationMessage: l10n.t`Fetching patent analytics for: ${subject}`,
		};
	}

	async invoke(options: vscode.LanguageModelToolInvocationOptions<IPatentAnalyticsParams>, token: CancellationToken): Promise<vscode.LanguageModelToolResult> {
		this.logService.trace('[PatentAnalyticsTool] Fetching analytics');

		const cql = this.buildCql(options.input);
		if (!cql) {
			return new LanguageModelToolResult([
				new LanguageModelTextPart('Error: Provide at least one of: keywords, phrases, assignee, cpc, ipc, or query')
			]);
		}

		this.logService.info(`[PatentAnalyticsTool] CQL: ${cql}`);

		try {
			const params = new URLSearchParams({ q: cql, range: `1-${SAMPLE_SIZE}`, details: 'true' });
			if (options.input.countryCode) {
				params.set('countries', options.input.countryCode.toUpperCase());
			}

			const result = await this.patentBackendClient.get<OpsEnvelope<OpsSearchData>>(`/ops/search?${params.toString()}`, token, { timeoutMs: SEARCH_TIMEOUT_MS });

			if (!result.success || !result.data) {
				return new LanguageModelToolResult([
					new LanguageModelTextPart(`Error: ${result.error || 'Unknown error'}`)
				]);
			}

			const items = result.data.docs.filter((d): d is OpsSearchResultItem => typeof d !== 'string');
			this.logService.info(`[PatentAnalyticsTool] ${result.data.total} total matches, aggregating over ${items.length}`);

			if (result.data.total === 0 || items.length === 0) {
				return new LanguageModelToolResult([
					new LanguageModelTextPart(`No patents matched the query \`${cql}\`. Try broader keywords or fewer filters.`)
				]);
			}

			const analytics = this.aggregate(items);
			const formattedResponse = this.formatAnalytics(cql, result.data.total, items.length, analytics);

			return new LanguageModelToolResult([
				new LanguageModelTextPart(formattedResponse)
			]);

		} catch (error) {
			if (error instanceof PatentBackendError) {
				if (error.message === 'Request cancelled.') {
					return new LanguageModelToolResult([new LanguageModelTextPart('Request cancelled.')]);
				}
				this.logService.error(`[PatentAnalyticsTool] Backend error ${error.status}: ${error.message}`);
				return new LanguageModelToolResult([
					new LanguageModelTextPart(`Error: Patent analytics returned ${error.status}: ${error.message}` + patentBackendErrorRecoveryHint(error))
				]);
			}
			this.logService.error(`[PatentAnalyticsTool] Exception: ${error instanceof Error ? error.message : String(error)}`);
			return new LanguageModelToolResult([
				new LanguageModelTextPart(`Error: ${error instanceof Error ? error.message : 'Unknown error occurred'}`)
			]);
		}
	}

	/**
	 * Build an EPO OPS CQL query from the structured search criteria. Returns undefined when no
	 * criterion is given. `ta` searches title+abstract, `pa` applicant, `cpc`/`ic` classifications,
	 * `pd` publication date.
	 */
	private buildCql(input: IPatentAnalyticsParams): string | undefined {
		const { query, keywords, phrases, assignee, cpc, ipc, classification, dateFrom, dateTo } = input;
		const clauses: string[] = [];

		const quote = (s: string) => `"${s.replace(/"/g, '')}"`;

		const termClauses: string[] = [];
		for (const phrase of phrases ?? []) {
			termClauses.push(`ta=${quote(phrase)}`);
		}
		for (const keyword of keywords ?? []) {
			termClauses.push(`ta=${quote(keyword)}`);
		}
		if (termClauses.length === 0 && query) {
			termClauses.push(`ta=${quote(query)}`);
		}
		if (termClauses.length === 1) {
			clauses.push(termClauses[0]);
		} else if (termClauses.length > 1) {
			clauses.push(`(${termClauses.join(' or ')})`);
		}

		if (assignee) {
			clauses.push(`pa=${quote(assignee)}`);
		}

		const cpcCodes = cpc && cpc.length > 0 ? cpc : (classification ? [classification] : []);
		if (cpcCodes.length === 1) {
			clauses.push(`cpc=${cpcCodes[0]}`);
		} else if (cpcCodes.length > 1) {
			clauses.push(`(${cpcCodes.map(c => `cpc=${c}`).join(' or ')})`);
		}

		if (ipc && ipc.length === 1) {
			clauses.push(`ic=${ipc[0]}`);
		} else if (ipc && ipc.length > 1) {
			clauses.push(`(${ipc.map(c => `ic=${c}`).join(' or ')})`);
		}

		const toOpsDate = (d: string) => d.replace(/-/g, '');
		if (dateFrom && dateTo) {
			clauses.push(`pd within "${toOpsDate(dateFrom)} ${toOpsDate(dateTo)}"`);
		} else if (dateFrom) {
			clauses.push(`pd >= "${toOpsDate(dateFrom)}"`);
		} else if (dateTo) {
			clauses.push(`pd <= "${toOpsDate(dateTo)}"`);
		}

		return clauses.length > 0 ? clauses.join(' and ') : undefined;
	}

	/**
	 * Aggregate year/country/assignee distributions from the sampled search results.
	 */
	private aggregate(items: OpsSearchResultItem[]): AnalyticsData {
		const byYear = new Map<number, number>();
		const byCountry = new Map<string, number>();
		const byAssignee = new Map<string, number>();

		for (const item of items) {
			const year = item.publicationDate ? parseInt(item.publicationDate.substring(0, 4), 10) : NaN;
			if (!isNaN(year)) {
				byYear.set(year, (byYear.get(year) || 0) + 1);
			}

			const country = item.docId?.substring(0, 2).toUpperCase();
			if (country) {
				byCountry.set(country, (byCountry.get(country) || 0) + 1);
			}

			for (const applicant of item.applicants ?? []) {
				const name = applicant.trim().toUpperCase().replace(/[.,]+$/, '');
				if (name) {
					byAssignee.set(name, (byAssignee.get(name) || 0) + 1);
				}
			}
		}

		return {
			byYear: [...byYear.entries()].map(([year, count]) => ({ year, count })).sort((a, b) => a.year - b.year),
			byCountry: [...byCountry.entries()].map(([country, count]) => ({ country, count })).sort((a, b) => b.count - a.count),
			topAssignees: [...byAssignee.entries()].map(([assignee, count]) => ({ assignee, count })).sort((a, b) => b.count - a.count).slice(0, 10),
		};
	}

	/**
	 * Format analytics data for LLM consumption
	 */
	private formatAnalytics(cql: string, total: number, sampleSize: number, analytics: AnalyticsData): string {
		const peakYear = analytics.byYear.reduce((max, y) => y.count > max.count ? y : max, analytics.byYear[0] || { year: 0, count: 0 });

		const lines: string[] = [
			'## Patent Analytics Results',
			'',
			`**Query (EPO OPS CQL)**: \`${cql}\``,
			`**Total Matches**: ${total.toLocaleString()} (exact count from EPO OPS)`,
			`**Sample**: distributions below are computed over the ${sampleSize} most relevant matches`,
			'',
			'### Summary',
			`- Peak Year (in sample): ${peakYear.year} (${peakYear.count} patents)`,
			`- Top Country (in sample): ${analytics.byCountry[0]?.country || 'N/A'}`,
			`- Top Assignee (in sample): ${analytics.topAssignees[0]?.assignee || 'N/A'}`,
			'',
			'### Yearly Trend (sample)',
		];

		analytics.byYear.forEach(y => {
			lines.push(`- ${y.year}: ${y.count}`);
		});

		lines.push('', '### Countries (sample)');
		analytics.byCountry.slice(0, 10).forEach(c => {
			lines.push(`- ${c.country}: ${c.count}`);
		});

		lines.push('', '### Top Assignees (sample)');
		analytics.topAssignees.forEach(a => {
			lines.push(`- ${a.assignee}: ${a.count}`);
		});

		lines.push(
			'',
			'---',
			'Use this data to create visualizations. You can:',
			'1. Create a Python script with matplotlib/plotly to visualize trends',
			'2. Generate a markdown report with the analysis',
			'3. Build interactive dashboards',
			'',
			'For per-year exact counts, rerun this tool with dateFrom/dateTo buckets (each run returns the exact total for its window). For CPC breakdowns, fetch biblio for specific patents via patent_api_request (GET /ops/biblio?doc=...).'
		);

		return lines.join('\n');
	}
}

ToolRegistry.registerTool(PatentAnalyticsVizTool);
