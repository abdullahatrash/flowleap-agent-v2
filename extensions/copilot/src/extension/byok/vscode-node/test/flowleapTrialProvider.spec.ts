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
import { registerPatentSubscriptionProvider } from '../../../patentai/common/patentSubscriptionRegistry';
import { registerPatentAccessTokenProvider } from '../../../patentai/common/patentTokenRegistry';
import { IPatentBackendClient, PatentBackendError, TransientBackendError, TrialModelKeyUnavailableError, TrialModelKeyPayload } from '../../../patentai/vscode-node/patentBackendClient';
import { createExtensionUnitTestingServices } from '../../../test/node/services';
import { BYOKAuthType } from '../../common/byokProvider';
import type { IBYOKStorageService } from '../byokStorageService';
import { FlowLeapTrialLMProvider } from '../flowleapTrialProvider';

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

function makeStorageService() {
	const storeAPIKey = vi.fn(async () => undefined);
	const deleteAPIKey = vi.fn(async () => undefined);
	const service: IBYOKStorageService = {
		getAPIKey: vi.fn(async () => undefined),
		storeAPIKey,
		deleteAPIKey,
		getStoredModelConfigs: vi.fn(async () => ({})),
		saveModelConfig: vi.fn(async () => undefined),
		removeModelConfig: vi.fn(async () => undefined),
	};
	return { service, storeAPIKey, deleteAPIKey };
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

	function makeProvider(backend: { client: IPatentBackendClient }, storage: { service: IBYOKStorageService }, fetchImpl: () => Promise<Response> = catalogResponse) {
		return new FlowLeapTrialLMProvider(
			storage.service,
			backend.client,
			makeFetcherService(fetchImpl),
			new TestLogService(),
			instaService,
			new DefaultsOnlyConfigurationService(),
			new NullExperimentationService(),
		);
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

	it('stays hidden without a backend call when the user is signed out', async () => {
		registerPatentAccessTokenProvider(() => undefined);
		const backend = makeBackendClient(async () => { throw new PatentBackendError(undefined, 'must not be called'); });
		const storage = makeStorageService();

		const models = await listModels(makeProvider(backend, storage));

		expect(models).toEqual([]);
		expect(backend.getTrialModelKey).not.toHaveBeenCalled();
	});
});
