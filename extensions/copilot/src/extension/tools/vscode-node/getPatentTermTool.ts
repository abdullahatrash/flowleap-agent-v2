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

interface IGetPatentTermParams {
	patentNumber: string;
}

/** `data` payload of the `/v1/tools/get_patent_term` facade endpoint. */
interface TermData {
	patentNumber: string;
	filingDate: string | null;
	baseExpiryDate: string | null;
	basis: string;
	disclaimer: string;
}

/**
 * Tool for estimating a patent's term (expiry) from the FlowLeap backend's compound
 * `/v1/tools/get_patent_term` facade endpoint. Routes through the shared {@link IPatentBackendClient}
 * seam (so it inherits the centralized `401 → re-sign-in` / `402 → start-trial` gating) and
 * {@link callFacadeTool} unwrapping.
 *
 * The estimate is the statutory base (20 years from filing) only: it does NOT account for PTA/PTE,
 * SPCs, terminal disclaimers, or annuity lapses. The backend's own disclaimer is surfaced verbatim
 * and the model is pointed at get_patent_summary / the legal-status events for lapse/adjustment data.
 * When the backend has no filing date on record it returns a `422`; the tool reports that cleanly
 * rather than as a raw error.
 */
export class GetPatentTermTool implements ICopilotTool<IGetPatentTermParams> {

	public static readonly toolName = ToolName.GetPatentTerm;

	constructor(
		@ILogService private readonly logService: ILogService,
		@IPatentBackendClient private readonly patentBackendClient: IPatentBackendClient,
	) { }

	prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<IGetPatentTermParams>, _token: CancellationToken): vscode.ProviderResult<vscode.PreparedToolInvocation> {
		const { patentNumber } = options.input;
		return {
			invocationMessage: l10n.t`Estimating patent term for ${patentNumber}...`,
		};
	}

	async invoke(options: vscode.LanguageModelToolInvocationOptions<IGetPatentTermParams>, token: CancellationToken): Promise<vscode.LanguageModelToolResult> {
		this.logService.trace('[GetPatentTermTool] Estimating patent term');

		const patentNumber = options.input.patentNumber?.trim();
		if (!patentNumber) {
			return new LanguageModelToolResult([
				new LanguageModelTextPart('Error: No patent number provided')
			]);
		}

		try {
			const term = await callFacadeTool<TermData>(this.patentBackendClient, ToolName.GetPatentTerm, { patent_number: patentNumber }, token);
			const formatted = this.formatTerm(term, patentNumber);
			this.logService.info(`[GetPatentTermTool] Formatted response length: ${formatted.length} chars`);
			return new LanguageModelToolResult([new LanguageModelTextPart(formatted)]);
		} catch (error) {
			return handlePatentToolError(
				error,
				this.logService,
				'[GetPatentTermTool]',
				err => err.status === 422
					? `Could not estimate the term for ${patentNumber}: ${err.message} A filing date is required; use get_patent_summary or the legal-status events to check current status.`
					: `Error estimating term for ${patentNumber}: ${err.status} - ${err.message}`,
			);
		}
	}

	/** Format the term estimate, surfacing the backend's own disclaimer verbatim. */
	private formatTerm(term: TermData, patentNumber: string): string {
		return [
			`# Patent Term Estimate: ${term.patentNumber || patentNumber}`,
			'',
			`**Filing Date:** ${term.filingDate || 'N/A'}`,
			`**Estimated Expiry (base):** ${term.baseExpiryDate || 'N/A'}`,
			`**Basis:** ${term.basis}`,
			'',
			`> ${term.disclaimer}`,
			'',
			'---',
			'For lapse/withdrawal, terminal disclaimers, or adjustment (PTA/PTE/SPC) data, use get_patent_summary (legal-status events) or the OPS legal endpoint — this is a base estimate only, not the enforceable expiry date.',
		].join('\n');
	}
}

ToolRegistry.registerTool(GetPatentTermTool);
