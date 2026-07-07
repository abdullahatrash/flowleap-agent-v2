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
import { renderMarkdownTable, ToolResponseBudgets, truncatePreview } from './patentResponseFormatter';

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

/** Renders a cited document with its country and non-patent-literature tags for a table cell. */
function citedDocumentLabel(doc: CitationDoc): string {
	if (!doc.citedDocument) {
		return '—';
	}
	const nplTag = doc.isNPL ? ' (non-patent literature)' : '';
	const countryTag = doc.country && !doc.isNPL ? ` [${doc.country}]` : '';
	return `${doc.citedDocument}${countryTag}${nplTag}`;
}

/** Renders which parties cited a reference (examiner and/or applicant) for a table cell. */
function citingPartiesLabel(doc: CitationDoc): string {
	const parties: string[] = [];
	if (doc.examinerCited) {
		parties.push('examiner');
	}
	if (doc.applicantCited) {
		parties.push('applicant');
	}
	return parties.length > 0 ? parties.join(', ') : '—';
}

/**
 * Tool for backward citation search: finds prior-art references the USPTO examiner cited against a
 * given application, tagged with the X/Y/A relevance categories (X = novelty-destroying/102,
 * Y = obviousness/103, A = background). Routes through the shared {@link IPatentBackendClient} seam,
 * so it inherits the centralized `401 → re-sign-in` / `402 → start-trial` gating.
 */
export class SearchCitationsTool implements ICopilotTool<ISearchCitationsParams> {

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
					new LanguageModelTextPart(`Error: Citation search backend returned ${error.status}: ${error.message}` + patentBackendErrorRecoveryHint(error))
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

		const rows = result.data.map((doc, i) => ({ doc, n: i + 1 }));

		lines.push(renderMarkdownTable(rows, [
			{ header: '#', cell: r => String(r.n), align: 'right' },
			{ header: 'Cited Document', cell: r => citedDocumentLabel(r.doc) },
			{ header: 'Category', cell: r => r.doc.category ?? '—' },
			{ header: 'Rejected Claims', cell: r => r.doc.rejectedClaims ?? '—' },
			{ header: 'Cited By', cell: r => citingPartiesLabel(r.doc) },
			{ header: 'OA Date', cell: r => r.doc.officeActionDate ?? '—' },
			{ header: 'OA Type', cell: r => r.doc.officeActionType ?? '—' },
			{ header: 'Inventor', cell: r => r.doc.inventor ?? '—' },
		]));
		lines.push('');
		lines.push(`Categories: ${Object.values(CATEGORY_LABELS).join('; ')}.`);

		// Cited passages are too long for a table cell; render them as per-row snippets below the table.
		const withPassages = rows.filter(r => r.doc.citedPassages && r.doc.citedPassages.length > 0);
		if (withPassages.length > 0) {
			lines.push('');
			lines.push('### Cited Passages');
			for (const r of withPassages) {
				const joined = r.doc.citedPassages!.join(' | ');
				const label = r.doc.citedDocument ?? `Citation ${r.n}`;
				lines.push(`- **${label}** (#${r.n}): ${truncatePreview(joined, ToolResponseBudgets.SearchCitationsPassages)}`);
			}
		}

		if (total > result.data.length) {
			lines.push('');
			lines.push(`Showing first ${result.data.length} of ${total}. Re-call with a larger size to see more.`);
		}

		lines.push('');
		lines.push('For forward citations, citation statistics, or date-range filtering, use citation_api_guide.');

		return lines.join('\n');
	}
}

ToolRegistry.registerTool(SearchCitationsTool);
