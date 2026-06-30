/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { LanguageModelChat, lm, type ChatRequest } from 'vscode';
import { IConfigurationService } from '../../../platform/configuration/common/configurationService';
import { ChatModelFamily, EmbeddingsEndpointFamily, ICompletionModelInformation, IEmbeddingModelInformation, IEndpointProvider } from '../../../platform/endpoint/common/endpointProvider';
import { AutoChatEndpoint } from '../../../platform/endpoint/node/autoChatEndpoint';
import { EmbeddingEndpoint } from '../../../platform/endpoint/node/embeddingsEndpoint';
import { ExtensionContributedChatEndpoint } from '../../../platform/endpoint/vscode-node/extChatEndpoint';
import { ILogService } from '../../../platform/log/common/logService';
import { IChatEndpoint, IEmbeddingsEndpoint } from '../../../platform/networking/common/networking';
import { TokenizerType } from '../../../util/common/tokenizer';
import { raceTimeout } from '../../../util/vs/base/common/async';
import { Emitter, Event } from '../../../util/vs/base/common/event';
import { IInstantiationService } from '../../../util/vs/platform/instantiation/common/instantiation';

/**
 * Vendors that `lm.selectChatModels({})` surfaces but that CANNOT serve normal
 * client-side inference, so they must never count as "the user connected a
 * provider":
 *  - `copilot`     — the built-in Copilot wrapper (routes to the retired backend)
 *  - `copilotcli`  — Copilot CLI agent-session models (targetChatSessionType-scoped)
 *  - `claude-code` — Claude Code agent-session models (targetChatSessionType-scoped)
 *  - `patent-ai` / `flowleap` — retired backend pseudo-models
 *
 * Counting any of these as a usable BYOK model is what let a no-key chat turn slip
 * past the onboarding gate into a dead backend request (`copilot`) or an endless
 * "thinking" hang (`copilotcli` / `claude-code`). This list is exhaustive: it covers
 * every non-BYOK `registerLanguageModelChatProvider` vendor in the extension.
 */
const NON_BYOK_VENDORS: ReadonlySet<string> = new Set(['copilot', 'copilotcli', 'claude-code', 'patent-ai', 'flowleap']);

const BYOK_VENDOR_IDS: readonly string[] = [
	'anthropic',
	'azure',
	'customendpoint',
	'customoai',
	'gemini',
	'ollama',
	'openai',
	'openrouter',
	'xai',
];

/**
 * Internal utility families used by background callers (title/intent generation,
 * commit messages, summarization, subagents, …). They have no real BYOK model, so
 * the user assigns each a model via these settings (the same ones the upstream
 * provider reads). Without honoring them, utility calls fall back to an arbitrary
 * first model — e.g. a rate-limited `:free` OpenRouter model that stalls the turn.
 */
const UTILITY_MODEL_CONFIG_KEY = 'chat.utilityModel';
const UTILITY_SMALL_MODEL_CONFIG_KEY = 'chat.utilitySmallModel';
const UTILITY_FAMILIES: ReadonlySet<string> = new Set(['copilot-utility', 'copilot-utility-small']);

/**
 * Endpoint provider for FlowLeap Patent AI.
 *
 * This provider bypasses GitHub's CAPI completely. Inference is BYO-key only: every
 * chat turn resolves to a model the user connected with their own provider key
 * (Anthropic/OpenAI/Gemini/OpenRouter/…), wrapped in {@link ExtensionContributedChatEndpoint}
 * so it runs client-side. There is deliberately no server-key fallback — the legacy
 * Patent AI `/v1/chat/completions` proxy is retired (410) and is not wired here, even
 * as a last resort. When the user has no usable BYO-key model yet, {@link getChatEndpoint}
 * throws rather than dispatching a doomed request; the onboarding gate uses
 * {@link hasByokModel} to surface the "connect a provider" prompt before it gets there.
 */
export class PatentAIEndpointProvider implements IEndpointProvider {

	declare readonly _serviceBrand: undefined;

	private readonly _onDidModelsRefresh = new Emitter<void>();
	readonly onDidModelsRefresh: Event<void> = this._onDidModelsRefresh.event;

	private _embeddingEndpoint: IEmbeddingsEndpoint | undefined;

	constructor(
		@ILogService protected readonly _logService: ILogService,
		@IInstantiationService protected readonly _instantiationService: IInstantiationService,
		@IConfigurationService protected readonly _configurationService: IConfigurationService,
	) {
		this._logService.info('[Patent AI] Endpoint provider initialized (BYOK-only)');
	}

	/**
	 * Whether `model` is a real BYO-key model that can run inference client-side —
	 * i.e. its vendor is not one of the {@link NON_BYOK_VENDORS} pseudo/agent
	 * providers that `selectChatModels` also returns but that can't serve a normal
	 * chat turn.
	 */
	private _isByokModel(model: LanguageModelChat): boolean {
		return !NON_BYOK_VENDORS.has(model.vendor);
	}

