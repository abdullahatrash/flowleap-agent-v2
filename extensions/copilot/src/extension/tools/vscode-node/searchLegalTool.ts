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

interface ISearchLegalParams {
	query: string;
	jurisdiction?: 'EPO' | 'USPTO' | 'EU' | 'WIPO';
	comprehensive?: boolean;
	limit?: number;
}

interface LegalChunkResult {
	chunk_id?: string;
	document_id?: string;
	jurisdiction?: string;
	source?: string;
	section?: string;
	title?: string;
	chunk_text?: string;
	source_url?: string;
	version?: string;
	similarity?: number;
	combined_score?: number;
	context?: {
		prev_chunk?: string;
		next_chunk?: string;
	};
}

interface LegalComprehensiveResult {
	document_id?: string;
	jurisdiction?: string;
	source?: string;
	section?: string;
	title?: string;
	source_url?: string;
	version?: string;
	relevance_score?: number;
	full_content?: string;
	key_excerpts?: string[];
	citation?: string;
}

/** `data` payload of the `reference_search` facade tool. */
interface LegalSearchData {
	query?: string;
	jurisdiction?: string;
	search_mode?: string;
	comprehensive?: boolean;
	results?: LegalChunkResult[] | LegalComprehensiveResult[];
	count?: number;
}

/**
 * PRIMARY tool for patent law / procedure lookups: searches MPEP (USPTO), EPC, and EPO Guidelines
 * through the FlowLeap backend's `reference_search` facade tool. Routes through the shared
 * {@link IPatentBackendClient} seam, so it inherits the centralized `401 → re-sign-in` /
 * `402 → start-trial` gating instead of fetching the backend directly.
 */
export class SearchLegalTool implements ICopilotTool<ISearchLegalParams> {

	public static readonly toolName = ToolName.SearchLegal;

	constructor(
		@ILogService private readonly logService: ILogService,
		@IPatentBackendClient private readonly patentBackendClient: IPatentBackendClient,
	) { }

	prepareInvocation(_options: vscode.LanguageModelToolInvocationPrepareOptions<ISearchLegalParams>, _token: CancellationToken): vscode.ProviderResult<vscode.PreparedToolInvocation> {
		const { query, jurisdiction, comprehensive } = _options.input;
		const filters: string[] = [];
		if (jurisdiction) {
			filters.push(jurisdiction);
		}
		if (comprehensive) {
			filters.push('full sections');
		}
		const suffix = filters.length > 0 ? ` (${filters.join(', ')})` : '';
		return {
			invocationMessage: l10n.t`Searching legal sources for: ${query}${suffix}`,
			confirmationMessages: {
				title: l10n.t`Search Legal Sources`,
				message: l10n.t`Allow Patent AI to search legal sources for: ${query}?`
			}
		};
	}

	async invoke(options: vscode.LanguageModelToolInvocationOptions<ISearchLegalParams>, token: CancellationToken): Promise<vscode.LanguageModelToolResult> {
		this.logService.trace('[SearchLegalTool] Invoking legal search');

		const { query, jurisdiction, comprehensive = false, limit = 10 } = options.input;

		if (!query || query.trim().length < 3) {
			return new LanguageModelToolResult([
				new LanguageModelTextPart('Error: query must be at least 3 characters.')
			]);
		}

		try {
			const input: {
				query: string;
				limit: number;
				comprehensive: boolean;
				jurisdiction?: string;
			} = {
				query,
				limit,
				comprehensive,
			};
			if (jurisdiction) {
				input.jurisdiction = jurisdiction;
			}

			const data = await callFacadeTool<LegalSearchData>(this.patentBackendClient, 'reference_search', input, token);

			const formatted = this.formatSearchResults(data, { query, jurisdiction, comprehensive, limit });
			this.logService.info(`[SearchLegalTool] Formatted response length: ${formatted.length} chars`);

			return new LanguageModelToolResult([
				new LanguageModelTextPart(formatted)
			]);
		} catch (error) {
			return handlePatentToolError(error, this.logService, '[SearchLegalTool]', err => `Error: Legal search backend returned ${err.status}: ${err.message}`);
		}
	}

