/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Raw } from '@vscode/prompt-tsx';
import { describe, expect, it, vi } from 'vitest';
import * as modelCapabilities from '../../../../../platform/endpoint/common/chatModelCapabilities';
import { convertToApiChatMessage } from '../../../../../platform/endpoint/vscode-node/extChatEndpoint';
import { LanguageModelTextPart, LanguageModelToolResult } from '../../../../../vscodeTypes';
import { apiMessageToGeminiMessage } from '../../../../byok/common/geminiMessageConverter';
import { apiMessageToAnthropicMessage } from '../../../../byok/common/anthropicMessageConverter';
import { ToolCallRound } from '../../../../prompt/common/toolCallRound';
import { ToolName } from '../../../../tools/common/toolNames';
import { assemble, details } from './patentToolRoutingTestUtils';

vi.mock('../../../../../vscodeTypes', async () => import('../../../../../util/common/test/shims/vscodeTypesShim'));
vi.mock('vscode', async importOriginal => ({ ...await importOriginal<object>(), ...await import('../../../../../util/common/test/shims/vscodeTypesShim') }));

const families = [
	'default', 'unrecognized-provider/model', 'gpt-4.1', 'o4-mini', 'gpt-5', 'gpt-5-mini', 'gpt-5-codex',
	'gpt-5.1', 'gpt-5.1-codex', 'gpt-5.1-codex-mini', 'gpt-5.2', 'gpt-5.2-codex', 'gpt-5.3-codex', 'gpt-5.4', 'gpt-5.5', 'gpt-5.6', 'gpt-6', 'gpt-oss-120b',
	'claude-3.5-sonnet', 'claude-haiku-4.5', 'claude-sonnet-4.5', 'claude-opus-4.5', 'claude-sonnet-4.6', 'claude-opus-4.6',
	'gemini-2.0-flash', 'gemini-3.5-flash', 'gemini-3.8-flash', 'grok-code-fast-1', 'minimax-m2', 'glm-4.7',
	'vscModelA', 'vscModelB', 'vscModelC', 'vscModelD',
	'google/gemini-3.8-flash', 'anthropic/claude-sonnet-4.6', 'openai/gpt-5.5', 'z-ai/glm-4.7', 'minimax/minimax-m2',
];

