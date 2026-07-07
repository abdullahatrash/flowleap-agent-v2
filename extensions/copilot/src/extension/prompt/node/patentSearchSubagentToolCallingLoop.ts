/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { randomUUID } from 'crypto';
import type { CancellationToken, ChatRequest, ChatResponseStream, LanguageModelToolInformation, Progress } from 'vscode';
import { IAuthenticationChatUpgradeService } from '../../../platform/authentication/common/authenticationUpgrade';
import { IChatHookService } from '../../../platform/chat/common/chatHookService';
import { ChatLocation, ChatResponse } from '../../../platform/chat/common/commonTypes';
import { ISessionTranscriptService } from '../../../platform/chat/common/sessionTranscriptService';
import { IConfigurationService } from '../../../platform/configuration/common/configurationService';
import { IEndpointProvider } from '../../../platform/endpoint/common/endpointProvider';
import { IFileSystemService } from '../../../platform/filesystem/common/fileSystemService';
import { IGitService } from '../../../platform/git/common/gitService';
import { ILogService } from '../../../platform/log/common/logService';
import { IChatEndpoint } from '../../../platform/networking/common/networking';
import { IOTelService } from '../../../platform/otel/common/otelService';
import { IRequestLogger } from '../../../platform/requestLogger/common/requestLogger';
import { IExperimentationService } from '../../../platform/telemetry/common/nullExperimentationService';
import { ITelemetryService } from '../../../platform/telemetry/common/telemetry';
import { IInstantiationService } from '../../../util/vs/platform/instantiation/common/instantiation';
import { ChatResponseProgressPart, ChatResponseReferencePart } from '../../../vscodeTypes';
import { IToolCallingLoopOptions, ToolCallingLoop, ToolCallingLoopFetchOptions } from '../../intents/node/toolCallingLoop';
import { PatentSearchSubagentPrompt } from '../../prompts/node/agent/patentSearchSubagentPrompt';
import { PromptRenderer } from '../../prompts/node/base/promptRenderer';
import { ToolName } from '../../tools/common/toolNames';
import { IToolsService } from '../../tools/common/toolsService';
import { IBuildPromptContext } from '../common/intents';
import { IBuildPromptResult } from './intents';

export interface IPatentSearchSubagentToolCallingLoopOptions extends IToolCallingLoopOptions {
	request: ChatRequest;
	location: ChatLocation;
	promptText: string;
	maxSearchTurns: number;
}

/**
 * Tool calling loop for the patent search subagent.
 * Restricts available tools to patent search operations only.
 */
export class PatentSearchSubagentToolCallingLoop extends ToolCallingLoop<IPatentSearchSubagentToolCallingLoopOptions> {

	public static readonly ID = 'patentSearchSubagentTool';

	constructor(
		options: IPatentSearchSubagentToolCallingLoopOptions,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@ILogService logService: ILogService,
		@IRequestLogger requestLogger: IRequestLogger,
		@IEndpointProvider private readonly endpointProvider: IEndpointProvider,
		@IToolsService private readonly toolsService: IToolsService,
		@IAuthenticationChatUpgradeService authenticationChatUpgradeService: IAuthenticationChatUpgradeService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IConfigurationService configurationService: IConfigurationService,
		@IExperimentationService experimentationService: IExperimentationService,
		@IChatHookService chatHookService: IChatHookService,
		@ISessionTranscriptService sessionTranscriptService: ISessionTranscriptService,
		@IFileSystemService fileSystemService: IFileSystemService,
		@IOTelService otelService: IOTelService,
		@IGitService gitService: IGitService,
	) {
		super(options, instantiationService, endpointProvider, logService, requestLogger, authenticationChatUpgradeService, telemetryService, configurationService, experimentationService, chatHookService, sessionTranscriptService, fileSystemService, otelService, gitService);
	}

