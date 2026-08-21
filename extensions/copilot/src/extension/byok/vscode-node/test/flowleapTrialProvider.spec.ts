/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrepareLanguageModelChatModelOptions } from 'vscode';
import * as vscode from 'vscode';
import { BlockedExtensionService, IBlockedExtensionService } from '../../../../platform/chat/common/blockedExtensionService';
import { DefaultsOnlyConfigurationService } from '../../../../platform/configuration/common/defaultsOnlyConfigurationService';
import { HeadersImpl, IFetcherService, isAbortError, Response } from '../../../../platform/networking/common/fetcherService';
import { NullExperimentationService } from '../../../../platform/telemetry/common/nullExperimentationService';
import { ITestingServicesAccessor } from '../../../../platform/test/node/services';
import { TestLogService } from '../../../../platform/testing/common/testLogService';
import { DisposableStore } from '../../../../util/vs/base/common/lifecycle';
import { Event } from '../../../../util/vs/base/common/event';
import { SyncDescriptor } from '../../../../util/vs/platform/instantiation/common/descriptors';
import { IInstantiationService } from '../../../../util/vs/platform/instantiation/common/instantiation';
import { notifyPatentSubscriptionChanged, registerPatentSubscriptionProvider } from '../../../patentai/common/patentSubscriptionRegistry';
import { registerPatentAccessTokenProvider } from '../../../patentai/common/patentTokenRegistry';
import { IPatentBackendClient, PatentBackendError, TransientBackendError, TrialModelKeyUnavailableError, TrialModelKeyPayload } from '../../../patentai/vscode-node/patentBackendClient';
import { createExtensionUnitTestingServices } from '../../../test/node/services';
import { BYOKAuthType } from '../../common/byokProvider';
import { AbstractOpenAICompatibleLMProvider } from '../abstractLanguageModelChatProvider';
import type { IBYOKStorageService } from '../byokStorageService';
import { FlowLeapTrialLMProvider, IFlowLeapTrialLifecycleDeps } from '../flowleapTrialProvider';

const TRIAL_KEY = 'sk-or-v1-trial-key';
const SERVED_MODELS = ['deepseek/deepseek-v4-flash-0731', 'google/gemini-3.7-flash', 'openai/gpt-5.6-luna'];

/** The OpenRouter catalog: the served models plus one extra that must never render as a trial model. */
const CATALOG = {
	data: [
		{ id: 'anthropic/claude-opus-5', name: 'Claude Opus 5', supported_parameters: ['tools'], architecture: { input_modalities: ['text'] }, top_provider: { context_length: 200000 } },
		{ id: 'deepseek/deepseek-v4-flash-0731', name: 'DeepSeek V4 Flash', supported_parameters: ['tools'], architecture: { input_modalities: ['text'] }, top_provider: { context_length: 128000 } },
		{ id: 'google/gemini-3.7-flash', name: 'Gemini 3.7 Flash', supported_parameters: ['tools', 'reasoning'], architecture: { input_modalities: ['text', 'image'] }, top_provider: { context_length: 1000000 } },
		{ id: 'openai/gpt-5.6-luna', name: 'GPT-5.6 Luna', supported_parameters: ['tools'], architecture: { input_modalities: ['text', 'image'] }, top_provider: { context_length: 400000 } },
	],
};

/** Stateful storage fake: `getAPIKey` serves what `storeAPIKey` stored, so lifecycle tests can assert "a held key gets discarded". */
function makeStorageService(initialKey?: string) {
	let stored = initialKey;
	const storeAPIKey = vi.fn(async (_provider: string, apiKey: string) => { stored = apiKey; });
	const deleteAPIKey = vi.fn(async () => { stored = undefined; });
	const service: IBYOKStorageService = {
		getAPIKey: vi.fn(async () => stored),
		storeAPIKey,
		deleteAPIKey,
		getStoredModelConfigs: vi.fn(async () => ({})),
		saveModelConfig: vi.fn(async () => undefined),
		removeModelConfig: vi.fn(async () => undefined),
	};
	return { service, storeAPIKey, deleteAPIKey };
}

