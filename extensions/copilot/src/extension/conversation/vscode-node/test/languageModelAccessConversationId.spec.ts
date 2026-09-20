/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { OutputMode, Raw } from '@vscode/prompt-tsx';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as vscode from 'vscode';
import { BlockedExtensionService, IBlockedExtensionService } from '../../../../platform/chat/common/blockedExtensionService';
import { ChatFetchResponseType, ChatLocation, ChatResponse } from '../../../../platform/chat/common/commonTypes';
import { ConfigKey, IConfigurationService } from '../../../../platform/configuration/common/configurationService';
import { createResponsesRequestBody } from '../../../../platform/endpoint/node/responsesApi';
import { ExtensionContributedChatEndpoint } from '../../../../platform/endpoint/vscode-node/extChatEndpoint';
import { IChatEndpoint, ICreateEndpointBodyOptions, IEndpointBody, IMakeChatRequestOptions } from '../../../../platform/networking/common/networking';
import { NoopOTelService, resolveOTelConfig } from '../../../../platform/otel/common/index';
import { ITestingServicesAccessor } from '../../../../platform/test/node/services';
import { ITokenizer, TokenizerType } from '../../../../util/common/tokenizer';
import { DisposableStore } from '../../../../util/vs/base/common/lifecycle';
import { SyncDescriptor } from '../../../../util/vs/platform/instantiation/common/descriptors';
import { IInstantiationService } from '../../../../util/vs/platform/instantiation/common/instantiation';
import { createExtensionUnitTestingServices } from '../../../test/node/services';
import { CopilotLanguageModelWrapper } from '../languageModelAccess';

const MODEL_FAMILY = 'gpt-5';

/**
 * A BYOK Responses endpoint reached through a contributed `vscode.lm` model cannot see the
 * conversation it belongs to, because the request crosses an IPC boundary that carries only the
 * `vscode.lm` request options. `43f74c456fa` smuggles the id through `modelOptions._conversationId`.
 * This exercises all three legs of that bridge with the production code of each: the extension
 * endpoint writes the bag, the wrapper reads it back, and the Responses body builder turns it into
 * a `prompt_cache_key`. Without the bridge every BYOK Responses turn pays full input price on the
 * whole replayed history.
 */
describe('BYOK conversation id bridge', () => {
	const disposables = new DisposableStore();
	let accessor: ITestingServicesAccessor;
	let instaService: IInstantiationService;

	beforeEach(() => {
		const testingServiceCollection = createExtensionUnitTestingServices(disposables);
		testingServiceCollection.define(IBlockedExtensionService, new SyncDescriptor(BlockedExtensionService));
		accessor = disposables.add(testingServiceCollection.createTestingAccessor());
		instaService = accessor.get(IInstantiationService);
	});

	afterEach(() => {
		disposables.clear();
	});

	it('reaches a Responses prompt_cache_key through the extension-endpoint path', async () => {
		await accessor.get(IConfigurationService).setConfig(ConfigKey.ResponsesApiPromptCacheKeyEnabled, true);

		expect({
			withConversationId: await promptCacheKey(instaService, disposables, 'conversation-332031'),
			withoutConversationId: await promptCacheKey(instaService, disposables, undefined),
		}).toEqual({
			withConversationId: `conversation-332031:${MODEL_FAMILY}`,
			withoutConversationId: undefined,
		});
	});

	/**
	 * `ResponsesApiPromptCacheKeyEnabled` is `ConfigType.ExperimentBased`, but no experiment service
	 * ever flips it under BYOK (#416), so the bridge above must already be live on the setting's
	 * built-in default with no `setConfig` call. Guards against the default silently reverting to
	 * `false`, which would put every BYOK Responses turn back on a cold prompt cache.
	 */
	it('reaches a Responses prompt_cache_key with the default configuration, no settings change', async () => {
		expect(await promptCacheKey(instaService, disposables, 'conversation-332031')).toBe(`conversation-332031:${MODEL_FAMILY}`);
	});
});

/**
 * Drives a request through the same extension-endpoint / wrapper / Responses-body-builder bridge
 * as production, and returns the `prompt_cache_key` the real body builder produced for it.
 */
