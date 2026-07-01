/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import type * as vscode from 'vscode';
import { ILogService } from '../../../platform/log/common/logService';
import { CancellationToken } from '../../../util/vs/base/common/cancellation';
import { LanguageModelTextPart, LanguageModelToolResult } from '../../../vscodeTypes';
import { IPatentBackendClient, PatentBackendError, patentBackendErrorRecoveryHint } from '../../patentai/vscode-node/patentBackendClient';
import { ToolName } from '../common/toolNames';
import { ICopilotTool, ToolRegistry } from '../common/toolsRegistry';

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
 */
export class AnalyzeClaimTool implements ICopilotTool<IAnalyzeClaimParams> {

	public static readonly toolName = ToolName.AnalyzeClaim;

	constructor(
		@ILogService private readonly logService: ILogService,
		@IPatentBackendClient private readonly patentBackendClient: IPatentBackendClient,
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
			const formattedResponse = this.formatAnalysis(result.analysis);
			this.logService.info(`[AnalyzeClaimTool] Formatted response length: ${formattedResponse.length} chars`);

			return new LanguageModelToolResult([
				new LanguageModelTextPart(formattedResponse)
			]);

		} catch (error) {
			if (error instanceof PatentBackendError) {
				if (error.message === 'Request cancelled.') {
					return new LanguageModelToolResult([new LanguageModelTextPart('Request cancelled.')]);
				}
				this.logService.error(`[AnalyzeClaimTool] Backend error ${error.status}: ${error.message}`);
				return new LanguageModelToolResult([
					new LanguageModelTextPart(`Error: Claim analysis backend returned ${error.status}: ${error.message}` + patentBackendErrorRecoveryHint(error))
				]);
			}
			this.logService.error(`[AnalyzeClaimTool] Exception: ${error instanceof Error ? error.message : String(error)}`);
			return new LanguageModelToolResult([
				new LanguageModelTextPart(`Error: ${error instanceof Error ? error.message : 'Unknown error occurred'}`)
			]);
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
		analysis.claimElements.forEach((elem, i) => {
			lines.push(`${i + 1}. **[${elem.type}]** ${elem.element}`);
		});

		lines.push('', '---');
		lines.push('Use the suggested CQL queries with the `search_patents` tool to find prior art.');
		lines.push('Run multiple queries to maximize coverage (different terminology may find different patents).');

		return lines.join('\n');
	}
}

ToolRegistry.registerTool(AnalyzeClaimTool);
