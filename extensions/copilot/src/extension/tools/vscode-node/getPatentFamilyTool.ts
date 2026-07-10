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

interface IGetPatentFamilyParams {
	publicationNumber: string;
}

/** One INPADOC family member, as returned by the `/tools/get_patent_family` facade `data` payload. */
interface FamilyMember {
	docId: string;
	country?: string;
	docNumber?: string;
	kind?: string;
}

interface FamilyData {
	docId: string;
	familyMembers: FamilyMember[];
	totalCount: number;
}

/**
 * Tool for retrieving a patent's INPADOC family members (equivalents/counterparts filed in other
 * jurisdictions) from EPO OPS, through the FlowLeap agent-first `/tools/get_patent_family` facade.
 * Routes through the shared {@link IPatentBackendClient} seam (via {@link callFacadeTool}), so it
 * inherits the centralized `401 → re-sign-in` / `402 → start-trial` / `429 → wait` gating. This is the
 * typed replacement for the raw `ops_api_guide` family endpoints in FTO / portfolio workflows.
 */
export class GetPatentFamilyTool implements ICopilotTool<IGetPatentFamilyParams> {

	public static readonly toolName = ToolName.GetPatentFamily;

	constructor(
		@ILogService private readonly logService: ILogService,
		@IPatentBackendClient private readonly patentBackendClient: IPatentBackendClient,
	) { }

	prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<IGetPatentFamilyParams>, _token: CancellationToken): vscode.ProviderResult<vscode.PreparedToolInvocation> {
		const { publicationNumber } = options.input;
		return {
			invocationMessage: l10n.t`Fetching patent family for ${publicationNumber}...`,
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

	async invoke(options: vscode.LanguageModelToolInvocationOptions<IGetPatentFamilyParams>, token: CancellationToken): Promise<vscode.LanguageModelToolResult> {
		this.logService.trace('[GetPatentFamilyTool] Invoking patent-family fetch');

		const { publicationNumber } = options.input;
		const doc = this.normalizePublicationNumber(publicationNumber);
		this.logService.info(`[GetPatentFamilyTool] Normalized: ${publicationNumber} -> ${doc}`);

		try {
			const data = await callFacadeTool<FamilyData>(this.patentBackendClient, 'get_patent_family', { patent_number: doc }, token);
			const formatted = this.formatFamily(data, doc);
			this.logService.info(`[GetPatentFamilyTool] Formatted response length: ${formatted.length} chars`);
			return new LanguageModelToolResult([new LanguageModelTextPart(formatted)]);
		} catch (error) {
			return handlePatentToolError(error, this.logService, '[GetPatentFamilyTool]', err => `Error fetching patent family for ${publicationNumber}: ${err.status} - ${err.message}`);
		}
	}

	private formatFamily(data: FamilyData, doc: string): string {
		const members = data.familyMembers ?? [];
		const lines: string[] = [
			`# Patent Family: ${data.docId || doc}`,
			'',
		];

		if (members.length === 0) {
			lines.push('No INPADOC family members found for this publication number.');
			lines.push('');
			lines.push('EPO OPS may not hold family data for this document. Verify the number with get_patent_details, or the patent may have no foreign equivalents.');
			return lines.join('\n');
		}

		lines.push(`INPADOC family: ${data.totalCount ?? members.length} member(s) across jurisdictions.`);
		lines.push('');
		lines.push(renderMarkdownTable(members, [
			{ header: 'Country', cell: m => m.country || (m.docId ? m.docId.substring(0, 2) : '—') },
			{ header: 'Publication', cell: m => m.docId || m.docNumber || '—' },
			{ header: 'Kind', cell: m => m.kind || '—' },
		]));
		lines.push('');
		lines.push('The INPADOC family groups documents sharing a priority (equivalents/counterparts across jurisdictions). For the legal status of an individual member use get_legal_status on that member; for its EP prosecution history use get_register_events.');
		return lines.join('\n');
	}
}

ToolRegistry.registerTool(GetPatentFamilyTool);