	private async _selectByokModels(): Promise<LanguageModelChat[]> {
		const results = await Promise.all(BYOK_VENDOR_IDS.map(async vendor => {
			try {
				return await lm.selectChatModels({ vendor });
			} catch (err) {
				this._logService.trace(`[Patent AI] selectChatModels failed for BYOK vendor '${vendor}': ${err}`);
				return [];
			}
		}));
		return results.flat().filter(m => this._isByokModel(m));
	}

	/**
	 * Resolve a BYO-key chat model to run client-side. Prefers a model whose family/id
	 * matches `preferred` (a bare family string or a configured utility model); otherwise
	 * the first available. Returns undefined when the user has no BYO-key model yet, so
	 * the caller can surface the "connect a provider" gate.
	 */
	private async _resolveByokEndpoint(preferred?: string): Promise<IChatEndpoint | undefined> {
		try {
			const models = await this._selectByokModels();
			if (models.length === 0) {
				return undefined;
			}
			const chosen =
				(preferred ? models.find(m => m.family === preferred || m.id === preferred) : undefined) ??
				models[0];
			this._logService.info(`[Patent AI] Resolved BYOK model '${chosen.vendor}/${chosen.id}' for client-side inference`);
			return this._instantiationService.createInstance(ExtensionContributedChatEndpoint, chosen);
		} catch (err) {
			this._logService.warn(`[Patent AI] selectChatModels failed while resolving a BYOK endpoint: ${err}`);
			return undefined;
		}
	}

	/**
	 * Resolve a utility family ('copilot-utility' / 'copilot-utility-small') to the BYOK model
	 * the user assigned via `chat.utilityModel` / `chat.utilitySmallModel`. The setting value is
	 * `${vendor}/${id}` (e.g. `openrouter/anthropic/claude-haiku-4.5`). Returns undefined when the
	 * override is unset, malformed, points at a non-BYOK vendor, or doesn't resolve to exactly one
	 * model, so the caller falls back to the default {@link _resolveByokEndpoint} behavior. This
	 * mirrors the upstream ProductionEndpointProvider so background callers honor the same settings.
	 */
	private async _resolveUtilityOverride(family: string): Promise<IChatEndpoint | undefined> {
		const configKey = family === 'copilot-utility-small' ? UTILITY_SMALL_MODEL_CONFIG_KEY : UTILITY_MODEL_CONFIG_KEY;
		const raw = this._configurationService.getNonExtensionConfig<unknown>(configKey);
		if (typeof raw !== 'string' || raw.length === 0) {
			return undefined;
		}
		const slashIdx = raw.indexOf('/');
		if (slashIdx <= 0 || slashIdx >= raw.length - 1) {
			this._logService.warn(`[Patent AI] Ignoring malformed ${configKey} override '${raw}' (expected '\${vendor}/\${id}').`);
			return undefined;
		}
		const vendor = raw.substring(0, slashIdx);
		const id = raw.substring(slashIdx + 1);
		if (NON_BYOK_VENDORS.has(vendor)) {
			this._logService.warn(`[Patent AI] Ignoring ${configKey} override '${raw}': '${vendor}' is not a BYOK vendor.`);
			return undefined;
		}
		try {
			const models = (await lm.selectChatModels({ vendor, id })).filter(m => this._isByokModel(m));
			if (models.length !== 1) {
				this._logService.warn(`[Patent AI] ${configKey} override '${raw}' matched ${models.length} models; using default utility model instead.`);
				return undefined;
			}
			this._logService.info(`[Patent AI] Applying ${configKey} override '${models[0].vendor}/${models[0].id}' for '${family}'`);
			return this._instantiationService.createInstance(ExtensionContributedChatEndpoint, models[0]);
		} catch (err) {
			this._logService.warn(`[Patent AI] Failed to resolve ${configKey} override '${raw}': ${err}`);
			return undefined;
		}
	}

	/**
	 * True when the user has connected at least one usable BYO-key chat model
	 * (Anthropic/OpenAI/Google/OpenRouter/…). The onboarding gate reads this to
	 * decide whether to let a chat turn proceed or prompt the user to connect a
	 * provider first.
	 *
	 * Counts only real BYO-key models (see {@link _isByokModel}) — the built-in
	 * Copilot wrapper that `selectChatModels` also returns can't run inference, so
	 * including it would falsely pass the gate.
	 */
	async hasByokModel(): Promise<boolean> {
		try {
			// Bound the enumeration so a slow/stuck provider can never hang the chat
			// turn (the gate would otherwise sit in "thinking" forever). On timeout
			// we fail closed and surface the connect-provider prompt rather than
			// proceeding into a doomed request.
			const models = await raceTimeout(this._selectByokModels(), 5000);
			if (!models) {
				this._logService.warn('[Patent AI] hasByokModel: model enumeration timed out; treating as no connected provider');
				return false;
			}
			this._logService.trace(`[Patent AI] hasByokModel: byok=${models.length} models=[${models.map(m => `${m.vendor}/${m.id}`).join(', ')}]`);
			return models.length > 0;
		} catch (err) {
			this._logService.warn(`[Patent AI] selectChatModels failed while checking for a BYOK model: ${err}`);
			return false;
		}
	}

