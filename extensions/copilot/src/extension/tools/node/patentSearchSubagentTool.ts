/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import type * as vscode from 'vscode';
import { ChatFetchResponseType } from '../../../platform/chat/common/commonTypes';
import { ChatResponseStreamImpl } from '../../../util/common/chatResponseStreamImpl';
import { generateUuid } from '../../../util/vs/base/common/uuid';
import { IInstantiationService } from '../../../util/vs/platform/instantiation/common/instantiation';
import { ChatResponseNotebookEditPart, ChatResponseTextEditPart, ChatToolInvocationPart, ExtendedLanguageModelToolResult, LanguageModelTextPart, MarkdownString } from '../../../vscodeTypes';
import { Conversation, Turn } from '../../prompt/common/conversation';
import { IBuildPromptContext } from '../../prompt/common/intents';
import { PatentSearchSubagentToolCallingLoop } from '../../prompt/node/patentSearchSubagentToolCallingLoop';
import { ToolName } from '../common/toolNames';
import { CopilotToolMode, ICopilotTool, ToolRegistry } from '../common/toolsRegistry';
import { updateSubagentInvocation } from './subagentToolUtils';

export interface IPatentSearchSubagentParams {
	/** Natural language description of what patents/literature to search for */
	query: string;
	/** User-visible description shown while the subagent is working */
	description: string;
	/** Detailed instructions for the search subagent's objective */
	details: string;
}

const DEFAULT_TOOL_CALL_LIMIT = 8;
const DEFAULT_MAX_SEARCH_TURNS = 6;

/** Internal subagent type, which links the trajectory to this tool call. */
const PATENT_SEARCH_AGENT_NAME = 'patent-search';
/** The readable form of that type, which titles the subagent header. */
const PATENT_SEARCH_AGENT_DISPLAY_NAME = 'Patent Search';

class PatentSearchSubagentTool implements ICopilotTool<IPatentSearchSubagentParams> {
	public static readonly toolName = ToolName.PatentSearchSubagent;
	private _inputContext: IBuildPromptContext | undefined;

	constructor(
		@IInstantiationService private readonly instantiationService: IInstantiationService,
	) { }

	async invoke(options: vscode.LanguageModelToolInvocationOptions<IPatentSearchSubagentParams>, token: vscode.CancellationToken) {
		const searchInstruction = [
			`Search for patents and academic literature related to: ${options.input.query}`,
			'',
			'Detailed instructions: ',
			`${options.input.details}`,
			'',
			'IMPORTANT: Search BOTH patent databases (EPO/USPTO) AND academic sources.',
			'Use query builder tools to construct optimized queries before searching.',
		].join('\n');

		const request = this._inputContext!.request!;
		const parentSessionId = generateUuid();
		// Use the parent tool call ID so the subagent's nested tools render under the parent's
		// header. A programmatic invocation without a streamed parent still needs an ID.
		const parentToolCallId = options.chatStreamToolCallId;
		const subAgentInvocationId = parentToolCallId ?? generateUuid();

		const loop = this.instantiationService.createInstance(PatentSearchSubagentToolCallingLoop, {
			toolCallLimit: DEFAULT_TOOL_CALL_LIMIT,
			conversation: new Conversation(parentSessionId, [new Turn(generateUuid(), { type: 'user', message: searchInstruction })]),
			request: request,
			location: request.location,
			promptText: options.input.query,
			maxSearchTurns: DEFAULT_MAX_SEARCH_TURNS,
			subAgentInvocationId,
		});

		const stream = this._inputContext?.stream && ChatResponseStreamImpl.filter(
			this._inputContext.stream,
			part => part instanceof ChatToolInvocationPart || part instanceof ChatResponseTextEditPart || part instanceof ChatResponseNotebookEditPart
		);
		const modelName = await loop.getModelName();
		updateSubagentInvocation(stream, parentToolCallId, ToolName.PatentSearchSubagent, {
			description: options.input.description,
			agentName: PATENT_SEARCH_AGENT_NAME,
			agentDisplayName: PATENT_SEARCH_AGENT_DISPLAY_NAME,
			prompt: options.input.query,
			modelName,
		});

		const loopResult = await loop.run(stream, token);

		let subagentResponse = '';
		if (loopResult.response.type === ChatFetchResponseType.Success) {
			subagentResponse = loopResult.toolCallRounds.at(-1)?.response ?? loopResult.round.response ?? '';
		} else {
			subagentResponse = `The patent search subagent request failed: ${loopResult.response.type}: ${loopResult.response.reason}`;
		}

		// Extract content from <patent_results> tags if present, otherwise use full response
		const patentResultsMatch = subagentResponse.match(/<patent_results>([\s\S]*?)<\/patent_results>/);
		const finalResponse = patentResultsMatch ? patentResultsMatch[1].trim() : subagentResponse;

		updateSubagentInvocation(stream, parentToolCallId, ToolName.PatentSearchSubagent, {
			description: options.input.description,
			agentName: PATENT_SEARCH_AGENT_NAME,
			agentDisplayName: PATENT_SEARCH_AGENT_DISPLAY_NAME,
			prompt: options.input.query,
			modelName,
			result: finalResponse,
		});

		const result = new ExtendedLanguageModelToolResult([new LanguageModelTextPart(finalResponse)]);
		result.toolMetadata = {
			query: options.input.query,
			description: options.input.description,
			// The subAgentInvocationId links this tool call to the subagent's trajectory
			subAgentInvocationId,
			agentName: PATENT_SEARCH_AGENT_NAME,
			modelName,
		};
		result.toolResultMessage = new MarkdownString(l10n.t`Patent search complete: ${options.input.description}`);
		return result;
	}

	prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<IPatentSearchSubagentParams>, _token: vscode.CancellationToken): vscode.ProviderResult<vscode.PreparedToolInvocation> {
		return {
			invocationMessage: options.input.description,
		};
	}

	async resolveInput(input: IPatentSearchSubagentParams, promptContext: IBuildPromptContext, _mode: CopilotToolMode): Promise<IPatentSearchSubagentParams> {
		this._inputContext = promptContext;
		return input;
	}
}

ToolRegistry.registerTool(PatentSearchSubagentTool);