async function promptCacheKey(instaService: IInstantiationService, disposables: DisposableStore, conversationId: string | undefined) {
	const bodies: IEndpointBody[] = [];
	// The far side of the IPC boundary: the real Responses body builder, fed by whatever the
	// wrapper decided to forward.
	const responsesEndpoint = createResponsesEndpoint(instaService, body => bodies.push(body));
	const wrapper = disposables.add(instaService.createInstance(CopilotLanguageModelWrapper));
	const languageModel = createContributedModel(async (messages, options, token) => {
		await wrapper.provideLanguageModelResponse(responsesEndpoint, [...messages], {
			requestInitiator: 'core',
			tools: options.tools ?? [],
			toolMode: options.toolMode ?? vscode.LanguageModelChatToolMode.Auto,
			modelOptions: options.modelOptions,
		}, 'core', { report: () => { } }, token);
	});
	const extensionEndpoint = new ExtensionContributedChatEndpoint(
		languageModel,
		instaService,
		new NoopOTelService(resolveOTelConfig({ env: {}, extensionVersion: '1.0.0', sessionId: 'test' })),
	);

	await extensionEndpoint.makeChatRequest2({
		debugName: 'test',
		messages: [{
			role: Raw.ChatRole.User,
			content: [{ type: Raw.ChatCompletionContentPartKind.Text, text: 'hello' }],
		}],
		conversationId,
		finishedCb: undefined,
		location: ChatLocation.Agent,
		requestOptions: {},
	}, new vscode.CancellationTokenSource().token);

	expect(bodies).toHaveLength(1);
	return bodies[0].prompt_cache_key;
}

/**
 * A Responses endpoint that records the body the real builder produces for every request the
 * wrapper hands it.
 */
function createResponsesEndpoint(instaService: IInstantiationService, record: (body: IEndpointBody) => void): IChatEndpoint {
	const endpoint = {
		family: MODEL_FAMILY,
		model: MODEL_FAMILY,
		name: 'Test Responses Model',
		version: '1.0',
		modelProvider: 'test',
		modelMaxPromptTokens: 128000,
		maxOutputTokens: 4096,
		supportsVision: false,
		supportsToolCalls: true,
		supportsPrediction: false,
		supportsToolSearch: false,
		showInModelPicker: false,
		isFallback: false,
		tokenizer: TokenizerType.O200K,
		urlOrRequestMetadata: 'https://api.example.com/v1/responses',
		acquireTokenizer: (): ITokenizer => ({
			mode: OutputMode.Raw,
			tokenLength: async () => 0,
			countMessageTokens: async () => 0,
			countMessagesTokens: async () => 0,
			countToolTokens: async () => 0,
		}),
		createRequestBody: (options: ICreateEndpointBodyOptions): IEndpointBody =>
			instaService.invokeFunction(servicesAccessor => createResponsesRequestBody(servicesAccessor, options, MODEL_FAMILY, endpoint)),
		makeChatRequest2: async (options: IMakeChatRequestOptions): Promise<ChatResponse> => {
			record(endpoint.createRequestBody({
				...options,
				requestId: 'test-request',
				postOptions: options.requestOptions ?? {},
			}));
			return {
				type: ChatFetchResponseType.Success,
				requestId: 'test-request',
				serverRequestId: undefined,
				usage: undefined,
				value: '',
				resolvedModel: MODEL_FAMILY,
			} as ChatResponse;
		},
	} as unknown as IChatEndpoint;
	return endpoint;
}

/** A contributed `vscode.lm` model whose `sendRequest` runs the wrapper, as the real IPC hop does. */
function createContributedModel(
	sendRequest: (
		messages: readonly (vscode.LanguageModelChatMessage | vscode.LanguageModelChatMessage2)[],
		options: vscode.LanguageModelChatRequestOptions,
		token: vscode.CancellationToken,
	) => Promise<void>,
): vscode.LanguageModelChat {
	return {
		id: 'test-model',
		name: 'Test Responses Model',
		vendor: 'CustomEndpoint',
		family: MODEL_FAMILY,
		version: '1.0.0',
		maxInputTokens: 128000,
		capabilities: {},
		sendRequest: async (
			messages: readonly (vscode.LanguageModelChatMessage | vscode.LanguageModelChatMessage2)[],
			options: vscode.LanguageModelChatRequestOptions,
			token: vscode.CancellationToken,
		) => {
			await sendRequest(messages, options, token);
			return { stream: (async function* () { })() };
		},
	} as unknown as vscode.LanguageModelChat;
}
