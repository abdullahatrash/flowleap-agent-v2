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
import { FacadeToolEnvelope } from './patentFacadeTypes';
import { renderMarkdownTable } from './patentResponseFormatter';
import { handlePatentToolError } from './patentToolError';

interface IGetProsecutionTimelineParams {
	publicationNumber: string;
}

/** One event in the merged prosecution/legal-status chronology. */
interface TimelineEvent {
	code?: string;
	date?: string;
	description?: string;
	/** Origin of the event: 'register' (EP Register) or 'legal' (INPADOC legal-status). */
	source?: string;
}

interface TimelineData {
	events?: TimelineEvent[];
	patentNumber?: string;
	/** Per-source failures (e.g. `{ register: 'OPS error 404: ...' }`) when one feed had no data. */
	sourceErrors?: Record<string, string>;
	totalEvents?: number;
}

/** Human label for an event's source feed. */
function sourceLabel(source: string | undefined): string {
	switch (source) {
		case 'register': return 'EP Register';
		case 'legal': return 'INPADOC legal';
		default: return source ?? '—';
	}
}

/**
 * Tool for a chronological prosecution / legal-status timeline of a publication number, merging EP
 * Register events and INPADOC legal-status events (filing, search report, grant, oppositions,
 * assignments, renewals/maintenance, lapse). Routes through the FlowLeap `/v1/tools/get_prosecution_timeline`
 * facade over the shared {@link IPatentBackendClient} seam, so it inherits the centralized
 * `401 → re-sign-in` / `402 → start-trial` gating.
 *
 * Most complete for EP/WO publications; for US patents it surfaces the INPADOC legal events
 * (assignment, grant, maintenance-fee payments). Distinct from the citation tools: this is the
 * event chronology, NOT examiner-cited prior art (use `search_citations` for that), and NOT the
 * parent/child application chain (use `get_continuity` for that).
 */
export class GetProsecutionTimelineTool implements ICopilotTool<IGetProsecutionTimelineParams> {

	public static readonly toolName = ToolName.GetProsecutionTimeline;

	constructor(
		@ILogService private readonly logService: ILogService,
		@IPatentBackendClient private readonly patentBackendClient: IPatentBackendClient,
	) { }

	prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<IGetProsecutionTimelineParams>, _token: CancellationToken): vscode.ProviderResult<vscode.PreparedToolInvocation> {
		const { publicationNumber } = options.input;
		return {
			invocationMessage: l10n.t`Building prosecution timeline for ${publicationNumber}...`,
		};
	}

	/** Normalize a publication number to the OPS epodoc format (US10000000B2), stripping separators. */
	private normalizePublicationNumber(pubNum: string): string {
		return pubNum.replace(/[-.\s/]/g, '').toUpperCase();
	}

	async invoke(options: vscode.LanguageModelToolInvocationOptions<IGetProsecutionTimelineParams>, token: CancellationToken): Promise<vscode.LanguageModelToolResult> {
		this.logService.trace('[GetProsecutionTimelineTool] Invoking prosecution timeline');

		const { publicationNumber } = options.input;
		const normalized = this.normalizePublicationNumber(publicationNumber);

		try {
			const envelope = await this.patentBackendClient.post<FacadeToolEnvelope<TimelineData>>(
				'/tools/get_prosecution_timeline', { patent_number: normalized }, token);

			if (!envelope.success || !envelope.data) {
				const errorMsg = envelope.error?.message ?? `No prosecution timeline returned for ${normalized}`;
				this.logService.error(`[GetProsecutionTimelineTool] ${errorMsg}`);
				return new LanguageModelToolResult([new LanguageModelTextPart(errorMsg)]);
			}

			const formatted = this.formatTimeline(envelope.data, normalized);
			this.logService.info(`[GetProsecutionTimelineTool] Formatted response length: ${formatted.length} chars`);
			return new LanguageModelToolResult([new LanguageModelTextPart(formatted)]);
		} catch (error) {
			return handlePatentToolError(error, this.logService, '[GetProsecutionTimelineTool]', err => `Error building prosecution timeline for ${normalized}: ${err.status} - ${err.message}`);
		}
	}

	private formatTimeline(data: TimelineData, publicationNumber: string): string {
		const events = [...(data.events ?? [])].sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''));
		const lines: string[] = [`# Prosecution Timeline: ${data.patentNumber ?? publicationNumber}`, ''];

		if (events.length === 0) {
			lines.push('No prosecution or legal-status events found for this publication.');
		} else {
			lines.push(`${events.length} event(s), earliest first:`);
			lines.push('');
			lines.push(renderMarkdownTable(events.map((e, i) => ({ e, n: i + 1 })), [
				{ header: '#', cell: r => String(r.n), align: 'right' },
				{ header: 'Date', cell: r => r.e.date ?? '—' },
				{ header: 'Event', cell: r => r.e.description ?? '—' },
				{ header: 'Code', cell: r => r.e.code ?? '—' },
				{ header: 'Source', cell: r => sourceLabel(r.e.source) },
			]));
		}

		// One feed being empty is expected (e.g. no EP Register entry for a US publication); surface it as
		// a coverage note rather than an error so the model does not misread it as a failed lookup.
		const sourceErrors = data.sourceErrors ? Object.keys(data.sourceErrors) : [];
		if (sourceErrors.length > 0) {
			lines.push('');
			lines.push(`Coverage note: no data from ${sourceErrors.map(sourceLabel).join(', ')} for this publication (this is normal outside that feed's jurisdiction).`);
		}

		lines.push('');
		lines.push('Timeline merges EP Register and INPADOC legal-status events. For examiner-cited prior art use search_citations; for the parent/child application chain use get_continuity.');
		return lines.join('\n');
	}
}

ToolRegistry.registerTool(GetProsecutionTimelineTool);
