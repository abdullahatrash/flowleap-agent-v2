/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


import { Raw } from '@vscode/prompt-tsx';
import * as vscode from 'vscode';
import { IAuthenticationService } from '../../../platform/authentication/common/authentication';
import { CopilotToken } from '../../../platform/authentication/common/copilotToken';
import { IBlockedExtensionService } from '../../../platform/chat/common/blockedExtensionService';
import { ChatFetchResponseType, ChatLocation, getErrorDetailsFromChatFetchError } from '../../../platform/chat/common/commonTypes';
import { getTextPart } from '../../../platform/chat/common/globalStringUtils';
import { EmbeddingType, getWellKnownEmbeddingTypeInfo, IEmbeddingsComputer } from '../../../platform/embeddings/common/embeddingsComputer';
import { CustomDataPartMimeTypes } from '../../../platform/endpoint/common/endpointTypes';
import { encodeStatefulMarker } from '../../../platform/endpoint/common/statefulMarkerContainer';
import { IEnvService, isScenarioAutomation } from '../../../platform/env/common/envService';
import { IVSCodeExtensionContext } from '../../../platform/extContext/common/extensionContext';
import { IOctoKitService } from '../../../platform/github/common/githubService';
import { ILogService } from '../../../platform/log/common/logService';
import { FinishedCallback, OpenAiFunctionTool, OptionalChatRequestParams } from '../../../platform/networking/common/fetch';
import { IChatEndpoint, IEndpoint } from '../../../platform/networking/common/networking';
import { APIUsage } from '../../../platform/networking/common/openai';
import { IOTelService, type OTelModelOptions } from '../../../platform/otel/common/otelService';
import { retrieveCapturingTokenByCorrelation, runWithCapturingToken } from '../../../platform/requestLogger/node/requestLogger';
import { ITelemetryService } from '../../../platform/telemetry/common/telemetry';
import { isEncryptedThinkingDelta } from '../../../platform/thinking/common/thinking';
import { BaseTokensPerCompletion } from '../../../platform/tokenizer/node/tokenizer';
import { TelemetryCorrelationId } from '../../../util/common/telemetryCorrelationId';
import { Disposable, MutableDisposable } from '../../../util/vs/base/common/lifecycle';
import { isBoolean, isDefined, isNumber, isString, isStringArray } from '../../../util/vs/base/common/types';
import { IInstantiationService } from '../../../util/vs/platform/instantiation/common/instantiation';
import { ExtensionMode } from '../../../vscodeTypes';
import type { LMResponsePart } from '../../byok/common/byokProvider';
import { IExtensionContribution } from '../../common/contributions';
import { PromptRenderer } from '../../prompts/node/base/promptRenderer';
import { isImageDataPart } from '../common/languageModelChatMessageHelpers';
import { LanguageModelAccessPrompt } from './languageModelAccessPrompt';

export class LanguageModelAccess extends Disposable implements IExtensionContribution {

	readonly id = 'languageModelAccess';

	readonly activationBlocker?: Promise<void>;

	constructor(
		@ILogService private readonly _logService: ILogService,
		@IAuthenticationService private readonly _authenticationService: IAuthenticationService,
		@IEmbeddingsComputer private readonly _embeddingsComputer: IEmbeddingsComputer,
		@IVSCodeExtensionContext private readonly _vsCodeExtensionContext: IVSCodeExtensionContext,
	) {
		super();

		if (this._vsCodeExtensionContext.extensionMode === ExtensionMode.Test && !isScenarioAutomation) {
			this._logService.warn('[LanguageModelAccess] LanguageModels and Embeddings are NOT AVAILABLE in test mode.');
			return;
		}

		// initial
		this.activationBlocker = Promise.all([
			this._registerChatProvider(),
			this._registerEmbeddings(),
		]).then(() => { });
	}

	override dispose(): void {
		super.dispose();
	}

	private async _registerChatProvider(): Promise<void> {
		// BYOK build: intentionally DO NOT register a `copilot`-vendor language-model provider.
		//
		// VS Code's `vscode.lm` selection path dispatches a chat turn straight to the provider
		// registered for the selected model's vendor. With a `copilot` provider registered, a
		// remembered or default `copilot`-vendor model bypasses PatentAIEndpointProvider and hits
		// CAPI — disabled in #8 — producing "Missing Authentication header". Inference here is
		// BYOK-only, so no `copilot`-vendor model may be reachable for a chat turn; the user's BYOK
		// providers register themselves (see byokContribution). This class's model-publishing path
		// is gated behind a Copilot token that never arrives in this build, so it stays inert.
		//
		// Do NOT re-register this provider. See docs/adr/0004-byok-inference-routing.md.
		return;
	}