	/**
	 * Get endpoint for the subagent.
	 *
	 * BYOK-only (ADR 0004): resolve to the user's own model, which runs client-side. A
	 * configured family (`patent.searchSubagent.model`) is honored by the endpoint
	 * provider, matched against the BYO-key models; otherwise we use the request's
	 * selected model. The previous 'patent-gemini-3-flash' default pointed at the retired
	 * backend (410), and `getChatEndpoint` never throws on an unknown id, so the old
	 * try/catch fallback was dead code.
	 */
	private async getEndpoint(): Promise<IChatEndpoint> {
		const configuredModel = this._configurationService.getNonExtensionConfig<string>('patent.searchSubagent.model');
		if (configuredModel) {
			// `ChatModelFamily` accepts an arbitrary model id, so no cast is needed.
			return this.endpointProvider.getChatEndpoint(configuredModel);
		}
		return this.endpointProvider.getChatEndpoint(this.options.request);
	}

	protected override createPromptContext(availableTools: LanguageModelToolInformation[], outputStream: ChatResponseStream | undefined): IBuildPromptContext {
		const context = super.createPromptContext(availableTools, outputStream);
		if (context.tools) {
			context.tools = {
				...context.tools,
				toolReferences: [],
				subAgentInvocationId: randomUUID(),
				subAgentName: 'patent-search',
			};
		}
		context.query = this.options.promptText;
		return context;
	}

	protected async buildPrompt(buildPromptContext: IBuildPromptContext, progress: Progress<ChatResponseReferencePart | ChatResponseProgressPart>, token: CancellationToken): Promise<IBuildPromptResult> {
		const endpoint = await this.getEndpoint();
		const renderer = PromptRenderer.create(
			this.instantiationService,
			endpoint,
			PatentSearchSubagentPrompt,
			{
				promptContext: buildPromptContext,
				maxSearchTurns: this.options.maxSearchTurns
			}
		);
		return await renderer.render(progress, token);
	}

	protected async getAvailableTools(): Promise<LanguageModelToolInformation[]> {
		const endpoint = await this.getEndpoint();
		const allTools = this.toolsService.getEnabledTools(this.options.request, endpoint);

		// Only patent search tools — no editing, no terminal, no code tools. This is an allowlist
		// over the currently-enabled tools, so a name whose tool family hasn't landed yet is simply
		// inert until that family registers (e.g. ReadPdf, the API guides arrive with #12–#16).
		const allowedPatentTools = new Set([
			ToolName.SearchPatents,
			ToolName.BuildPatentQuery,
			ToolName.BuildUSPTOQuery,
			ToolName.SearchAcademic,
			ToolName.FetchWebPage,
			ToolName.ReadPdf,
			ToolName.OpsApiGuide,
			ToolName.USPTOApiGuide,
			ToolName.CitationApiGuide,
			ToolName.LegalSearchGuide,
			// Executors for the guide tools above, so every guide the subagent can read has its
			// executor available (e.g. build a USPTO query then run it via PatentApiRequest).
			ToolName.PatentApiRequest,
			ToolName.SearchCitations,
			ToolName.SearchForwardCitations,
			ToolName.SearchLegal,
			ToolName.GetPatentDetails,
		]);

		return allTools.filter(tool => allowedPatentTools.has(tool.name as ToolName));
	}

	protected async fetch({ messages, finishedCb, requestOptions }: ToolCallingLoopFetchOptions, token: CancellationToken): Promise<ChatResponse> {
		const endpoint = await this.getEndpoint();
		return endpoint.makeChatRequest2({
			debugName: PatentSearchSubagentToolCallingLoop.ID,
			messages,
			finishedCb,
			location: this.options.location,
			requestOptions: {
				...requestOptions,
				temperature: 0
			},
			userInitiatedRequest: false,
			telemetryProperties: {
				messageId: randomUUID(),
				messageSource: 'chat.editAgent',
				subType: 'subagent/patent-search'
			}
		}, token);
	}
}