describe('patent routing at the assembled provider and tool-result boundary', () => {
	it('keeps usable local evidence navigation inline while retaining the complete offloaded source', async () => {
		const result = await assemble('gemini-3.8-flash');
		expect({ offloaded: result.saved.some(files => typeof files !== 'string' && files['content.txt'] === details), publication: result.toolText.includes('EP0983762A1'), lookup: result.toolText.includes('evidenceLookup'), file: result.toolText.includes('/session/tool-output/content.txt') }).toEqual({ offloaded: true, publication: true, lookup: true, file: true });
	});
	it('retains patent role and routing when the optional base coding instructions are omitted', async () => {
		const result = await assemble('google/gemini-3.8-flash', undefined, undefined, true, true);
		expect(result.text).toContain('patentAIIdentity');
	});
	it.each(families)('scopes provider capabilities and preserves native evidence navigation for %s', async family => {
		const result = await assemble(family);
		// An assembly contract, not proof that a live model obeys it. Every block below is an
		// invariant of the assembly, so assert it; only the selected provider class varies per
		// family — prefixed BYOK names may legitimately use the fallback — so that is snapshotted.
		expect({ identity: result.text.includes('<patentAIIdentity>'), codingScoped: result.text.includes('<codingTaskReminders>'), explicitCoding: result.text.includes('Explicit coding requests remain coding tasks'), gapFallback: result.text.includes('use local code for that gap'), writer: result.text.includes('template=prior-art-report'), sourceRoute: result.toolText.includes('evidenceLookup') }).toEqual({ identity: true, codingScoped: true, explicitCoding: true, gapFallback: true, writer: true, sourceRoute: true });
		expect(result.resolver).toMatchSnapshot();
	});
	it.each(['isHiddenFamilyH'] as const)('renders the hash-selected provider path %s', async predicate => {
		// Hidden family IDs are not published. Force only selection; render the real
		// registered provider class, its reminders and the shared assembly unchanged.
		const matcher = vi.spyOn(modelCapabilities, predicate).mockReturnValue(true);
		try {
			const result = await assemble('hidden-routing-fixture');
			expect({ identity: result.text.includes('<patentAIIdentity>'), codingScoped: result.text.includes('<codingTaskReminders>'), sourceRoute: result.toolText.includes('evidenceLookup') }).toEqual({ identity: true, codingScoped: true, sourceRoute: true });
			expect(result.resolver).toMatchSnapshot();
		} finally { matcher.mockRestore(); }
	});
	it.each(['EP0983762A1', 'EP0983762'])('keeps an already bounded local evidence page inline for %s even when its header exceeds the generic threshold', async publicationNumber => {
		const page = 'Local returned-text lines: 1 results.\n[EP0983762A1:description:en; line 1] ' + 'x'.repeat(7980) + '\nContinue with evidenceLookup={"anchor":"EP0983762A1:description:en","start":1,"offset":7980}.';
		const result = await assemble('gemini-3.8-flash', ToolName.GetPatentDetails, page, true, false, JSON.stringify({ publicationNumber, evidenceLookup: { anchor: 'EP0983762A1:description:en' } }));
		expect({ offloads: result.saved.length, exactPage: result.toolText.includes(page), continuation: result.toolText.includes('"offset":7980') }).toEqual({ offloads: 0, exactPage: true, continuation: true });
	});
	it('keeps search candidates and explicit preview limits inline without losing the full returned list', async () => {
		const results = 'Found 300 patents matching CQL: "dental and pd<20020221"\nShowing results 1-100:\n| Publication | Title | Published |\n| EP0983762A1 | Dental composition | 2000-03-08 |\n' + Array.from({ length: 99 }, (_, i) => `| EP${1000000 + i}A1 | Synthetic long candidate title ${'x'.repeat(100)} | 2000-01-01 |`).join('\n');
		const result = await assemble('claude-sonnet-4.6', ToolName.SearchPatents, results);
		expect({ fullResult: result.saved.some(files => typeof files !== 'string' && files['content.txt'] === results), candidate: result.toolText.includes('EP0983762A1'), partial: result.toolText.includes('Partial search-result preview'), route: result.toolText.includes('get_patent_details'), bounded: result.toolText.length < 5000 }).toEqual({ fullResult: true, candidate: true, partial: true, route: true, bounded: true });
	});
	it('preserves generic coding tool offload behavior when patent tools are absent', async () => {
		const result = await assemble('gpt-5.5', ToolName.CoreRunInTerminal, 'Coding command output.\n'.repeat(1000), false);
		expect({ patentRole: result.text.includes('<patentAIIdentity>'), scopedReminders: result.text.includes('<codingTaskReminders>'), fileRoute: result.toolText.includes('Use the read_file tool'), localEvidence: result.toolText.includes('evidenceLookup') }).toEqual({ patentRole: false, scopedReminders: false, fileRoute: true, localEvidence: false });
	});
	it('does not invent an evidence identity when the invocation cannot identify a publication', async () => {
		const result = await assemble('gemini-3.8-flash', ToolName.GetPatentDetails, details, true, false, '{}');
		expect({ localEvidence: result.toolText.includes('evidenceLookup'), fileRoute: result.toolText.includes('Use the read_file tool') }).toEqual({ localEvidence: false, fileRoute: true });
	});

	it.each(['gemini-3.8-flash', 'google/gemini-3.8-flash', 'claude-sonnet-4.6', 'gpt-5.5'])('retains the actual assembled system blocks through native API conversion for %s', async family => {
		// Native Gemini generates UUID call IDs; VS Code can append its invocation suffix.
		const callId = '11b401f7-bc49-4110-8455-9b487705834d__vscode-1789042212369';
		const result = await assemble(family, undefined, undefined, true, false, undefined, { query: 'Review this source.', rounds: [new ToolCallRound('Retrieved source.', [{ id: callId, name: ToolName.GetPatentDetails, arguments: '{"publicationNumber":"EP0983762A1"}' }])], results: { [callId]: new LanguageModelToolResult([new LanguageModelTextPart(details)]) }, tools: [ToolName.GetPatentDetails, ToolName.WritePatentResults].map(name => ({ name, description: '', inputSchema: {}, tags: [], source: undefined })) });
		const sourceSystems = result.messages.filter(message => message.role === Raw.ChatRole.System).flatMap(message => message.content.filter(part => part.type === Raw.ChatCompletionContentPartKind.Text).map(part => part.text));
		const apiMessages = convertToApiChatMessage(result.messages);
		const gemini = apiMessageToGeminiMessage(apiMessages as Parameters<typeof apiMessageToGeminiMessage>[0]);
		const anthropic = apiMessageToAnthropicMessage(apiMessages as Parameters<typeof apiMessageToAnthropicMessage>[0]);
		const geminiSystem = gemini.systemInstruction?.parts?.map(part => part.text ?? '').join('\n') ?? '';
		const anthropicSystem = anthropic.system.text;
		const geminiResponse = gemini.contents.flatMap(content => content.parts ?? []).find(part => part.functionResponse)?.functionResponse;
		expect(geminiResponse?.name).toBe(ToolName.GetPatentDetails);
		expect(JSON.stringify(geminiResponse?.response)).toContain('evidenceLookup');
		expect(JSON.stringify(geminiResponse?.response)).toContain('EP0983762A1');
		const anthropicBlocks = anthropic.messages.flatMap(message => typeof message.content === 'string' ? [] : message.content);
		expect(anthropicBlocks).toContainEqual(expect.objectContaining({ type: 'tool_use', id: callId, name: ToolName.GetPatentDetails }));
		const anthropicResult = anthropicBlocks.find(block => block.type === 'tool_result');
		expect(anthropicResult).toEqual(expect.objectContaining({ tool_use_id: callId }));
		expect(JSON.stringify(anthropicResult)).toContain('evidenceLookup');
		expect(JSON.stringify(anthropicResult)).toContain('EP0983762A1');
		expect({ sourceHasPatentRole: sourceSystems.some(text => text.includes('<patentAIIdentity>')), geminiRetainsEverySystem: sourceSystems.every(text => geminiSystem.includes(text)), anthropicRetainsEverySystem: sourceSystems.every(text => anthropicSystem.includes(text)) }).toEqual({ sourceHasPatentRole: true, geminiRetainsEverySystem: true, anthropicRetainsEverySystem: true });
	});
	it.each(families)('keeps explicit coding and uncovered local analysis requests within provider capabilities for %s', async family => {
		const tools = [ToolName.GetPatentDetails, ToolName.WritePatentResults, ToolName.CreateFile, ToolName.CoreRunInTerminal].map(name => ({ name, description: '', inputSchema: {}, tags: [], source: undefined }));
		for (const query of ['Implement a TypeScript function to group patent records by publication year.', 'Fit a custom logistic regression to my local measurements and save reproducible code; the available patent tools do not perform this calculation.']) {
			const result = await assemble(family, undefined, undefined, true, false, undefined, { query, rounds: [], results: {}, tools });
			expect({ requestPreserved: result.text.includes(query), explicitCoding: result.text.includes('Explicit coding requests remain coding tasks'), fallbackAllowed: result.text.includes('use local code for that gap'), providerRemindersRetained: result.text.includes('<codingTaskReminders>') }).toEqual({ requestPreserved: true, explicitCoding: true, fallbackAllowed: true, providerRemindersRetained: true });
		}
	});

});
