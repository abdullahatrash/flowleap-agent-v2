/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as l10n from '@vscode/l10n';
import { CancellationToken, commands, LanguageModelChatMessage, LanguageModelChatMessage2, LanguageModelResponsePart2, PrepareLanguageModelChatModelOptions, Progress, ProvideLanguageModelChatResponseOptions, window } from 'vscode';
import { CHAT_PROVIDER_AUTH_FAILED_ERROR_NAME } from '../../../platform/chat/common/commonTypes';
import { IConfigurationService } from '../../../platform/configuration/common/configurationService';
import { looksLikeByokKeyRejection } from '../../../platform/endpoint/vscode-node/byokKeyRejection';
import { ILogService } from '../../../platform/log/common/logService';
import { IFetcherService } from '../../../platform/networking/common/fetcherService';
import { IExperimentationService } from '../../../platform/telemetry/common/nullExperimentationService';
import { toErrorMessage } from '../../../util/common/errorMessage';
import { raceTimeout } from '../../../util/vs/base/common/async';
import { Emitter } from '../../../util/vs/base/common/event';
import { DisposableStore, IDisposable } from '../../../util/vs/base/common/lifecycle';
import { IInstantiationService } from '../../../util/vs/platform/instantiation/common/instantiation';
import { getPatentSubscriptionStatus, onDidChangePatentSubscription } from '../../patentai/common/patentSubscriptionRegistry';
import { getPatentAccessToken } from '../../patentai/common/patentTokenRegistry';
import { IPatentBackendClient, TrialModelKeyPayload, TrialModelKeyUnavailableError } from '../../patentai/vscode-node/patentBackendClient';
import { selectUserByokChatModels } from '../../patentai/vscode-node/patentEndpointProvider';
import { BYOKAuthType, BYOKModelCapabilities } from '../common/byokProvider';
import { looksLikeSpendCapRejection } from '../common/trialSpendCap';
import { LanguageModelChatConfiguration, OpenAICompatibleLanguageModelChatInformation } from './abstractLanguageModelChatProvider';
import { byokKnownModelToAPIInfoWithEffort } from './byokModelInfo';
import { IBYOKStorageService } from './byokStorageService';
import { AbstractOpenRouterLMProvider, OPENROUTER_BASE_URL } from './openRouterProvider';

/** The model-manager surface the revocation nudge and the cap message link to — where the user adds their own key. */
const MANAGE_MODELS_COMMAND = 'workbench.action.chat.manage';

/** Bound the user-model probe so a slow provider enumeration can never stall a model listing. */
const USER_MODEL_PROBE_TIMEOUT_MS = 5000;

/**
 * The trial provider's lifecycle dependencies, injectable so tests drive them without stubbing
 * globals: the user-model probe behind BYO-key precedence, and the notification surface for the
 * add-your-own-key nudge.
 */
export interface IFlowLeapTrialLifecycleDeps {
	/** True when the user has at least one model connected with their OWN BYO key (any non-trial BYOK vendor). */
	hasUserByokModels(): Promise<boolean>;
	showWarningMessage(message: string, ...items: string[]): Thenable<string | undefined>;
	executeCommand(command: string): Thenable<unknown>;
}

