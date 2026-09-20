/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import { expect, suite, test } from 'vitest';
import { ChatFetchResponseType } from '../../../../platform/chat/common/commonTypes';
import { ChatResponseStreamImpl } from '../../../../util/common/chatResponseStreamImpl';
import { ChatSubagentToolInvocationData, ChatToolInvocationPart, LanguageModelTextPart } from '../../../../vscodeTypes';
import { IBuildPromptContext } from '../../../prompt/common/intents';
import { ToolName } from '../../common/toolNames';
import { CopilotToolMode, ToolRegistry } from '../../common/toolsRegistry';

// Ensure side-effect registration
import '../patentSearchSubagentTool';

function createTool() {
	const toolCtor = ToolRegistry.getTools().find(t => t.toolName === ToolName.PatentSearchSubagent)!;
	let loopOptions: { subAgentInvocationId?: string } | undefined;
	const loop = {
		getModelName: async () => 'Patent Model',
		run: async () => ({
			response: { type: ChatFetchResponseType.Success },
			toolCallRounds: [],
			round: { response: '<patent_results>EP1234567 A1</patent_results>' },
		}),
	};
	const instantiationService = {
		createInstance(_ctor: unknown, options: { subAgentInvocationId?: string }) {
			loopOptions = options;
			return loop;
		},
	};
	const tool = new (toolCtor as any)(instantiationService);
	return { tool, getLoopOptions: () => loopOptions };
}

suite('PatentSearchSubagentTool', () => {
	test('groups nested tools and metadata updates under the parent tool call', async () => {
		const { tool, getLoopOptions } = createTool();
		const input = { query: 'solid state battery separator', description: 'Search for prior art', details: 'Search EPO and USPTO' };
		const pushedParts: ChatToolInvocationPart[] = [];
		const stream = new ChatResponseStreamImpl(part => {
			if (part instanceof ChatToolInvocationPart) {
				pushedParts.push(part);
			}
		}, () => { });
		await tool.resolveInput(input, {
			request: { id: 'request-id', sessionId: 'session-id', location: 1 },
			stream,
			requestId: 'top-level-turn-id',
		} as unknown as IBuildPromptContext, CopilotToolMode.FullContext);

		const result = await tool.invoke({
			input,
			chatStreamToolCallId: 'parent-tool-call-id',
		} as vscode.LanguageModelToolInvocationOptions<typeof input>, undefined!);
		const responseText = result.content.find((part: unknown): part is LanguageModelTextPart => part instanceof LanguageModelTextPart)?.value;
		const updates = pushedParts.map(part => part.toolSpecificData as ChatSubagentToolInvocationData);

		expect({
			loopSubAgentInvocationId: getLoopOptions()?.subAgentInvocationId,
			updateToolCallIds: pushedParts.map(part => part.toolCallId),
			partialUpdates: pushedParts.every(part => part.enablePartialUpdate && part.isComplete === false),
			agentNames: updates.map(data => data.agentName),
			displayNames: updates.map(data => data.agentDisplayName),
			modelNames: updates.map(data => data.modelName),
			results: updates.map(data => data.result),
			metadataSubAgentInvocationId: (result.toolMetadata as { subAgentInvocationId?: string }).subAgentInvocationId,
			responseText,
		}).toEqual({
			loopSubAgentInvocationId: 'parent-tool-call-id',
			updateToolCallIds: ['parent-tool-call-id', 'parent-tool-call-id'],
			partialUpdates: true,
			agentNames: ['patent-search', 'patent-search'],
			displayNames: ['Patent Search', 'Patent Search'],
			modelNames: ['Patent Model', 'Patent Model'],
			results: [undefined, 'EP1234567 A1'],
			metadataSubAgentInvocationId: 'parent-tool-call-id',
			responseText: 'EP1234567 A1',
		});
	});
});
