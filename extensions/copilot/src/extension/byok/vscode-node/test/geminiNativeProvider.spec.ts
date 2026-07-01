/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { NoopOTelService, resolveOTelConfig } from '../../../../platform/otel/common/index';
import type { CapturingToken } from '../../../../platform/requestLogger/common/capturingToken';
import type { IRequestLogger } from '../../../../platform/requestLogger/common/requestLogger';
import { NullTelemetryService } from '../../../../platform/telemetry/common/nullTelemetryService';
import type { TelemetryDestination, TelemetryEventMeasurements, TelemetryEventProperties } from '../../../../platform/telemetry/common/telemetry';
import { TestLogService } from '../../../../platform/testing/common/testLogService';
import type { IBYOKStorageService } from '../byokStorageService';

const mockHandleAPIKeyUpdate = vi.fn();
const mockNotifyByokKeyRejected = vi.fn();

vi.mock('../../../../platform/endpoint/vscode-node/byokKeyRejection', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../../../../platform/endpoint/vscode-node/byokKeyRejection')>();
	return {
		...actual,
		notifyByokKeyRejected: mockNotifyByokKeyRejected,
	};
});

vi.mock('@google/genai', () => {
	class MockGoogleGenAI {
		public static createdWithApiKeys: string[] = [];
		public static streamChunks: any[] = [];
		public static listModelsResult: AsyncIterable<any> = (async function* () { })();

		public readonly apiKey: string;
		public readonly models: {
			list: () => Promise<AsyncIterable<any>>;
			generateContentStream: (params: unknown) => Promise<AsyncIterable<any>>;
		};

		constructor(opts: { apiKey: string }) {
			this.apiKey = opts.apiKey;
			MockGoogleGenAI.createdWithApiKeys.push(opts.apiKey);
			this.models = {
				list: async () => MockGoogleGenAI.listModelsResult,
				generateContentStream: async () => (async function* () {
					for (const c of MockGoogleGenAI.streamChunks) {
						yield c;
					}
				})()
			};
		}
	}

	class MockApiError extends Error { }

	return {
		GoogleGenAI: MockGoogleGenAI,
		ApiError: MockApiError,
		Type: { OBJECT: 'object' },
	};
});

vi.mock('../../common/byokProvider', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../../common/byokProvider')>();
	return {
		...actual,
		handleAPIKeyUpdate: mockHandleAPIKeyUpdate,
	};
});

type ProgressItem = vscode.LanguageModelResponsePart2;

class TestProgress implements vscode.Progress<ProgressItem> {
	public readonly items: ProgressItem[] = [];
	report(value: ProgressItem): void {
		this.items.push(value);
	}
}

class RecordingTelemetryService extends NullTelemetryService {
	public readonly events: { eventName: string; destination: TelemetryDestination; properties?: TelemetryEventProperties; measurements?: TelemetryEventMeasurements }[] = [];

	override sendTelemetryEvent(eventName: string, destination: TelemetryDestination, properties?: TelemetryEventProperties, measurements?: TelemetryEventMeasurements): void {
		this.events.push({ eventName, destination, properties, measurements });
	}
}

function createStorageService(overrides?: Partial<IBYOKStorageService>): IBYOKStorageService {
	return {
		getAPIKey: vi.fn().mockResolvedValue(undefined),
		storeAPIKey: vi.fn().mockResolvedValue(undefined),
		deleteAPIKey: vi.fn().mockResolvedValue(undefined),
		getStoredModelConfigs: vi.fn().mockResolvedValue({}),
		saveModelConfig: vi.fn().mockResolvedValue(undefined),
		removeModelConfig: vi.fn().mockResolvedValue(undefined),
		...overrides,
	};
}

function createRequestLogger(): IRequestLogger {
	const didChangeEmitter = new vscode.EventEmitter<void>();
	return {
		_serviceBrand: undefined,
		promptRendererTracing: false,
		captureInvocation: async <T>(_request: CapturingToken, fn: () => Promise<T>) => fn(),
		logToolCall: () => undefined,
		logModelListCall: () => undefined,
		logChatRequest: () => ({
			markTimeToFirstToken: () => undefined,
			resolveWithCancelation: () => undefined,
			resolve: () => undefined,
		}),
		addPromptTrace: () => undefined,
		addEntry: () => undefined,
		onDidChangeRequests: didChangeEmitter.event,
		getRequests: () => [],
		enableWorkspaceEditTracing: () => undefined,
		disableWorkspaceEditTracing: () => undefined,
	} as unknown as IRequestLogger;
}

