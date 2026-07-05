/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import type * as vscode from 'vscode';
import { IEndpointProvider } from '../../../../platform/endpoint/common/endpointProvider';
import { ILogService } from '../../../../platform/log/common/logService';
import { IChatEndpoint } from '../../../../platform/networking/common/networking';
import { createServiceIdentifier } from '../../../../util/common/services';
import { Emitter } from '../../../../util/vs/base/common/event';
import { Disposable } from '../../../../util/vs/base/common/lifecycle';
import type { ParsedClaudeModelId } from '../common/claudeModelId';
import { tryParseClaudeModelId } from './claudeModelId';
import type { EffortLevel } from '@anthropic-ai/claude-agent-sdk';

export const CLAUDE_REASONING_EFFORT_PROPERTY = 'reasoningEffort';

const NATIVE_CLAUDE_CONTEXT_WINDOW = 200_000;
const NATIVE_CLAUDE_MAX_OUTPUT = 64_000;

/**
 * The Claude model tiers surfaced in the Agents window composer for
 * Claude-native mode. The `id` doubles as the SDK model alias — the Claude CLI
 * resolves each ('sonnet'/'opus'/'haiku') to its latest concrete version and
 * bills it to the user's own Claude credentials, so no version strings are
 * tracked here. Built at call time so localized strings pick up the active
 * language bundle.
 */
function getNativeClaudeModels(): vscode.LanguageModelChatInformation[] {
	const base = {
		maxInputTokens: NATIVE_CLAUDE_CONTEXT_WINDOW,
		maxOutputTokens: NATIVE_CLAUDE_MAX_OUTPUT,
		isUserSelectable: true,
		capabilities: { imageInput: true, toolCalling: true },
		targetChatSessionType: 'claude-code',
	} as const;
	return [
		{
			...base,
			id: 'sonnet',
			name: l10n.t('Claude Sonnet'),
			family: 'sonnet',
			version: 'sonnet',
			tooltip: l10n.t('Balanced Claude model for everyday agentic coding.'),
			isDefault: true,
		},
		{
			...base,
			id: 'opus',
			name: l10n.t('Claude Opus'),
			family: 'opus',
			version: 'opus',
			tooltip: l10n.t('Most capable Claude model for complex, multi-step work.'),
		},
		{
			...base,
			id: 'haiku',
			name: l10n.t('Claude Haiku'),
			family: 'haiku',
			version: 'haiku',
			tooltip: l10n.t('Fastest, most cost-effective Claude model.'),
		},
	];
}

export interface IClaudeCodeModels {
	readonly _serviceBrand: undefined;
	/**
	 * Resolves a Claude endpoint for the given requested model ID.
	 * Falls back to the fallback model ID if the requested model doesn't match,
	 * then to the newest Sonnet, newest Haiku, or any Claude endpoint.
	 * Returns `undefined` if no Claude endpoint can be found.
	 */
	resolveEndpoint(requestedModel: ParsedClaudeModelId | string | undefined, fallbackModelId: ParsedClaudeModelId | undefined): Promise<IChatEndpoint | undefined>;

	/**
	 * Resolves the reasoning effort level for the given requested model ID and requested reasoning effort.
	 */
	resolveReasoningEffort(requestedModel: ParsedClaudeModelId | string | undefined, requestedReasoningEffort: string | undefined): Promise<EffortLevel | undefined>;

	/**
	 * Registers a LanguageModelChatProvider so that Claude models appear in
	 * VS Code's built-in model picker for the claude-code session type.
	 */
	registerLanguageModelChatProvider(lm: typeof vscode['lm']): void;
}

export const IClaudeCodeModels = createServiceIdentifier<IClaudeCodeModels>('IClaudeCodeModels');

export class ClaudeCodeModels extends Disposable implements IClaudeCodeModels {
	declare _serviceBrand: undefined;
	private _cachedEndpoints: Promise<IChatEndpoint[]> | undefined;
	private readonly _onDidChange = this._register(new Emitter<void>());

	constructor(
		@IEndpointProvider private readonly endpointProvider: IEndpointProvider,
		@ILogService private readonly logService: ILogService,
	) {
		super();
		this._register(this.endpointProvider.onDidModelsRefresh(() => {
			this._cachedEndpoints = undefined;
			this._onDidChange.fire();
		}));
	}

	public registerLanguageModelChatProvider(lm: typeof vscode['lm']): void {
		const provider: vscode.LanguageModelChatProvider = {
			onDidChangeLanguageModelChatInformation: this._onDidChange.event,
			provideLanguageModelChatInformation: async (_options, _token) => {
				return this._provideLanguageModelChatInfo();
			},
			provideLanguageModelChatResponse: async (_model, _messages, _options, _progress, _token) => {
				// Implemented via chat participants.
			},
			provideTokenCount: async (_model, _text, _token) => {
				// Token counting is not currently supported for the claude provider.
				return 0;
			}
		};
		this._register(lm.registerLanguageModelChatProvider('claude-code', provider));

		void this._getEndpoints().then(() => this._onDidChange.fire());
	}

