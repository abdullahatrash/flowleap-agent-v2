/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as l10n from '@vscode/l10n';
import { CancellationToken, PrepareLanguageModelChatModelOptions } from 'vscode';
import { IConfigurationService } from '../../../platform/configuration/common/configurationService';
import { ILogService } from '../../../platform/log/common/logService';
import { IFetcherService } from '../../../platform/networking/common/fetcherService';
import { IExperimentationService } from '../../../platform/telemetry/common/nullExperimentationService';
import { IInstantiationService } from '../../../util/vs/platform/instantiation/common/instantiation';
import { getPatentSubscriptionStatus } from '../../patentai/common/patentSubscriptionRegistry';
import { getPatentAccessToken } from '../../patentai/common/patentTokenRegistry';
import { IPatentBackendClient, TrialModelKeyPayload, TrialModelKeyUnavailableError } from '../../patentai/vscode-node/patentBackendClient';
import { BYOKAuthType, BYOKModelCapabilities } from '../common/byokProvider';
import { LanguageModelChatConfiguration, OpenAICompatibleLanguageModelChatInformation } from './abstractLanguageModelChatProvider';
import { byokKnownModelToAPIInfoWithEffort } from './byokModelInfo';
import { IBYOKStorageService } from './byokStorageService';
import { AbstractOpenRouterLMProvider, OPENROUTER_BASE_URL } from './openRouterProvider';

/**
 * The "FlowLeap Trial" model provider (ADR 0015 client half, #241): while the user's FlowLeap
 * subscription is `trialing`, it fetches the backend-provisioned Trial Model key through the
 * {@link IPatentBackendClient} seam, stores it in secret storage, and offers exactly the curated
 * model list the backend served (ordered — the first entry is the default). Inference runs
 * through the inherited OpenRouter machinery, the same single path as a BYO OpenRouter key.
 *
 * Every non-success outcome degrades to today's add-your-own-key experience, never a harder
 * block: the typed `trial_model_key_unavailable` denial hides the provider and discards the
 * stored key; a transport failure hides it for this listing only, and the next model listing
 * retries the fetch.
 */
export class FlowLeapTrialLMProvider extends AbstractOpenRouterLMProvider {

	public static readonly providerName = 'FlowLeap Trial';
	public static readonly providerId = 'flowleap-trial';

	constructor(
		byokStorageService: IBYOKStorageService,
		@IPatentBackendClient private readonly _patentBackendClient: IPatentBackendClient,
		@IFetcherService fetcherService: IFetcherService,
		@ILogService logService: ILogService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IConfigurationService configurationService: IConfigurationService,
		@IExperimentationService expService: IExperimentationService
	) {
		super(
			FlowLeapTrialLMProvider.providerId,
			FlowLeapTrialLMProvider.providerName,
			byokStorageService,
			fetcherService,
			logService,
			instantiationService,
			configurationService,
			expService
		);
	}

	/**
	 * The trial key is fetched from the backend and lives in secret storage only. Never migrate
	 * it into a provider-group configuration the way user-entered BYO keys are — that would copy
	 * the credential out of secret storage.
	 */
	protected override async configureDefaultGroupWithApiKeyOnly(): Promise<string | undefined> {
		return undefined;
	}

	override async provideLanguageModelChatInformation(_options: PrepareLanguageModelChatModelOptions, token: CancellationToken): Promise<OpenAICompatibleLanguageModelChatInformation<LanguageModelChatConfiguration>[]> {
		// Signed out → no trial. Skip the backend round-trip (it would 401 and fire a sign-in
		// prompt on every silent model listing).
		if (!getPatentAccessToken()) {
			return [];
		}

		// One source of truth for `trialing`: the same subscription snapshot that drives the
		// trial countdown. A conclusive non-trialing state hides the provider and discards the
		// key; `trialing` and `unknown` (snapshot not read yet, e.g. cold start) proceed to the
		// fetch and let the backend's typed 403 be the final word.
		const status = getPatentSubscriptionStatus();
		if (status === 'active' || status === 'inactive') {
			await this._discardStoredKey();
			return [];
		}

		let payload: TrialModelKeyPayload;
		try {
			payload = await this._patentBackendClient.getTrialModelKey(token);
		} catch (err) {
			if (err instanceof TrialModelKeyUnavailableError) {
				this._logService.info(`[FlowLeap Trial] Trial Model key unavailable (${err.reason ?? 'no reason'}); hiding the trial provider.`);
				await this._discardStoredKey();
				return [];
			}
			// Transport failure (backend down, timeout, …): degrade to the add-your-own-key
			// experience for this listing only — the next model listing retries the fetch.
			this._logService.warn(`[FlowLeap Trial] Trial Model key fetch failed; hiding the trial provider until the next listing: ${err}`);
			return [];
		}

		await this._byokStorageService.storeAPIKey(this._name, payload.key, BYOKAuthType.GlobalApiKey);

		// Capability lookup via the inherited OpenRouter catalog discovery. The catalog is a
		// capability source only — the rendered list is exactly `payload.models`, in the served
		// order, whether or not the catalog fetch succeeds.
		let catalogById = new Map<string, OpenAICompatibleLanguageModelChatInformation<LanguageModelChatConfiguration>>();
		try {
			const catalog = await this.getAllModels(true, payload.key, undefined);
			catalogById = new Map(catalog.map(model => [model.id, model]));
		} catch (err) {
			this._logService.warn(`[FlowLeap Trial] OpenRouter catalog lookup failed; serving trial models with fallback capabilities: ${err}`);
		}

		return payload.models.map((id, index) => {
			const base = catalogById.get(id) ?? this._fallbackModelInformation(id);
			return {
				...base,
				tooltip: l10n.t('{0} is a FlowLeap Trial model: FlowLeap pays for it during your free trial, and it stops working when the trial ends. Add your own API key to keep a model after that.', base.name),
				// The backend list is ordered default-first by contract.
				isDefault: index === 0,
				isBYOK: true,
				apiKey: payload.key,
				configuration: { apiKey: payload.key },
			};
		});
	}

	/** Drop the stored trial key (trial ended, converted, or denied) — the key must not outlive access. */
	private async _discardStoredKey(): Promise<void> {
		await this._byokStorageService.deleteAPIKey(this._name, BYOKAuthType.GlobalApiKey);
	}

	/**
	 * Model information for a served trial model the OpenRouter catalog lookup could not resolve
	 * (catalog unreachable, or the model filtered out of the tools-capable listing). The backend
	 * list must render regardless, so assume the capabilities every curated Trial Model has by
	 * contract — tool calling on, conservative token limits — and register them as known models
	 * so inference-time model-info resolution agrees.
	 */
	private _fallbackModelInformation(id: string): OpenAICompatibleLanguageModelChatInformation<LanguageModelChatConfiguration> {
		const capabilities: BYOKModelCapabilities = {
			name: id,
			toolCalling: true,
			vision: false,
			maxInputTokens: 100_000,
			maxOutputTokens: 16_000,
		};
		this.updateKnownModels({ [id]: capabilities });
		return {
			...byokKnownModelToAPIInfoWithEffort(this._name, id, capabilities),
			url: OPENROUTER_BASE_URL,
		};
	}
}
