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
import { callFacadeTool } from './patentFacade';
import { IMarkdownColumn, renderMarkdownTable, truncatePreview } from './patentResponseFormatter';
import { handlePatentToolError } from './patentToolError';

interface IComparePatentsParams {
	patentNumbers: string[];
}

/** One patent's bibliographic record in the `/v1/tools/compare_patents` facade `data.patents` array. */
interface ComparedPatent {
	patentNumber: string;
	docId: string;
	title: string | null;
	abstract: string | null;
	applicants: string[];
	inventors: string[];
	ipc: string[];
	cpc: string[];
	dates: { filing: string | null; publication: string | null; priority: string[] };
}

/** `data` payload of the `/v1/tools/compare_patents` facade endpoint. */
interface ComparePatentsData {
	count: number;
	patents: ComparedPatent[];
}

/** Max characters of each patent's abstract rendered below the comparison table. */
const ABSTRACT_PREVIEW_LIMIT = 400;
/** Facade contract: 2–10 published documents per comparison. */
const MIN_PATENTS = 2;
const MAX_PATENTS = 10;

/**
 * Tool for a data-grounded, side-by-side comparison of 2–10 PUBLISHED patent documents via the
 * FlowLeap backend's compound `/v1/tools/compare_patents` facade endpoint. Routes through the shared
 * {@link IPatentBackendClient} seam (inheriting the centralized `401`/`402`/`429` gating) and
 * {@link callFacadeTool} unwrapping. The backend fetches each document's bibliographic record; this
 * tool renders them as an attribute-by-patent comparison table (via the shared
 * {@link renderMarkdownTable} primitive) with bounded abstracts, and the agent reads off the
 * similarities and differences.
 *
 * NOT to be confused with compare_claims: compare_claims charts a USER's own DRAFTED claim text
 * against references (element-by-element scaffold); THIS tool compares one published document against
 * another published document.
 */
export class ComparePatentsTool implements ICopilotTool<IComparePatentsParams> {

	public static readonly toolName = ToolName.ComparePatents;

	constructor(
		@ILogService private readonly logService: ILogService,
		@IPatentBackendClient private readonly patentBackendClient: IPatentBackendClient,
	) { }

	prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<IComparePatentsParams>, _token: CancellationToken): vscode.ProviderResult<vscode.PreparedToolInvocation> {
		const count = options.input.patentNumbers?.length ?? 0;
		return {
			invocationMessage: l10n.t`Comparing ${count} patents...`,
		};
	}

	async invoke(options: vscode.LanguageModelToolInvocationOptions<IComparePatentsParams>, token: CancellationToken): Promise<vscode.LanguageModelToolResult> {
		this.logService.trace('[ComparePatentsTool] Comparing published patents');

		const patentNumbers = (options.input.patentNumbers ?? []).map(p => p.trim()).filter(p => p.length > 0);
		if (patentNumbers.length < MIN_PATENTS) {
			return new LanguageModelToolResult([
				new LanguageModelTextPart(`Error: compare_patents needs at least ${MIN_PATENTS} patent numbers (received ${patentNumbers.length}). To analyze a single patent, use get_patent_summary.`)
			]);
		}

		const limited = patentNumbers.slice(0, MAX_PATENTS);
		if (patentNumbers.length > MAX_PATENTS) {
			this.logService.warn(`[ComparePatentsTool] Limiting comparison to first ${MAX_PATENTS} patents (received ${patentNumbers.length})`);
		}

		try {
			const result = await callFacadeTool<ComparePatentsData>(this.patentBackendClient, ToolName.ComparePatents, { patent_numbers: limited }, token);
			if (!result.patents || result.patents.length === 0) {
				return new LanguageModelToolResult([
					new LanguageModelTextPart(`No bibliographic data was returned for any of: ${limited.join(', ')}.`)
				]);
			}
			const formatted = this.formatComparison(result.patents, limited.length > result.patents.length ? limited : undefined);
			this.logService.info(`[ComparePatentsTool] Formatted response length: ${formatted.length} chars`);
			return new LanguageModelToolResult([new LanguageModelTextPart(formatted)]);
		} catch (error) {
			return handlePatentToolError(
				error,
				this.logService,
				'[ComparePatentsTool]',
				err => `Error comparing patents: ${err.status} - ${err.message}`,
			);
		}
	}

	/**
	 * Render the compared patents as an attribute-by-patent table (rows are bibliographic fields,
	 * columns are the patents) plus a bounded abstract per patent and an analysis rubric.
	 */
	private formatComparison(patents: readonly ComparedPatent[], requested: readonly string[] | undefined): string {
		const attributes: { label: string; value: (p: ComparedPatent) => string }[] = [
			{ label: 'Title', value: p => p.title || 'N/A' },
			{ label: 'Applicants', value: p => this.joinOrNa(p.applicants) },
			{ label: 'Inventors', value: p => this.joinOrNa(p.inventors) },
			{ label: 'Filing Date', value: p => p.dates?.filing || 'N/A' },
			{ label: 'Publication Date', value: p => p.dates?.publication || 'N/A' },
			{ label: 'Priority Date(s)', value: p => this.joinOrNa(p.dates?.priority) },
			{ label: 'IPC', value: p => this.joinOrNa(p.ipc) },
			{ label: 'CPC', value: p => this.joinOrNa(p.cpc) },
		];

		const columns: IMarkdownColumn<{ label: string; value: (p: ComparedPatent) => string }>[] = [
			{ header: 'Attribute', cell: row => row.label },
			...patents.map((p): IMarkdownColumn<{ label: string; value: (p: ComparedPatent) => string }> => ({
				header: p.patentNumber || p.docId,
				cell: row => row.value(p),
			})),
		];

		const lines: string[] = [
			`## Patent Comparison (${patents.length} documents)`,
			'',
			renderMarkdownTable(attributes, columns),
			'',
			'### Abstracts',
			'',
		];
		for (const p of patents) {
			lines.push(`#### ${p.patentNumber || p.docId}`);
			lines.push(p.abstract ? truncatePreview(p.abstract, ABSTRACT_PREVIEW_LIMIT) : 'No abstract available.');
			lines.push('');
		}

		if (requested) {
			const returned = new Set(patents.map(p => p.patentNumber));
			const missing = requested.filter(r => !returned.has(r));
			if (missing.length > 0) {
				lines.push(`> No data returned for: ${missing.join(', ')}.`, '');
			}
		}

		lines.push(
			'---',
			'### Analysis Instructions',
			'Compare these PUBLISHED documents against each other using ONLY the data above: shared vs distinct applicants/inventors, overlapping IPC/CPC classifications (shared technical space), relative filing/priority dates (which is earlier prior art), and the substantive differences in the abstracts. Summarize what each covers and how they relate.',
			'',
			'NOTE: This is a document-to-document comparison. To chart a USER\'s own DRAFTED claim text against references element-by-element (novelty / FTO / 102-103 risk), use compare_claims instead. For a single patent\'s full claims and description, use get_patent_details.',
		);

		return lines.join('\n');
	}

	private joinOrNa(values: readonly string[] | undefined): string {
		return values && values.length > 0 ? values.join(', ') : 'N/A';
	}
}

ToolRegistry.registerTool(ComparePatentsTool);