function createDefaultLifecycleDeps(): IFlowLeapTrialLifecycleDeps {
	return {
		hasUserByokModels: async () => (await selectUserByokChatModels()).length > 0,
		showWarningMessage: (message, ...items) => window.showWarningMessage(message, ...items),
		executeCommand: command => commands.executeCommand(command),
	};
}

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
 *
 * The provider follows the subscription, not the machine (#242): it listens to the subscription
 * change broadcast, and a status leaving `trialing` (conversion, cancellation, sign-out) discards
 * the stored key, re-lists the models (which hides them), and nudges toward a BYO key. A mid-turn
 * key revocation maps to the same nudge instead of a raw provider error.
 */
export class FlowLeapTrialLMProvider extends AbstractOpenRouterLMProvider implements IDisposable {

	public static readonly providerName = 'FlowLeap Trial';
	public static readonly providerId = 'flowleap-trial';

	private readonly _disposables = new DisposableStore();
	private readonly _onDidChangeModels = this._disposables.add(new Emitter<void>());
	/** Signals core to re-query the model listing — how subscription changes reach the picker without a manual refresh. */
	readonly onDidChangeLanguageModelChatInformation = this._onDidChangeModels.event;

	constructor(
		byokStorageService: IBYOKStorageService,
		private readonly _lifecycleDeps: IFlowLeapTrialLifecycleDeps = createDefaultLifecycleDeps(),
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
		this._disposables.add(onDidChangePatentSubscription(() => {
			this._handleSubscriptionChange().catch(err => this._logService.warn(`[FlowLeap Trial] Subscription-change handling failed: ${err}`));
		}));
	}

	dispose(): void {
		this._disposables.dispose();
	}

	/**
	 * Reaction to a subscription-status broadcast. Leaving `trialing` — conversion, cancellation,
	 * or sign-out — discards the stored trial key (it must not outlive access), but only when a key
	 * was actually held: a user who never trialed gets no nudge. The nudge names the honest way
	 * back: sign-out pauses the trial models (they return with the session), while a conclusive
	 * non-trialing status ends them (the ask is a BYO key). Every change re-lists the models, so
	 * entering `trialing` (fresh sign-in mid-trial) surfaces the trial models and leaving it hides
	 * them, both without a manual refresh.
	 */
	private async _handleSubscriptionChange(): Promise<void> {
		const status = getPatentSubscriptionStatus();
		const signedOut = !getPatentAccessToken();
		if (signedOut || status === 'active' || status === 'inactive') {
			const hadKey = await this._byokStorageService.getAPIKey(this._name);
			if (hadKey) {
				this._logService.info(`[FlowLeap Trial] Subscription left 'trialing' (${signedOut ? 'signed out' : status}); discarding the trial key.`);
				await this._discardStoredKey();
				if (signedOut) {
					this._nudgeTowardSignIn();
				} else {
					this._nudgeTowardOwnKey();
				}
			}
		}
		this._onDidChangeModels.fire();
	}

	/**
	 * Sign-out variant of the nudge: the trial did not end — the session did — so the ask is to
	 * sign back in, never to add a key the user does not need yet.
	 */
	private _nudgeTowardSignIn(): void {
		const signIn = l10n.t('Sign In');
		// Fire-and-forget: the nudge must never block or fail the state change that triggered it.
		Promise.resolve(this._lifecycleDeps.showWarningMessage(
			l10n.t('You signed out of FlowLeap, so the Trial models are paused — sign back in to keep using them.'),
			signIn
		)).then(choice => {
			if (choice === signIn) {
				return this._lifecycleDeps.executeCommand('flowleap.signIn');
			}
			return undefined;
		}).then(undefined, () => undefined);
	}

	/** The first-class BYO-key steer shown when the trial models go away for good (#242). */
	private _nudgeTowardOwnKey(): void {
		const manageModels = l10n.t('Manage Models');
		// Fire-and-forget: the nudge must never block or fail the state change that triggered it.
		Promise.resolve(this._lifecycleDeps.showWarningMessage(
			l10n.t('Your FlowLeap Trial models are no longer available. Add your own API key to keep using chat.'),
			manageModels
		)).then(choice => {
			if (choice === manageModels) {
				return this._lifecycleDeps.executeCommand(MANAGE_MODELS_COMMAND);
			}
			return undefined;
		}).then(undefined, () => undefined);
	}

	/**
	 * Chat turns run through the inherited OpenRouter machinery, but two failure shapes get a
	 * trial-specific mapping (ADR 0015), checked in this order:
	 *
	 * 1. Spend cap (#243): a 402/credit-limit shaped rejection means the daily cap is exhausted —
	 *    the key is still VALID, so this must be recognised before the revocation branch (which
	 *    would discard a working key). The user sees the actionable two-exit message — add your
	 *    own key now, or the cap resets daily — never the raw provider error.
	 * 2. Key rejection (#242): the trial key is not a credential the user can update, so the
	 *    generic "update your key" recovery would be a dead end. A mid-turn rejection means the
	 *    key was revoked (trial ended or converted) — discard it, re-list (hiding the provider
	 *    unless a re-fetch serves a fresh key), and surface the add-your-own-key nudge as the
	 *    turn's failure.
	 *
	 * Every other error passes through untouched.
	 */
	override async provideLanguageModelChatResponse(model: OpenAICompatibleLanguageModelChatInformation<LanguageModelChatConfiguration>, messages: Array<LanguageModelChatMessage | LanguageModelChatMessage2>, options: ProvideLanguageModelChatResponseOptions, progress: Progress<LanguageModelResponsePart2>, token: CancellationToken): Promise<void> {
		try {
			return await super.provideLanguageModelChatResponse(model, messages, options, progress, token);
		} catch (err) {
			if (err instanceof Error && looksLikeSpendCapRejection(err.name, err.message)) {
				this._logService.info('[FlowLeap Trial] Daily spend cap reached; rendering the two-exit guidance.');
				// The chat error renderer makes the manage-models command link clickable.
				throw new Error(l10n.t('Your FlowLeap Trial models have reached today\'s shared usage cap. Add your own API key to keep chatting now: [{0}](command:{1}) — or wait: the cap resets daily, so your trial models come back tomorrow.', l10n.t('Manage Models'), MANAGE_MODELS_COMMAND));
			}
			const preClassified = err instanceof Error && err.name === CHAT_PROVIDER_AUTH_FAILED_ERROR_NAME;
			if (preClassified || looksLikeByokKeyRejection(toErrorMessage(err, false))) {
				this._logService.info('[FlowLeap Trial] The trial key was rejected mid-turn (revoked); discarding it and steering to BYO-key setup.');
				await this._discardStoredKey();
				this._onDidChangeModels.fire();
				// The chat error renderer makes the manage-models command link clickable; the
				// message must not itself look like a key rejection, or downstream heuristics
				// would re-map it to the generic "update your key" toast.
				throw new Error(l10n.t('Your FlowLeap Trial model is no longer available because the trial ended or converted. Add your own API key to keep chatting: [{0}](command:{1})', l10n.t('Manage Models'), MANAGE_MODELS_COMMAND));
			}
			throw err;
		}
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

		// BYO-key precedence (#242): when the user connected any model of their own, that model
		// owns the default slot — the trial list stays selectable but must not claim it. A failed
		// or timed-out probe counts as "user has models": wrongly declining the default is
		// harmless (a trial-only pool falls back to its first model anyway), wrongly claiming it
		// would override the user's own model.
		let userModelPresent = true;
		try {
			userModelPresent = await raceTimeout(this._lifecycleDeps.hasUserByokModels(), USER_MODEL_PROBE_TIMEOUT_MS) ?? true;
		} catch (err) {
			this._logService.warn(`[FlowLeap Trial] User-model probe failed; not claiming the default model slot: ${err}`);
		}

		return payload.models.map((id, index) => {
			const base = catalogById.get(id) ?? this._fallbackModelInformation(id);
			return {
				...base,
				tooltip: l10n.t('{0} is a FlowLeap Trial model: FlowLeap pays for it during your free trial, and it stops working when the trial ends. Add your own API key to keep a model after that.', base.name),
				// The backend list is ordered default-first by contract.
				isDefault: index === 0 && !userModelPresent,
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
