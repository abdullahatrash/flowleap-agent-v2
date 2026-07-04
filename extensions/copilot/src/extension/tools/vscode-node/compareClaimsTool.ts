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

interface OpsEnvelope<T> {
	success: boolean;
	data?: T;
	error?: string;
}

interface OpsClaimsData {
	docId: string;
	lang: string;
	claims: string[];
}

interface FetchedClaims {
	patentNumber: string;
	claims: string[] | null;
	failureReason?: string;
}

/**
 * Tool for comparing a user's claim against prior art patents. Fetches the actual claims of each
 * cited patent from EPO OPS (`/ops/fulltext/claims`, via the shared {@link IPatentBackendClient}
 * seam, so it inherits the centralized `401 → re-sign-in` / `402 → start-trial` gating) and
 * returns them alongside the user's claim with an analysis rubric — the agent performs the
 * element-by-element comparison itself. Should be called AFTER search_patents to analyze
 * relevant results.
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
			const fetched = await Promise.all(limitedPatents.map(p => this.fetchClaims(p, token)));

			const withClaims = fetched.filter(f => f.claims && f.claims.length > 0);
			this.logService.info(`[CompareClaimsTool] Fetched claims for ${withClaims.length}/${fetched.length} patents`);

			if (withClaims.length === 0) {
				const failures = fetched.map(f => `- ${f.patentNumber}: ${f.failureReason || 'no claims returned'}`).join('\n');
				return new LanguageModelToolResult([
					new LanguageModelTextPart(
						`Could not retrieve claims for any of the requested patents:\n${failures}\n\n` +
						'EPO OPS full text covers mainly EP/WO publications. For US patents, fetch claims via ' +
						'patent_api_request (POST /patent-search-uspto/search) or get_patent_details, then compare manually.'
					)
				]);
			}

			const formattedResponse = this.formatComparisonPackage(userClaim, fetched);
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
	 * Fetch the claims of one patent. Per-patent 404s (full text not published via OPS for that
	 * jurisdiction) are reported inline rather than failing the whole comparison; auth (401/402)
	 * and cancellation errors propagate so the seam's centralized recovery UX still fires.
	 */
	private async fetchClaims(patentNumber: string, token: CancellationToken): Promise<FetchedClaims> {
		const doc = patentNumber.replace(/[-.\s/]/g, '').toUpperCase();
		try {
			const result = await this.patentBackendClient.get<OpsEnvelope<OpsClaimsData>>(
				`/ops/fulltext/claims?${new URLSearchParams({ doc }).toString()}`, token);
			if (!result.success || !result.data || result.data.claims.length === 0) {
				return { patentNumber, claims: null, failureReason: result.error || 'no claims returned' };
			}
			return { patentNumber, claims: result.data.claims };
		} catch (error) {
			if (error instanceof PatentBackendError) {
				if (error.message === 'Request cancelled.' || error.status === 401 || error.status === 402) {
					throw error;
				}
				return { patentNumber, claims: null, failureReason: `${error.status} - ${error.message}` };
			}
			return { patentNumber, claims: null, failureReason: error instanceof Error ? error.message : 'unknown error' };
		}
	}

	/**
	 * Assemble the user claim and the fetched prior-art claims into a comparison package with an
	 * analysis rubric for the agent.
	 */
	private formatComparisonPackage(userClaim: string, fetched: FetchedClaims[]): string {
		const lines: string[] = [
			'## Prior Art Claim Comparison Package',
			'',
			'### User Claim',
			'```',
			userClaim.trim(),
			'```',
			'',
			'### Prior Art Claims',
			'',
		];

		for (const f of fetched) {
			lines.push(`#### ${f.patentNumber}`);
			if (f.claims && f.claims.length > 0) {
				lines.push('```');
				lines.push(f.claims.join('\n\n'));
				lines.push('```');
			} else {
				lines.push(`Claims unavailable via EPO OPS (${f.failureReason}). For US patents, fetch via patent_api_request (POST /patent-search-uspto/search).`);
			}
			lines.push('');
		}

		lines.push(
			'---',
			'### Analysis Instructions',
			'Now perform an element-by-element comparison of the user claim against each prior-art claim set above. For each patent, report:',
			'1. **Relevance** — HIGH (anticipates most/all elements), MEDIUM (discloses several elements), or LOW.',
			'2. **Overlapping elements** — user-claim elements disclosed by the prior art, citing the specific claim number.',
			'3. **Missing elements** — user-claim elements NOT found in the prior art (potential novelty).',
			'4. **Key differences** — material differences in scope or implementation.',
			'',
			'Then summarize: HIGH-relevance patents raise §102 (anticipation) risk; combinations of MEDIUM-relevance patents may support §103 (obviousness) rejections. Use get_patent_details for full descriptions of specific patents if needed.'
		);

		return lines.join('\n');
	}
}

ToolRegistry.registerTool(CompareClaimsTool);
