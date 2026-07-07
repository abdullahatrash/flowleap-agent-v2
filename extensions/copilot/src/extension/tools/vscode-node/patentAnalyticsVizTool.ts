/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  Patent Analytics Tool
 *
 *  Sends a structured search contract to the FlowLeap backend's full-corpus analytics route
 *  (`/v1/patent-analytics`, DuckDB-backed over a quarterly-refreshed slice of the Google Patents
 *  corpus) and renders the returned aggregates (filing trend, top assignees, country and CPC
 *  breakdowns) as markdown tables. The aggregates ARE the deliverable — no client-side sampling.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import type * as vscode from 'vscode';
import { ILogService } from '../../../platform/log/common/logService';
import { CancellationToken } from '../../../util/vs/base/common/cancellation';
import { LanguageModelTextPart, LanguageModelToolResult } from '../../../vscodeTypes';
import { IPatentBackendClient } from '../../patentai/vscode-node/patentBackendClient';
import { handlePatentToolError } from './patentToolError';
import { ToolName } from '../common/toolNames';
import { ICopilotTool, ToolRegistry } from '../common/toolsRegistry';
import { renderMarkdownTable, ToolResponseBudgets } from './patentResponseFormatter';

interface IPatentAnalyticsParams {
	keywords?: string[];      // Individual keywords, OR logic, matched against EN title + abstract
	phrases?: string[];       // Exact phrase matches, matched against EN title + abstract
	assignee?: string;        // Harmonized-assignee-name substring match
	cpc?: string[];           // CPC classification codes, prefix match (e.g. ["G06N", "A61B"])
	ipc?: string[];           // IPC classification codes, prefix match
	countryCode?: string;     // Publication country (e.g. "US", "CN", "EP")
	dateFrom?: string;        // Publication-date lower bound, YYYY-MM-DD
	dateTo?: string;          // Publication-date upper bound, YYYY-MM-DD
}

/** The structured request body accepted by `/v1/patent-analytics`. Every field is optional; at least one is required. */
interface IPatentAnalyticsRequest {
	keywords?: string[];
	phrases?: string[];
	assignee?: string;
	cpc?: string[];
	ipc?: string[];
	countryCode?: string;
	dateFrom?: string;
	dateTo?: string;
}

interface AnalyticsAggregates {
	byYear: { year: number; count: number }[];
	byCountry: { country: string; count: number }[];
	topAssignees: { assignee: string; count: number }[];
	topCPC: { cpc: string; count: number }[];
}

interface AnalyticsResponse {
	success: boolean;
	searchDescription?: string;
	request?: IPatentAnalyticsRequest;
	analytics?: AnalyticsAggregates;
	error?: string;
}

