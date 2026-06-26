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

interface ISearchCitationsParams {
	applicationNumber: string;
	category?: 'X' | 'Y' | 'A';
	examinerOnly?: boolean;
	size?: number;
}

interface CitationDoc {
	id?: string;
	applicationNumber?: string;
	citedDocument?: string;
	country?: string;
	category?: string;
	categoryDescription?: string;
	rejectedClaims?: string;
	citedPassages?: string[];
	examinerCited?: boolean;
	applicantCited?: boolean;
	isNPL?: boolean;
	officeActionDate?: string;
	officeActionType?: string;
	inventor?: string;
	techCenter?: string;
}

interface CitationSearchResult {
	success: boolean;
	total?: number;
	data?: CitationDoc[];
	applicationNumber?: string;
	cached?: boolean;
	error?: string;
}

const CATEGORY_LABELS: Record<string, string> = {
	X: 'X (novelty-destroying, 35 USC 102)',
	Y: 'Y (obviousness, 35 USC 103)',
	A: 'A (background reference)',
};

/**
 * Tool for backward citation search: finds prior-art references the USPTO examiner cited against a
 * given application, tagged with the X/Y/A relevance categories (X = novelty-destroying/102,
 * Y = obviousness/103, A = background). Routes through the shared {@link IPatentBackendClient} seam,
 * so it inherits the centralized `401 → re-sign-in` / `402 → start-trial` gating.
 */
class SearchCitationsTool implements ICopilotTool<ISearchCitationsParams> {

	public static readonly toolName = ToolName.SearchCitations;

	constructor(
		@ILogService private readonly logService: ILogService,
		@IPatentBackendClient private readonly patentBackendClient: IPatentBackendClient,
	) { }

	prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<ISearchCitationsParams>, _token: CancellationToken): vscode.ProviderResult<vscode.PreparedToolInvocation> {
		const { applicationNumber, category, examinerOnly } = options.input;
		const filters: string[] = [];
		if (category) {
			filters.push(`${category}-rated only`);
		}
		if (examinerOnly) {
			filters.push('examiner-cited only');
		}
		const suffix = filters.length > 0 ? ` (${filters.join(', ')})` : '';
		return {
			invocationMessage: l10n.t`Searching citations for application ${applicationNumber}${suffix}`,
			confirmationMessages: {
				title: l10n.t`Search Citations`,
				message: l10n.t`Allow Patent AI to search citations for application ${applicationNumber}?`
			}
		};
	}

	async invoke(options: vscode.LanguageModelToolInvocationOptions<ISearchCitationsParams>, token: CancellationToken): Promise<vscode.LanguageModelToolResult> {
		this.logService.trace('[SearchCitationsTool] Invoking citation search');

		const { applicationNumber, category, examinerOnly = false, size = 100 } = options.input;

		const normalized = applicationNumber.replace(/[\/,\s]/g, '');

		try {
			const requestBody: {
				applicationNumber: string;
				size: number;
				examinerCitedOnly: boolean;
				category?: string;
			} = {
				applicationNumber: normalized,
				size,
				examinerCitedOnly: examinerOnly,
			};
			if (category) {
				requestBody.category = category;
			}

			const result = await this.patentBackendClient.post<CitationSearchResult>('/citation-search', requestBody, token);

			if (!result.success) {
				this.logService.error(`[SearchCitationsTool] Search failed: ${result.error}`);
				return new LanguageModelToolResult([
					new LanguageModelTextPart(`Error searching citations: ${result.error ?? 'unknown error'}`)
				]);
			}

			const formatted = this.formatSearchResults(result, { applicationNumber: normalized, category, examinerOnly, size });
			this.logService.info(`[SearchCitationsTool] Formatted response length: ${formatted.length} chars`);

			return new LanguageModelToolResult([
				new LanguageModelTextPart(formatted)
			]);
		} catch (error) {
			if (error instanceof PatentBackendError) {
				if (error.message === 'Request cancelled.') {
					return new LanguageModelToolResult([new LanguageModelTextPart('Request cancelled.')]);
				}
				this.logService.error(`[SearchCitationsTool] Backend error ${error.status}: ${error.message}`);
				return new LanguageModelToolResult([
					new LanguageModelTextPart(`Error: Citation search backend returned ${error.status}: ${error.message}`)
				]);
			}
			this.logService.error(`[SearchCitationsTool] Exception: ${error instanceof Error ? error.message : String(error)}`);
			return new LanguageModelToolResult([
				new LanguageModelTextPart(`Error: ${error instanceof Error ? error.message : 'Unknown error occurred'}`)
			]);
		}
	}

	private formatSearchResults(
		result: CitationSearchResult,
		query: { applicationNumber: string; category?: string; examinerOnly: boolean; size: number }
	): string {
		const lines: string[] = [];
		const total = result.total ?? result.data?.length ?? 0;

		lines.push(`Found ${total} citations for application ${query.applicationNumber}`);
		if (query.category) {
			lines.push(`Category filter: ${CATEGORY_LABELS[query.category] ?? query.category}`);
		}
		if (query.examinerOnly) {
			lines.push('Examiner-cited only: yes');
		}
		lines.push('');

		if (!result.data || result.data.length === 0) {
			lines.push('No citations found matching the filters.');
			lines.push('');
			lines.push('For forward citations, citation statistics, or date-range filtering, use citation_api_guide.');
			return lines.join('\n');
		}

		let index = 1;
		for (const doc of result.data) {
			lines.push(`Citation ${index++}`);
			if (doc.citedDocument) {
				const nplTag = doc.isNPL ? ' (non-patent literature)' : '';
				const countryTag = doc.country && !doc.isNPL ? ` [${doc.country}]` : '';
				lines.push(`  Cited document: ${doc.citedDocument}${countryTag}${nplTag}`);
			}
			if (doc.category) {
				lines.push(`  Category: ${CATEGORY_LABELS[doc.category] ?? doc.category}`);
			}
			if (doc.rejectedClaims) {
				lines.push(`  Rejected claims: ${doc.rejectedClaims}`);
			}
			const citingParties: string[] = [];
			if (doc.examinerCited) {
				citingParties.push('examiner');
			}
			if (doc.applicantCited) {
				citingParties.push('applicant');
			}
			if (citingParties.length > 0) {
				lines.push(`  Cited by: ${citingParties.join(', ')}`);
			}
			if (doc.officeActionDate) {
				lines.push(`  Office action date: ${doc.officeActionDate}`);
			}
			if (doc.officeActionType) {
				lines.push(`  Office action type: ${doc.officeActionType}`);
			}
			if (doc.inventor) {
				lines.push(`  Inventor: ${doc.inventor}`);
			}
			if (doc.citedPassages && doc.citedPassages.length > 0) {
				const joined = doc.citedPassages.join(' | ');
				const preview = joined.length > 200 ? joined.substring(0, 200) + '...' : joined;
				lines.push(`  Cited passages: ${preview}`);
			}
			lines.push('');
		}

		if (total > result.data.length) {
			lines.push(`Showing first ${result.data.length} of ${total}. Re-call with a larger size to see more.`);
			lines.push('');
		}

		lines.push('For forward citations, citation statistics, or date-range filtering, use citation_api_guide.');

		return lines.join('\n');
	}
}

ToolRegistry.registerTool(SearchCitationsTool);
