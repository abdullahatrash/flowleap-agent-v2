/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { readFileSync } from 'fs';
import { Raw } from '@vscode/prompt-tsx';
import type { ChatRequest, LanguageModelToolInformation } from 'vscode';
import { ChatLocation } from '../../../../../platform/chat/common/commonTypes';
import { ConfigKey, IConfigurationService } from '../../../../../platform/configuration/common/configurationService';
import { MockEndpoint } from '../../../../../platform/endpoint/test/node/mockEndpoint';
import { messageToMarkdown } from '../../../../../platform/log/common/messageStringify';
import { URI } from '../../../../../util/vs/base/common/uri';
import { IInstantiationService } from '../../../../../util/vs/platform/instantiation/common/instantiation';
import { LanguageModelTextPart, LanguageModelToolResult } from '../../../../../vscodeTypes';
import { IPatentExecutionLedger, PatentExecutionSnapshot } from '../../../../patentai/vscode-node/patentExecutionLedger';
import { ChatVariablesCollection } from '../../../../prompt/common/chatVariablesCollection';
import { Conversation, Turn } from '../../../../prompt/common/conversation';
import { ToolCallRound } from '../../../../prompt/common/toolCallRound';
import { IChatDiskSessionResources, FileTree } from '../../../common/chatDiskSessionResources';
import { createExtensionUnitTestingServices } from '../../../../test/node/services';
import { ToolName } from '../../../../tools/common/toolNames';
import { PromptRenderer } from '../../base/promptRenderer';
import { AgentPrompt } from '../agentPrompt';
import { PromptRegistry } from '../promptRegistry';

// Public text from the actual oversized result. Both replay surfaces use this same
// captured source, so a model never sees inconsistent offload and local-lookup data.
const fixture: { publicationNumber: string; claims: { number: string; text: string }[]; description: string } = JSON.parse(readFileSync(new URL('./fixtures/patentToolRouting.json', import.meta.url), 'utf8'));
export const claim8 = fixture.claims.find(claim => claim.number === '8')!.text;
export const fixtureSnapshot: PatentExecutionSnapshot = { limitation: 'Captured returned text only; no live patent search or completeness certification.', executions: [{ id: 'fixture-detail', recordedAt: '2026-09-10', kind: 'details', status: 'succeeded', publicationIds: [fixture.publicationNumber], publicationDate: '2000-03-08', publicationTitle: 'Dental restorative composition', sources: [
	{ anchor: 'EP0983762A1:claims:en', reference: { publicationNumber: fixture.publicationNumber, section: 'claims' }, language: 'en', text: fixture.claims.map(claim => claim.text).join('\n\n'), retrieval: 'returned', review: 'unknown', completeness: 'unknown' },
	...fixture.claims.map(claim => ({ anchor: `EP0983762A1:claims:${claim.number}:en`, reference: { publicationNumber: fixture.publicationNumber, section: 'claims' as const, claimNumber: claim.number }, language: 'en', text: claim.text, retrieval: 'returned' as const, review: 'unknown' as const, completeness: 'unknown' as const })),
	{ anchor: 'EP0983762A1:description:en', reference: { publicationNumber: fixture.publicationNumber, section: 'description' }, language: 'en', text: fixture.description, retrieval: 'returned', review: 'unknown', completeness: 'unknown' },
] }] };
export const details = 'Evidence recovery: call get_patent_details with this publicationNumber and evidenceLookup: {} for the local anchor index.\n\n# EP0983762A1\n' + fixture.claims.map(claim => `[Claim ${claim.number}] [source anchor: EP0983762A1:claims:${claim.number}:en]\n${claim.text}`).join('\n\n') + '\n\nDescription [source anchor: EP0983762A1:description:en]\n' + fixture.description;

export async function assemble(family: string, toolName = ToolName.GetPatentDetails, content = details, patentTools = true, omitBase = false, toolArguments = JSON.stringify({ publicationNumber: 'EP0983762A1' }), replay?: { query: string; rounds: ToolCallRound[]; results: Record<string, LanguageModelToolResult>; tools: LanguageModelToolInformation[] }) {
	const services = createExtensionUnitTestingServices();
	const saved: (string | FileTree)[] = [];
	services.define(IPatentExecutionLedger, { _serviceBrand: undefined, record: async () => 'Recorded', read: async () => ({ executions: [], limitation: 'Synthetic prompt fixture.' }) });
	services.define(IChatDiskSessionResources, {
		_serviceBrand: undefined,
		async ensure(_session, _call, files) { saved.push(files); return URI.file('/session/tool-output'); },
		isSessionResourceUri: () => true,
	});
	const accessor = services.createTestingAccessor();
	try {
		const config = accessor.get(IConfigurationService);
		await config.setConfig(ConfigKey.Advanced.LargeToolResultsToDiskEnabled, true);
		await config.setConfig(ConfigKey.Advanced.LargeToolResultsToDiskThreshold, 8000);
		await config.setConfig(ConfigKey.Advanced.OmitBaseAgentInstructions, omitBase);
		const instantiation = accessor.get(IInstantiationService);
		const endpoint = instantiation.createInstance(MockEndpoint, family);
		const customizations = await PromptRegistry.resolveAllCustomizations(instantiation, endpoint);
		const request = { prompt: replay?.query ?? 'Review prior art and save a report. Preserve essentially free and dependent claim scope.', references: [], toolReferences: [], tools: new Map(), id: 'request', sessionId: 'session', hasHooksEnabled: false } as Partial<ChatRequest>;
		const names = [ToolName.ReadFile, ToolName.CoreRunInTerminal, ToolName.CreateFile, ...(patentTools ? [ToolName.SearchPatents, ToolName.GetPatentDetails, ToolName.WritePatentResults] : [])];
		const result = await PromptRenderer.create(instantiation, endpoint, AgentPrompt, {
			endpoint, customizations, location: ChatLocation.Panel,
			promptContext: {
				request: request as ChatRequest, query: request.prompt!, history: [], chatVariables: new ChatVariablesCollection(),
				conversation: new Conversation('session', [new Turn('turn', { type: 'user', message: request.prompt! })]),
				tools: { availableTools: replay?.tools ?? names.map(name => ({ name, description: '', inputSchema: {}, tags: [], source: undefined })), toolInvocationToken: null as never, toolReferences: [] },
				toolCallRounds: replay?.rounds ?? [new ToolCallRound('Read the source', [{ id: 'details', name: toolName, arguments: toolArguments }])],
				toolCallResults: replay?.results ?? { details: new LanguageModelToolResult([new LanguageModelTextPart(content)]) },
			},
		}).render();
		return { messages: result.messages, text: result.messages.map(m => messageToMarkdown(m)).join('\n'), toolText: result.messages.filter(m => m.role === Raw.ChatRole.Tool).map(m => messageToMarkdown(m)).join('\n'), saved, resolver: customizations.SystemPrompt.name };
	} finally { accessor.dispose(); services.dispose(); }
}