	private async _registerEmbeddings(): Promise<void> {

		const dispo = this._register(new MutableDisposable());


		const update = async () => {

			if (!await this._getToken()) {
				dispo.clear();
				return;
			}

			const embeddingsComputer = this._embeddingsComputer;
			const embeddingType = EmbeddingType.text3small_512;
			const model = getWellKnownEmbeddingTypeInfo(embeddingType)?.model;
			if (!model) {
				throw new Error(`No model found for embedding type ${embeddingType.id}`);
			}

			dispo.clear();
			dispo.value = vscode.lm.registerEmbeddingsProvider(`copilot.${model}`, new class implements vscode.EmbeddingsProvider {
				async provideEmbeddings(input: string[], token: vscode.CancellationToken): Promise<vscode.Embedding[]> {
					const result = await embeddingsComputer.computeEmbeddings(embeddingType, input, {}, new TelemetryCorrelationId('EmbeddingsProvider::provideEmbeddings'), token);
					return result.values.map(embedding => ({ values: embedding.value.slice(0) }));
				}
			});
		};

		this._register(this._authenticationService.onDidAuthenticationChange(() => update()));
		await update();
	}

	private async _getToken(): Promise<CopilotToken | undefined> {
		if (!this._authenticationService.hasCopilotTokenSource) {
			this._logService.warn('[LanguageModelAccess] LanguageModel/Embeddings are not available without a Copilot token source');
			return undefined;
		}

		try {
			const copilotToken = await this._authenticationService.getCopilotToken();
			return copilotToken;
		} catch (e) {
			this._logService.warn('[LanguageModelAccess] LanguageModel/Embeddings are not available without auth token');
			this._logService.error(e);
			return undefined;
		}
	}
}

/**
 * Exported for test
 */
export class CopilotLanguageModelWrapper extends Disposable {

	constructor(
		@ITelemetryService private readonly _telemetryService: ITelemetryService,
		@IBlockedExtensionService private readonly _blockedExtensionService: IBlockedExtensionService,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@ILogService private readonly _logService: ILogService,
		@IAuthenticationService private readonly _authenticationService: IAuthenticationService,
		@IEnvService private readonly _envService: IEnvService,
		@IOTelService private readonly _otelService: IOTelService,
		@IOctoKitService private readonly _octoKitService: IOctoKitService,
	) {
		super();
	}

