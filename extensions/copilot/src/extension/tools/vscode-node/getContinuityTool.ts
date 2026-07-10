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

interface IGetContinuityParams {
	applicationNumber: string;
}

/** One parent record from a USPTO ODP `parentContinuityBag`. */
interface ContinuityParent {
	parentApplicationNumberText?: string;
	parentApplicationFilingDate?: string;
	parentApplicationStatusCode?: number;
	parentApplicationStatusDescriptionText?: string;
	parentPatentNumber?: string;
	claimParentageTypeCode?: string;
	claimParentageTypeCodeDescriptionText?: string;
	firstInventorToFileIndicator?: boolean;
}

/** One child record from a USPTO ODP `childContinuityBag`. */
interface ContinuityChild {
	childApplicationNumberText?: string;
	childApplicationFilingDate?: string;
	childApplicationStatusCode?: number;
	childApplicationStatusDescriptionText?: string;
	childPatentNumber?: string;
	claimParentageTypeCode?: string;
	claimParentageTypeCodeDescriptionText?: string;
	firstInventorToFileIndicator?: boolean;
}

/** One file-wrapper entry in the continuity response (usually one per queried application). */
interface ContinuityWrapper {
	applicationNumberText?: string;
	parentContinuityBag?: ContinuityParent[];
	childContinuityBag?: ContinuityChild[];
}

interface ContinuityData {
	count?: number;
	patentFileWrapperDataBag?: ContinuityWrapper[];
	requestIdentifier?: string;
}

/** Render a parent/child relationship label, preferring the human description over the raw code. */
function relationshipLabel(descriptionText: string | undefined, code: string | undefined): string {
	if (descriptionText) {
		return descriptionText;
	}
	return code ?? '—';
}

/** Render an application status, combining the numeric code and its description when both are present. */
function statusLabel(code: number | undefined, descriptionText: string | undefined): string {
	if (descriptionText && code !== undefined) {
		return `${descriptionText} (${code})`;
	}
	return descriptionText ?? (code !== undefined ? String(code) : '—');
}

/**
 * Tool for the USPTO parent/child continuity chain of a US application — the backbone of
 * priority-date and double-patenting analysis. Routes through the FlowLeap `/v1/tools/get_continuity`
 * facade over the shared {@link IPatentBackendClient} seam, so it inherits the centralized
 * `401 → re-sign-in` / `402 → start-trial` gating.
 *
 * Distinct from the citation tools: this returns the applicant's OWN related filings (divisionals,
 * continuations, continuations-in-part), NOT examiner-cited prior art. For prior art cited against
 * the application use `search_citations`; for a legal-event chronology use `get_prosecution_timeline`.
 */
export class GetContinuityTool implements ICopilotTool<IGetContinuityParams> {

	public static readonly toolName = ToolName.GetContinuity;

	constructor(
		@ILogService private readonly logService: ILogService,
		@IPatentBackendClient private readonly patentBackendClient: IPatentBackendClient,
	) { }

	prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<IGetContinuityParams>, _token: CancellationToken): vscode.ProviderResult<vscode.PreparedToolInvocation> {
		const { applicationNumber } = options.input;
		return {
			invocationMessage: l10n.t`Fetching continuity chain for application ${applicationNumber}...`,
		};
	}

	async invoke(options: vscode.LanguageModelToolInvocationOptions<IGetContinuityParams>, token: CancellationToken): Promise<vscode.LanguageModelToolResult> {
		this.logService.trace('[GetContinuityTool] Invoking continuity lookup');

		const { applicationNumber } = options.input;
		const normalized = applicationNumber.replace(/[\/,\s]/g, '');

		try {
			const envelope = await this.patentBackendClient.post<FacadeToolEnvelope<ContinuityData>>(
				'/tools/get_continuity', { application_number: normalized }, token);

			if (!envelope.success || !envelope.data) {
				const errorMsg = envelope.error?.message ?? `No continuity data returned for application ${normalized}`;
				this.logService.error(`[GetContinuityTool] ${errorMsg}`);
				return new LanguageModelToolResult([new LanguageModelTextPart(errorMsg)]);
			}

			const formatted = this.formatContinuity(envelope.data, normalized);
			this.logService.info(`[GetContinuityTool] Formatted response length: ${formatted.length} chars`);
			return new LanguageModelToolResult([new LanguageModelTextPart(formatted)]);
		} catch (error) {
			return handlePatentToolError(error, this.logService, '[GetContinuityTool]', err => `Error fetching continuity for application ${normalized}: ${err.status} - ${err.message}`);
		}
	}

	private formatContinuity(data: ContinuityData, applicationNumber: string): string {
		const wrappers = data.patentFileWrapperDataBag ?? [];
		const parents: ContinuityParent[] = [];
		const children: ContinuityChild[] = [];
		for (const wrapper of wrappers) {
			parents.push(...(wrapper.parentContinuityBag ?? []));
			children.push(...(wrapper.childContinuityBag ?? []));
		}

		const lines: string[] = [`# Continuity Chain: Application ${applicationNumber}`, ''];

		if (parents.length === 0 && children.length === 0) {
			lines.push('No continuity relationships found — this application has no parent or child applications on record (USPTO ODP).');
			return lines.join('\n');
		}

		if (parents.length > 0) {
			lines.push(`## Parent applications (${applicationNumber} claims priority from these)`);
			lines.push('');
			lines.push(renderMarkdownTable(parents.map((p, i) => ({ p, n: i + 1 })), [
				{ header: '#', cell: r => String(r.n), align: 'right' },
				{ header: 'Parent Application', cell: r => r.p.parentApplicationNumberText ?? '—' },
				{ header: 'Patent', cell: r => r.p.parentPatentNumber ?? '—' },
				{ header: 'Filing Date', cell: r => r.p.parentApplicationFilingDate ?? '—' },
				{ header: 'Relationship', cell: r => relationshipLabel(r.p.claimParentageTypeCodeDescriptionText, r.p.claimParentageTypeCode) },
				{ header: 'Status', cell: r => statusLabel(r.p.parentApplicationStatusCode, r.p.parentApplicationStatusDescriptionText) },
			]));
			lines.push('');
		}

		if (children.length > 0) {
			lines.push(`## Child applications (later filings that claim priority from ${applicationNumber})`);
			lines.push('');
			lines.push(renderMarkdownTable(children.map((c, i) => ({ c, n: i + 1 })), [
				{ header: '#', cell: r => String(r.n), align: 'right' },
				{ header: 'Child Application', cell: r => r.c.childApplicationNumberText ?? '—' },
				{ header: 'Patent', cell: r => r.c.childPatentNumber ?? '—' },
				{ header: 'Filing Date', cell: r => r.c.childApplicationFilingDate ?? '—' },
				{ header: 'Relationship', cell: r => relationshipLabel(r.c.claimParentageTypeCodeDescriptionText, r.c.claimParentageTypeCode) },
				{ header: 'Status', cell: r => statusLabel(r.c.childApplicationStatusCode, r.c.childApplicationStatusDescriptionText) },
			]));
			lines.push('');
		}

		lines.push('Relationship codes: CON = continuation, DIV = divisional, CIP = continuation-in-part, PRO = provisional. The earliest parent filing date sets the priority date for shared subject matter; a common-owner parent is where obviousness-type double patenting (terminal disclaimer) is assessed.');
		lines.push('These are the applicant\'s OWN related filings — for prior art cited against this application use search_citations; for a legal-event chronology use get_prosecution_timeline.');
		return lines.join('\n');
	}
}

ToolRegistry.registerTool(GetContinuityTool);
