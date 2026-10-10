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
import { callFacadeTool } from './patentFacade';
import { handlePatentToolError } from './patentToolError';
import { ToolName } from '../common/toolNames';
import { ICopilotTool, ToolRegistry } from '../common/toolsRegistry';

interface ISearchAcademicParams {
	query: string;
	sources?: string[]; // e.g., ['scholar', 'arxiv']
	maxResults?: number;
	fromYear?: number;
	toYear?: number;
}

/** Facade source names. The tool's own input keeps the lib's historical `scholar` spelling. */
type FacadeSource = 'semantic-scholar' | 'arxiv';

interface AcademicPaper {
	title: string;
	authors: string[];
	abstract?: string;
	url: string;
	source: string; // 'scholar' | 'arxiv'
	year?: string;
	citations?: number;
	doi?: string;
	/** Other sources that returned the same paper. */
	alsoIn?: string[];
}

/** What one source did for the search (absent from older backends). */
interface AcademicSourceReport {
	source: string;
	status: 'ok' | 'rate_limited' | 'error';
	returned: number;
	totalHits?: number;
	message?: string;
}

/** `data` payload of the `search_academic` facade tool. */
interface AcademicSearchData {
	total?: number;
	papers?: AcademicPaper[];
	query?: string;
	sources?: AcademicSourceReport[];
}

const SOURCE_LABEL: Record<string, string> = { scholar: 'Semantic Scholar', arxiv: 'arXiv' };

/**
 * Tool for searching academic sources (Semantic Scholar, arXiv) for non-patent literature (NPL)
 * prior art, through the FlowLeap backend's `search_academic` facade tool. Routes through the
 * shared {@link IPatentBackendClient} seam, so it inherits the centralized `401 → re-sign-in` /
 * `402 → start-trial` gating.
 */
export class SearchAcademicTool implements ICopilotTool<ISearchAcademicParams> {

	public static readonly toolName = ToolName.SearchAcademic;

	constructor(
		@ILogService private readonly logService: ILogService,
		@IPatentBackendClient private readonly patentBackendClient: IPatentBackendClient,
	) { }

	prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<ISearchAcademicParams>, _token: CancellationToken): vscode.ProviderResult<vscode.PreparedToolInvocation> {
		const { query } = options.input;
		return {
			invocationMessage: l10n.t`Searching academic sources: ${query}`,
			confirmationMessages: {
				title: l10n.t`Search Academic Sources`,
				message: l10n.t`Allow Patent AI to search academic sources (Semantic Scholar, arXiv) for: ${query}?`
			}
		};
	}

	async invoke(options: vscode.LanguageModelToolInvocationOptions<ISearchAcademicParams>, token: CancellationToken): Promise<vscode.LanguageModelToolResult> {
		this.logService.trace('[SearchAcademicTool] Invoking academic search');

		const { query, sources = ['scholar', 'arxiv'], maxResults = 10, fromYear, toYear } = options.input;

		try {
			// The facade names the Semantic Scholar source `semantic-scholar` on input while the
			// papers it returns still carry `source: "scholar"`; map the tool's own spelling across.
			const facadeSources = sources
				.map((s): FacadeSource | undefined => (s === 'scholar' || s === 'semantic-scholar' ? 'semantic-scholar' : s === 'arxiv' ? 'arxiv' : undefined))
				.filter((s): s is FacadeSource => s !== undefined);
			const input = {
				query,
				sources: facadeSources.length > 0 ? facadeSources : ['semantic-scholar', 'arxiv'],
				max_results: maxResults,
				...(fromYear !== undefined || toYear !== undefined
					? { filter: { ...(fromYear !== undefined ? { from_year: fromYear } : {}), ...(toYear !== undefined ? { to_year: toYear } : {}) } }
					: {}),
			};

			const data = await callFacadeTool<AcademicSearchData>(this.patentBackendClient, 'search_academic', input, token);

			// Format results for LLM
			const formattedResponse = this.formatSearchResults(data);
			this.logService.info(`[SearchAcademicTool] Formatted response length: ${formattedResponse.length} chars`);

			return new LanguageModelToolResult([
				new LanguageModelTextPart(formattedResponse)
			]);

		} catch (error) {
			return handlePatentToolError(error, this.logService, '[SearchAcademicTool]', err => `Error: Academic search backend returned ${err.status}: ${err.message}`);
		}
	}

	/**
	 * Format search results for LLM consumption
	 */
	private formatSearchResults(result: AcademicSearchData): string {
		const sourceLines = this.formatSources(result.sources);
		const failed = result.sources?.filter(s => s.status !== 'ok') ?? [];

		if (!result.papers || result.papers.length === 0) {
			const lines = [`No academic papers found for query: ${result.query}`, ...sourceLines];
			if (failed.length > 0) {
				lines.push('Some sources failed, so this is not evidence that no literature exists. Retry later or use another source.');
			}
			return lines.join('\n');
		}

		const lines: string[] = [
			`Found ${result.total} academic papers matching query: "${result.query}"`,
			...sourceLines,
			`Showing top ${result.papers.length} results:`,
			''
		];

		for (let i = 0; i < result.papers.length; i++) {
			const paper = result.papers[i];
			lines.push(`${i + 1}. ${paper.title}`);

			if (paper.authors && paper.authors.length > 0) {
				lines.push(`   Authors: ${paper.authors.join(', ')}`);
			}

			if (paper.year) {
				lines.push(`   Year: ${paper.year}`);
			}

			if (paper.citations !== undefined) {
				lines.push(`   Citations: ${paper.citations}`);
			}

			const alsoIn = paper.alsoIn?.length ? ` (also in ${paper.alsoIn.map(s => SOURCE_LABEL[s] ?? s).join(', ')})` : '';
			lines.push(`   Source: ${SOURCE_LABEL[paper.source] ?? paper.source}${alsoIn}`);
			if (paper.doi) {
				lines.push(`   DOI: ${paper.doi}`);
			}
			lines.push(`   URL: ${paper.url}`);

			if (paper.abstract) {
				// Truncate abstract to first 300 chars for readability
				const abstractPreview = paper.abstract.length > 300
					? paper.abstract.substring(0, 300) + '...'
					: paper.abstract;
				lines.push(`   Abstract: ${abstractPreview}`);
			}

			lines.push(''); // Empty line between papers
		}

		lines.push('Note: Use these URLs to access full papers and detailed information.');

		return lines.join('\n');
	}

	/** One line per source: its hit count, or why it contributed nothing. */
	private formatSources(sources: AcademicSourceReport[] | undefined): string[] {
		if (!sources?.length) {
			return [];
		}
		return sources.map(s => {
			const label = SOURCE_LABEL[s.source] ?? s.source;
			if (s.status === 'ok') {
				return s.totalHits !== undefined ? `${label}: ${s.totalHits} matches` : `${label}: ${s.returned} returned`;
			}
			const why = s.status === 'rate_limited' ? 'rate limited' : 'failed';
			return `${label}: ${why}, no results from this source${s.message ? ` (${s.message})` : ''}`;
		});
	}
}

ToolRegistry.registerTool(SearchAcademicTool);