	private async _provideLanguageModelResponse(_endpoint: IChatEndpoint, _messages: Array<vscode.LanguageModelChatMessage | vscode.LanguageModelChatMessage2>, _options: vscode.ProvideLanguageModelChatResponseOptions, extensionId: string | undefined, callback: FinishedCallback, token: vscode.CancellationToken): Promise<APIUsage | undefined> {
		if (extensionId === 'core') {
			extensionId = undefined;
		}

		const extensionInfo = !extensionId ? { packageJSON: { version: this._envService.vscodeVersion } } : vscode.extensions.getExtension(extensionId, true);
		if (!extensionInfo || typeof extensionInfo.packageJSON.version !== 'string') {
			throw new Error('Invalid extension information');
		}
		const extensionVersion = <string>extensionInfo.packageJSON.version;

		const blockedExtensionMessage = vscode.l10n.t('The extension has been temporarily blocked due to making too many requests. Please try again later.');
		if (extensionId && this._blockedExtensionService.isExtensionBlocked(extensionId)) {
			throw vscode.LanguageModelError.Blocked(blockedExtensionMessage);
		}

		const toolTokenCount = _options.tools ? await this.countToolTokens(_endpoint, _options.tools) : 0;
		const baseCount = await PromptRenderer.create(this._instantiationService, _endpoint, LanguageModelAccessPrompt, { noSafety: false, messages: [] }).countTokens();
		const tokenLimit = _endpoint.modelMaxPromptTokens - baseCount - BaseTokensPerCompletion - toolTokenCount;

		this.validateRequest(_messages);
		if (_options.tools) {
			this.validateTools(_options.tools);
		}
		// Add safety rules to the prompt if it originates from outside the Copilot Chat extension, otherwise they already exist in the prompt.
		const { messages, tokenCount } = await PromptRenderer.create(this._instantiationService, {
			..._endpoint,
			modelMaxPromptTokens: tokenLimit
		}, LanguageModelAccessPrompt, { noSafety: extensionId === this._envService.extensionId, messages: _messages }).render();

		/* __GDPR__
			"languagemodelrequest" : {
				"owner": "jrieken",
				"comment": "Data about extensions using the language model",
				"model": { "classification": "SystemMetaData", "purpose": "FeatureInsight", "comment": "The model that is being used" },
				"extensionId": { "classification": "SystemMetaData", "purpose": "FeatureInsight", "comment": "The extension identifier for which we make the request" },
				"extensionVersion": { "classification": "SystemMetaData", "purpose": "FeatureInsight", "comment": "The extension version for which we make the request" },
				"tokenCount": { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true, "comment": "The number of tokens" },
				"tokenLimit": { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true, "comment": "The number of tokens that can be used" }
			}
		*/
		this._telemetryService.sendMSFTTelemetryEvent(
			'languagemodelrequest',
			{
				extensionId,
				extensionVersion,
				model: _endpoint.model
			},
			{
				tokenCount,
				tokenLimit
			}
		);

		// If no messages they got rendered out due to token limit
		if (messages.length === 0 || tokenCount > tokenLimit) {
			throw new Error('Message exceeds token limit.');
		}

		if (_options.tools && _options.tools.length > 128 && !_endpoint.supportsToolSearch) {
			throw new Error('Cannot have more than 128 tools per request.');
		}

		const endpoint: IChatEndpoint = new Proxy(_endpoint, {
			get: function (target, prop, receiver) {
				if (prop === 'getExtraHeaders') {
					return function () {
						const extraHeaders = target.getExtraHeaders?.() ?? {};
						if (!extensionId) {
							return extraHeaders;
						}
						return {
							...extraHeaders,
							'x-onbehalf-extension-id': `${extensionId}/${extensionVersion}`,
						};
					};
				}
				if (prop === 'acquireTokenizer') {
					return target.acquireTokenizer.bind(target);
				}
				return Reflect.get(target, prop, receiver);
			}
		});


		const options: OptionalChatRequestParams = LanguageModelOptions.Default.convert(_options.modelOptions ?? {});
		const telemetryProperties = { messageSource: `api.${extensionId}` };

		options.tools = _options.tools?.map((tool): OpenAiFunctionTool => {
			return {
				type: 'function',
				function: {
					name: tool.name,
					description: tool.description,
					parameters: tool.inputSchema && Object.keys(tool.inputSchema).length ? tool.inputSchema : undefined
				}
			};
		});
		if (_options.toolMode === vscode.LanguageModelChatToolMode.Required && _options.tools?.length && _options.tools.length > 1) {
			throw new Error('LanguageModelChatToolMode.Required is not supported with more than one tool');
		}

		options.tool_choice = _options.toolMode === vscode.LanguageModelChatToolMode.Required && _options.tools?.length ?
			{ type: 'function', function: { name: _options.tools[0].name } } :
			undefined;

		// Restore CapturingToken context if correlation ID was passed through modelOptions.
		// This handles BYOK providers where the original AsyncLocalStorage context was lost
		// when crossing the VS Code IPC boundary.
		const correlationId = (_options as { modelOptions?: OTelModelOptions }).modelOptions?._capturingTokenCorrelationId;
		const capturingToken = correlationId ? retrieveCapturingTokenByCorrelation(correlationId) : undefined;

		// Restore OTel trace context if passed through modelOptions.
		// This links the wrapper's chat span back to the original invoke_agent trace.
		const parentTraceContext = (_options as { modelOptions?: OTelModelOptions }).modelOptions?._otelTraceContext ?? undefined;

		const makeRequest = () => endpoint.makeChatRequest2({
			debugName: 'copilotLanguageModelWrapper',
			messages,
			finishedCb: callback,
			location: ChatLocation.Other,
			source: { extensionId },
			requestOptions: options,
			userInitiatedRequest: !!extensionId,
			telemetryProperties,
			modelCapabilities: {
				reasoningEffort: typeof _options.modelConfiguration?.reasoningEffort === 'string' ? _options.modelConfiguration.reasoningEffort : undefined,
			},
		}, token);

		// Run request within the parent OTel context (no extra span) so chat spans in chatMLFetcher inherit the agent trace
		const wrappedRequest = parentTraceContext
			? () => this._otelService.runWithTraceContext(parentTraceContext, async () => {
				return capturingToken
					? await runWithCapturingToken(capturingToken, makeRequest)
					: await makeRequest();
			})
			: () => capturingToken
				? runWithCapturingToken(capturingToken, makeRequest)
				: makeRequest();

		const result = await wrappedRequest();

		if (result.type !== ChatFetchResponseType.Success) {
			if (result.type === ChatFetchResponseType.ExtensionBlocked) {
				if (extensionId) {
					this._blockedExtensionService.reportBlockedExtension(extensionId, result.retryAfter);
				}

				throw vscode.LanguageModelError.Blocked(blockedExtensionMessage);
			} else if (result.type === ChatFetchResponseType.QuotaExceeded) {
				const outageStatus = await this._octoKitService.getGitHubOutageStatus();
				const details = getErrorDetailsFromChatFetchError(result, this._authenticationService.copilotToken?.copilotPlan, outageStatus, this._authenticationService.copilotToken?.tokenBasedBilling, this._authenticationService.copilotToken?.quotaInfo.quota_reset_date);
				const err = new vscode.LanguageModelError(details.message);
				err.name = 'ChatQuotaExceeded';
				throw err;
			} else if (result.type === ChatFetchResponseType.RateLimited) {
				const err = new Error(result.reason);
				err.name = 'ChatRateLimited';
				throw err;
			}

			throw new Error(result.reason);
		}

		this._telemetryService.sendInternalMSFTTelemetryEvent(
			'languagemodelrequest',
			{
				extensionId,
				extensionVersion,
				requestid: result.requestId,
				query: getTextPart(messages[messages.length - 1].content),
				model: _endpoint.model
			},
			{
				tokenCount,
				tokenLimit
			}
		);

		return result.usage;
	}

