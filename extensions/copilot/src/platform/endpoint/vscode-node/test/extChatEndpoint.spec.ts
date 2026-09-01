/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Raw } from '@vscode/prompt-tsx';
import { describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { ChatFetchResponseType, ChatLocation } from '../../../chat/common/commonTypes';
import { NoopOTelService, resolveOTelConfig } from '../../../otel/common/index';
import type { IInstantiationService } from '../../../../util/vs/platform/instantiation/common/instantiation';
import { CustomDataPartMimeTypes } from '../../common/endpointTypes';
import { convertToApiChatMessage, ExtensionContributedChatEndpoint } from '../extChatEndpoint';

describe('ExtensionContributedChatEndpoint', () => {
	it('forwards telemetry turn from request properties through model options', async () => {
		let capturedOptions: vscode.LanguageModelChatRequestOptions | undefined;
		const languageModel = createLanguageModel(options => capturedOptions = options);
		const endpoint = new ExtensionContributedChatEndpoint(
			languageModel,
			createInstantiationService(),
			new NoopOTelService(resolveOTelConfig({ env: {}, extensionVersion: '1.0.0', sessionId: 'test' })),
		);

		const result = await endpoint.makeChatRequest2({
			debugName: 'test',
			messages: [{
				role: Raw.ChatRole.User,
				content: [{ type: Raw.ChatCompletionContentPartKind.Text, text: 'hello' }]
			}],
			finishedCb: undefined,
			location: ChatLocation.Panel,
			requestOptions: {},
			telemetryProperties: { turnIndex: '5' }
		}, new vscode.CancellationTokenSource().token);

		expect(result.type).toBe(ChatFetchResponseType.Success);
		expect(capturedOptions?.modelOptions?._telemetryTurn).toBe(5);
	});

	it('only forwards telemetry turn for base-10 non-negative integer request properties', async () => {
		const capturedOptions: vscode.LanguageModelChatRequestOptions[] = [];
		const languageModel = createLanguageModel(options => capturedOptions.push(options));
		const endpoint = new ExtensionContributedChatEndpoint(
			languageModel,
			createInstantiationService(),
			new NoopOTelService(resolveOTelConfig({ env: {}, extensionVersion: '1.0.0', sessionId: 'test' })),
		);

		for (const turnIndex of ['', ' ', '-1', '1e2', '3.14', 'abc']) {
			const result = await endpoint.makeChatRequest2({
				debugName: 'test',
				messages: [{
					role: Raw.ChatRole.User,
					content: [{ type: Raw.ChatCompletionContentPartKind.Text, text: 'hello' }]
				}],
				finishedCb: undefined,
				location: ChatLocation.Panel,
				requestOptions: {},
				telemetryProperties: { turnIndex }
			}, new vscode.CancellationTokenSource().token);

			expect(result.type).toBe(ChatFetchResponseType.Success);
		}

		expect(capturedOptions.map(options => options.modelOptions?._telemetryTurn)).toEqual([undefined, undefined, undefined, undefined, undefined, undefined]);
	});

	it('converts document parts to data parts instead of dropping them', () => {
		const pdfBase64 = Buffer.from('%PDF-1.7 fake').toString('base64');
		const [message] = convertToApiChatMessage([{
			role: Raw.ChatRole.User,
			content: [
				{ type: Raw.ChatCompletionContentPartKind.Text, text: 'see attached' },
				{ type: Raw.ChatCompletionContentPartKind.Document, documentData: { data: pdfBase64, mediaType: 'application/pdf' } },
			],
		}]);

		expect((message.content as (vscode.LanguageModelTextPart | vscode.LanguageModelDataPart)[]).map(part =>
			part instanceof vscode.LanguageModelDataPart
				? { mimeType: part.mimeType, data: Buffer.from(part.data).toString() }
				: { text: (part as vscode.LanguageModelTextPart).value }
		)).toEqual([
			{ text: 'see attached' },
			{ mimeType: 'application/pdf', data: '%PDF-1.7 fake' },
		]);
	});

	// https://github.com/microsoft/vscode/issues/313920: the internal cache_control sentinel
	// must only reach providers that handle it, or a naive serializer leaks it upstream.
	it('omits the internal cache_control sentinel for providers that do not handle it, keeps it for those that do', () => {
		const toolMessage: Raw.ChatMessage = {
			role: Raw.ChatRole.Tool,
			toolCallId: 'call-1',
			content: [
				{ type: Raw.ChatCompletionContentPartKind.Text, text: 'the tool output' },
				{ type: Raw.ChatCompletionContentPartKind.CacheBreakpoint, cacheType: 'ephemeral' },
			],
		};

		expect({
			defaulted: describeToolResult(convertToApiChatMessage([toolMessage])[0]),
			omitted: describeToolResult(convertToApiChatMessage([toolMessage], { emitCacheBreakpoints: false })[0]),
			emitted: describeToolResult(convertToApiChatMessage([toolMessage], { emitCacheBreakpoints: true })[0]),
		}).toEqual({
			defaulted: { text: 'the tool output', cacheControl: false },
			omitted: { text: 'the tool output', cacheControl: false },
			emitted: { text: 'the tool output', cacheControl: true },
		});
	});

	it('gates the cache_control sentinel on the model vendor end-to-end', async () => {
		const capture = async (vendor: string) => {
			let capturedMessages: readonly vscode.LanguageModelChatMessage[] | undefined;
			const languageModel = createLanguageModel(() => { }, messages => capturedMessages = messages, vendor);
			const endpoint = new ExtensionContributedChatEndpoint(
				languageModel,
				createInstantiationService(),
				new NoopOTelService(resolveOTelConfig({ env: {}, extensionVersion: '1.0.0', sessionId: 'test' })),
			);

			await endpoint.makeChatRequest2({
				debugName: 'test',
				messages: [{
					role: Raw.ChatRole.Tool,
					toolCallId: 'call-1',
					content: [
						{ type: Raw.ChatCompletionContentPartKind.Text, text: 'the tool output' },
						{ type: Raw.ChatCompletionContentPartKind.CacheBreakpoint, cacheType: 'ephemeral' },
					],
				}],
				finishedCb: undefined,
				location: ChatLocation.Agent,
				requestOptions: {},
			}, new vscode.CancellationTokenSource().token);

			return describeToolResult(capturedMessages![0]);
		};

		// `flowleap-trial` runs the OpenRouter converter, so it must keep the sentinel too.
		expect({
			anthropic: await capture('anthropic'),
			trial: await capture('flowleap-trial'),
			ollama: await capture('ollama'),
		}).toEqual({
			anthropic: { text: 'the tool output', cacheControl: true },
			trial: { text: 'the tool output', cacheControl: true },
			ollama: { text: 'the tool output', cacheControl: false },
		});
	});
});

function describeToolResult(message: vscode.LanguageModelChatMessage | vscode.LanguageModelChatMessage2): { text: string | undefined; cacheControl: boolean } {
	const toolResult = message.content[0] as vscode.LanguageModelToolResultPart2;
	const text = toolResult.content.find((part): part is vscode.LanguageModelTextPart => part instanceof vscode.LanguageModelTextPart)?.value;
	const cacheControl = toolResult.content.some(part => part instanceof vscode.LanguageModelDataPart && part.mimeType === CustomDataPartMimeTypes.CacheControl);
	return { text, cacheControl };
}

function createLanguageModel(
	captureOptions: (options: vscode.LanguageModelChatRequestOptions) => void,
	captureMessages?: (messages: readonly vscode.LanguageModelChatMessage[]) => void,
	vendor: string = 'test-vendor',
): vscode.LanguageModelChat {
	return {
		id: 'test-model',
		name: 'Test Model',
		vendor,
		family: 'test-family',
		version: '1.0.0',
		maxInputTokens: 1000,
		capabilities: {},
		sendRequest: vi.fn(async (messages, options) => {
			captureOptions(options);
			captureMessages?.(messages);
			return {
				stream: (async function* () {
					yield new vscode.LanguageModelTextPart('hello');
				})()
			};
		})
	} as unknown as vscode.LanguageModelChat;
}

function createInstantiationService(): IInstantiationService {
	return { createInstance: vi.fn() } as unknown as IInstantiationService;
}
