/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { IConfigurationService } from '../../../platform/configuration/common/configurationService';
import { ILogService } from '../../../platform/log/common/logService';
import { IFetcherService } from '../../../platform/networking/common/fetcherService';
import { IExperimentationService } from '../../../platform/telemetry/common/nullExperimentationService';
import { IInstantiationService } from '../../../util/vs/platform/instantiation/common/instantiation';
import { BYOKKnownModels, BYOKModelCapabilities } from '../common/byokProvider';
import { AbstractOpenAICompatibleLMProvider, DiscoveredModelListing } from './abstractLanguageModelChatProvider';
import { IBYOKStorageService } from './byokStorageService';

/**
 * One entry of Mistral's `GET /v1/models` listing. Only the fields the provider reads are
 * declared; the listing also carries OCR, embedding, moderation and audio models, which the
 * `capabilities` flags tell apart from chat models.
 * See https://docs.mistral.ai/api/#tag/models/operation/list_models_v1_models_get
 */
export interface MistralModelData extends DiscoveredModelListing {
	name?: string | null;
	capabilities?: {
		completion_chat?: boolean;
		function_calling?: boolean;
		vision?: boolean;
		reasoning?: boolean;
	};
	max_context_length?: number;
	aliases?: string[];
	/** ISO date after which the model is retired; past dates mean the model no longer serves. */
	deprecation?: string | null;
}

/** Mistral does not publish a per-model completion ceiling; reserve the same default as OpenRouter. */
const defaultMaxOutputTokens = 16000;

/**
 * Capabilities for one Mistral chat model. Exported for tests. Returns `undefined` for
 * listings that cannot chat (OCR, embeddings, moderation, audio) so they stay out of the picker.
 */
export function mistralModelCapabilities(model: MistralModelData): BYOKModelCapabilities | undefined {
	const capabilities = model.capabilities ?? {};
	if (capabilities.completion_chat === false) {
		return undefined;
	}
	// Mistral's SDK defaults the window to 32k when the listing omits it.
	const contextWindow = model.max_context_length ?? 32768;
	// Keep at least half the window for the prompt on small models.
	const maxOutputTokens = Math.min(defaultMaxOutputTokens, Math.floor(contextWindow / 2));
	return {
		name: model.name?.trim() || humanizeMistralModelId(model.id),
		toolCalling: capabilities.function_calling ?? false,
		vision: capabilities.vision ?? false,
		contextWindow,
		maxInputTokens: contextWindow - maxOutputTokens,
		maxOutputTokens,
	};
}

/**
 * Mistral lists every model twice: once under its dated id (`mistral-large-2411`) and once under
 * the rolling alias (`mistral-large-latest`), each naming the other in `aliases`. Showing both
 * doubles the picker with identical rows, so a dated entry is dropped when its `-latest` alias is
 * itself in the listing; a dated model with no alias entry stays. Retired models drop too.
 */
export function selectMistralListings(models: readonly MistralModelData[], now: Date = new Date()): MistralModelData[] {
	const listedIds = new Set(models.map(model => model.id));
	return models.filter(model => {
		if (model.deprecation && new Date(model.deprecation) <= now) {
			return false;
		}
		if (model.id.endsWith('-latest')) {
			return true;
		}
		const rollingAlias = model.aliases?.find(alias => alias.endsWith('-latest'));
		return !(rollingAlias && listedIds.has(rollingAlias));
	});
}

function humanizeMistralModelId(modelId: string): string {
	return modelId.split('-').filter(p => p.length > 0).map(p => {
		if (/^\d+$/.test(p)) {
			return p;
		}
		return p.charAt(0).toUpperCase() + p.slice(1);
	}).join(' ');
}

export class MistralBYOKLMProvider extends AbstractOpenAICompatibleLMProvider {

	public static readonly providerName = 'Mistral';
	public static readonly providerId = this.providerName.toLowerCase();

	constructor(
		knownModels: BYOKKnownModels,
		byokStorageService: IBYOKStorageService,
		@IFetcherService fetcherService: IFetcherService,
		@ILogService logService: ILogService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IConfigurationService configurationService: IConfigurationService,
		@IExperimentationService expService: IExperimentationService
	) {
		super(
			MistralBYOKLMProvider.providerId,
			MistralBYOKLMProvider.providerName,
			knownModels,
			byokStorageService,
			fetcherService,
			logService,
			instantiationService,
			configurationService,
			expService
		);
	}

	protected getModelsBaseUrl(): string | undefined {
		return 'https://api.mistral.ai/v1';
	}

	protected override selectDiscoveredModels(models: DiscoveredModelListing[]): DiscoveredModelListing[] {
		return selectMistralListings(models as MistralModelData[]);
	}

	protected override resolveModelCapabilities(modelData: unknown): BYOKModelCapabilities | undefined {
		return mistralModelCapabilities(modelData as MistralModelData);
	}
}