	async provideLanguageModelResponse(endpoint: IChatEndpoint, messages: Array<vscode.LanguageModelChatMessage | vscode.LanguageModelChatMessage2>, options: vscode.ProvideLanguageModelChatResponseOptions, extensionId: string | undefined, progress: vscode.Progress<LMResponsePart>, token: vscode.CancellationToken): Promise<void> {
		let thinkingActive = false;
		const finishCallback: FinishedCallback = async (_text, index, delta): Promise<undefined> => {
			if (delta.thinking) {
				// Show thinking progress for unencrypted thinking deltas
				if (!isEncryptedThinkingDelta(delta.thinking)) {
					const text = delta.thinking.text ?? '';
					progress.report(new vscode.LanguageModelThinkingPart(text, delta.thinking.id, delta.thinking.metadata));
					thinkingActive = true;
				}
			} else if (thinkingActive) {
				progress.report(new vscode.LanguageModelThinkingPart('', '', { vscode_reasoning_done: true }));
				thinkingActive = false;
			}
			if (delta.text) {
				progress.report(new vscode.LanguageModelTextPart(delta.text));
			}
			if (delta.copilotToolCalls) {
				for (const call of delta.copilotToolCalls) {
					// Anthropic models send "" (empty string) for tools with no parameters.
					let parameters: object;
					try {
						parameters = JSON.parse(call.arguments || '{}');
					} catch (err) {
						// The model can stream malformed JSON for tool arguments. Log it for
						// diagnostics and fall back to empty parameters so the tool call is still
						// surfaced to the extension (matching other tool-call consumers) instead of
						// leaking an unhandled rejection out of this fire-and-forget callback.
						this._logService.error(err, `Got invalid JSON for tool call: ${call.arguments}`);
						parameters = {};
					}
					progress.report(new vscode.LanguageModelToolCallPart(call.id, call.name, parameters));
				}
			}

			if (delta.statefulMarker) {
				progress.report(
					new vscode.LanguageModelDataPart(encodeStatefulMarker(endpoint.model, delta.statefulMarker), CustomDataPartMimeTypes.StatefulMarker)
				);
			}

			return undefined;
		};
		const usage = await this._provideLanguageModelResponse(endpoint, messages, options, extensionId, finishCallback, token);
		if (usage) {
			progress.report(new vscode.LanguageModelDataPart(new TextEncoder().encode(JSON.stringify(usage)), CustomDataPartMimeTypes.Usage));
		}
	}

