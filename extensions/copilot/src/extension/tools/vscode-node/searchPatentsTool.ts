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
import { renderMarkdownTable, ToolResponseBudgets, truncatePreview } from './patentResponseFormatter';

interface ISearchPatentsParams {
	query: string;
	range?: string;
	countries?: string;
}

interface PatentDoc {
	docId: string;
	title: string | null;
	abstract: string | null;
	applicants: string[];
	publicationDate: string | null;
}

/** `data` payload of the `search_patents` facade tool with `provider: 'epo_ops'`. */
interface PatentSearchData {
	total?: number;
	range?: {
		begin: number;
		end: number;
	};
	docs?: PatentDoc[];
}

/**
 * Tool for searching patent databases using CQL (Common Patent Query Language). Calls the
 * `search_patents` tool on the FlowLeap backend's `/v1/tools` facade (which handles EPO OPS
 * authentication) through the shared {@link IPatentBackendClient} seam, so it inherits the
 * centralized `401 → re-sign-in` / `402 → start-trial` gating.
 *
 * The facade hydrates each EPO result with title, abstract, applicants and publication date by
 * default, which is what this tool's table renders.
 */
export class SearchPatentsTool implements ICopilotTool<ISearchPatentsParams> {

	public static readonly toolName = ToolName.SearchPatents;

	constructor(
		@ILogService private readonly logService: ILogService,
		@IPatentBackendClient private readonly patentBackendClient: IPatentBackendClient,
	) { }

	prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<ISearchPatentsParams>, _token: CancellationToken): vscode.ProviderResult<vscode.PreparedToolInvocation> {
		const { query } = options.input;
		return {
			invocationMessage: l10n.t`Searching patents: ${query}`,
			confirmationMessages: {
				title: l10n.t`Search Patents`,
				message: l10n.t`Allow Patent AI to search for patents using query: ${query}?`
			}
		};
	}

	async invoke(options: vscode.LanguageModelToolInvocationOptions<ISearchPatentsParams>, token: CancellationToken): Promise<vscode.LanguageModelToolResult> {
		this.logService.trace('[SearchPatentsTool] Invoking patent search');

		const { query, range = '1-25', countries } = options.input;

		try {
			// The facade takes snake_case params and a countries ARRAY (the legacy route took a
			// comma-separated string); this tool keeps its own string input and splits it here.
			const input: { query: string; provider: 'epo_ops'; range: string; countries?: string[] } = {
				query,
				provider: 'epo_ops',
				range,
			};
			const countryList = countries?.split(',').map(c => c.trim().toUpperCase()).filter(c => c.length === 2);
			if (countryList && countryList.length > 0) {
				input.countries = countryList;
			}

			const data = await callFacadeTool<PatentSearchData>(this.patentBackendClient, 'search_patents', input, token);

			// Format results for LLM
			const formattedResponse = this.formatSearchResults(data, query);
			this.logService.info(`[SearchPatentsTool] Formatted response length: ${formattedResponse.length} chars`);

			return new LanguageModelToolResult([
				new LanguageModelTextPart(formattedResponse)
			]);

		} catch (error) {
			return handlePatentToolError(error, this.logService, '[SearchPatentsTool]', err => `Error: Patent search backend returned ${err.status}: ${err.message}`);
		}
	}

	/**
	 * Format search results for LLM consumption. The facade envelope carries no echo of the query, so
	 * the caller's own query text is threaded through for the summary line.
	 */
	private formatSearchResults(result: PatentSearchData, query: string): string {
		if (!result.docs || result.docs.length === 0) {
			return `No patents found for query: ${query}`;
		}

		// `total` is optional in the backend response; fall back to the number of
		// returned docs so the summary never reads "Found undefined patents".
		const total = result.total ?? result.docs.length;
		const lines: string[] = [
			`Found ${total} patents matching query: "${query}"`,
			`Showing results ${result.range?.begin}-${result.range?.end}:`,
			''
		];

		lines.push(renderMarkdownTable(result.docs, [
			{ header: 'Publication', cell: doc => doc.docId },
			{ header: 'Title', cell: doc => doc.title ?? '—' },
			{ header: 'Assignee', cell: doc => doc.applicants.length > 0 ? doc.applicants.join(', ') : '—' },
			{ header: 'Published', cell: doc => doc.publicationDate ?? '—' },
		]));

		// Abstracts are too long for a table cell; render them as per-row snippets below the table.
		const withAbstract = result.docs.filter(doc => doc.abstract);
		if (withAbstract.length > 0) {
			lines.push('');
			lines.push('### Abstracts');
			for (const doc of withAbstract) {
				lines.push(`- **${doc.docId}**: ${truncatePreview(doc.abstract!, ToolResponseBudgets.SearchPatentsAbstract)}`);
			}
		}

		lines.push('');
		lines.push('Note: Use these patent document IDs to fetch detailed information (full claims, descriptions, etc.) if needed.');

		return lines.join('\n');
	}
}

ToolRegistry.registerTool(SearchPatentsTool);
