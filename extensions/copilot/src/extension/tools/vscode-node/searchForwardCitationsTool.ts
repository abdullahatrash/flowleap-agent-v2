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

interface ISearchForwardCitationsParams {
	citedDocument: string;
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

interface ForwardCitationSearchResult {
	success: boolean;
	total?: number;
	data?: CitationDoc[];
	citedDocument?: string;
	cached?: boolean;
	error?: string;
}

const CATEGORY_LABELS: Record<string, string> = {
	X: 'X (novelty-destroying, 35 USC 102)',
	Y: 'Y (obviousness, 35 USC 103)',
	A: 'A (background reference)',
};

/**
 * Tool for forward citation impact analysis: finds patents that CITE a given document, tagged with
 * the X/Y/A relevance categories. Distinct from {@link SearchCitationsTool} (prior art cited AGAINST
 * an application); this takes a cited document and returns the citing patents. Routes through the
 * shared {@link IPatentBackendClient} seam, inheriting the centralized `401`/`402` gating.
 */
class SearchForwardCitationsTool implements ICopilotTool<ISearchForwardCitationsParams> {

	public static readonly toolName = ToolName.SearchForwardCitations;

	constructor(
		@ILogService private readonly logService: ILogService,
		@IPatentBackendClient private readonly patentBackendClient: IPatentBackendClient,
	) { }

	prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<ISearchForwardCitationsParams>, _token: CancellationToken): vscode.ProviderResult<vscode.PreparedToolInvocation> {
		const { citedDocument, category, examinerOnly } = options.input;
		const filters: string[] = [];
		if (category) {
			filters.push(`${category}-rated only`);
		}
		if (examinerOnly) {
			filters.push('examiner-cited only');
		}
		const suffix = filters.length > 0 ? ` (${filters.join(', ')})` : '';
		return {
			invocationMessage: l10n.t`Finding patents that cite ${citedDocument}${suffix}`,
			confirmationMessages: {
				title: l10n.t`Search Forward Citations`,
				message: l10n.t`Allow Patent AI to find patents citing ${citedDocument}?`
			}
		};
	}

	async invoke(options: vscode.LanguageModelToolInvocationOptions<ISearchForwardCitationsParams>, token: CancellationToken): Promise<vscode.LanguageModelToolResult> {
		this.logService.trace('[SearchForwardCitationsTool] Invoking forward citation search');

		const { citedDocument, category, examinerOnly = false, size = 100 } = options.input;

		try {
			const requestBody: {
				citedDocument: string;
				size: number;
				examinerCitedOnly: boolean;
				category?: string;
			} = {
				citedDocument,
				size,
				examinerCitedOnly: examinerOnly,
			};
			if (category) {
				requestBody.category = category;
			}

			const result = await this.patentBackendClient.post<ForwardCitationSearchResult>('/citation-search/forward', requestBody, token);

			if (!result.success) {
				this.logService.error(`[SearchForwardCitationsTool] Search failed: ${result.error}`);
				return new LanguageModelToolResult([
					new LanguageModelTextPart(`Error searching forward citations: ${result.error ?? 'unknown error'}`)
				]);
			}

			const formatted = this.formatSearchResults(result, { citedDocument, category, examinerOnly, size });
			this.logService.info(`[SearchForwardCitationsTool] Formatted response length: ${formatted.length} chars`);

			return new LanguageModelToolResult([
				new LanguageModelTextPart(formatted)
			]);
		} catch (error) {
			if (error instanceof PatentBackendError) {
				if (error.message === 'Request cancelled.') {
					return new LanguageModelToolResult([new LanguageModelTextPart('Request cancelled.')]);
				}
				this.logService.error(`[SearchForwardCitationsTool] Backend error ${error.status}: ${error.message}`);
				return new LanguageModelToolResult([
					new LanguageModelTextPart(`Error: Forward citation backend returned ${error.status}: ${error.message}`)
				]);
			}
			this.logService.error(`[SearchForwardCitationsTool] Exception: ${error instanceof Error ? error.message : String(error)}`);
			return new LanguageModelToolResult([
				new LanguageModelTextPart(`Error: ${error instanceof Error ? error.message : 'Unknown error occurred'}`)
			]);
		}
	}

	private formatSearchResults(
		result: ForwardCitationSearchResult,
		query: { citedDocument: string; category?: string; examinerOnly: boolean; size: number }
	): string {
		const lines: string[] = [];
		const total = result.total ?? result.data?.length ?? 0;

		lines.push(`Found ${total} patents citing ${query.citedDocument}`);
		if (query.category) {
			lines.push(`Category filter: ${CATEGORY_LABELS[query.category] ?? query.category}`);
		}
		if (query.examinerOnly) {
			lines.push('Examiner-cited only: yes');
		}
		lines.push('');

		if (!result.data || result.data.length === 0) {
			lines.push('No forward citations found matching the filters.');
			lines.push('');
			lines.push('For citation statistics or date-range filtering, use citation_api_guide.');
			return lines.join('\n');
		}

		let index = 1;
		for (const doc of result.data) {
			lines.push(`Citing patent ${index++}`);
			if (doc.applicationNumber) {
				lines.push(`  Application: ${doc.applicationNumber}`);
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
			lines.push('');
		}

		if (total > result.data.length) {
			lines.push(`Showing first ${result.data.length} of ${total}. Re-call with a larger size to see more.`);
			lines.push('');
		}

		lines.push('For citation statistics or date-range filtering, use citation_api_guide.');

		return lines.join('\n');
	}
}

ToolRegistry.registerTool(SearchForwardCitationsTool);