	/**
	 * Get the chat endpoint for a request. BYOK-only: every path resolves to the user's
	 * own provider key. There is no server-key fallback — the retired Patent AI backend
	 * chat endpoint (410) is intentionally not wired. When no BYO-key model is connected,
	 * this throws so the failure is explicit rather than a doomed backend request.
	 * Embeddings are intentionally untouched.
	 */
	async getChatEndpoint(requestOrFamilyOrModel?: LanguageModelChat | ChatRequest | ChatModelFamily): Promise<IChatEndpoint> {
		this._logService.trace('[Patent AI] Resolving chat endpoint');

		// A bare family string (e.g. 'gpt-4o') or no argument — utility callers like
		// terminal-fix, AI rename, git branch/commit naming, the patent-search subagent.
		// Resolve to the user's BYO-key model so these run client-side.
		if (!requestOrFamilyOrModel || typeof requestOrFamilyOrModel === 'string') {
			const preferred = typeof requestOrFamilyOrModel === 'string' ? requestOrFamilyOrModel : undefined;
			// Internal utility families honor the user's chat.utilityModel / chat.utilitySmallModel
			// assignment first; without this they'd match no real model and fall back to an arbitrary
			// first BYOK model (e.g. a rate-limited `:free` model that stalls the turn).
			if (preferred && UTILITY_FAMILIES.has(preferred)) {
				const override = await this._resolveUtilityOverride(preferred);
				if (override) {
					return override;
				}
			}
			const byok = await this._resolveByokEndpoint(preferred);
			return byok ?? this._throwNoByokModel();
		}

		// Extract the selected LanguageModelChat — directly, or from a ChatRequest.
		const model: LanguageModelChat | undefined = 'model' in requestOrFamilyOrModel ? requestOrFamilyOrModel.model : requestOrFamilyOrModel;

		// An explicit BYO-key model (Anthropic/OpenAI/Gemini/OpenRouter/…) runs client-side.
		// The Copilot wrapper and the retired pseudo-vendors are excluded: selecting one
		// would route to a dead backend, so fall through and resolve a real BYO-key model.
		if (model && model.id !== AutoChatEndpoint.pseudoModelId && this._isByokModel(model)) {
			this._logService.info(`[Patent AI] Routing model '${model.vendor}/${model.id}' client-side via BYOK`);
			return this._instantiationService.createInstance(ExtensionContributedChatEndpoint, model);
		}

		// 'Auto' or a patent-ai/flowleap pseudo-model → resolve to any connected BYO-key model.
		const byok = await this._resolveByokEndpoint();
		return byok ?? this._throwNoByokModel();
	}

	/**
	 * Fail an inference request that has no BYO-key model to run against. BYOK is the
	 * only inference path, so this is a hard stop rather than a fallback to the retired
	 * backend. The onboarding gate ({@link hasByokModel}) is expected to catch this state
	 * earlier and prompt the user to connect a provider.
	 */
	private _throwNoByokModel(): never {
		throw new Error('No connected model. Add your own provider key via "Manage Models" to start a chat.');
	}

	/**
	 * Get embeddings endpoint (mock). Embeddings are independent of the retired chat
	 * backend and are left untouched by the BYOK migration.
	 */
	async getEmbeddingsEndpoint(_family?: EmbeddingsEndpointFamily): Promise<IEmbeddingsEndpoint> {
		if (!this._embeddingEndpoint) {
			const mockEmbeddingModel: IEmbeddingModelInformation = {
				id: 'patent-embeddings',
				vendor: 'patent-ai',
				name: 'Patent AI Embeddings',
				version: '1.0.0',
				model_picker_enabled: false,
				is_chat_default: false,
				is_chat_fallback: false,
				capabilities: {
					tokenizer: TokenizerType.O200K,
					family: 'patent-ai',
					type: 'embeddings',
					limits: {
						max_inputs: 8192
					}
				}
			};
			this._embeddingEndpoint = this._instantiationService.createInstance(EmbeddingEndpoint, mockEmbeddingModel);
		}
		return this._embeddingEndpoint;
	}

	/**
	 * Get all completion models (empty - chat only)
	 */
	async getAllCompletionModels(_forceRefresh?: boolean): Promise<ICompletionModelInformation[]> {
		return [];
	}

	/**
	 * Get all chat endpoints. BYOK-only: returns the user's connected models, or an empty
	 * list when none are connected (no server-key pseudo-models).
	 */
	async getAllChatEndpoints(): Promise<IChatEndpoint[]> {
		const byokModels = await this._selectByokModels();
		return byokModels.map(model => this._instantiationService.createInstance(ExtensionContributedChatEndpoint, model));
	}
}
