/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Raw } from '@vscode/prompt-tsx';
import assert from 'assert';
import * as vscode from 'vscode';
import { IChatMLFetcher, IFetchMLOptions } from '../../../../platform/chat/common/chatMLFetcher';
import { ChatFetchResponseType, ChatResponses } from '../../../../platform/chat/common/commonTypes';
import { MockChatMLFetcher } from '../../../../platform/chat/test/common/mockChatMLFetcher';
import { IEndpointProvider } from '../../../../platform/endpoint/common/endpointProvider';
import { CustomDataPartMimeTypes } from '../../../../platform/endpoint/common/endpointTypes';
import { IChatEndpoint } from '../../../../platform/networking/common/networking';
import { ITestingServicesAccessor } from '../../../../platform/test/node/services';
import { CancellationToken } from '../../../../util/vs/base/common/cancellation';
import { IInstantiationService } from '../../../../util/vs/platform/instantiation/common/instantiation';
import { createExtensionTestingServices } from '../../../test/vscode-node/services';
import { CopilotLanguageModelWrapper } from '../languageModelAccess';


suite('CopilotLanguageModelWrapper', () => {
	let accessor: ITestingServicesAccessor;
	let instaService: IInstantiationService;

	function createAccessor() {
		const testingServiceCollection = createExtensionTestingServices();
		testingServiceCollection.define(IChatMLFetcher, new MockChatMLFetcher());

		accessor = testingServiceCollection.createTestingAccessor();
		instaService = accessor.get(IInstantiationService);
	}

	suite('validateRequest - invalid', () => {
		let wrapper: CopilotLanguageModelWrapper;
		let endpoint: IChatEndpoint;
		setup(async () => {
			createAccessor();
			endpoint = await accessor.get(IEndpointProvider).getChatEndpoint('copilot-utility');
			wrapper = instaService.createInstance(CopilotLanguageModelWrapper);
		});

		const runTest = async (messages: vscode.LanguageModelChatMessage[], tools?: vscode.LanguageModelChatTool[], errMsg?: string) => {
			await assert.rejects(
				() => wrapper.provideLanguageModelResponse(endpoint, messages, { tools, requestInitiator: 'unknown', toolMode: vscode.LanguageModelChatToolMode.Auto }, vscode.extensions.all[0].id, { report: () => { } }, CancellationToken.None),
				err => {
					errMsg ??= 'Invalid request';
					assert.ok(err instanceof Error, 'expected an Error');
					assert.ok(err.message.includes(errMsg), `expected error to include "${errMsg}", got ${err.message}`);
					return true;
				}
			);
		};

		test('empty', async () => {
			await runTest([]);
		});

		test('bad tool name', async () => {
			await runTest([vscode.LanguageModelChatMessage.User('hello')], [{ name: 'hello world', description: 'my tool' }], 'Invalid tool name');
		});
	});

	suite('validateRequest - valid', () => {
		let wrapper: CopilotLanguageModelWrapper;
		let endpoint: IChatEndpoint;
		setup(async () => {
			createAccessor();
			endpoint = await accessor.get(IEndpointProvider).getChatEndpoint('copilot-utility');
			wrapper = instaService.createInstance(CopilotLanguageModelWrapper);
		});
		const runTest = async (messages: vscode.LanguageModelChatMessage[], tools?: vscode.LanguageModelChatTool[]) => {
			await wrapper.provideLanguageModelResponse(endpoint, messages, { tools, requestInitiator: 'unknown', toolMode: vscode.LanguageModelChatToolMode.Auto }, vscode.extensions.all[0].id, { report: () => { } }, CancellationToken.None);
		};

		test('simple', async () => {
			await runTest([vscode.LanguageModelChatMessage.User('hello')]);
		});

		test('tool call and user message', async () => {
			const toolCall = vscode.LanguageModelChatMessage.Assistant('');
			toolCall.content = [new vscode.LanguageModelToolCallPart('id', 'func', { param: 123 })];
			const toolResult = vscode.LanguageModelChatMessage.User('');
			toolResult.content = [new vscode.LanguageModelToolResultPart('id', [new vscode.LanguageModelTextPart('result')])];
			await runTest([toolCall, toolResult, vscode.LanguageModelChatMessage.User('user message')]);
		});

		test('good tool name', async () => {
			await runTest([vscode.LanguageModelChatMessage.User('hello2')], [{ name: 'hello_world', description: 'my tool' }]);
		});
	});

	suite('trailing assistant guard', () => {
		let wrapper: CopilotLanguageModelWrapper;
		let endpoint: IChatEndpoint;
		let fetcher: CapturingChatMLFetcher;

		/** Records the messages of each request so the outgoing shape can be asserted. */
		class CapturingChatMLFetcher extends MockChatMLFetcher {
			readonly requests: Raw.ChatMessage[][] = [];
			override async fetchMany(options: IFetchMLOptions, token: CancellationToken): Promise<ChatResponses> {
				this.requests.push(options.messages);
				return super.fetchMany(options, token);
			}
		}

		setup(async () => {
			const testingServiceCollection = createExtensionTestingServices();
			fetcher = new CapturingChatMLFetcher();
			testingServiceCollection.define(IChatMLFetcher, fetcher);
			accessor = testingServiceCollection.createTestingAccessor();
			instaService = accessor.get(IInstantiationService);
			endpoint = await accessor.get(IEndpointProvider).getChatEndpoint('copilot-utility');
			wrapper = instaService.createInstance(CopilotLanguageModelWrapper);
		});

		test('appends a synthetic user message when the conversation ends with an assistant turn', async () => {
			// Some providers (e.g. Google) reject requests whose last message is an assistant turn.
			await wrapper.provideLanguageModelResponse(
				endpoint,
				[vscode.LanguageModelChatMessage.User('hello'), vscode.LanguageModelChatMessage.Assistant('partial answer')],
				{ requestInitiator: 'unknown', toolMode: vscode.LanguageModelChatToolMode.Auto },
				vscode.extensions.all[0].id,
				{ report: () => { } },
				CancellationToken.None
			);

			assert.strictEqual(fetcher.requests.length, 1);
			const sent = fetcher.requests[0];
			assert.strictEqual(sent[sent.length - 1].role, Raw.ChatRole.User);
			assert.deepStrictEqual(sent[sent.length - 1].content, [{ type: Raw.ChatCompletionContentPartKind.Text, text: 'Please continue.' }]);
		});

		test('does not touch a conversation that already ends with a user turn', async () => {
			await wrapper.provideLanguageModelResponse(
				endpoint,
				[vscode.LanguageModelChatMessage.User('hello')],
				{ requestInitiator: 'unknown', toolMode: vscode.LanguageModelChatToolMode.Auto },
				vscode.extensions.all[0].id,
				{ report: () => { } },
				CancellationToken.None
			);

			assert.strictEqual(fetcher.requests.length, 1);
			const sent = fetcher.requests[0];
			assert.strictEqual(sent[sent.length - 1].role, Raw.ChatRole.User);
			assert.strictEqual(sent.filter(m => m.role === Raw.ChatRole.User).length, 1);
		});
	});

	suite('usage emission', () => {
		let wrapper: CopilotLanguageModelWrapper;
		let endpoint: IChatEndpoint;
		let fetcher: MockChatMLFetcher;
		setup(async () => {
			createAccessor();
			fetcher = accessor.get(IChatMLFetcher) as MockChatMLFetcher;
			endpoint = await accessor.get(IEndpointProvider).getChatEndpoint('copilot-utility');
			wrapper = instaService.createInstance(CopilotLanguageModelWrapper);
		});

		test('reports usage as a LanguageModelDataPart', async () => {
			const expectedUsage = {
				prompt_tokens: 100,
				completion_tokens: 50,
				total_tokens: 150,
				prompt_tokens_details: { cached_tokens: 10 }
			};
			fetcher.setNextResponse({
				type: ChatFetchResponseType.Success,
				requestId: 'test-request-id',
				serverRequestId: 'test-server-request-id',
				usage: expectedUsage,
				value: 'hello',
				resolvedModel: 'test-model'
			});

			const reportedParts: vscode.LanguageModelResponsePart2[] = [];
			await wrapper.provideLanguageModelResponse(
				endpoint,
				[vscode.LanguageModelChatMessage.User('hello')],
				{ requestInitiator: 'unknown', toolMode: vscode.LanguageModelChatToolMode.Auto },
				vscode.extensions.all[0].id,
				{ report: part => reportedParts.push(part) },
				CancellationToken.None
			);

			const usagePart = reportedParts.find((p): p is vscode.LanguageModelDataPart =>
				p instanceof vscode.LanguageModelDataPart && p.mimeType === CustomDataPartMimeTypes.Usage);
			assert.ok(usagePart, 'expected a usage data part to be reported');
			const decoded = JSON.parse(new TextDecoder().decode(usagePart.data));
			assert.deepStrictEqual(decoded, expectedUsage);
		});
	});
});
