/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import type * as vscode from 'vscode';
import { ILogService } from '../../../platform/log/common/logService';
import { CancellationToken } from '../../../util/vs/base/common/cancellation';
import { LanguageModelTextPart, LanguageModelToolResult } from '../../../vscodeTypes';
import { IPatentBackendClient, PatentBackendError, patentBackendErrorRecoveryHint } from '../../patentai/vscode-node/patentBackendClient';
import { ToolName } from '../common/toolNames';
import { ICopilotTool, ToolRegistry } from '../common/toolsRegistry';

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

interface PatentSearchResult {
	success: boolean;
	total?: number;
	range?: {
		begin: number;
		end: number;
	};
	docs?: PatentDoc[];
	query?: string;
	error?: string;
}

/**
 * Tool for searching patent databases using CQL (Common Patent Query Language). Calls the FlowLeap
 * backend (which handles EPO OPS API authentication) through the shared {@link IPatentBackendClient}
 * seam, so it inherits the centralized `401 → re-sign-in` / `402 → start-trial` gating.
 */
class SearchPatentsTool implements ICopilotTool<ISearchPatentsParams> {

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
			// Build request body, only include countries if specified
			const requestBody: { query: string; range: string; countries?: string } = { query, range };
			if (countries) {
				requestBody.countries = countries;
			}

			const result = await this.patentBackendClient.post<PatentSearchResult>('/patent-search', requestBody, token);

			if (!result.success) {
				this.logService.error(`[SearchPatentsTool] Search failed: ${result.error}`);
				return new LanguageModelToolResult([
					new LanguageModelTextPart(`Error searching patents: ${result.error}`)
				]);
			}

			// Format results for LLM
			const formattedResponse = this.formatSearchResults(result);
			this.logService.info(`[SearchPatentsTool] Formatted response length: ${formattedResponse.length} chars`);

			return new LanguageModelToolResult([
				new LanguageModelTextPart(formattedResponse)
			]);

		} catch (error) {
			if (error instanceof PatentBackendError) {
				if (error.message === 'Request cancelled.') {
					return new LanguageModelToolResult([new LanguageModelTextPart('Request cancelled.')]);
				}
				this.logService.error(`[SearchPatentsTool] Backend error ${error.status}: ${error.message}`);
				return new LanguageModelToolResult([
					new LanguageModelTextPart(`Error: Patent search backend returned ${error.status}: ${error.message}` + patentBackendErrorRecoveryHint(error))
				]);
			}
			this.logService.error(`[SearchPatentsTool] Exception: ${error instanceof Error ? error.message : String(error)}`);
			return new LanguageModelToolResult([
				new LanguageModelTextPart(`Error: ${error instanceof Error ? error.message : 'Unknown error occurred'}`)
			]);
		}
	}

	/**
	 * Format search results for LLM consumption
	 */
	private formatSearchResults(result: PatentSearchResult): string {
		if (!result.success || !result.docs || result.docs.length === 0) {
			return `No patents found for query: ${result.query}`;
		}

		const lines: string[] = [
			`Found ${result.total} patents matching query: "${result.query}"`,
			`Showing results ${result.range?.begin}-${result.range?.end}:`,
			''
		];

		for (const doc of result.docs) {
			lines.push(`${doc.docId}`);

			if (doc.title) {
				lines.push(`  Title: ${doc.title}`);
			}

			if (doc.applicants && doc.applicants.length > 0) {
				lines.push(`  Applicants: ${doc.applicants.join(', ')}`);
			}

			if (doc.publicationDate) {
				lines.push(`  Published: ${doc.publicationDate}`);
			}

			if (doc.abstract) {
				// Truncate abstract to first 200 chars for readability
				const abstractPreview = doc.abstract.length > 200
					? doc.abstract.substring(0, 200) + '...'
					: doc.abstract;
				lines.push(`  Abstract: ${abstractPreview}`);
			}

			lines.push(''); // Empty line between patents
		}

		lines.push('Note: Use these patent document IDs to fetch detailed information (full claims, descriptions, etc.) if needed.');

		return lines.join('\n');
	}
}

ToolRegistry.registerTool(SearchPatentsTool);
