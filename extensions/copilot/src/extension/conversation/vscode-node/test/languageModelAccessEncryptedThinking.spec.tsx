/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AssistantMessage, OutputMode, PromptElement, PromptElementProps, Raw } from '@vscode/prompt-tsx';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as vscode from 'vscode';
import { BlockedExtensionService, IBlockedExtensionService } from '../../../../platform/chat/common/blockedExtensionService';
import { ChatFetchResponseType, ChatLocation, ChatResponse } from '../../../../platform/chat/common/commonTypes';
import { ThinkingDataContainer } from '../../../../platform/endpoint/common/thinkingDataContainer';
import { createResponsesRequestBody } from '../../../../platform/endpoint/node/responsesApi';
import { MockEndpoint } from '../../../../platform/endpoint/test/node/mockEndpoint';
import { ExtensionContributedChatEndpoint } from '../../../../platform/endpoint/vscode-node/extChatEndpoint';
import { IResponseDelta } from '../../../../platform/networking/common/fetch';
import { IChatEndpoint, ICreateEndpointBodyOptions, IEndpointBody, IMakeChatRequestOptions } from '../../../../platform/networking/common/networking';
import { NoopOTelService, resolveOTelConfig } from '../../../../platform/otel/common/index';
import { ITestingServicesAccessor } from '../../../../platform/test/node/services';
import { asThinkingOriginApi, ThinkingData, ThinkingOriginApi } from '../../../../platform/thinking/common/thinking';
import { ITokenizer, TokenizerType } from '../../../../util/common/tokenizer';
import { DisposableStore } from '../../../../util/vs/base/common/lifecycle';
import { SyncDescriptor } from '../../../../util/vs/platform/instantiation/common/descriptors';
import { IInstantiationService } from '../../../../util/vs/platform/instantiation/common/instantiation';
import type { LMResponsePart } from '../../../byok/common/byokProvider';
import { ThinkingDataItem } from '../../../prompt/common/toolCallRound';
import { renderPromptElement } from '../../../prompts/node/base/promptRenderer';
import { createExtensionUnitTestingServices } from '../../../test/node/services';
import { CopilotLanguageModelWrapper } from '../languageModelAccess';

const MODEL_FAMILY = 'gpt-5';
/**
 * Deliberately not `rs`-prefixed. The Responses body builder keeps a legacy fallback that replays
 * any `rs`-prefixed payload even when its origin is unknown, so an `rs_` id here would pass the
 * assertion without the provenance tag ever surviving. This id only gets replayed if the tag does.
 */
const REASONING_ID = 'CzDhIBSZ31';
const REASONING_TEXT = 'because';
const ENCRYPTED = 'opaque-reasoning-blob';

/**
 * Encrypted reasoning reaches a consumer only when the request opted in, and `vscode.lm` offers
 * the typed `includeEncryptedThinking` option to core alone. An extension consumer therefore asks
 * through the internal `modelOptions` bag, the seam `43f74c456fa` established for the conversation
 * id. This walks the whole loop with the production code of every leg: the extension endpoint
 * writes the bag, the wrapper restores it and tags the emitted payload with the producing API, the
 * consumer folds the deltas into its round and renders them into history, and the next request
 * reaches the real Responses body builder. Without the bridge the model redoes paid reasoning on
 * every tool continuation.
 */
