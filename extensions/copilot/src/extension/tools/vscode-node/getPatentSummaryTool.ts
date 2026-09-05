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
import { ToolName } from '../common/toolNames';
import { ICopilotTool, ToolRegistry } from '../common/toolsRegistry';
import { callFacadeTool } from './patentFacade';
import { handlePatentToolError } from './patentToolError';

interface IGetPatentSummaryParams {
	patentNumber: string;
}

/** `data` payload of the `/v1/tools/get_patent_summary` facade endpoint (biblio + status + family + term). */
interface SummaryData {
	documentReference?: PatentDocumentReference | null;
	patentNumber: string;
	bibliography: {
		docId: string;
		title: string | null;
		abstract: string | null;
		applicants: string[];
		inventors: string[];
		ipc: string[];
		cpc: string[];
		dates: { filing: string | null; publication: string | null; priority: string[] };
	} | null;
	legalStatus: { docId: string; events: LegalEvent[] } | null;
	family: { docId: string; familyMembers: unknown[]; totalCount: number } | null;
	term: { patentNumber: string; filingDate: string | null; baseExpiryDate: string | null; basis: string; disclaimer: string } | null;
}

interface LegalEvent {
	code: string;
	country: string;
	date: string | null;
	text: string;
}

/** Number of most-recent legal-status events surfaced in the overview; full history is on the legal endpoint. */
const MAX_LEGAL_EVENTS = 8;

/**
 * Tool for the one-call patent overview from the FlowLeap backend's compound
 * `/v1/tools/get_patent_summary` facade endpoint: bibliography, abstract, latest legal status, family
 * size, and the estimated term in a single round-trip. Routes through the shared
 * {@link IPatentBackendClient} seam (inheriting the centralized `401`/`402`/`429` gating) and
 * {@link callFacadeTool} unwrapping.
 *
 * This is the DEFAULT entry point for "tell me about patent X" overview questions — it collapses the
 * biblio/status/family/term round-trips into one call. It does NOT return full claims or description
 * text; for those, use get_patent_details.
 */
export class GetPatentSummaryTool implements ICopilotTool<IGetPatentSummaryParams> {

	public static readonly toolName = ToolName.GetPatentSummary;

	constructor(
		@ILogService private readonly logService: ILogService,
		@IPatentBackendClient private readonly patentBackendClient: IPatentBackendClient,
	) { }

	prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<IGetPatentSummaryParams>, _token: CancellationToken): vscode.ProviderResult<vscode.PreparedToolInvocation> {
		const { patentNumber } = options.input;
		return {
			invocationMessage: l10n.t`Fetching patent summary for ${patentNumber}...`,
		};
	}

	async invoke(options: vscode.LanguageModelToolInvocationOptions<IGetPatentSummaryParams>, token: CancellationToken): Promise<vscode.LanguageModelToolResult> {
		this.logService.trace('[GetPatentSummaryTool] Fetching patent summary');

		const patentNumber = options.input.patentNumber?.trim();
		if (!patentNumber) {
			return new LanguageModelToolResult([
				new LanguageModelTextPart('Error: No patent number provided')
			]);
		}

		try {
			const summary = await callFacadeTool<SummaryData>(this.patentBackendClient, ToolName.GetPatentSummary, { patent_number: patentNumber }, token);
			const formatted = this.formatSummary(summary, patentNumber);
			this.logService.info(`[GetPatentSummaryTool] Formatted response length: ${formatted.length} chars`);
			return new LanguageModelToolResult([new LanguageModelTextPart(formatted)]);
		} catch (error) {
			return handlePatentToolError(
				error,
				this.logService,
				'[GetPatentSummaryTool]',
				err => `Error fetching summary for ${patentNumber}: ${err.status} - ${err.message}`,
			);
		}
	}

	/** Format the compound summary as a single overview block. */
	private formatSummary(summary: SummaryData, patentNumber: string): string {
		const biblio = summary.bibliography;
		const lines: string[] = [
			`# Patent Summary: ${patentCitationLink(summary.patentNumber || biblio?.docId || patentNumber, summary.documentReference)}`,
			'',
			`**Title:** ${biblio?.title || 'N/A'}`,
			`**Applicants:** ${this.joinOrNa(biblio?.applicants)}`,
			`**Inventors:** ${this.joinOrNa(biblio?.inventors)}`,
			`**Filing Date:** ${biblio?.dates?.filing || 'N/A'}`,
			`**Publication Date:** ${biblio?.dates?.publication || 'N/A'}`,
			`**Priority Date(s):** ${this.joinOrNa(biblio?.dates?.priority)}`,
			`**IPC:** ${this.joinOrNa(biblio?.ipc)}`,
			`**CPC:** ${this.joinOrNa(biblio?.cpc)}`,
			'',
			'## Abstract',
			biblio?.abstract || 'No abstract available.',
			'',
			'## Legal Status',
			this.formatLegalStatus(summary.legalStatus),
			'',
			'## Patent Family',
			summary.family ? `${summary.family.totalCount} family member(s) on record. Use patent_api_request with GET /ops/family?doc=${summary.patentNumber || patentNumber} for the full list.` : 'Family data not available.',
			'',
			'## Estimated Term',
			this.formatTerm(summary.term),
			'',
			'---',
			'This is an OVERVIEW (biblio, abstract, latest status, family, estimated term). For the FULL claims and description text, use get_patent_details; for the drawings, use get_patent_figures.',
		];
		return lines.join('\n');
	}

	private joinOrNa(values: readonly string[] | undefined): string {
		return values && values.length > 0 ? values.join(', ') : 'N/A';
	}

	/** Render the most-recent legal-status events; the full history stays on the legal endpoint. */
	private formatLegalStatus(legalStatus: SummaryData['legalStatus']): string {
		const events = legalStatus?.events ?? [];
		if (events.length === 0) {
			return 'No legal-status events available.';
		}
		const shown = events.slice(0, MAX_LEGAL_EVENTS);
		const rendered = shown.map(e => `- ${e.date || 'N/A'} — ${e.code}${e.country ? ` (${e.country})` : ''}: ${e.text}`);
		if (events.length > shown.length) {
			rendered.push(`- …and ${events.length - shown.length} earlier event(s). Use the OPS legal endpoint for the full history.`);
		}
		return rendered.join('\n');
	}

	private formatTerm(term: SummaryData['term']): string {
		if (!term) {
			return 'Term estimate not available.';
		}
		const expiry = term.baseExpiryDate ? `${term.baseExpiryDate} (${term.basis})` : `not estimable (${term.basis}; no filing date on record)`;
		return [
			`**Estimated Expiry (base):** ${expiry}`,
			`> ${term.disclaimer}`,
			'For a dedicated term estimate use get_patent_term.',
		].join('\n');
	}
}

ToolRegistry.registerTool(GetPatentSummaryTool);