/** Injectable lifecycle deps (no stubbed globals): no user BYOK models, and a scripted notification surface. */
function makeLifecycleDeps(overrides?: Partial<IFlowLeapTrialLifecycleDeps>) {
	const showWarningMessage = vi.fn(async (_message: string, ..._items: string[]): Promise<string | undefined> => undefined);
	const executeCommand = vi.fn(async (): Promise<unknown> => undefined);
	const deps: IFlowLeapTrialLifecycleDeps = {
		hasUserByokModels: async () => false,
		showWarningMessage,
		executeCommand,
		...overrides,
	};
	return { deps, showWarningMessage, executeCommand };
}

/** An {@link IPatentBackendClient} whose trial-key fetch is scripted per test; nothing else is exercised. */
function makeBackendClient(impl: () => Promise<TrialModelKeyPayload>) {
	const getTrialModelKey = vi.fn(impl);
	const client: IPatentBackendClient = {
		_serviceBrand: undefined,
		post<T>(): Promise<T> { throw new Error('post not exercised in the trial provider'); },
		get<T>(): Promise<T> { throw new Error('get not exercised in the trial provider'); },
		getCustomerPortalUrl(): never { throw new Error('getCustomerPortalUrl not exercised in the trial provider'); },
		getTrialModelKey,
	};
	return { client, getTrialModelKey };
}

/** A fetcher that answers the OpenRouter catalog discovery request (or rejects, when scripted to). */
function makeFetcherService(impl: () => Promise<Response>): IFetcherService {
	return {
		_serviceBrand: undefined,
		onDidFetch: Event.None,
		onDidCompleteFetch: Event.None,
		getUserAgentLibrary: () => 'test-stub',
		fetch: impl,
		makeAbortController: () => new AbortController(),
		isAbortError,
		createWebSocket() { throw new Error('createWebSocket not implemented in the trial provider test fake'); },
		disconnectAll: () => Promise.resolve(undefined),
		isInternetDisconnectedError: () => false,
		isFetcherError: () => false,
		isNetworkProcessCrashedError: () => false,
		getUserMessageForFetcherError: () => '',
		fetchWithPagination() { throw new Error('fetchWithPagination not implemented in the trial provider test fake'); },
	};
}

function catalogResponse(): Promise<Response> {
	return Promise.resolve(Response.fromText(200, '', new HeadersImpl({ 'content-type': 'application/json' }), JSON.stringify(CATALOG), 'test-stub'));
}

const LIST_OPTIONS: PrepareLanguageModelChatModelOptions = { silent: true };

