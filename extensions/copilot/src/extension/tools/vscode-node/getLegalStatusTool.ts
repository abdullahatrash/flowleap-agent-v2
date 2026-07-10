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
import { handlePatentToolError } from './patentToolError';
import { renderMarkdownTable } from './patentResponseFormatter';

interface IGetLegalStatusParams {
	publicationNumber: string;
}

/** One INPADOC legal-status event, as returned by the `/tools/get_legal_status` facade `data` payload. */
interface LegalStatusEvent {
	code: string;
	date: string;
	country: string | null;
	text: string | null;
	gazette?: { number: string | null; date: string | null };
}

interface LegalStatusData {
	docId: string;
	events: LegalStatusEvent[];
}

/** Render a gazette reference (`number (date)`) for a table cell, or `—` when absent. */
function gazetteLabel(gazette: LegalStatusEvent['gazette']): string {
	if (!gazette || (!gazette.number && !gazette.date)) {
		return '—';
	}
	if (gazette.number && gazette.date) {
		return `${gazette.number} (${gazette.date})`;
	}
	return gazette.number || gazette.date || '—';
}

/**
 * Tool for retrieving a patent's INPADOC legal-status events (grants, lapses, oppositions, renewal
 * fees) per jurisdiction from EPO OPS, through the FlowLeap agent-first `/tools/get_legal_status`
 * facade. Routes through the shared {@link IPatentBackendClient} seam (via {@link callFacadeTool}), so
 * it inherits the centralized `401 → re-sign-in` / `402 → start-trial` / `429 → wait` gating. This is
 * the typed replacement for the raw `ops_api_guide` legal endpoints in FTO / portfolio workflows.
 */
export class GetLegalStatusTool implements ICopilotTool<IGetLegalStatusParams> {

	public static readonly toolName = ToolName.GetLegalStatus;

	constructor(
		@ILogService private readonly logService: ILogService,
		@IPatentBackendClient private readonly patentBackendClient: IPatentBackendClient,
	) { }

	prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<IGetLegalStatusParams>, _token: CancellationToken): vscode.ProviderResult<vscode.PreparedToolInvocation> {
		const { publicationNumber } = options.input;
		return {
			invocationMessage: l10n.t`Fetching legal status for ${publicationNumber}...`,
		};
	}

	/**
	 * Normalize a publication number to the OPS epodoc format (US10000000B2). User input and search
	 * results may carry hyphens, dots, or spaces (US-10000000-B2); epodoc wants them stripped. Kind-code
	 * edge cases are handled server-side.
	 */
	private normalizePublicationNumber(pubNum: string): string {
		return pubNum.replace(/[-.\s/]/g, '').toUpperCase();
	}

	async invoke(options: vscode.LanguageModelToolInvocationOptions<IGetLegalStatusParams>, token: CancellationToken): Promise<vscode.LanguageModelToolResult> {
		this.logService.trace('[GetLegalStatusTool] Invoking legal-status fetch');

		const { publicationNumber } = options.input;
		const doc = this.normalizePublicationNumber(publicationNumber);
		this.logService.info(`[GetLegalStatusTool] Normalized: ${publicationNumber} -> ${doc}`);

		try {
			const data = await callFacadeTool<LegalStatusData>(this.patentBackendClient, 'get_legal_status', { patent_number: doc }, token);
			const formatted = this.formatLegalStatus(data, doc);
			this.logService.info(`[GetLegalStatusTool] Formatted response length: ${formatted.length} chars`);
			return new LanguageModelToolResult([new LanguageModelTextPart(formatted)]);
		} catch (error) {
			return handlePatentToolError(error, this.logService, '[GetLegalStatusTool]', err => `Error fetching legal status for ${publicationNumber}: ${err.status} - ${err.message}`);
		}
	}

	private formatLegalStatus(data: LegalStatusData, doc: string): string {
		const events = data.events ?? [];
		const lines: string[] = [
			`# Legal Status: ${data.docId || doc}`,
			'',
		];

		if (events.length === 0) {
			lines.push('No INPADOC legal-status events found for this publication number.');
			lines.push('');
			lines.push('EPO OPS may not hold legal-status data for this document. Verify the number with get_patent_details, or for EP prosecution history try get_register_events.');
			return lines.join('\n');
		}

		lines.push(`${events.length} legal-status event(s) from EPO OPS (INPADOC), newest first.`);
		lines.push('');
		lines.push(renderMarkdownTable(events, [
			{ header: 'Date', cell: e => e.date || '—' },
			{ header: 'Country', cell: e => e.country || '—' },
			{ header: 'Code', cell: e => e.code || '—' },
			{ header: 'Event', cell: e => e.text || '—' },
			{ header: 'Gazette', cell: e => gazetteLabel(e.gazette) },
		]));
		lines.push('');
		lines.push('These are raw INPADOC legal-status events. Read in-force vs. lapsed/expired from the event history (grant, lapse/withdrawal, renewal-fee and opposition codes). For family-wide status across jurisdictions use get_patent_family; for the EP register prosecution timeline use get_register_events.');
		return lines.join('\n');
	}
}

ToolRegistry.registerTool(GetLegalStatusTool);
