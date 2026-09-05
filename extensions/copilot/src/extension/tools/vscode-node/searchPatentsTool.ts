/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import type * as vscode from 'vscode';
import { ILogService } from '../../../platform/log/common/logService';
import { CancellationToken } from '../../../util/vs/base/common/cancellation';
import { LanguageModelTextPart, LanguageModelToolResult } from '../../../vscodeTypes';
import { PatentDocumentReference } from '../../patentai/common/patentDocumentReference';
import { patentCitationLink } from '../../patentai/vscode-node/patentCitationLink';
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
	documentReference?: PatentDocumentReference | null;
	docId: string;
	title: string | null;
	abstract: string | null;
	applicants: string[];
	publicationDate: string | null;
}

/** `data` payload of the `search_patents` facade tool with `provider: 'epo_ops'`. */
interface PatentSearchData {
	/** OPS's count of every CQL match worldwide — NOT reduced by `countryFilter`. */
	total?: number;
	/** Documents left on this page after the backend's country post-filter. */
	returned?: number;
	/** The country filter the backend applied to this page, when one was requested. */
	countryFilter?: string[];
	/** The CQL actually sent to OPS — carries the compiled country clause when a filter was requested. */
	effectiveQuery?: string;
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
		const docs = result.docs ?? [];
		const filter = result.countryFilter && result.countryFilter.length > 0 ? result.countryFilter.join(',') : undefined;
		const worldwideTotal = result.total ?? 0;
		// A backend that compiles the filter into the CQL echoes `effectiveQuery` (PRD 0001 S7);
		// then `total` already counts the filtered set. Older backends post-filter the page.
		const filterInQuery = result.effectiveQuery !== undefined;
		const sentQuery = result.effectiveQuery ?? query;

		if (docs.length === 0) {
			if (filterInQuery && worldwideTotal > 0) {
				return `Found ${worldwideTotal} patents matching CQL: "${sentQuery}", but range ${result.range?.begin}-${result.range?.end} holds none of them — request a range within 1-${worldwideTotal}.`;
			}
			// Legacy backend: the country filter is a page-level post-filter — OPS matched `total`
			// documents worldwide, and none on THIS page carried an allowed country code.
			// Reporting that as "no patents found" was a false negative (2026-09-02: a count
			// probe on `ti=helmet and ti=brake` read 0 while OPS held 38, two of them EP/WO).
			if (filter && worldwideTotal > 0) {
				return [
					`Found ${worldwideTotal} patents matching query: "${query}" worldwide, but none of the ${result.range?.begin}-${result.range?.end} on this page are in the country filter [${filter}].`,
					`This is NOT a zero-hit query. To count the [${filter}] hits, either re-run with a wider range (e.g. "1-100") or put the filter into the CQL instead (e.g. append \`and pn any "${result.countryFilter!.join(' ')}"\`) so the total reflects it.`,
				].join('\n');
			}
			return `No patents found for query: ${query}`;
		}

		// `total` is optional in the backend response; fall back to the number of
		// returned docs so the summary never reads "Found undefined patents".
		const total = result.total ?? docs.length;
		const lines: string[] = [
			filterInQuery && filter
				? `Found ${total} patents matching CQL: "${sentQuery}" (country filter [${filter}] is part of the query, so this total counts only those offices)`
				: filter
					? `Found ${total} patents matching query: "${query}" worldwide; ${result.returned ?? docs.length} of the ${result.range?.begin}-${result.range?.end} on this page are in the country filter [${filter}]. The worldwide total is not a count of [${filter}] hits.`
					: `Found ${total} patents matching query: "${query}"`,
			`Showing results ${result.range?.begin}-${result.range?.end}:`,
			''
		];

		lines.push(renderMarkdownTable(docs, [
			{ header: 'Publication', cell: doc => patentCitationLink(doc.docId, doc.documentReference) },
			{ header: 'Title', cell: doc => doc.title ?? '—' },
			{ header: 'Assignee', cell: doc => doc.applicants.length > 0 ? doc.applicants.join(', ') : '—' },
			{ header: 'Published', cell: doc => doc.publicationDate ?? '—' },
		]));

		// Abstracts are too long for a table cell; render them as per-row snippets below the table.
		const withAbstract = docs.filter(doc => doc.abstract);
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
