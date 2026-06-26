/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import type * as vscode from 'vscode';
import { ILogService } from '../../../platform/log/common/logService';
import { CancellationToken } from '../../../util/vs/base/common/cancellation';
import { LanguageModelTextPart, LanguageModelToolResult } from '../../../vscodeTypes';
import { IPatentBackendClient, PatentBackendError } from '../../patentai/vscode-node/patentBackendClient';
import { ToolName } from '../common/toolNames';
import { ICopilotTool, ToolRegistry } from '../common/toolsRegistry';

interface ISearchAcademicParams {
	query: string;
	sources?: string[]; // e.g., ['scholar', 'arxiv']
	maxResults?: number;
}

interface AcademicPaper {
	title: string;
	authors: string[];
	abstract?: string;
	url: string;
	source: string; // 'scholar' | 'arxiv' | 'pubmed' etc
	year?: string;
	citations?: number;
}

interface AcademicSearchResult {
	success: boolean;
	total?: number;
	papers?: AcademicPaper[];
	query?: string;
	error?: string;
}

/**
 * Tool for searching academic sources (Google Scholar, arXiv, PubMed) for non-patent literature
 * (NPL) prior art. Calls the FlowLeap backend (which handles upstream API authentication) through
 * the shared {@link IPatentBackendClient} seam, so it inherits the centralized `401 → re-sign-in` /
 * `402 → start-trial` gating.
 */
class SearchAcademicTool implements ICopilotTool<ISearchAcademicParams> {

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
				message: l10n.t`Allow Patent AI to search academic sources (Google Scholar, arXiv) for: ${query}?`
			}
		};
	}

	async invoke(options: vscode.LanguageModelToolInvocationOptions<ISearchAcademicParams>, token: CancellationToken): Promise<vscode.LanguageModelToolResult> {
		this.logService.trace('[SearchAcademicTool] Invoking academic search');

		const { query, sources = ['scholar', 'arxiv'], maxResults = 10 } = options.input;

		try {
			const result = await this.patentBackendClient.post<AcademicSearchResult>('/academic-search', { query, sources, maxResults }, token);

			if (!result.success) {
				this.logService.error(`[SearchAcademicTool] Search failed: ${result.error}`);
				return new LanguageModelToolResult([
					new LanguageModelTextPart(`Error searching academic sources: ${result.error}`)
				]);
			}

			// Format results for LLM
			const formattedResponse = this.formatSearchResults(result);
			this.logService.info(`[SearchAcademicTool] Formatted response length: ${formattedResponse.length} chars`);

			return new LanguageModelToolResult([
				new LanguageModelTextPart(formattedResponse)
			]);

		} catch (error) {
			if (error instanceof PatentBackendError) {
				if (error.message === 'Request cancelled.') {
					return new LanguageModelToolResult([new LanguageModelTextPart('Request cancelled.')]);
				}
				this.logService.error(`[SearchAcademicTool] Backend error ${error.status}: ${error.message}`);
				return new LanguageModelToolResult([
					new LanguageModelTextPart(`Error: Academic search backend returned ${error.status}: ${error.message}`)
				]);
			}
			this.logService.error(`[SearchAcademicTool] Exception: ${error instanceof Error ? error.message : String(error)}`);
			return new LanguageModelToolResult([
				new LanguageModelTextPart(`Error: ${error instanceof Error ? error.message : 'Unknown error occurred'}`)
			]);
		}
	}

	/**
	 * Format search results for LLM consumption
	 */
	private formatSearchResults(result: AcademicSearchResult): string {
		if (!result.success || !result.papers || result.papers.length === 0) {
			return `No academic papers found for query: ${result.query}`;
		}

		const lines: string[] = [
			`Found ${result.total} academic papers matching query: "${result.query}"`,
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

			lines.push(`   Source: ${paper.source}`);
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
}

ToolRegistry.registerTool(SearchAcademicTool);