	private _getEndpoints(): Promise<IChatEndpoint[]> {
		if (!this._cachedEndpoints) {
			this._cachedEndpoints = this._fetchAvailableEndpoints();
		}
		return this._cachedEndpoints;
	}

	private async _provideLanguageModelChatInfo(): Promise<vscode.LanguageModelChatInformation[]> {
		// Claude-native mode: sessions run against the Claude CLI's own credential
		// chain (claude.ai subscription or ANTHROPIC_API_KEY), so the available
		// models are the standard Anthropic tiers rather than the BYOK endpoints.
		// The SDK resolves each alias ('opus'/'sonnet'/'haiku') to its latest
		// concrete version, so we don't have to track model version strings here.
		return getNativeClaudeModels();
	}

	public async resolveReasoningEffort(requestedModel: ParsedClaudeModelId | string | undefined, requestedReasoningEffort: string | undefined): Promise<EffortLevel | undefined> {
		const endpoint = await this.resolveEndpoint(requestedModel, undefined);
		return pickReasoningEffort(endpoint, requestedReasoningEffort);
	}

	public async resolveEndpoint(requestedModel: ParsedClaudeModelId | string | undefined, fallbackModelId: ParsedClaudeModelId | undefined): Promise<IChatEndpoint | undefined> {
		const endpoints = await this._getEndpoints();

		// 1. Exact match for the requested model
		if (requestedModel) {
			let parsedModel: ParsedClaudeModelId | undefined;
			if (typeof requestedModel === 'string') {
				parsedModel = tryParseClaudeModelId(requestedModel);
			} else {
				parsedModel = requestedModel;
			}
			const mappedModel = parsedModel?.toEndpointModelId() ?? requestedModel;
			const exact = endpoints.find(e => e.family === mappedModel || e.model === mappedModel);
			if (exact) {
				return exact;
			}
		}

		// 2. Exact match for the fallback model from session state
		if (fallbackModelId) {
			const fallback = endpoints.find(e => e.model === fallbackModelId.toEndpointModelId());
			if (fallback) {
				return fallback;
			}
		}

		// 3. Newest Sonnet (endpoints are sorted by name descending)
		const sonnet = endpoints.find(e => e.family?.includes('sonnet') || e.model.includes('sonnet'));
		if (sonnet) {
			return sonnet;
		}

		// 4. Newest Haiku
		const haiku = endpoints.find(e => e.family?.includes('haiku') || e.model.includes('haiku'));
		if (haiku) {
			return haiku;
		}

		// 5. Any model (these are already only Anthropic models)
		return endpoints[0];
	}

	private async _fetchAvailableEndpoints(): Promise<IChatEndpoint[]> {
		try {
			const endpoints = await this.endpointProvider.getAllChatEndpoints();

			// Filter for Anthropic models that are available in the model picker
			// and use the Messages API (required for Claude Code)
			const claudeEndpoints = endpoints.filter(e =>
				e.supportsToolCalls &&
				e.showInModelPicker &&
				e.modelProvider === 'Anthropic' &&
				e.apiType === 'messages'
			);

			if (claudeEndpoints.length === 0) {
				this.logService.trace('[ClaudeCodeModels] No Anthropic models with Messages API found');
				return [];
			}

			return claudeEndpoints.sort((a, b) => b.name.localeCompare(a.name));
		} catch (ex) {
			this.logService.error(`[ClaudeCodeModels] Failed to fetch models`, ex);
			return [];
		}
	}
}

const SUPPORTED_EFFORT_LEVELS: EffortLevel[] = ['low', 'medium', 'high'];

export function isEffortLevel(value: string): value is EffortLevel {
	return SUPPORTED_EFFORT_LEVELS.includes(value as EffortLevel);
}

/**
 * Picks the reasoning effort to use for an endpoint given a requested level.
 */
export function pickReasoningEffort(endpoint: IChatEndpoint | undefined, requestedReasoningEffort: string | undefined): EffortLevel | undefined {
	if (!endpoint || !endpoint.supportsReasoningEffort || endpoint.supportsReasoningEffort.length === 0) {
		return undefined;
	}
	if (requestedReasoningEffort && isEffortLevel(requestedReasoningEffort) && endpoint.supportsReasoningEffort.includes(requestedReasoningEffort)) {
		return requestedReasoningEffort;
	}
	if (endpoint.supportsReasoningEffort.length === 1 && isEffortLevel(endpoint.supportsReasoningEffort[0])) {
		return endpoint.supportsReasoningEffort[0];
	}
	return undefined;
}
