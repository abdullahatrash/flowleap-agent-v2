/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  Patent Analytics Tool
 *
 *  Fetches patent analytics data from the FlowLeap backend (BigQuery-backed).
 *  The agent uses this data to create visualizations.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import type * as vscode from 'vscode';
import { ILogService } from '../../../platform/log/common/logService';
import { CancellationToken } from '../../../util/vs/base/common/cancellation';
import { LanguageModelTextPart, LanguageModelToolResult } from '../../../vscodeTypes';
import { IPatentBackendClient, PatentBackendError } from '../../patentai/vscode-node/patentBackendClient';
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

interface AnalyticsData {
	byYear: { year: number; count: number }[];
	byCountry: { country: string; count: number }[];
	topAssignees: { assignee: string; count: number }[];
	topCPC: { cpc: string; count: number }[];
}

interface AnalyticsResponse {
	success: boolean;
	searchDescription: string;  // Human-readable description of what was searched
	request: {
		keywords?: string[];
		phrases?: string[];
		assignee?: string;
		cpc?: string[];
		ipc?: string[];
		countryCode?: string;
		dateFrom?: string;
		dateTo?: string;
	};
	analytics: AnalyticsData;
	error?: string;
}

/**
 * Tool for fetching patent analytics from the FlowLeap backend (via the shared {@link IPatentBackendClient}
 * seam, so it inherits the centralized `401 → re-sign-in` / `402 → start-trial` gating). Returns raw
 * analytics data that the agent can use to create visualizations.
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

		const { query, keywords, phrases, assignee, cpc, ipc, classification, dateFrom, dateTo, countryCode } = options.input;

		// Check for valid search criteria
		const hasSearch = (keywords && keywords.length > 0) ||
			(phrases && phrases.length > 0) ||
			assignee ||
			(cpc && cpc.length > 0) ||
			(ipc && ipc.length > 0) ||
			classification ||
			query;

		if (!hasSearch) {
			return new LanguageModelToolResult([
				new LanguageModelTextPart('Error: Provide at least one of: keywords, phrases, assignee, cpc, ipc, or query')
			]);
		}

		try {
			// Build V2 API request - send keywords/phrases directly, no parsing needed
			const requestBody: Record<string, unknown> = {};

			// Structured search (preferred)
			if (keywords && keywords.length > 0) {
				requestBody.keywords = keywords;
			}
			if (phrases && phrases.length > 0) {
				requestBody.phrases = phrases;
			}

			// Legacy fallback
			if (query && !requestBody.keywords && !requestBody.phrases) {
				requestBody.query = query;
			}

			// Filters
			if (assignee) {
				requestBody.assignee = assignee;
			}
			if (cpc && cpc.length > 0) {
				requestBody.cpc = cpc;
			} else if (classification) {
				// Legacy classification param maps to cpc
				requestBody.cpc = [classification];
			}
			if (ipc && ipc.length > 0) {
				requestBody.ipc = ipc;
			}
			if (countryCode) {
				requestBody.countryCode = countryCode;
			}
			if (dateFrom) {
				requestBody.dateFrom = dateFrom;
			}
			if (dateTo) {
				requestBody.dateTo = dateTo;
			}

			const result = await this.patentBackendClient.post<AnalyticsResponse>('/patent-analytics', requestBody, token);

			this.logService.info('[PatentAnalyticsTool] Result received');

			if (!result.success) {
				return new LanguageModelToolResult([
					new LanguageModelTextPart(`Error: ${result.error || 'Unknown error'}`)
				]);
			}

			// Format analytics data for LLM
			const formattedResponse = this.formatAnalytics(result.searchDescription, result.analytics);

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
					new LanguageModelTextPart(`Error: Patent analytics returned ${error.status}: ${error.message}`)
				]);
			}
			this.logService.error(`[PatentAnalyticsTool] Exception: ${error instanceof Error ? error.message : String(error)}`);
			return new LanguageModelToolResult([
				new LanguageModelTextPart(`Error: ${error instanceof Error ? error.message : 'Unknown error occurred'}`)
			]);
		}
	}

	/**
	 * Format analytics data for LLM consumption
	 */
	private formatAnalytics(searchDescription: string, analytics: AnalyticsData): string {
		const totalPatents = analytics.byYear.reduce((sum, y) => sum + y.count, 0);
		const peakYear = analytics.byYear.reduce((max, y) => y.count > max.count ? y : max, analytics.byYear[0] || { year: 0, count: 0 });

		const lines: string[] = [
			'## Patent Analytics Results',
			'',
			`**Search**: ${searchDescription}`,
			'',
			'### Summary',
			`- Total Patents: ${totalPatents.toLocaleString()}`,
			`- Peak Year: ${peakYear.year} (${peakYear.count.toLocaleString()} patents)`,
			`- Top Country: ${analytics.byCountry[0]?.country || 'N/A'}`,
			`- Top Assignee: ${analytics.topAssignees[0]?.assignee || 'N/A'}`,
			`- Main Technology: ${analytics.topCPC[0]?.cpc || 'N/A'}`,
			'',
			'### Yearly Trends',
		];

		analytics.byYear.forEach(y => {
			lines.push(`- ${y.year}: ${y.count.toLocaleString()}`);
		});

		lines.push('', '### Top Countries');
		analytics.byCountry.slice(0, 10).forEach(c => {
			lines.push(`- ${c.country}: ${c.count.toLocaleString()}`);
		});

		lines.push('', '### Top Assignees');
		analytics.topAssignees.slice(0, 10).forEach(a => {
			lines.push(`- ${a.assignee}: ${a.count.toLocaleString()}`);
		});

		lines.push('', '### Technology Areas (CPC)');
		analytics.topCPC.slice(0, 10).forEach(c => {
			lines.push(`- ${c.cpc}: ${c.count.toLocaleString()}`);
		});

		lines.push(
			'',
			'---',
			'Use this data to create visualizations. You can:',
			'1. Create a Python script with matplotlib/plotly to visualize trends',
			'2. Generate a markdown report with the analysis',
			'3. Build interactive dashboards'
		);

		return lines.join('\n');
	}
}

ToolRegistry.registerTool(PatentAnalyticsVizTool);