describe('BYOK encrypted thinking bridge', () => {
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

	it('keeps an encrypted Responses reasoning payload across the vscode.lm boundary and replays it', async () => {
		const bodies: IEndpointBody[] = [];
		// The far side of the IPC boundary: a Responses endpoint that streams one encrypted
		// reasoning delta and builds every request body with the real builder.
		const responsesEndpoint = createResponsesEndpoint(instaService, body => bodies.push(body));
		const wrapper = disposables.add(instaService.createInstance(CopilotLanguageModelWrapper));
		const languageModel = createContributedModel(async (messages, options, token) => {
			const parts: LMResponsePart[] = [];
			await wrapper.provideLanguageModelResponse(responsesEndpoint, [...messages], {
				requestInitiator: 'core',
				tools: options.tools ?? [],
				toolMode: options.toolMode ?? vscode.LanguageModelChatToolMode.Auto,
				modelOptions: options.modelOptions,
			}, 'core', { report: part => parts.push(part) }, token);
			return parts;
		});
		// Typed as the interface, because the assertion below reads `apiType`: the concrete class does
		// not declare one, which is the whole reason provenance has to ride the part metadata.
		const extensionEndpoint: IChatEndpoint = new ExtensionContributedChatEndpoint(
			languageModel,
			instaService,
			new NoopOTelService(resolveOTelConfig({ env: {}, extensionVersion: '1.0.0', sessionId: 'test' })),
		);

		// First turn: collect whatever the provider sent back across the boundary.
		const deltas: IResponseDelta[] = [];
		await extensionEndpoint.makeChatRequest2({
			debugName: 'test',
			messages: [userMessage('hello')],
			finishedCb: async (_text, _index, delta) => {
				deltas.push(delta);
				return undefined;
			},
			location: ChatLocation.Agent,
			requestOptions: {},
		}, new vscode.CancellationTokenSource().token);

		// The consumer folds the deltas into one round the way the tool-calling loop does. Its own
		// endpoint is the contributed model, which has no API type of its own, so the round carries
		// no origin and the payload's provenance has to survive on the part metadata alone.
		let thinking: ThinkingDataItem | undefined;
		for (const delta of deltas) {
			if (delta.thinking) {
				thinking = ThinkingDataItem.createOrUpdate(thinking, delta.thinking);
			}
		}
		const consumerOriginApi = asThinkingOriginApi(extensionEndpoint.apiType);
		const { messages: history } = await renderPromptElement(
			instaService,
			instaService.createInstance(MockEndpoint, MODEL_FAMILY),
			ConsumerAssistantRound,
			{ thinking, originApi: consumerOriginApi },
		);

		// Second turn: that history goes back out over the boundary and reaches the body builder.
		bodies.length = 0;
		await extensionEndpoint.makeChatRequest2({
			debugName: 'test',
			messages: [userMessage('hello'), ...history, userMessage('and now?')],
			finishedCb: undefined,
			location: ChatLocation.Agent,
			requestOptions: {},
		}, new vscode.CancellationTokenSource().token);

		expect({
			emitted: deltas.flatMap(delta => delta.thinking ? [delta.thinking] : []),
			consumerOriginApi,
			replayed: bodies.at(-1)?.input?.filter(item => item.type === 'reasoning'),
		}).toEqual({
			emitted: [{
				id: REASONING_ID,
				text: REASONING_TEXT,
				metadata: { encrypted_content: ENCRYPTED, vscode_thinking_origin_api: 'responses' },
			}],
			consumerOriginApi: undefined,
			replayed: [{
				type: 'reasoning',
				id: REASONING_ID,
				summary: [],
				encrypted_content: ENCRYPTED,
			}],
		});
	});
});

type ConsumerAssistantRoundProps = PromptElementProps<{
	readonly thinking: ThinkingData | undefined;
	readonly originApi: ThinkingOriginApi | undefined;
}>;

/**
 * The consumer's own history rendering, mirroring what `toolCalling.tsx` does with a round —
 * including skipping the envelope when the round carries no reasoning, which is exactly what
 * happens when nothing opts the request in.
 */
class ConsumerAssistantRound extends PromptElement<ConsumerAssistantRoundProps> {
	render() {
		const thinking = this.props.thinking && <ThinkingDataContainer thinking={this.props.thinking} originApi={this.props.originApi} />;
		return <AssistantMessage>{thinking}</AssistantMessage>;
	}
}

function userMessage(text: string): Raw.ChatMessage {
	return {
		role: Raw.ChatRole.User,
		content: [{ type: Raw.ChatCompletionContentPartKind.Text, text }],
	};
}

/**
 * A Responses endpoint that streams one encrypted reasoning delta and records the body the real
 * builder produces for every request the wrapper hands it.
 */
function createResponsesEndpoint(instaService: IInstantiationService, record: (body: IEndpointBody) => void): IChatEndpoint {
	const endpoint = {
		family: MODEL_FAMILY,
		model: MODEL_FAMILY,
		name: 'Test Responses Model',
		version: '1.0',
		modelProvider: 'test',
		apiType: 'responses',
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
			await options.finishedCb?.('', 0, {
				text: '',
				thinking: { id: REASONING_ID, text: REASONING_TEXT, encrypted: ENCRYPTED },
			});
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
	) => Promise<LMResponsePart[]>,
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
			const parts = await sendRequest(messages, options, token);
			return { stream: (async function* () { yield* parts; })() };
		},
	} as unknown as vscode.LanguageModelChat;
}