	async provideTokenCount(endpoint: IEndpoint, message: string | vscode.LanguageModelChatMessage | vscode.LanguageModelChatMessage2): Promise<number> {
		if (typeof message === 'string') {
			return endpoint.acquireTokenizer().tokenLength(message);
		} else {
			let raw: Raw.ChatMessage;

			const content = message.content.map((part): Raw.ChatCompletionContentPart | undefined => {
				if (part instanceof vscode.LanguageModelTextPart) {
					return { type: Raw.ChatCompletionContentPartKind.Text, text: part.value };
				} else if (part instanceof vscode.LanguageModelDataPart && part.mimeType === 'application/pdf') {
					return { type: Raw.ChatCompletionContentPartKind.Document, documentData: { data: Buffer.from(part.data).toString('base64'), mediaType: part.mimeType } };
				} else if (isImageDataPart(part)) {
					return { type: Raw.ChatCompletionContentPartKind.Image, imageUrl: { url: `data:${part.mimeType};base64,${Buffer.from(part.data).toString('base64url')}` } };
				} else {
					return undefined;
				}
			}).filter(isDefined);
			switch (message.role) {
				case vscode.LanguageModelChatMessageRole.User:
					raw = { role: Raw.ChatRole.User, content, name: message.name };
					break;
				case vscode.LanguageModelChatMessageRole.System:
					raw = { role: Raw.ChatRole.Assistant, content, name: message.name };
					break;
				case vscode.LanguageModelChatMessageRole.Assistant:
					raw = {
						role: Raw.ChatRole.Assistant,
						content,
						name: message.name,
						toolCalls: message.content
							.filter(part => part instanceof vscode.LanguageModelToolCallPart)
							.map(part => part as vscode.LanguageModelToolCallPart)
							.map(part => ({ function: { name: part.name, arguments: JSON.stringify(part.input) }, id: part.callId, type: 'function' })),
					};
					break;
				default:
					return 0;
			}

			return endpoint.acquireTokenizer().countMessageTokens(raw);
		}
	}

	private validateTools(tools: readonly vscode.LanguageModelChatTool[]): void {
		for (const tool of tools) {
			if (!tool.name.match(/^[\w-]+$/)) {
				throw new Error(`Invalid tool name "${tool.name}": only alphanumeric characters, hyphens, and underscores are allowed.`);
			}
		}
	}

	private async countToolTokens(endpoint: IChatEndpoint, tools: readonly vscode.LanguageModelChatTool[]): Promise<number> {
		return await endpoint.acquireTokenizer().countToolTokens(tools);
	}

	private validateRequest(_messages: Array<vscode.LanguageModelChatMessage | vscode.LanguageModelChatMessage2>): void {
		const lastMessage = _messages.at(-1);
		if (!lastMessage) {
			throw new Error('Invalid request: no messages.');
		}

		_messages.forEach((message, i) => {
			if (message.role === vscode.LanguageModelChatMessageRole.Assistant) {
				// Filter out DataPart since it does not share the same value type and does not have callId, function, etc.
				const filteredContent = message.content.filter(part => part instanceof vscode.LanguageModelDataPart);
				const toolCallIds = new Set(filteredContent
					.filter(part => part instanceof vscode.LanguageModelToolCallPart)
					.map(part => part.callId));
				let nextMessageIdx = i + 1;
				const errMsg = 'Invalid request: Tool call part must be followed by a User message with a LanguageModelToolResultPart with a matching callId.';
				while (toolCallIds.size > 0) {
					const nextMessage = _messages.at(nextMessageIdx++);
					if (!nextMessage || nextMessage.role !== vscode.LanguageModelChatMessageRole.User) {
						throw new Error(errMsg);
					}

					nextMessage.content.forEach(part => {
						if (!(part instanceof vscode.LanguageModelToolResultPart2 || part instanceof vscode.LanguageModelToolResultPart)) {
							throw new Error(errMsg);
						}

						toolCallIds.delete(part.callId);
					});
				}
			}
		});
	}
}


function or(...checks: ((value: unknown) => boolean)[]): (value: unknown) => boolean {
	return (value) => checks.some(check => check(value));
}

class LanguageModelOptions {

	private static _defaultDesc: Record<string, (value: unknown) => boolean> = {
		stop: or(isStringArray, isString),
		temperature: isNumber,
		max_tokens: isNumber,
		frequency_penalty: isNumber,
		presence_penalty: isNumber,
	};

	static Default = new LanguageModelOptions({ ...this._defaultDesc });

	constructor(private _description: Record<string, (value: unknown) => boolean>) { }

	convert(options: { [name: string]: unknown }): Record<string, number | boolean | string> {
		const result: Record<string, number | boolean | string> = {};
		for (const key in this._description) {
			const isValid = this._description[key];
			const value = options[key];
			if (value !== null && value !== undefined && isValid(value)) {
				// Type guards ensure we only add values of the correct type
				if (isNumber(value) || isBoolean(value) || isString(value)) {
					result[key] = value;
				}
			}
		}
		return result;
	}
}
