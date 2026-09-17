/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { Raw } from '@vscode/prompt-tsx';
import { IChatMLFetcher } from '../../../platform/chat/common/chatMLFetcher';
import { IConfigurationService } from '../../../platform/configuration/common/configurationService';
import { IDomainService } from '../../../platform/endpoint/common/domainService';
import { IChatModelInformation, ModelSupportedEndpoint } from '../../../platform/endpoint/common/endpointProvider';
import { ILogService } from '../../../platform/log/common/logService';
import { IFetcherService } from '../../../platform/networking/common/fetcherService';
import { ICreateEndpointBodyOptions, IEndpointBody } from '../../../platform/networking/common/networking';

import { IChatWebSocketManager } from '../../../platform/networking/node/chatWebSocketManager';
import { IExperimentationService } from '../../../platform/telemetry/common/nullExperimentationService';
import { ITokenizerProvider } from '../../../platform/tokenizer/node/tokenizer';
import { IInstantiationService } from '../../../util/vs/platform/instantiation/common/instantiation';
import { BYOKModelCapabilities } from '../common/byokProvider';
import { OpenAIEndpoint } from '../node/openAIEndpoint';
import { AbstractOpenAICompatibleLMProvider, LanguageModelChatConfiguration, OpenAICompatibleLanguageModelChatInformation } from './abstractLanguageModelChatProvider';
import { IBYOKStorageService } from './byokStorageService';

export interface OpenRouterModelData {
	id: string;
	name: string;
	supported_parameters?: string[];
	architecture?: {
		input_modalities?: string[];
	};
	top_provider: {
		context_length: number;
		/** The model's real completion ceiling; null when OpenRouter does not know it. */
		max_completion_tokens?: number | null;
	};
}

/** Fallback when OpenRouter reports no completion ceiling; kept as the pre-existing default. */
const defaultMaxOutputTokens = 16000;
/** Upper bound on what we reserve for output, so the prompt budget never collapses on models advertising huge completions. */
const maxReservedOutputTokens = 64000;

/**
 * Capabilities for one OpenRouter model listing. Exported for tests; the provider and the
 * FlowLeap Trial provider both resolve through it.
 */
export function openRouterModelCapabilities(model: OpenRouterModelData): BYOKModelCapabilities {
	const supportedParameters = model.supported_parameters ?? [];
	// OpenRouter reports reasoning support per model via `supported_parameters`. The unified `reasoning` parameter and
	// the OpenAI-style `reasoning_effort` alias both indicate the model accepts an effort level.
	// See https://openrouter.ai/docs/use-cases/reasoning-tokens
	const supportsReasoningEffort = supportedParameters.includes('reasoning') || supportedParameters.includes('reasoning_effort')
		? ['low', 'medium', 'high']
		: undefined;
	// A single structured report call can exceed 16k output tokens; a fixed ceiling below the
	// model's real one surfaces as a "Response too long" failure. Reserve what the model can
	// actually emit, bounded so the prompt budget stays usable.
	const reported = model.top_provider.max_completion_tokens;
	const maxOutputTokens = reported ? Math.min(reported, maxReservedOutputTokens) : defaultMaxOutputTokens;
	return {
		name: model.name,
		toolCalling: supportedParameters.includes('tools'),
		vision: model.architecture?.input_modalities?.includes('image') ?? false,
		maxInputTokens: model.top_provider.context_length - maxOutputTokens,
		maxOutputTokens,
		supportsReasoningEffort
	};
}

/** OpenRouter API base URL, shared with the FlowLeap Trial provider (same inference host, different key source). */
export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

/**
 * OpenRouter's in-region host. Same API, same key, different domain: the choice of domain is what
 * decides where inference runs. A key whose workspace guardrail restricts it to Europe is rejected
 * with 403 on any other domain, before inference, so such a key cannot work without this host.
 */
export const OPENROUTER_EU_BASE_URL = 'https://eu.openrouter.ai/api/v1';

/** The setting that picks which OpenRouter host a user's own key is sent to. */
export const OPENROUTER_DATA_REGION_CONFIG_KEY = 'patent.openRouter.dataRegion';

export type OpenRouterDataRegion = 'global' | 'eu';

/** Resolves the OpenRouter host for a region, falling back to the global host for any unknown value. */
export function openRouterBaseUrlForRegion(region: string | undefined): string {
	return region === 'eu' ? OPENROUTER_EU_BASE_URL : OPENROUTER_BASE_URL;
}

/**
 * The OpenRouter inference machinery (model discovery, capability resolution, and the native
 * Anthropic-Messages routing), independent of where the API key comes from. Two providers share
 * it: {@link OpenRouterLMProvider} (user-entered BYO key) and the FlowLeap Trial provider
 * (backend-fetched trial key) — the latter must run inference through exactly this path, with
 * no new inference code.
 */
export abstract class AbstractOpenRouterLMProvider extends AbstractOpenAICompatibleLMProvider {

	constructor(
		id: string,
		name: string,
		byokStorageService: IBYOKStorageService,
		@IFetcherService fetcherService: IFetcherService,
		@ILogService logService: ILogService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IConfigurationService configurationService: IConfigurationService,
		@IExperimentationService expService: IExperimentationService
	) {
		super(
			id,
			name,
			undefined,
			byokStorageService,
			fetcherService,
			logService,
			instantiationService,
			configurationService,
			expService
		);
	}

	protected override getModelsBaseUrl(): string | undefined {
		return OPENROUTER_BASE_URL;
	}

