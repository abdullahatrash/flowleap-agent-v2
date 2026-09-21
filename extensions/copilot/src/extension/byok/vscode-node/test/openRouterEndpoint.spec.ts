/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Raw } from '@vscode/prompt-tsx';
import { ChatLocation } from '../../../../platform/chat/common/commonTypes';
import { IChatModelInformation, ModelSupportedEndpoint } from '../../../../platform/endpoint/common/endpointProvider';
import { ITestingServicesAccessor } from '../../../../platform/test/node/services';
import { TokenizerType } from '../../../../util/common/tokenizer';
import { DisposableStore } from '../../../../util/vs/base/common/lifecycle';
import { IInstantiationService } from '../../../../util/vs/platform/instantiation/common/instantiation';
import { createExtensionUnitTestingServices } from '../../../test/node/services';
import { OpenRouterEndpoint } from '../openRouterProvider';

describe('OpenRouterEndpoint', () => {
	const disposables = new DisposableStore();
	let accessor: ITestingServicesAccessor;
	let instaService: IInstantiationService;

	beforeEach(() => {
		const testingServiceCollection = createExtensionUnitTestingServices();
		accessor = disposables.add(testingServiceCollection.createTestingAccessor());
		instaService = accessor.get(IInstantiationService);
	});

	afterEach(() => {
		disposables.clear();
	});

	describe('Anthropic models — Messages API', () => {
		let anthropicMetadata: IChatModelInformation;

		beforeEach(() => {
			anthropicMetadata = {
				id: 'anthropic/claude-sonnet-4',
				name: 'Claude Sonnet 4',
				vendor: 'OpenRouter',
				version: '1.0',
				model_picker_enabled: true,
				is_chat_default: false,
				is_chat_fallback: false,
				supported_endpoints: [ModelSupportedEndpoint.Messages],
				capabilities: {
					type: 'chat',
					family: 'anthropic/claude-sonnet-4',
					tokenizer: TokenizerType.O200K,
					supports: {
						parallel_tool_calls: false,
						streaming: true,
						tool_calls: true,
						vision: true,
						prediction: false,
						thinking: false
					},
					limits: {
						max_prompt_tokens: 200000,
						max_output_tokens: 16000,
						max_context_window_tokens: 200000
					}
				}
			};
		});

		it('should use Messages API when supported_endpoints includes Messages', () => {
			const endpoint = instaService.createInstance(OpenRouterEndpoint,
				anthropicMetadata,
				'test-api-key',
				'https://openrouter.ai/api/v1/messages');

			expect(endpoint.apiType).toBe('messages');
		});

		/**
		 * Pins today's beta list so a future capability gate cannot quietly widen what we ask a
		 * third-party host to accept. OpenRouter may serve this model from Amazon Bedrock, which
		 * answers `400 invalid beta flag` for anything it does not implement (#453).
		 *
		 * The list is one flag, not four: the capability gates for tool search and context editing
		 * match on a leading `claude`, and an OpenRouter id carries the `anthropic/` vendor prefix,
		 * so they read as unsupported here. Interleaved thinking has no such gate and is the flag
		 * Bedrock rejected live.
		 */
		it('sends exactly these beta flags for anthropic/claude-sonnet-5', () => {
			anthropicMetadata.id = 'anthropic/claude-sonnet-5';
			anthropicMetadata.name = 'Claude Sonnet 5';
			anthropicMetadata.capabilities.family = anthropicMetadata.id;
			const endpoint = instaService.createInstance(OpenRouterEndpoint, anthropicMetadata, 'test-api-key', 'https://openrouter.ai/api/v1/messages');
			expect(endpoint.getExtraHeaders()['anthropic-beta']).toBe('interleaved-thinking-2025-05-14');
		});

		it('asks OpenRouter for the Anthropic provider first while keeping fallbacks open', () => {
			anthropicMetadata.id = 'anthropic/claude-sonnet-5';
			anthropicMetadata.capabilities.family = anthropicMetadata.id;
			const endpoint = instaService.createInstance(OpenRouterEndpoint, anthropicMetadata, 'test-api-key', 'https://openrouter.ai/api/v1/messages');
			const body = endpoint.createRequestBody({
				debugName: 'provider-test', requestId: 'provider-test', location: ChatLocation.Panel,
				postOptions: {}, finishedCb: undefined,
				messages: [{ role: Raw.ChatRole.User, content: [{ type: Raw.ChatCompletionContentPartKind.Text, text: 'hi' }] }],
			});
			expect(body.provider).toEqual({ order: ['anthropic'], allow_fallbacks: true });
		});

	});

	describe('Non-Anthropic models — Chat Completions', () => {
		let nonAnthropicMetadata: IChatModelInformation;

		beforeEach(() => {
			nonAnthropicMetadata = {
				id: 'openai/gpt-4o',
				name: 'GPT-4o',
				vendor: 'OpenRouter',
				version: '1.0',
				model_picker_enabled: true,
				is_chat_default: false,
				is_chat_fallback: false,
				supported_endpoints: [ModelSupportedEndpoint.ChatCompletions],
				capabilities: {
					type: 'chat',
					family: 'openai/gpt-4o',
					tokenizer: TokenizerType.O200K,
					supports: {
						parallel_tool_calls: false,
						streaming: true,
						tool_calls: true,
						vision: true,
						prediction: false,
						thinking: false
					},
					limits: {
						max_prompt_tokens: 128000,
						max_output_tokens: 16000,
						max_context_window_tokens: 128000
					}
				}
			};
		});

		it('sends no provider preference and no beta flags for a non-Anthropic model', () => {
			const endpoint = instaService.createInstance(OpenRouterEndpoint, nonAnthropicMetadata, 'test-api-key', 'https://openrouter.ai/api/v1/chat/completions');
			const body = endpoint.createRequestBody({
				debugName: 'provider-test', requestId: 'provider-test', location: ChatLocation.Panel,
				postOptions: {}, finishedCb: undefined,
				messages: [{ role: Raw.ChatRole.User, content: [{ type: Raw.ChatCompletionContentPartKind.Text, text: 'hi' }] }],
			});
			expect([body.provider, endpoint.getExtraHeaders()['anthropic-beta']]).toEqual([undefined, undefined]);
		});

		it('should use Chat Completions API for non-Anthropic models', () => {
			const endpoint = instaService.createInstance(OpenRouterEndpoint,
				nonAnthropicMetadata,
				'test-api-key',
				'https://openrouter.ai/api/v1/chat/completions');

			expect(endpoint.apiType).toBe('chatCompletions');
		});

		it('preserves PDF bytes as a file input for Gemini Chat Completions', () => {
			nonAnthropicMetadata.id = 'google/gemini-3.8-flash';
			nonAnthropicMetadata.capabilities.family = nonAnthropicMetadata.id;
			const endpoint = instaService.createInstance(OpenRouterEndpoint, nonAnthropicMetadata, 'test-api-key', 'https://openrouter.ai/api/v1/chat/completions');
			const data = Buffer.from('%PDF-1.7\nfigure and text bytes').toString('base64');
			const body = endpoint.createRequestBody({
				debugName: 'pdf-test', requestId: 'pdf-test', location: ChatLocation.Panel,
				postOptions: {}, finishedCb: undefined,
				messages: [{ role: Raw.ChatRole.User, content: [
					{ type: Raw.ChatCompletionContentPartKind.Text, text: 'Read the disclosure' },
					{ type: Raw.ChatCompletionContentPartKind.Document, documentData: { mediaType: 'application/pdf', data } },
				] }],
			});
			expect(body.messages?.[0].content).toEqual([
				{ type: 'text', text: 'Read the disclosure' },
				{ type: 'file', file: { filename: 'document.pdf', file_data: `data:application/pdf;base64,${data}` } },
			]);
		});
	});
});
