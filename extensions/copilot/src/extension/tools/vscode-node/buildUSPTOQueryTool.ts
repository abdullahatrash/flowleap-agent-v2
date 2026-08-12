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

interface IBuildUSPTOQueryParams {
	description: string;
	focus?: 'broad' | 'precise' | 'comprehensive';
}

interface USPTOQueryStrategy {
	recommended_query: {
		query: string;
		assignee?: string;
		cpcCode?: string;
		dateRange?: { from?: string; to?: string };
		assigneeCountry?: string;
		phraseMatch?: boolean;
		sort?: string;
		size?: number;
		includeClaims?: boolean;
		includeCitations?: boolean;
	};
	explanation: string;
	search_parameters_used: string[];
	alternatives?: {
		broader?: { query: string; assignee?: string; cpcCode?: string };
		narrower?: { query: string; assignee?: string; cpcCode?: string };
	};
	tips?: string[];
}

interface BuildQueryResult {
	success: boolean;
	strategy?: USPTOQueryStrategy;
	error?: string;
}

/**
 * Tool for building optimized USPTO Open Data Portal queries from natural language descriptions.
 * Analyzes the user's intent and constructs effective US patent search queries via the FlowLeap
 * backend through the shared {@link IPatentBackendClient} seam, so it inherits the centralized
 * `401 → re-sign-in` / `402 → start-trial` gating.
 */
export class BuildUSPTOQueryTool implements ICopilotTool<IBuildUSPTOQueryParams> {

	public static readonly toolName = ToolName.BuildUSPTOQuery;

	constructor(
		@ILogService private readonly logService: ILogService,
		@IPatentBackendClient private readonly patentBackendClient: IPatentBackendClient,
		@IManagedInferenceConsentService private readonly consentService: IManagedInferenceConsentService,
	) { }

	prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<IBuildUSPTOQueryParams>, _token: CancellationToken): vscode.ProviderResult<vscode.PreparedToolInvocation> {
		const { description } = options.input;
		return {
			invocationMessage: l10n.t`Building USPTO search strategy: ${description}`,
		};
	}

	async invoke(options: vscode.LanguageModelToolInvocationOptions<IBuildUSPTOQueryParams>, token: CancellationToken): Promise<vscode.LanguageModelToolResult> {
		this.logService.trace('[BuildUSPTOQueryTool] Building USPTO query strategy');

		const refusal = await refuseWithoutManagedInferenceConsent(this.consentService, 'query-generation');
		if (refusal) {
			return refusal;
		}

		const { description, focus = 'comprehensive' } = options.input;

		try {
			const result = await this.patentBackendClient.post<BuildQueryResult>('/build-uspto-query', { description, focus }, token);

			if (!result.success || !result.strategy) {
				this.logService.error(`[BuildUSPTOQueryTool] Strategy building failed: ${result.error}`);
				return new LanguageModelToolResult([
					new LanguageModelTextPart(`Error building USPTO query strategy: ${result.error}`)
				]);
			}

			const formattedResponse = withProcessingNotice(this.formatStrategy(result.strategy), 'query-generation');
			this.logService.info(`[BuildUSPTOQueryTool] Formatted response length: ${formattedResponse.length} chars`);

			return new LanguageModelToolResult([
				new LanguageModelTextPart(formattedResponse)
			]);

		} catch (error) {
			return handlePatentToolError(error, this.logService, '[BuildUSPTOQueryTool]', err => `Error: USPTO query builder returned ${err.status}: ${err.message}`);
		}
	}

	/**
	 * Format strategy for LLM consumption
	 */
	private formatStrategy(strategy: USPTOQueryStrategy): string {
		const q = strategy.recommended_query;
		const lines: string[] = [
			'## USPTO Patent Search Strategy',
			'',
			'### Recommended Query Parameters',
			'```json',
			JSON.stringify(q, null, 2),
			'```',
			'',
			'### Explanation',
			strategy.explanation,
			'',
			'### Parameters Used',
			strategy.search_parameters_used.map(f => `- ${f}`).join('\n'),
		];

		if (strategy.alternatives) {
			lines.push('', '### Alternative Queries');
			if (strategy.alternatives.broader) {
				lines.push(`**Broader search:** \`${JSON.stringify(strategy.alternatives.broader)}\``);
			}
			if (strategy.alternatives.narrower) {
				lines.push(`**Narrower search:** \`${JSON.stringify(strategy.alternatives.narrower)}\``);
			}
		}

		if (strategy.tips && strategy.tips.length > 0) {
			lines.push('', '### Tips');
			lines.push(strategy.tips.map(t => `- ${t}`).join('\n'));
		}

		lines.push('', '---', 'Use these parameters with the USPTO search endpoint to execute the search.');

		return lines.join('\n');
	}
}

ToolRegistry.registerTool(BuildUSPTOQueryTool);
