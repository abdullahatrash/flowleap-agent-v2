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

/** Publication types the backend's `search_npl` accepts. */
export type NplPublicationType =
	| 'journal-article'
	| 'proceedings-article'
	| 'book-chapter'
	| 'preprint'
	| 'review'
	| 'book'
	| 'dissertation'
	| 'report'
	| 'standard'
	| 'dataset';

interface ISearchNplParams {
	query: string;
	fromYear?: number;
	toYear?: number;
	openAccess?: boolean;
	type?: NplPublicationType;
	limit?: number;
	page?: number;
}

interface ScholarlyWork {
	id: string;
	doi: string | null;
	title: string;
	abstract: string | null;
	publicationDate: string | null;
	type: string;
	citedByCount: number;
	isOpenAccess: boolean;
	openAccessUrl: string | null;
	authors: string[];
	source: string | null;
}

/** `data` payload of the `search_npl` facade tool. */
interface NplSearchData {
	total?: number;
	page?: number;
	perPage?: number;
	results?: ScholarlyWork[];
	query?: string;
}

/** Abstract characters shown per work; the agent reads more through the DOI or open-access URL. */
const ABSTRACT_PREVIEW_CHARS = 400;

/**
 * Searches non-patent literature in OpenAlex (250M+ scholarly works: journal articles,
 * proceedings, book chapters, preprints, theses, reports, standards) through the FlowLeap
 * backend's `search_npl` facade tool. Results are ranked by relevance and carry the DOI,
 * venue, citation count, abstract and open-access link. Routes through the shared
 * {@link IPatentBackendClient} seam, so it inherits the centralized `401 → re-sign-in` /
 * `402 → start-trial` gating.
 */
export class SearchNplTool implements ICopilotTool<ISearchNplParams> {

	public static readonly toolName = ToolName.SearchNpl;

	constructor(
		@ILogService private readonly logService: ILogService,
		@IPatentBackendClient private readonly patentBackendClient: IPatentBackendClient,
	) { }

	prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<ISearchNplParams>, _token: CancellationToken): vscode.ProviderResult<vscode.PreparedToolInvocation> {
		const { query } = options.input;
		return {
			invocationMessage: l10n.t`Searching non-patent literature: ${query}`,
			confirmationMessages: {
				title: l10n.t`Search Non-Patent Literature`,
				message: l10n.t`Allow Patent AI to search scholarly literature (OpenAlex) for: ${query}?`
			}
		};
	}

	async invoke(options: vscode.LanguageModelToolInvocationOptions<ISearchNplParams>, token: CancellationToken): Promise<vscode.LanguageModelToolResult> {
		this.logService.trace('[SearchNplTool] Invoking NPL search');

		const { query, fromYear, toYear, openAccess, type, limit = 10, page = 1 } = options.input;

		try {
			const filter: Record<string, unknown> = {};
			if (fromYear !== undefined) {
				filter.from_year = fromYear;
			}
			if (toYear !== undefined) {
				filter.to_year = toYear;
			}
			if (openAccess) {
				filter.open_access = true;
			}
			if (type) {
				filter.type = type;
			}
			const input = {
				query,
				limit: Math.min(Math.max(limit, 1), 50),
				page: Math.max(page, 1),
				...(Object.keys(filter).length > 0 ? { filter } : {}),
			};

			const data = await callFacadeTool<NplSearchData>(this.patentBackendClient, 'search_npl', input, token);

			const formattedResponse = this.formatSearchResults(data, query);
			this.logService.info(`[SearchNplTool] Formatted response length: ${formattedResponse.length} chars`);

			return new LanguageModelToolResult([
				new LanguageModelTextPart(formattedResponse)
			]);

		} catch (error) {
			return handlePatentToolError(error, this.logService, '[SearchNplTool]', err => `Error: NPL search backend returned ${err.status}: ${err.message}`);
		}
	}

	/**
	 * Format search results for LLM consumption
	 */
	private formatSearchResults(result: NplSearchData, query: string): string {
		const works = result.results ?? [];
		if (works.length === 0) {
			return `No non-patent literature found in OpenAlex for query: "${result.query ?? query}". Reformulate (synonyms, broader terms, drop a filter) before concluding there is no NPL.`;
		}

		const page = result.page ?? 1;
		const lines: string[] = [
			`OpenAlex: ${result.total ?? works.length} works match "${result.query ?? query}" (ranked by relevance).`,
			`Showing ${works.length} on page ${page}:`,
			''
		];

		works.forEach((work, i) => {
			lines.push(`${i + 1}. ${work.title}`);

			if (work.authors?.length) {
				lines.push(`   Authors: ${work.authors.join(', ')}`);
			}

			// The publication date is what a prior-art cutoff is checked against.
			const published = [work.publicationDate && `Published: ${work.publicationDate}`, work.source && `in ${work.source}`].filter(Boolean).join(' ');
			if (published) {
				lines.push(`   ${published}`);
			}

			lines.push(`   Type: ${work.type} · Citations: ${work.citedByCount}`);

			if (work.doi) {
				lines.push(`   DOI: https://doi.org/${work.doi}`);
			}
			if (work.openAccessUrl) {
				lines.push(`   Open access: ${work.openAccessUrl}`);
			}
			lines.push(`   OpenAlex: https://openalex.org/${work.id}`);

			if (work.abstract) {
				const abstractPreview = work.abstract.length > ABSTRACT_PREVIEW_CHARS
					? work.abstract.substring(0, ABSTRACT_PREVIEW_CHARS) + '...'
					: work.abstract;
				lines.push(`   Abstract: ${abstractPreview}`);
			}

			lines.push('');
		});

		const shown = (page - 1) * (result.perPage ?? works.length) + works.length;
		if (result.total !== undefined && result.total > shown) {
			lines.push(`More results: call again with page=${page + 1}, or narrow with fromYear/toYear/type.`);
		}
		lines.push('Cite a work by title, authors, venue, publication date and DOI. Open the DOI or open-access link with fetch_webpage to read beyond the abstract.');

		return lines.join('\n');
	}
}

ToolRegistry.registerTool(SearchNplTool);
