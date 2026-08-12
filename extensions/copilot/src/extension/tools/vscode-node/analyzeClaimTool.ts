/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import type * as vscode from 'vscode';
import { ILogService } from '../../../platform/log/common/logService';
import { CancellationToken } from '../../../util/vs/base/common/cancellation';
import { LanguageModelTextPart, LanguageModelToolResult } from '../../../vscodeTypes';
import { IManagedInferenceConsentService } from '../../patentai/vscode-node/managedInferenceConsentService';
import { IPatentBackendClient } from '../../patentai/vscode-node/patentBackendClient';
import { refuseWithoutManagedInferenceConsent, withProcessingNotice } from './managedInferenceGate';
import { handlePatentToolError } from './patentToolError';
import { ToolName } from '../common/toolNames';
import { ICopilotTool, ToolRegistry } from '../common/toolsRegistry';
import { IMarkdownColumn, renderMarkdownTable } from './patentResponseFormatter';

interface IAnalyzeClaimParams {
	claimText: string;
	focus?: 'search' | 'elements' | 'full';
}

interface ClaimElement {
	element: string;
	type: 'preamble' | 'component' | 'method' | 'function' | 'limitation';
}

interface ClaimAnalysis {
	keywords: string[];
	synonyms: Record<string, string[]>;
	ipcCodes: string[];
	suggestedQueries: string[];
	claimElements: ClaimElement[];
}

interface AnalyzeClaimResult {
	success: boolean;
	analysis?: ClaimAnalysis;
	error?: string;
}

/**
 * Tool for analyzing a patent claim to extract searchable elements. Uses the FlowLeap backend (via the
 * shared {@link IPatentBackendClient} seam, so it inherits the centralized `401 → re-sign-in` /
 * `402 → start-trial` gating) to parse claim structure and extract keywords, synonyms, and IPC codes.
 * Should be called BEFORE search_patents to build effective search strategies.
 *
 * The claim text is processed on FlowLeap's own Anthropic/OpenAI account, so the call is gated on
 * the user's Claim Analysis consent (#213) before anything is transmitted.
 */
export class AnalyzeClaimTool implements ICopilotTool<IAnalyzeClaimParams> {

	public static readonly toolName = ToolName.AnalyzeClaim;

	constructor(
		@ILogService private readonly logService: ILogService,
		@IPatentBackendClient private readonly patentBackendClient: IPatentBackendClient,
		@IManagedInferenceConsentService private readonly consentService: IManagedInferenceConsentService,
	) { }

	prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<IAnalyzeClaimParams>, _token: CancellationToken): vscode.ProviderResult<vscode.PreparedToolInvocation> {
		const { claimText } = options.input;
		const preview = claimText.length > 50 ? claimText.substring(0, 50) + '...' : claimText;
		return {
			invocationMessage: l10n.t`Analyzing claim: "${preview}"`,
		};
	}

	async invoke(options: vscode.LanguageModelToolInvocationOptions<IAnalyzeClaimParams>, token: CancellationToken): Promise<vscode.LanguageModelToolResult> {
		this.logService.trace('[AnalyzeClaimTool] Analyzing claim for search');

		// Consent is the first question — ahead of input validation, so a user who refused hears
		// about their own setting rather than a validation error that explains nothing.
		const refusal = await refuseWithoutManagedInferenceConsent(this.consentService, 'claim-analysis');
		if (refusal) {
			return refusal;
		}

		const { claimText, focus = 'full' } = options.input;

		if (!claimText || claimText.trim().length === 0) {
			return new LanguageModelToolResult([
				new LanguageModelTextPart('Error: No claim text provided')
			]);
		}

		try {
			const result = await this.patentBackendClient.post<AnalyzeClaimResult>('/analyze-claim', { claimText, focus }, token);

			if (!result.success || !result.analysis) {
				this.logService.error(`[AnalyzeClaimTool] Analysis failed: ${result.error}`);
				return new LanguageModelToolResult([
					new LanguageModelTextPart(`Error analyzing claim: ${result.error}`)
				]);
			}

			// Format analysis for LLM
			const formattedResponse = withProcessingNotice(this.formatAnalysis(result.analysis), 'claim-analysis');
			this.logService.info(`[AnalyzeClaimTool] Formatted response length: ${formattedResponse.length} chars`);

			return new LanguageModelToolResult([
				new LanguageModelTextPart(formattedResponse)
			]);

		} catch (error) {
			return handlePatentToolError(error, this.logService, '[AnalyzeClaimTool]', err => `Error: Claim analysis backend returned ${err.status}: ${err.message}`);
		}
	}

	/**
	 * Format analysis for LLM consumption
	 */
	private formatAnalysis(analysis: ClaimAnalysis): string {
		const lines: string[] = [
			'## Claim Analysis',
			'',
			'### Keywords',
			analysis.keywords.map(k => `- ${k}`).join('\n'),
			'',
			'### Synonyms & Alternative Terms',
		];

		for (const [keyword, synonyms] of Object.entries(analysis.synonyms)) {
			lines.push(`- **${keyword}**: ${synonyms.join(', ')}`);
		}

		lines.push('', '### Suggested IPC/CPC Classifications');
		lines.push(analysis.ipcCodes.map(code => `- ${code}`).join('\n'));

		lines.push('', '### Recommended Search Queries (CQL)');
		analysis.suggestedQueries.forEach((query, i) => {
			lines.push(`${i + 1}. \`${query}\``);
		});

		lines.push('', '### Claim Elements');
		const elementRows = analysis.claimElements.map((elem, i) => ({
			num: i + 1,
			element: elem.element,
			type: elem.type === 'preamble' || elem.type === 'limitation' ? elem.type : `limitation (${elem.type})`,
		}));
		const elementColumns: IMarkdownColumn<typeof elementRows[number]>[] = [
			{ header: '#', cell: r => String(r.num), align: 'right' },
			{ header: 'Claim Element', cell: r => r.element },
			{ header: 'Type', cell: r => r.type },
		];
		lines.push(renderMarkdownTable(elementRows, elementColumns));

		lines.push('', '---');
		lines.push('Use the suggested CQL queries with the `search_patents` tool to find prior art.');
		lines.push('Run multiple queries to maximize coverage (different terminology may find different patents).');

		return lines.join('\n');
	}
}

ToolRegistry.registerTool(AnalyzeClaimTool);