describe('FlowLeapTrialLMProvider (ADR 0015, #241)', () => {
	const disposables = new DisposableStore();
	let accessor: ITestingServicesAccessor;
	let instaService: IInstantiationService;

	beforeEach(() => {
		const testingServiceCollection = createExtensionUnitTestingServices();
		testingServiceCollection.define(IBlockedExtensionService, new SyncDescriptor(BlockedExtensionService));
		accessor = disposables.add(testingServiceCollection.createTestingAccessor());
		instaService = accessor.get(IInstantiationService);
		// Signed-in, `trialing` by default; individual tests override.
		registerPatentAccessTokenProvider(() => 'tok-trial');
		registerPatentSubscriptionProvider(() => ({ status: 'trialing' }));
	});

	afterEach(() => {
		registerPatentAccessTokenProvider(() => undefined);
		registerPatentSubscriptionProvider(() => undefined);
		disposables.clear();
		vi.restoreAllMocks();
	});

	function makeProvider(backend: { client: IPatentBackendClient }, storage: { service: IBYOKStorageService }, fetchImpl: () => Promise<Response> = catalogResponse, deps: IFlowLeapTrialLifecycleDeps = makeLifecycleDeps().deps) {
		return disposables.add(new FlowLeapTrialLMProvider(
			storage.service,
			deps,
			backend.client,
			makeFetcherService(fetchImpl),
			new TestLogService(),
			instaService,
			new DefaultsOnlyConfigurationService(),
			new NullExperimentationService(),
		));
	}

	function listModels(provider: FlowLeapTrialLMProvider) {
		const tokenSource = new vscode.CancellationTokenSource();
		try {
			return provider.provideLanguageModelChatInformation(LIST_OPTIONS, tokenSource.token);
		} finally {
			tokenSource.dispose();
		}
	}

	it('serves exactly the backend model list, in order, with the first entry as default and the key on every model', async () => {
		const backend = makeBackendClient(async () => ({ key: TRIAL_KEY, models: SERVED_MODELS, cap: { dailyUsd: 5 } }));
		const storage = makeStorageService();

		const models = await listModels(makeProvider(backend, storage));

		// Exactly the served list, in the served order — never the whole OpenRouter catalog.
		expect(models.map(m => m.id)).toEqual(SERVED_MODELS);
		expect(models.map(m => m.isDefault)).toEqual([true, false, false]);
		for (const model of models) {
			expect(model.configuration?.apiKey).toBe(TRIAL_KEY);
			expect(model.tooltip).toContain('FlowLeap');
		}
		// Catalog capabilities flow through (the Gemini entry is vision + reasoning capable).
		const gemini = models.find(m => m.id === 'google/gemini-3.7-flash');
		expect(gemini?.capabilities.imageInput).toBe(true);
	});

	it('stores the fetched key in secret storage via the BYOK storage service (never settings)', async () => {
		const backend = makeBackendClient(async () => ({ key: TRIAL_KEY, models: SERVED_MODELS, cap: { dailyUsd: 5 } }));
		const storage = makeStorageService();

		await listModels(makeProvider(backend, storage));

		expect(storage.storeAPIKey).toHaveBeenCalledWith(FlowLeapTrialLMProvider.providerName, TRIAL_KEY, BYOKAuthType.GlobalApiKey);
	});

	it('renders a served model even when the OpenRouter catalog lookup fails (fallback capabilities, list stays the backend list)', async () => {
		const backend = makeBackendClient(async () => ({ key: TRIAL_KEY, models: SERVED_MODELS, cap: { dailyUsd: 5 } }));
		const storage = makeStorageService();
		const provider = makeProvider(backend, storage, () => Promise.reject(new Error('catalog unreachable')));

		const models = await listModels(provider);

		expect(models.map(m => m.id)).toEqual(SERVED_MODELS);
		// Fallback capabilities keep tool calling on — the curated Trial Models are tool-capable by contract.
		expect(models.every(m => m.capabilities.toolCalling)).toBe(true);
	});

	it('hides the provider and discards the stored key on the typed trial_model_key_unavailable denial', async () => {
		const backend = makeBackendClient(async () => { throw new TrialModelKeyUnavailableError('not trialing', 'not_trialing'); });
		const storage = makeStorageService();

		const models = await listModels(makeProvider(backend, storage));

		expect(models).toEqual([]);
		expect(storage.deleteAPIKey).toHaveBeenCalledWith(FlowLeapTrialLMProvider.providerName, BYOKAuthType.GlobalApiKey);
		expect(storage.storeAPIKey).not.toHaveBeenCalled();
	});

	it('degrades to an empty listing on transport failure and recovers on the next listing (retry, never a harder block)', async () => {
		let backendUp = false;
		const backend = makeBackendClient(async () => {
			if (!backendUp) {
				throw new TransientBackendError('The patent backend returned HTTP 503 (Service Unavailable).', 503);
			}
			return { key: TRIAL_KEY, models: SERVED_MODELS, cap: { dailyUsd: 5 } };
		});
		const storage = makeStorageService();
		const provider = makeProvider(backend, storage);

		const whileDown = await listModels(provider);
		backendUp = true;
		const afterRecovery = await listModels(provider);

		expect(whileDown).toEqual([]);
		// A transient outage must not destroy the stored key — only a typed denial does.
		expect(storage.deleteAPIKey).not.toHaveBeenCalled();
		expect(afterRecovery.map(m => m.id)).toEqual(SERVED_MODELS);
	});

	it('skips the backend entirely and discards the key when the subscription snapshot is conclusively non-trialing', async () => {
		registerPatentSubscriptionProvider(() => ({ status: 'active' }));
		const backend = makeBackendClient(async () => { throw new PatentBackendError(undefined, 'must not be called'); });
		const storage = makeStorageService();

		const models = await listModels(makeProvider(backend, storage));

		expect(models).toEqual([]);
		expect(backend.getTrialModelKey).not.toHaveBeenCalled();
		expect(storage.deleteAPIKey).toHaveBeenCalledWith(FlowLeapTrialLMProvider.providerName, BYOKAuthType.GlobalApiKey);
	});

	it('still asks the backend when the snapshot is inconclusive (cold start) — the typed 403 is the final word', async () => {
		registerPatentSubscriptionProvider(() => undefined);
		const backend = makeBackendClient(async () => ({ key: TRIAL_KEY, models: SERVED_MODELS, cap: { dailyUsd: 5 } }));
		const storage = makeStorageService();

		const models = await listModels(makeProvider(backend, storage));

		expect(backend.getTrialModelKey).toHaveBeenCalledTimes(1);
		expect(models.map(m => m.id)).toEqual(SERVED_MODELS);
	});

	it('maps a spend-cap rejection to the localized two-exit message, never the raw provider error (ADR 0015, #243)', async () => {
		const capError = new Error('Quota Exceeded\n\nServer Error: This request requires more credits\nError Code: 402');
		capError.name = 'ChatQuotaExceeded';
		vi.spyOn(AbstractOpenAICompatibleLMProvider.prototype, 'provideLanguageModelChatResponse').mockRejectedValue(capError);
		const provider = makeProvider(makeBackendClient(async () => ({ key: TRIAL_KEY, models: SERVED_MODELS, cap: { dailyUsd: 5 } })), makeStorageService());

		const tokenSource = new vscode.CancellationTokenSource();
		try {
			await expect(provider.provideLanguageModelChatResponse({} as never, [], {} as never, { report: () => undefined }, tokenSource.token))
				.rejects.toThrow(/Add your own API key.*Manage Models.*cap resets daily/s);
		} finally {
			tokenSource.dispose();
		}
	});

	it('rethrows non-cap chat failures unchanged', async () => {
		vi.spyOn(AbstractOpenAICompatibleLMProvider.prototype, 'provideLanguageModelChatResponse').mockRejectedValue(new Error('socket hang up'));
		const provider = makeProvider(makeBackendClient(async () => ({ key: TRIAL_KEY, models: SERVED_MODELS, cap: { dailyUsd: 5 } })), makeStorageService());

		const tokenSource = new vscode.CancellationTokenSource();
		try {
			await expect(provider.provideLanguageModelChatResponse({} as never, [], {} as never, { report: () => undefined }, tokenSource.token))
				.rejects.toThrow('socket hang up');
		} finally {
			tokenSource.dispose();
		}
	});

	it('stays hidden without a backend call when the user is signed out', async () => {
		registerPatentAccessTokenProvider(() => undefined);
		const backend = makeBackendClient(async () => { throw new PatentBackendError(undefined, 'must not be called'); });
		const storage = makeStorageService();

		const models = await listModels(makeProvider(backend, storage));

		expect(models).toEqual([]);
		expect(backend.getTrialModelKey).not.toHaveBeenCalled();
	});

	// ── Lifecycle (#242): the provider follows the subscription, not the machine ────────────────

	/** Flush the async subscription-change reaction (two awaited storage calls) after a broadcast. */
	const settle = () => new Promise<void>(resolve => setTimeout(resolve, 0));

	it('discards the stored key, nudges toward a BYO key, and re-lists when the status leaves trialing (conversion)', async () => {
		let snapshot: { status: 'trialing' | 'active' } = { status: 'trialing' };
		registerPatentSubscriptionProvider(() => snapshot);
		const backend = makeBackendClient(async () => ({ key: TRIAL_KEY, models: SERVED_MODELS, cap: { dailyUsd: 5 } }));
		const storage = makeStorageService();
		const lifecycle = makeLifecycleDeps();
		const provider = makeProvider(backend, storage, catalogResponse, lifecycle.deps);
		let changeEvents = 0;
		disposables.add(provider.onDidChangeLanguageModelChatInformation(() => { changeEvents++; }));

		// While trialing: models served and the key held in storage.
		expect((await listModels(provider)).length).toBe(3);

		snapshot = { status: 'active' };
		notifyPatentSubscriptionChanged();
		await settle();

		expect(storage.deleteAPIKey).toHaveBeenCalledWith(FlowLeapTrialLMProvider.providerName, BYOKAuthType.GlobalApiKey);
		expect(lifecycle.showWarningMessage).toHaveBeenCalledTimes(1);
		expect(lifecycle.showWarningMessage.mock.calls[0][0]).toContain('Add your own API key');
		expect(changeEvents).toBe(1);
		// The re-listing core triggers off the change event now hides the provider.
		expect(await listModels(provider)).toEqual([]);
	});

	it('discards the stored key and nudges on sign-out, without a backend call', async () => {
		const backend = makeBackendClient(async () => ({ key: TRIAL_KEY, models: SERVED_MODELS, cap: { dailyUsd: 5 } }));
		const storage = makeStorageService();
		const lifecycle = makeLifecycleDeps();
		const provider = makeProvider(backend, storage, catalogResponse, lifecycle.deps);
		await listModels(provider);
		backend.getTrialModelKey.mockClear();

		registerPatentAccessTokenProvider(() => undefined);
		notifyPatentSubscriptionChanged();
		await settle();

		expect(storage.deleteAPIKey).toHaveBeenCalledWith(FlowLeapTrialLMProvider.providerName, BYOKAuthType.GlobalApiKey);
		expect(lifecycle.showWarningMessage).toHaveBeenCalledTimes(1);
		expect(backend.getTrialModelKey).not.toHaveBeenCalled();
	});

	it('never nudges a user who held no trial key, but still re-lists on the change', async () => {
		registerPatentSubscriptionProvider(() => ({ status: 'active' }));
		const backend = makeBackendClient(async () => { throw new PatentBackendError(undefined, 'must not be called'); });
		const storage = makeStorageService();
		const lifecycle = makeLifecycleDeps();
		const provider = makeProvider(backend, storage, catalogResponse, lifecycle.deps);
		let changeEvents = 0;
		disposables.add(provider.onDidChangeLanguageModelChatInformation(() => { changeEvents++; }));

		notifyPatentSubscriptionChanged();
		await settle();

		expect(lifecycle.showWarningMessage).not.toHaveBeenCalled();
		expect(storage.deleteAPIKey).not.toHaveBeenCalled();
		expect(changeEvents).toBe(1);
	});

	it('routes the nudge action to the manage-models command', async () => {
		let snapshot: { status: 'trialing' | 'inactive' } = { status: 'trialing' };
		registerPatentSubscriptionProvider(() => snapshot);
		const backend = makeBackendClient(async () => ({ key: TRIAL_KEY, models: SERVED_MODELS, cap: { dailyUsd: 5 } }));
		const storage = makeStorageService();
		const lifecycle = makeLifecycleDeps();
		lifecycle.showWarningMessage.mockResolvedValue('Manage Models');
		const provider = makeProvider(backend, storage, catalogResponse, lifecycle.deps);
		await listModels(provider);

		snapshot = { status: 'inactive' };
		notifyPatentSubscriptionChanged();
		await settle();

		expect(lifecycle.executeCommand).toHaveBeenCalledWith('workbench.action.chat.manage');
	});

	it('maps a revoked-key turn failure to the BYO-key nudge (not a raw provider error) and discards the key', async () => {
		const backend = makeBackendClient(async () => ({ key: TRIAL_KEY, models: SERVED_MODELS, cap: { dailyUsd: 5 } }));
		const storage = makeStorageService();
		const provider = makeProvider(backend, storage);
		const [model] = await listModels(provider);
		let changeEvents = 0;
		disposables.add(provider.onDidChangeLanguageModelChatInformation(() => { changeEvents++; }));
		// The inherited OpenRouter turn machinery throws the untyped auth-rejection shape OpenRouter
		// serves for a revoked key; the trial provider must re-map it, so fake exactly that seam.
		vi.spyOn(AbstractOpenAICompatibleLMProvider.prototype, 'provideLanguageModelChatResponse')
			.mockRejectedValue(new Error('token expired or invalid: 401 User not found.'));

		const tokenSource = new vscode.CancellationTokenSource();
		try {
			await expect(provider.provideLanguageModelChatResponse(model, [], {} as never, { report: () => undefined }, tokenSource.token))
				.rejects.toThrow(/Add your own API key.*command:workbench\.action\.chat\.manage/);
		} finally {
			tokenSource.dispose();
		}
		expect(storage.deleteAPIKey).toHaveBeenCalledWith(FlowLeapTrialLMProvider.providerName, BYOKAuthType.GlobalApiKey);
		expect(changeEvents).toBe(1);
	});

	it('passes a non-auth turn failure through untouched and keeps the key', async () => {
		const backend = makeBackendClient(async () => ({ key: TRIAL_KEY, models: SERVED_MODELS, cap: { dailyUsd: 5 } }));
		const storage = makeStorageService();
		const provider = makeProvider(backend, storage);
		const [model] = await listModels(provider);
		vi.spyOn(AbstractOpenAICompatibleLMProvider.prototype, 'provideLanguageModelChatResponse')
			.mockRejectedValue(new Error('The upstream provider is overloaded.'));

		const tokenSource = new vscode.CancellationTokenSource();
		try {
			await expect(provider.provideLanguageModelChatResponse(model, [], {} as never, { report: () => undefined }, tokenSource.token))
				.rejects.toThrow('The upstream provider is overloaded.');
		} finally {
			tokenSource.dispose();
		}
		expect(storage.deleteAPIKey).not.toHaveBeenCalled();
	});

	it('cedes the default slot to the user\'s own BYOK models while staying selectable (BYO-key precedence)', async () => {
		const backend = makeBackendClient(async () => ({ key: TRIAL_KEY, models: SERVED_MODELS, cap: { dailyUsd: 5 } }));
		const storage = makeStorageService();
		const lifecycle = makeLifecycleDeps({ hasUserByokModels: async () => true });
		const provider = makeProvider(backend, storage, catalogResponse, lifecycle.deps);

		const models = await listModels(provider);

		// Still the full trial list — selectable while trialing — but none of it claims default.
		expect(models.map(m => m.id)).toEqual(SERVED_MODELS);
		expect(models.map(m => m.isDefault)).toEqual([false, false, false]);
	});

	it('re-fetches the key silently on a fresh machine: empty storage plus a trialing account is enough', async () => {
		const backend = makeBackendClient(async () => ({ key: TRIAL_KEY, models: SERVED_MODELS, cap: { dailyUsd: 5 } }));
		const storage = makeStorageService(); // nothing stored: this machine has never seen the trial key
		const lifecycle = makeLifecycleDeps();
		const provider = makeProvider(backend, storage, catalogResponse, lifecycle.deps);

		// A background (silent) listing — no user action of any kind.
		const models = await listModels(provider);

		expect(models.map(m => m.id)).toEqual(SERVED_MODELS);
		expect(backend.getTrialModelKey).toHaveBeenCalledTimes(1);
		expect(storage.storeAPIKey).toHaveBeenCalledWith(FlowLeapTrialLMProvider.providerName, TRIAL_KEY, BYOKAuthType.GlobalApiKey);
		expect(lifecycle.showWarningMessage).not.toHaveBeenCalled();
	});
});