describe('GeminiNativeBYOKLMProvider', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('emits response.success telemetry with the forwarded turn measurement', async () => {
		const { GeminiNativeBYOKLMProvider } = await import('../geminiNativeProvider');
		const genai = await import('@google/genai');
		const MockGoogleGenAI = genai.GoogleGenAI as unknown as { streamChunks: any[] };
		MockGoogleGenAI.streamChunks.length = 0;
		MockGoogleGenAI.streamChunks.push({
			candidates: [{
				content: { parts: [{ text: 'Hello from Gemini' }] }
			}],
			usageMetadata: {
				promptTokenCount: 11,
				candidatesTokenCount: 7,
				totalTokenCount: 18,
				cachedContentTokenCount: 2
			}
		});

		const telemetry = new RecordingTelemetryService();
		const provider = new GeminiNativeBYOKLMProvider(undefined, createStorageService(), new TestLogService(), createRequestLogger(), telemetry, new NoopOTelService(resolveOTelConfig({ env: {}, extensionVersion: '1.0.0', sessionId: 'test' })));
		const model = {
			id: 'gemini-2.0-flash',
			name: 'Gemini 2.0 Flash',
			family: 'Gemini',
			version: '1.0.0',
			maxInputTokens: 1000,
			maxOutputTokens: 1000,
			capabilities: { toolCalling: false, imageInput: false },
			configuration: { apiKey: 'k_test' }
		} as any;
		const messages: vscode.LanguageModelChatMessage[] = [
			new vscode.LanguageModelChatMessage(vscode.LanguageModelChatMessageRole.User, 'hello')
		];

		const tokenSource = new vscode.CancellationTokenSource();
		try {
			await provider.provideLanguageModelChatResponse(
				model,
				messages,
				{ requestInitiator: 'test', tools: [], toolMode: vscode.LanguageModelChatToolMode.Auto, modelOptions: { _telemetryTurn: 3 } } as any,
				new TestProgress(),
				tokenSource.token
			);
		} finally {
			tokenSource.dispose();
		}

		const responseSuccessEvent = telemetry.events.find(event => event.eventName === 'response.success');
		expect(responseSuccessEvent).toBeDefined();
		expect(responseSuccessEvent?.measurements?.turn).toBe(3);
	}, 30_000);

	it.skip('throws a clear error when no API key is configured (no silent return)', async () => {
		const { GeminiNativeBYOKLMProvider } = await import('../geminiNativeProvider');
		const storage = createStorageService({ getAPIKey: vi.fn().mockResolvedValue(undefined) });
		const provider = new GeminiNativeBYOKLMProvider(undefined, storage, new TestLogService(), createRequestLogger(), new NullTelemetryService(), new NoopOTelService(resolveOTelConfig({ env: {}, extensionVersion: '1.0.0', sessionId: 'test' })));

		const model: vscode.LanguageModelChatInformation = {
			id: 'gemini-2.0-flash',
			name: 'Gemini 2.0 Flash',
			family: 'Gemini',
			version: '1.0.0',
			maxInputTokens: 1000,
			maxOutputTokens: 1000,
			capabilities: { toolCalling: false, imageInput: false }
		};
		const messages: vscode.LanguageModelChatMessage[] = [
			new vscode.LanguageModelChatMessage(vscode.LanguageModelChatMessageRole.User, 'hello')
		];

		const tokenSource = new vscode.CancellationTokenSource();
		const progress = new TestProgress();
		await expect(provider.provideLanguageModelChatResponse(
			model,
			messages,
			{ requestInitiator: 'test', tools: [], toolMode: vscode.LanguageModelChatToolMode.Auto },
			progress,
			tokenSource.token
		)).rejects.toThrow(/No API key configured/i);
	});

	// it.skip('initializes the Gemini client on API key update and can stream a response', async () => {
	// 	const { GeminiNativeBYOKLMProvider } = await import('../geminiNativeProvider');
	// 	const genai = await import('@google/genai');
	// 	const MockGoogleGenAI = genai.GoogleGenAI as unknown as { createdWithApiKeys: string[]; streamChunks: any[] };
	// 	MockGoogleGenAI.createdWithApiKeys.length = 0;
	// 	MockGoogleGenAI.streamChunks.length = 0;
	// 	MockGoogleGenAI.streamChunks.push({
	// 		candidates: [{
	// 			content: { parts: [{ text: 'Hello from Gemini' }] }
	// 		}]
	// 	});

	// 	mockHandleAPIKeyUpdate.mockResolvedValue({ apiKey: 'k_test', deleted: false, cancelled: false });

	// 	const storage = createStorageService({ getAPIKey: vi.fn().mockResolvedValue('k_test') });
	// 	const provider = new GeminiNativeBYOKLMProvider(undefined, storage, new TestLogService(), createRequestLogger());

	// 	await provider.updateAPIKey();
	// 	expect(MockGoogleGenAI.createdWithApiKeys).toEqual(['k_test']);

	// 	const model: vscode.LanguageModelChatInformation = {
	// 		id: 'gemini-2.0-flash',
	// 		name: 'Gemini 2.0 Flash',
	// 		family: 'Gemini',
	// 		version: '1.0.0',
	// 		maxInputTokens: 1000,
	// 		maxOutputTokens: 1000,
	// 		capabilities: { toolCalling: false, imageInput: false }
	// 	};
	// 	const messages: vscode.LanguageModelChatMessage[] = [
	// 		new vscode.LanguageModelChatMessage(vscode.LanguageModelChatMessageRole.User, 'hello')
	// 	];

	// 	const tokenSource = new vscode.CancellationTokenSource();
	// 	const progress = new TestProgress();
	// 	await provider.provideLanguageModelChatResponse(
	// 		model,
	// 		messages,
	// 		{ requestInitiator: 'test', tools: [], toolMode: vscode.LanguageModelChatToolMode.Auto },
	// 		progress,
	// 		tokenSource.token
	// 	);

	// 	expect(progress.items.some(p => p instanceof vscode.LanguageModelTextPart && p.value.includes('Hello from Gemini'))).toBe(true);
	// });

	// it.skip('clears the client when API key is deleted via update flow', async () => {
	// 	const { GeminiNativeBYOKLMProvider } = await import('../geminiNativeProvider');
	// 	const genai = await import('@google/genai');
	// 	const MockGoogleGenAI = genai.GoogleGenAI as unknown as { createdWithApiKeys: string[]; streamChunks: any[] };
	// 	MockGoogleGenAI.createdWithApiKeys.length = 0;
	// 	MockGoogleGenAI.streamChunks.length = 0;

	// 	const storage = createStorageService({ getAPIKey: vi.fn().mockResolvedValue(undefined) });
	// 	const provider = new GeminiNativeBYOKLMProvider(undefined, storage, new TestLogService(), createRequestLogger());

	// 	// First set a key
	// 	mockHandleAPIKeyUpdate.mockResolvedValueOnce({ apiKey: 'k_initial', deleted: false, cancelled: false });
	// 	await provider.updateAPIKey();
	// 	expect(MockGoogleGenAI.createdWithApiKeys).toEqual(['k_initial']);

	// 	// Then delete it
	// 	mockHandleAPIKeyUpdate.mockResolvedValueOnce({ apiKey: undefined, deleted: true, cancelled: false });
	// 	await provider.updateAPIKey();

	// 	const model: vscode.LanguageModelChatInformation = {
	// 		id: 'gemini-2.0-flash',
	// 		name: 'Gemini 2.0 Flash',
	// 		family: 'Gemini',
	// 		version: '1.0.0',
	// 		maxInputTokens: 1000,
	// 		maxOutputTokens: 1000,
	// 		capabilities: { toolCalling: false, imageInput: false }
	// 	};
	// 	const messages: vscode.LanguageModelChatMessage[] = [
	// 		new vscode.LanguageModelChatMessage(vscode.LanguageModelChatMessageRole.User, 'hello')
	// 	];

	// 	const tokenSource = new vscode.CancellationTokenSource();
	// 	const progress = new TestProgress();
	// 	await expect(provider.provideLanguageModelChatResponse(
	// 		model,
	// 		messages,
	// 		{ requestInitiator: 'test', tools: [], toolMode: vscode.LanguageModelChatToolMode.Auto },
	// 		progress,
	// 		tokenSource.token
	// 	)).rejects.toThrow(/No API key configured/i);
	// });

	// Replaces the pre-configuration-API skipped tests ("prompts for a new API key…" /
	// "retries listing…"): the key now arrives via configuration.apiKey and the re-prompt is
	// core's Manage Models flow, so the provider's contract on an invalid key is: notify the
	// user (visibly flagged, not silently absent from the picker) and rethrow for core's
	// per-group error row.
	it('flags a rejected API key during model listing and rethrows for core', async () => {
		const { GeminiNativeBYOKLMProvider } = await import('../geminiNativeProvider');
		const genai = await import('@google/genai');
		const MockGoogleGenAI = genai.GoogleGenAI as unknown as { listModelsResult: AsyncIterable<any> };
		// Simulate the models.list() call throwing an invalid API key error when iterated
		MockGoogleGenAI.listModelsResult = (async function* () {
			throw new Error('ApiError: {"error":{"message":"API key not valid. Please pass a valid API key.","details":[{"reason":"API_KEY_INVALID"}]}}');
		})();

		const provider = new GeminiNativeBYOKLMProvider(undefined, createStorageService(), new TestLogService(), createRequestLogger(), new NullTelemetryService(), new NoopOTelService(resolveOTelConfig({ env: {}, extensionVersion: '1.0.0', sessionId: 'test' })));
		const tokenSource = new vscode.CancellationTokenSource();

		await expect(provider.provideLanguageModelChatInformation(
			{ silent: true, configuration: { apiKey: 'bad_key' } } as Parameters<typeof provider.provideLanguageModelChatInformation>[0],
			tokenSource.token
		)).rejects.toThrow(/API key not valid/i);
		expect(mockNotifyByokKeyRejected).toHaveBeenCalledWith('Gemini');
	});
});
