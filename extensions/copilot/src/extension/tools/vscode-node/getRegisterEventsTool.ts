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

interface IGetRegisterEventsParams {
	publicationNumber: string;
}

/** One EP Register event, as returned by the `/tools/get_register_events` facade `data` payload. */
interface RegisterEvent {
	code: string;
	date: string;
	description: string | null;
	gazette?: { number: string | null; date: string | null };
}

interface RegisterEventsData {
	docId: string;
	events: RegisterEvent[];
}

/** Render a gazette reference (`number (date)`) for a table cell, or `—` when absent. */
function gazetteLabel(gazette: RegisterEvent['gazette']): string {
	if (!gazette || (!gazette.number && !gazette.date)) {
		return '—';
	}
	if (gazette.number && gazette.date) {
		return `${gazette.number} (${gazette.date})`;
	}
	return gazette.number || gazette.date || '—';
}

/**
 * Tool for retrieving a patent's EP Register prosecution events (oppositions, transfers of rights,
 * amendments, lapses) from the EPO Register, through the FlowLeap agent-first
 * `/tools/get_register_events` facade. Routes through the shared {@link IPatentBackendClient} seam (via
 * {@link callFacadeTool}), so it inherits the centralized `401 → re-sign-in` / `402 → start-trial` /
 * `429 → wait` gating. This is the typed replacement for the raw `ops_api_guide` register endpoints in
 * FTO / portfolio workflows. EP applications/patents only.
 */
export class GetRegisterEventsTool implements ICopilotTool<IGetRegisterEventsParams> {

	public static readonly toolName = ToolName.GetRegisterEvents;

	constructor(
		@ILogService private readonly logService: ILogService,
		@IPatentBackendClient private readonly patentBackendClient: IPatentBackendClient,
	) { }

	prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<IGetRegisterEventsParams>, _token: CancellationToken): vscode.ProviderResult<vscode.PreparedToolInvocation> {
		const { publicationNumber } = options.input;
		return {
			invocationMessage: l10n.t`Fetching register events for ${publicationNumber}...`,
		};
	}

	/**
	 * Normalize a publication number to the OPS epodoc format (EP1000000). User input and search
	 * results may carry hyphens, dots, or spaces (EP-1000000-A1); epodoc wants them stripped. Kind-code
	 * edge cases are handled server-side.
	 */
	private normalizePublicationNumber(pubNum: string): string {
		return pubNum.replace(/[-.\s/]/g, '').toUpperCase();
	}

	async invoke(options: vscode.LanguageModelToolInvocationOptions<IGetRegisterEventsParams>, token: CancellationToken): Promise<vscode.LanguageModelToolResult> {
		this.logService.trace('[GetRegisterEventsTool] Invoking register-events fetch');

		const { publicationNumber } = options.input;
		const doc = this.normalizePublicationNumber(publicationNumber);
		this.logService.info(`[GetRegisterEventsTool] Normalized: ${publicationNumber} -> ${doc}`);

		try {
			const data = await callFacadeTool<RegisterEventsData>(this.patentBackendClient, 'get_register_events', { patent_number: doc }, token);
			const formatted = this.formatRegisterEvents(data, doc);
			this.logService.info(`[GetRegisterEventsTool] Formatted response length: ${formatted.length} chars`);
			return new LanguageModelToolResult([new LanguageModelTextPart(formatted)]);
		} catch (error) {
			return handlePatentToolError(error, this.logService, '[GetRegisterEventsTool]', err => `Error fetching register events for ${publicationNumber}: ${err.status} - ${err.message}`);
		}
	}

	private formatRegisterEvents(data: RegisterEventsData, doc: string): string {
		const events = data.events ?? [];
		const lines: string[] = [
			`# Register Events: ${data.docId || doc}`,
			'',
		];

		if (events.length === 0) {
			lines.push('No EP Register events found for this publication number.');
			lines.push('');
			lines.push('The EP Register covers EP applications/patents only. For a non-EP document, or for INPADOC legal-status events across jurisdictions, use get_legal_status.');
			return lines.join('\n');
		}

		lines.push(`${events.length} EP Register event(s) — prosecution history (oppositions, transfers, amendments, lapses), newest first.`);
		lines.push('');
		lines.push(renderMarkdownTable(events, [
			{ header: 'Date', cell: e => e.date || '—' },
			{ header: 'Code', cell: e => e.code || '—' },
			{ header: 'Event', cell: e => e.description || '—' },
			{ header: 'Gazette', cell: e => gazetteLabel(e.gazette) },
		]));
		lines.push('');
		lines.push('EP Register events cover EP applications/patents only. For INPADOC legal-status events across all jurisdictions use get_legal_status; for the patent family use get_patent_family.');
		return lines.join('\n');
	}
}

ToolRegistry.registerTool(GetRegisterEventsTool);