	protected override getModelsDiscoveryUrl(modelsBaseUrl: string): string {
		return `${modelsBaseUrl}/models?supported_parameters=tools`;
	}

	protected override resolveModelCapabilities(modelData: unknown): BYOKModelCapabilities | undefined {
		return openRouterModelCapabilities(modelData as OpenRouterModelData);
	}

	protected override async createOpenAIEndPoint(model: OpenAICompatibleLanguageModelChatInformation<LanguageModelChatConfiguration>): Promise<OpenAIEndpoint> {
		const modelInfo = this.getModelInfo(model.id, model.url);
		const isAnthropic = isAnthropicModelId(model.id);

		if (isAnthropic) {
			// Anthropic models on OpenRouter use the native Messages API which
			// provides full cache_control, thinking, and tool support identical
			// to the direct Anthropic API.
			modelInfo.supported_endpoints = [ModelSupportedEndpoint.Messages];
		}

		const url = isAnthropic
			? `${model.url}/messages`
			: `${model.url}/chat/completions`;

		return this._instantiationService.createInstance(OpenRouterEndpoint, modelInfo, model.configuration?.apiKey ?? '', url);
	}
}

export class OpenRouterLMProvider extends AbstractOpenRouterLMProvider {

	public static readonly providerName = 'OpenRouter';
	public static readonly providerId = this.providerName.toLowerCase();

	constructor(
		byokStorageService: IBYOKStorageService,
		@IFetcherService fetcherService: IFetcherService,
		@ILogService logService: ILogService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IConfigurationService configurationService: IConfigurationService,
		@IExperimentationService expService: IExperimentationService
	) {
		super(
			OpenRouterLMProvider.providerId,
			OpenRouterLMProvider.providerName,
			byokStorageService,
			fetcherService,
			logService,
			instantiationService,
			configurationService,
			expService
		);
	}

	/**
	 * The user's own key, so the region is the user's choice. This is the single seam that decides
	 * the host: it feeds both model discovery and every chat request, since the resolved URL is
	 * carried on each model as `url`.
	 */
	protected override getModelsBaseUrl(): string | undefined {
		return openRouterBaseUrlForRegion(
			this._configurationService.getNonExtensionConfig<string>(OPENROUTER_DATA_REGION_CONFIG_KEY)
		);
	}
}

/**
 * Checks whether an OpenRouter model ID refers to an Anthropic model.
 * OpenRouter model IDs follow the format `provider/model-name`, e.g.
 * `anthropic/claude-sonnet-4` or `anthropic/claude-opus-4`.
 */
function isAnthropicModelId(modelId: string): boolean {
	return modelId.startsWith('anthropic/');
}

/**
 * OpenRouter-specific endpoint that routes Anthropic models through the native
 * Messages API (`/api/v1/messages`) for full prompt caching, thinking, and tool
 * support identical to the direct Anthropic API.
 *
 * @see https://openrouter.ai/docs/api/api-reference/anthropic-messages/create-messages
 */
export class OpenRouterEndpoint extends OpenAIEndpoint {
	constructor(
		modelMetadata: IChatModelInformation,
		apiKey: string,
		modelUrl: string,
		@IDomainService domainService: IDomainService,
		@IChatMLFetcher chatMLFetcher: IChatMLFetcher,
		@ITokenizerProvider tokenizerProvider: ITokenizerProvider,
		@IInstantiationService instantiationService: IInstantiationService,
		@IConfigurationService configurationService: IConfigurationService,
		@IExperimentationService expService: IExperimentationService,
		@IChatWebSocketManager chatWebSocketService: IChatWebSocketManager,
		@ILogService logService: ILogService,
	) {
		super(modelMetadata, apiKey, modelUrl, domainService, chatMLFetcher, tokenizerProvider, instantiationService, configurationService, expService, chatWebSocketService, logService);
	}

	/**
	 * Enable the Messages API path for Anthropic models. This bypasses the
	 * experiment flag check in the base class because BYOK models are always
	 * user-controlled — the `supported_endpoints` metadata is already set
	 * correctly by {@link OpenRouterLMProvider.createOpenAIEndPoint}.
	 */
	protected override get useMessagesApi(): boolean {
		return !!this.modelMetadata.supported_endpoints?.includes(ModelSupportedEndpoint.Messages);
	}

	override createRequestBody(options: ICreateEndpointBodyOptions): IEndpointBody {
		if (this.useMessagesApi || this.useResponsesApi) {
			return super.createRequestBody(options);
		}
		// prompt-tsx's OpenAI conversion discards Document parts. OpenRouter accepts
		// native PDFs as file inputs; opaque parts preserve that provider-specific shape.
		// See https://openrouter.ai/docs/guides/overview/multimodal/pdfs.
		return super.createRequestBody({
			...options,
			messages: options.messages.map(message => message.role !== Raw.ChatRole.User ? message : {
				...message,
				content: message.content.map(part => part.type === Raw.ChatCompletionContentPartKind.Document && part.documentData.mediaType === 'application/pdf' ? {
					type: Raw.ChatCompletionContentPartKind.Opaque,
					value: { type: 'file', file: { filename: 'document.pdf', file_data: `data:application/pdf;base64,${part.documentData.data}` } },
				} : part),
			}),
		});
	}

	public override getExtraHeaders(): Record<string, string> {
		const headers = super.getExtraHeaders();
		if (this.useMessagesApi) {
			Object.assign(headers, this.getAnthropicBetaHeader());
		}
		return headers;
	}
}
