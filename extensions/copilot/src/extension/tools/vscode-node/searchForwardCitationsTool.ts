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
import { ToolName } from '../common/toolNames';
import { ICopilotTool, ToolRegistry } from '../common/toolsRegistry';
import { CitationDoc } from './patentCitationTypes';
import { callFacadeTool } from './patentFacade';
import { renderMarkdownTable, ToolResponseBudgets, truncatePreview } from './patentResponseFormatter';
import { handlePatentToolError } from './patentToolError';

interface ISearchForwardCitationsParams {
	citedDocument: string;
	category?: 'X' | 'Y' | 'A';
	examinerOnly?: boolean;
	size?: number;
}

/** `data` payload of the `search_enriched_citations` facade tool. */
interface ForwardCitationSearchData {
	total?: number;
	citations?: CitationDoc[];
}

const CATEGORY_LABELS: Record<string, string> = {
	X: 'X (novelty-destroying, 35 USC 102)',
	Y: 'Y (obviousness, 35 USC 103)',
	A: 'A (background reference)',
};

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
 * Tool for forward citation impact analysis: finds patents that CITE a given document, tagged with
 * the X/Y/A relevance categories. Distinct from {@link SearchCitationsTool} (prior art cited AGAINST
 * an application); this takes a cited document and returns the citing patents. Routes through the
 * shared {@link IPatentBackendClient} seam, inheriting the centralized `401`/`402` gating.
 */
export class SearchForwardCitationsTool implements ICopilotTool<ISearchForwardCitationsParams> {

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
			const input: {
				cited_document: string;
				size: number;
				examiner_cited_only: boolean;
				category?: string;
			} = {
				cited_document: citedDocument,
				size,
				examiner_cited_only: examinerOnly,
			};
			if (category) {
				input.category = category;
			}

			const data = await callFacadeTool<ForwardCitationSearchData>(this.patentBackendClient, 'search_enriched_citations', input, token);

			const formatted = this.formatSearchResults(data, { citedDocument, category, examinerOnly, size });
			this.logService.info(`[SearchForwardCitationsTool] Formatted response length: ${formatted.length} chars`);

			return new LanguageModelToolResult([
				new LanguageModelTextPart(formatted)
			]);
		} catch (error) {
			return handlePatentToolError(error, this.logService, '[SearchForwardCitationsTool]', err => `Error: Forward citation backend returned ${err.status}: ${err.message}`);
		}
	}

	private formatSearchResults(
		result: ForwardCitationSearchData,
		query: { citedDocument: string; category?: string; examinerOnly: boolean; size: number }
	): string {
		const lines: string[] = [];
		const citations = result.citations;
		const total = result.total ?? citations?.length ?? 0;

		lines.push(`Found ${total} patents citing ${query.citedDocument}`);
		if (query.category) {
			lines.push(`Category filter: ${CATEGORY_LABELS[query.category] ?? query.category}`);
		}
		if (query.examinerOnly) {
			lines.push('Examiner-cited only: yes');
		}
		lines.push('');

		if (!citations || citations.length === 0) {
			lines.push('No forward citations found matching the filters.');
			lines.push('');
			lines.push('For prior art cited AGAINST this patent (the examiner X/Y/A references), use search_citations with the US application number — this tool only finds patents that cite this document, not the references cited against it. Resolve the application number via get_patent_family (find the US member) then get_continuity (read its application number).');
			lines.push('');
			lines.push('For citation statistics, use citation_api_guide.');
			return lines.join('\n');
		}

		const rows = citations.map((doc, i) => ({ doc, n: i + 1 }));

		lines.push(renderMarkdownTable(rows, [
			{ header: '#', cell: r => String(r.n), align: 'right' },
			{ header: 'Citing Application', cell: r => r.doc.applicationNumber ?? '—' },
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
		// (Parity with the backward citation tool, which previously included passages this tool omitted.)
		const withPassages = rows.filter(r => r.doc.citedPassages && r.doc.citedPassages.length > 0);
		if (withPassages.length > 0) {
			lines.push('');
			lines.push('### Cited Passages');
			for (const r of withPassages) {
				const joined = r.doc.citedPassages!.join(' | ');
				const label = r.doc.applicationNumber ?? `Citing patent ${r.n}`;
				lines.push(`- **${label}** (#${r.n}): ${truncatePreview(joined, ToolResponseBudgets.SearchForwardCitationsPassages)}`);
			}
		}

		if (total > citations.length) {
			lines.push('');
			lines.push(`Showing first ${citations.length} of ${total}. Re-call with a larger size to see more.`);
		}

		lines.push('');
		lines.push('For citation statistics, use citation_api_guide.');

		return lines.join('\n');
	}
}

ToolRegistry.registerTool(SearchForwardCitationsTool);
