/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import type * as vscode from 'vscode';
import { ILogService } from '../../../platform/log/common/logService';
import { CancellationToken } from '../../../util/vs/base/common/cancellation';
import { LanguageModelTextPart, LanguageModelToolResult } from '../../../vscodeTypes';
import { patentCitationLink } from '../../patentai/vscode-node/patentCitationLink';
import { IPatentBackendClient } from '../../patentai/vscode-node/patentBackendClient';
import { ToolName } from '../common/toolNames';
import { ICopilotTool, ToolRegistry } from '../common/toolsRegistry';
import { CitationDoc } from './patentCitationTypes';
import { callFacadeTool } from './patentFacade';
import { renderMarkdownTable, ToolResponseBudgets, truncatePreview } from './patentResponseFormatter';
import { handlePatentToolError } from './patentToolError';

interface ISearchCitationsParams {
	applicationNumber: string;
	category?: 'X' | 'Y' | 'A';
	examinerOnly?: boolean;
	size?: number;
	/** Inclusive office-action date window, YYYY-MM-DD; either bound may stand alone. */
	dateFrom?: string;
	dateTo?: string;
}

/** `data` payload of the `search_office_action_citations` facade tool. */
interface CitationSearchData {
	total?: number;
	citations?: CitationDoc[];
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
	return `${patentCitationLink(doc.citedDocument, doc.documentReference)}${countryTag}${nplTag}`;
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

		const { applicationNumber, category, examinerOnly = false, size = 100, dateFrom, dateTo } = options.input;

		const normalized = applicationNumber.replace(/[\/,\s]/g, '');

		try {
			const input: {
				application_number: string;
				size: number;
				examiner_cited_only: boolean;
				category?: string;
				date_range?: { from?: string; to?: string };
			} = {
				application_number: normalized,
				size,
				examiner_cited_only: examinerOnly,
			};
			if (category) {
				input.category = category;
			}
			if (dateFrom || dateTo) {
				input.date_range = { ...(dateFrom ? { from: dateFrom } : {}), ...(dateTo ? { to: dateTo } : {}) };
			}

			const data = await callFacadeTool<CitationSearchData>(this.patentBackendClient, 'search_office_action_citations', input, token);

			const formatted = this.formatSearchResults(data, { applicationNumber: normalized, category, examinerOnly, size, dateFrom, dateTo });
			this.logService.info(`[SearchCitationsTool] Formatted response length: ${formatted.length} chars`);

			return new LanguageModelToolResult([
				new LanguageModelTextPart(formatted)
			]);
		} catch (error) {
			return handlePatentToolError(error, this.logService, '[SearchCitationsTool]', err => `Error: Citation search backend returned ${err.status}: ${err.message}`);
		}
	}

	private formatSearchResults(
		result: CitationSearchData,
		query: { applicationNumber: string; category?: string; examinerOnly: boolean; size: number; dateFrom?: string; dateTo?: string }
	): string {
		const lines: string[] = [];
		const citations = result.citations;
		const total = result.total ?? citations?.length ?? 0;

		lines.push(`Found ${total} citations for application ${query.applicationNumber}`);
		if (query.category) {
			lines.push(`Category filter: ${CATEGORY_LABELS[query.category] ?? query.category}`);
		}
		if (query.examinerOnly) {
			lines.push('Examiner-cited only: yes');
		}
		if (query.dateFrom || query.dateTo) {
			lines.push(`Office-action date range: ${query.dateFrom ?? 'earliest'} to ${query.dateTo ?? 'latest'}`);
		}
		lines.push('');

		if (!citations || citations.length === 0) {
			lines.push('No citations found matching the filters.');
			lines.push('');
			lines.push('Backward citations key on the US application number, not the publication number — if you passed a publication number, resolve the application number via get_patent_family (find the US member) then get_continuity (read its application number) and retry. To instead find patents that cite this document forward, use search_forward_citations with the publication number.');
			lines.push('');
			lines.push('For forward citations or citation statistics, use citation_api_guide.');
			return lines.join('\n');
		}

		const rows = citations.map((doc, i) => ({ doc, n: i + 1 }));

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

		if (total > citations.length) {
			lines.push('');
			lines.push(`Showing first ${citations.length} of ${total}. Re-call with a larger size to see more.`);
		}

		lines.push('');
		lines.push('For forward citations or citation statistics, use citation_api_guide.');

		return lines.join('\n');
	}
}

ToolRegistry.registerTool(SearchCitationsTool);
