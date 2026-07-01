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

interface ICompareClaimsParams {
	userClaim: string;
	patentNumbers: string[];
}

interface ClaimComparison {
	patentNumber: string;
	title: string;
	relevanceScore: 'HIGH' | 'MEDIUM' | 'LOW';
	overlappingElements: string[];
	missingElements: string[];
	keyDifferences: string[];
	analysis: string;
}

interface CompareClaimsResult {
	success: boolean;
	comparisons?: ClaimComparison[];
	summary?: string;
	error?: string;
}

/**
 * Tool for comparing a user's claim against prior art patents. Calls the FlowLeap backend (via the
 * shared {@link IPatentBackendClient} seam, so it inherits the centralized `401 → re-sign-in` /
 * `402 → start-trial` gating), which fetches patent claims and analyzes overlaps.
 * Should be called AFTER search_patents to analyze relevant results.
 */
export class CompareClaimsTool implements ICopilotTool<ICompareClaimsParams> {

	public static readonly toolName = ToolName.CompareClaims;

	constructor(
		@ILogService private readonly logService: ILogService,
		@IPatentBackendClient private readonly patentBackendClient: IPatentBackendClient,
	) { }

	prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<ICompareClaimsParams>, _token: CancellationToken): vscode.ProviderResult<vscode.PreparedToolInvocation> {
		const { patentNumbers } = options.input;
		return {
			invocationMessage: l10n.t`Comparing claim against ${patentNumbers.length} patents...`,
			confirmationMessages: {
				title: l10n.t`Compare Patent Claims`,
				message: l10n.t`Allow Patent AI to compare your claim against ${patentNumbers.length} prior art patents?`
			}
		};
	}

	async invoke(options: vscode.LanguageModelToolInvocationOptions<ICompareClaimsParams>, token: CancellationToken): Promise<vscode.LanguageModelToolResult> {
		this.logService.trace('[CompareClaimsTool] Comparing claims against prior art');

		const { userClaim, patentNumbers } = options.input;

		if (!userClaim || userClaim.trim().length === 0) {
			return new LanguageModelToolResult([
				new LanguageModelTextPart('Error: No user claim provided')
			]);
		}

		if (!patentNumbers || patentNumbers.length === 0) {
			return new LanguageModelToolResult([
				new LanguageModelTextPart('Error: No patent numbers provided for comparison')
			]);
		}

		// Limit to 10 patents to avoid timeout
		const limitedPatents = patentNumbers.slice(0, 10);
		if (patentNumbers.length > 10) {
			this.logService.warn(`[CompareClaimsTool] Limiting comparison to first 10 patents (received ${patentNumbers.length})`);
		}

		try {
			const result = await this.patentBackendClient.post<CompareClaimsResult>(
				'/compare-claims',
				{ userClaim, patentNumbers: limitedPatents },
				token
			);

			this.logService.info('[CompareClaimsTool] Comparison result received');

			if (!result.success || !result.comparisons) {
				this.logService.error(`[CompareClaimsTool] Comparison failed: ${result.error}`);
				return new LanguageModelToolResult([
					new LanguageModelTextPart(`Error comparing claims: ${result.error}`)
				]);
			}

			// Format comparison for LLM
			const formattedResponse = this.formatComparison(result);
			this.logService.info(`[CompareClaimsTool] Formatted response length: ${formattedResponse.length} chars`);

			return new LanguageModelToolResult([
				new LanguageModelTextPart(formattedResponse)
			]);

		} catch (error) {
			if (error instanceof PatentBackendError) {
				if (error.message === 'Request cancelled.') {
					return new LanguageModelToolResult([new LanguageModelTextPart('Request cancelled.')]);
				}
				this.logService.error(`[CompareClaimsTool] Backend error ${error.status}: ${error.message}`);
				return new LanguageModelToolResult([
					new LanguageModelTextPart(`Error: Claim comparison backend returned ${error.status}: ${error.message}` + patentBackendErrorRecoveryHint(error))
				]);
			}
			this.logService.error(`[CompareClaimsTool] Exception: ${error instanceof Error ? error.message : String(error)}`);
			return new LanguageModelToolResult([
				new LanguageModelTextPart(`Error: ${error instanceof Error ? error.message : 'Unknown error occurred'}`)
			]);
		}
	}

	/**
	 * Format comparison results for LLM consumption
	 */
	private formatComparison(result: CompareClaimsResult): string {
		const lines: string[] = [
			'## Prior Art Comparison Results',
			'',
		];

		if (result.summary) {
			lines.push('### Summary');
			lines.push(result.summary);
			lines.push('');
		}

		lines.push('### Detailed Comparisons');
		lines.push('');

		for (const comp of result.comparisons || []) {
			lines.push(`#### ${comp.patentNumber}`);
			lines.push(`**Title:** ${comp.title}`);
			lines.push(`**Relevance:** ${this.getRelevanceEmoji(comp.relevanceScore)} ${comp.relevanceScore}`);
			lines.push('');

			if (comp.overlappingElements.length > 0) {
				lines.push('**Overlapping Elements:**');
				comp.overlappingElements.forEach(elem => lines.push(`- ✓ ${elem}`));
				lines.push('');
			}

			if (comp.missingElements.length > 0) {
				lines.push('**Elements NOT in Prior Art:**');
				comp.missingElements.forEach(elem => lines.push(`- ✗ ${elem}`));
				lines.push('');
			}

			if (comp.keyDifferences.length > 0) {
				lines.push('**Key Differences:**');
				comp.keyDifferences.forEach(diff => lines.push(`- ${diff}`));
				lines.push('');
			}

			if (comp.analysis) {
				lines.push('**Analysis:**');
				lines.push(comp.analysis);
				lines.push('');
			}

			lines.push('---');
			lines.push('');
		}

		// Add guidance
		lines.push('### Next Steps');
		lines.push('- **HIGH relevance patents** should be carefully reviewed for 102 (anticipation) issues');
		lines.push('- **MEDIUM relevance patents** may be combined for 103 (obviousness) rejections');
		lines.push('- Use `get_patent_details` to view full claims of specific patents');
		lines.push('- Consider searching for additional prior art if coverage is low');

		return lines.join('\n');
	}

	private getRelevanceEmoji(score: string): string {
		switch (score) {
			case 'HIGH': return '🔴';
			case 'MEDIUM': return '🟡';
			case 'LOW': return '🟢';
			default: return '⚪';
		}
	}
}

ToolRegistry.registerTool(CompareClaimsTool);