	private formatSearchResults(
		result: LegalSearchData,
		query: { query: string; jurisdiction?: string; comprehensive: boolean; limit: number }
	): string {
		const lines: string[] = [];
		const results = result.results ?? [];

		lines.push(`Found ${results.length} legal results for: "${query.query}"`);
		if (query.jurisdiction) {
			lines.push(`Jurisdiction filter: ${query.jurisdiction}`);
		}
		lines.push(`Mode: ${query.comprehensive ? 'comprehensive (full sections)' : 'chunks (matched passages)'}`);
		lines.push('');

		if (results.length === 0) {
			lines.push('No legal results matched the query.');
			lines.push('');
			lines.push('For advanced search (specific source filters, custom search modes, similarity tuning), use legal_search_guide.');
			return lines.join('\n');
		}

		if (query.comprehensive) {
			this.formatComprehensiveResults(lines, results as LegalComprehensiveResult[]);
		} else {
			this.formatChunkResults(lines, results as LegalChunkResult[]);
		}

		lines.push('For advanced search (specific source filters, custom search modes, similarity tuning), use legal_search_guide.');
		return lines.join('\n');
	}

	private formatChunkResults(lines: string[], results: LegalChunkResult[]): void {
		let index = 1;
		for (const chunk of results) {
			const heading = this.buildHeading(chunk.source, chunk.section, chunk.title, chunk.jurisdiction);
			lines.push(`Result ${index++}: ${heading}`);
			if (typeof chunk.similarity === 'number') {
				lines.push(`  Similarity: ${chunk.similarity.toFixed(3)}`);
			}
			if (chunk.chunk_text) {
				lines.push(`  Text: ${this.truncate(chunk.chunk_text, 800)}`);
			}
			if (chunk.source_url) {
				lines.push(`  Source: ${chunk.source_url}`);
			}
			if (chunk.context?.prev_chunk || chunk.context?.next_chunk) {
				if (chunk.context.prev_chunk) {
					lines.push(`  Prev context: ${this.truncate(chunk.context.prev_chunk, 200)}`);
				}
				if (chunk.context.next_chunk) {
					lines.push(`  Next context: ${this.truncate(chunk.context.next_chunk, 200)}`);
				}
			}
			lines.push('');
		}
	}

	private formatComprehensiveResults(lines: string[], results: LegalComprehensiveResult[]): void {
		let index = 1;
		for (const doc of results) {
			const heading = this.buildHeading(doc.source, doc.section, doc.title, doc.jurisdiction);
			lines.push(`Document ${index++}: ${heading}`);
			if (doc.citation) {
				lines.push(`  Citation: ${doc.citation}`);
			}
			if (typeof doc.relevance_score === 'number') {
				lines.push(`  Relevance: ${doc.relevance_score.toFixed(3)}`);
			}
			if (doc.full_content) {
				lines.push(`  Full content: ${this.truncate(doc.full_content, 2000)}`);
			} else if (doc.key_excerpts && doc.key_excerpts.length > 0) {
				lines.push('  Key excerpts:');
				for (const excerpt of doc.key_excerpts) {
					lines.push(`    - ${this.truncate(excerpt, 400)}`);
				}
			}
			if (doc.source_url) {
				lines.push(`  Source: ${doc.source_url}`);
			}
			lines.push('');
		}
	}

	private buildHeading(source?: string, section?: string, title?: string, jurisdiction?: string): string {
		const parts: string[] = [];
		if (source) {
			parts.push(source);
		}
		if (section) {
			parts.push(section);
		}
		if (title && title !== section) {
			parts.push(`— ${title}`);
		}
		if (jurisdiction) {
			parts.push(`[${jurisdiction}]`);
		}
		return parts.length > 0 ? parts.join(' ') : '(untitled)';
	}

	private truncate(text: string, max: number): string {
		if (text.length <= max) {
			return text;
		}
		return text.substring(0, max) + '...';
	}
}

ToolRegistry.registerTool(SearchLegalTool);