/**
 * Tool for fetching patent analytics over the full backend corpus. Maps the structured search
 * criteria to the `/v1/patent-analytics` contract and calls it through the shared
 * {@link IPatentBackendClient} seam, so it inherits the centralized `401 → re-sign-in` /
 * `402 → start-trial` / `429 → rate-limited` gating. The backend computes each aggregate
 * (filing trend, top assignees, country and CPC breakdowns) over the whole matching corpus and
 * caps each list at its top 20; this tool renders those aggregates as markdown tables.
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

		const request = this.buildRequest(options.input);
		if (!request) {
			return new LanguageModelToolResult([
				new LanguageModelTextPart('Error: Provide at least one search criterion: keywords, phrases, assignee, cpc, ipc, countryCode, dateFrom, or dateTo.')
			]);
		}

		try {
			const result = await this.patentBackendClient.post<AnalyticsResponse>('/patent-analytics', request, token);

			if (!result.success || !result.analytics) {
				return new LanguageModelToolResult([
					new LanguageModelTextPart(`Error: ${result.error || 'Unknown error'}`)
				]);
			}

			const formattedResponse = this.formatAnalytics(result.searchDescription, result.analytics);

			return new LanguageModelToolResult([
				new LanguageModelTextPart(formattedResponse)
			]);

		} catch (error) {
			return handlePatentToolError(error, this.logService, '[PatentAnalyticsTool]', err => `Error: Patent analytics returned ${err.status}: ${err.message}`);
		}
	}

	/**
	 * Map the tool inputs onto the `/v1/patent-analytics` request contract, dropping empty fields.
	 * Returns undefined when no criterion is given, so the caller can short-circuit before the network
	 * call (the backend would reject an empty body with `400 no-criterion`).
	 */
	private buildRequest(input: IPatentAnalyticsParams): IPatentAnalyticsRequest | undefined {
		const request: IPatentAnalyticsRequest = {};

		if (input.keywords && input.keywords.length > 0) {
			request.keywords = input.keywords;
		}
		if (input.phrases && input.phrases.length > 0) {
			request.phrases = input.phrases;
		}
		if (input.assignee) {
			request.assignee = input.assignee;
		}
		if (input.cpc && input.cpc.length > 0) {
			request.cpc = input.cpc;
		}
		if (input.ipc && input.ipc.length > 0) {
			request.ipc = input.ipc;
		}
		if (input.countryCode) {
			request.countryCode = input.countryCode.toUpperCase();
		}
		if (input.dateFrom) {
			request.dateFrom = input.dateFrom;
		}
		if (input.dateTo) {
			request.dateTo = input.dateTo;
		}

		return Object.keys(request).length > 0 ? request : undefined;
	}

	/**
	 * Render the backend aggregates as markdown tables. Each aggregate is already capped at its top 20
	 * by the backend; the assembled body is bounded by {@link ToolResponseBudgets.PatentAnalyticsViz} as
	 * a defensive whole-response ceiling.
	 */
	private formatAnalytics(searchDescription: string | undefined, analytics: AnalyticsAggregates): string {
		const { byYear, byCountry, topAssignees, topCPC } = analytics;

		if (byYear.length === 0 && byCountry.length === 0 && topAssignees.length === 0 && topCPC.length === 0) {
			return `No patents matched${searchDescription ? ` ${searchDescription}` : ' the given criteria'}. Try broader keywords or fewer filters.`;
		}

		const lines: string[] = ['## Patent Analytics Results', ''];
		if (searchDescription) {
			lines.push(`**Search**: ${searchDescription}`, '');
		}
		lines.push('Coverage: full-corpus counts over the backend patent corpus (a quarterly-refreshed slice of the Google Patents corpus). Each list below is capped at its top 20.', '');

		// Filing trend, oldest year first so the table reads as a time series.
		const yearsAscending = [...byYear].sort((a, b) => a.year - b.year);
		lines.push('### Filing Trend (by publication year)');
		lines.push(renderMarkdownTable(yearsAscending, [
			{ header: 'Year', cell: y => String(y.year) },
			{ header: 'Patents', cell: y => y.count.toLocaleString(), align: 'right' },
		]));
		lines.push('');

		lines.push('### Top Assignees');
		lines.push(renderMarkdownTable(topAssignees, [
			{ header: 'Assignee', cell: a => a.assignee },
			{ header: 'Patents', cell: a => a.count.toLocaleString(), align: 'right' },
		]));
		lines.push('');

		lines.push('### By Country');
		lines.push(renderMarkdownTable(byCountry, [
			{ header: 'Country', cell: c => c.country },
			{ header: 'Patents', cell: c => c.count.toLocaleString(), align: 'right' },
		]));
		lines.push('');

		lines.push('### Top CPC Sections');
		lines.push(renderMarkdownTable(topCPC, [
			{ header: 'CPC', cell: c => c.cpc },
			{ header: 'Patents', cell: c => c.count.toLocaleString(), align: 'right' },
		]));
		lines.push('');

		lines.push('Highlight for the user: the peak filing years, the leading assignees, the geographic concentration, and the dominant CPC sections. The tables above are the deliverable — present them directly rather than re-deriving the numbers.');

		const body = lines.join('\n');
		const budget = ToolResponseBudgets.PatentAnalyticsViz;
		return body.length > budget
			? body.substring(0, budget) + '\n\n(Output truncated to fit the response budget.)'
			: body;
	}
}

ToolRegistry.registerTool(PatentAnalyticsVizTool);
