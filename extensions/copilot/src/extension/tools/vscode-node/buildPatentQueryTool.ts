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

interface IBuildPatentQueryParams {
	description: string;
	focus?: 'broad' | 'precise' | 'comprehensive';
}

interface QueryStrategy {
	recommended_cql: string;
	explanation: string;
	search_fields_used: string[];
	alternatives?: {
		broader?: string;
		narrower?: string;
	};
	tips?: string[];
}

interface BuildQueryResult {
	success: boolean;
	strategy?: QueryStrategy;
	error?: string;
}

/**
 * Tool for building optimized CQL queries from natural language descriptions. Analyzes the user's
 * intent and constructs effective EP/WO patent search queries via the FlowLeap backend through the
 * shared {@link IPatentBackendClient} seam, so it inherits the centralized `401 → re-sign-in` /
 * `402 → start-trial` gating. Should be called BEFORE searchPatents to ensure a good search strategy.
 *
 * The description is processed on FlowLeap's own Anthropic/OpenAI account, so the call is gated on
 * the user's Query Generation consent (#213) before anything is transmitted.
 */
export class BuildPatentQueryTool implements ICopilotTool<IBuildPatentQueryParams> {

	public static readonly toolName = ToolName.BuildPatentQuery;

	constructor(
		@ILogService private readonly logService: ILogService,
		@IPatentBackendClient private readonly patentBackendClient: IPatentBackendClient,
		@IManagedInferenceConsentService private readonly consentService: IManagedInferenceConsentService,
	) { }

	prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<IBuildPatentQueryParams>, _token: CancellationToken): vscode.ProviderResult<vscode.PreparedToolInvocation> {
		const { description } = options.input;
		return {
			invocationMessage: l10n.t`Building patent search strategy: ${description}`,
		};
	}

	async invoke(options: vscode.LanguageModelToolInvocationOptions<IBuildPatentQueryParams>, token: CancellationToken): Promise<vscode.LanguageModelToolResult> {
		this.logService.trace('[BuildPatentQueryTool] Building query strategy');

		const refusal = await refuseWithoutManagedInferenceConsent(this.consentService, 'query-generation');
		if (refusal) {
			return refusal;
		}

		const { description, focus = 'comprehensive' } = options.input;

		try {
			const result = await this.patentBackendClient.post<BuildQueryResult>('/build-patent-query', { description, focus }, token);

			if (!result.success || !result.strategy) {
				this.logService.error(`[BuildPatentQueryTool] Strategy building failed: ${result.error}`);
				return new LanguageModelToolResult([
					new LanguageModelTextPart(`Error building query strategy: ${result.error}`)
				]);
			}

			// Format strategy for LLM
			const formattedResponse = withProcessingNotice(this.formatStrategy(result.strategy), 'query-generation');
			this.logService.info(`[BuildPatentQueryTool] Formatted response length: ${formattedResponse.length} chars`);

			return new LanguageModelToolResult([
				new LanguageModelTextPart(formattedResponse)
			]);

		} catch (error) {
			return handlePatentToolError(error, this.logService, '[BuildPatentQueryTool]', err => `Error: Patent query builder returned ${err.status}: ${err.message}`);
		}
	}

	/**
	 * Format strategy for LLM consumption
	 */
	private formatStrategy(strategy: QueryStrategy): string {
		const lines: string[] = [
			'## Patent Search Strategy',
			'',
			'### Recommended CQL Query',
			'```',
			strategy.recommended_cql,
			'```',
			'',
			'### Explanation',
			strategy.explanation,
			'',
			'### Search Fields Used',
			strategy.search_fields_used.map(f => `- ${f}`).join('\n'),
		];

		if (strategy.alternatives) {
			lines.push('', '### Alternative Queries');
			if (strategy.alternatives.broader) {
				lines.push(`**Broader search:** \`${strategy.alternatives.broader}\``);
			}
			if (strategy.alternatives.narrower) {
				lines.push(`**Narrower search:** \`${strategy.alternatives.narrower}\``);
			}
		}

		if (strategy.tips && strategy.tips.length > 0) {
			lines.push('', '### Tips');
			lines.push(strategy.tips.map(t => `- ${t}`).join('\n'));
		}

		lines.push('', '---', 'Use the recommended CQL query with the search_patents tool to execute the search.');

		return lines.join('\n');
	}
}

ToolRegistry.registerTool(BuildPatentQueryTool);
