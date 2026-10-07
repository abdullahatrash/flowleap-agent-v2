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
 * Mistral lists one model under several ids: the dated id (`codestral-2508`), the rolling alias
 * (`codestral-latest`) and sometimes more, each entry carrying the same `name` and naming the
 * others in `aliases`. The picker would show three identical rows. Entries are grouped by alias
 * connectivity and by shared `name`, and one id is kept per group: the `-latest` alias when there
 * is one, else the id matching the name, else the first listed. Retired models drop first.
 */
export function selectMistralListings(models: readonly MistralModelData[], now: Date = new Date()): MistralModelData[] {
	const live = models.filter(model => !(model.deprecation && new Date(model.deprecation) <= now));
	const groups = groupConnectedListings(live);
	return groups.map(group => pickRepresentative(group));
}

function groupConnectedListings(models: readonly MistralModelData[]): MistralModelData[][] {
	const parent = new Map<string, string>();
	const find = (key: string): string => {
		let root = key;
		while (parent.get(root) !== undefined && parent.get(root) !== root) {
			root = parent.get(root)!;
		}
		parent.set(key, root);
		return root;
	};
	const union = (a: string, b: string) => {
		const rootA = find(a);
		const rootB = find(b);
		if (rootA !== rootB) {
			parent.set(rootB, rootA);
		}
	};
	const listedIds = new Set(models.map(model => model.id));
	for (const model of models) {
		find(model.id);
		for (const alias of model.aliases ?? []) {
			if (listedIds.has(alias)) {
				union(model.id, alias);
			}
		}
		const name = model.name?.trim();
		if (name) {
			union(model.id, `name:${name}`);
		}
	}
	const byRoot = new Map<string, MistralModelData[]>();
	for (const model of models) {
		const root = find(model.id);
		const group = byRoot.get(root);
		if (group) {
			group.push(model);
		} else {
			byRoot.set(root, [model]);
		}
	}
	return Array.from(byRoot.values());
}

function pickRepresentative(group: MistralModelData[]): MistralModelData {
	return group.find(model => model.id.endsWith('-latest'))
		?? group.find(model => model.id === model.name?.trim())
		?? group[0];
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
