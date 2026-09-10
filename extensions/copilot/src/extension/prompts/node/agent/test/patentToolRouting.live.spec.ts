/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Raw } from '@vscode/prompt-tsx';
import { readFileSync, writeFileSync } from 'fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as vscode from 'vscode';
import { MockFileSystemService } from '../../../../../platform/filesystem/node/test/mockFileSystemService';
import { ILogService } from '../../../../../platform/log/common/logService';
import { PromptPathRepresentationService } from '../../../../../platform/prompts/common/promptPathRepresentationService';
import { TestWorkspaceService } from '../../../../../platform/test/node/testWorkspaceService';
import { mock } from '../../../../../util/common/test/simpleMock';
import { CancellationToken } from '../../../../../util/vs/base/common/cancellation';
import { DisposableStore } from '../../../../../util/vs/base/common/lifecycle';
import { URI } from '../../../../../util/vs/base/common/uri';
import { IInstantiationService } from '../../../../../util/vs/platform/instantiation/common/instantiation';
import { LanguageModelTextPart, LanguageModelToolResult } from '../../../../../vscodeTypes';
import { IPatentExecutionLedger } from '../../../../patentai/vscode-node/patentExecutionLedger';
import { ToolCallRound } from '../../../../prompt/common/toolCallRound';
import { NullToolsService } from '../../../../tools/common/toolsService';
import { getContributedToolName, ToolName } from '../../../../tools/common/toolNames';
import { checkPriorArtReportCompletion } from '../../../../tools/node/priorArtReportCompletion';
import { lookupPatentEvidence } from '../../../../tools/vscode-node/patentEvidenceLookup';
import { WritePatentResultsTool } from '../../../../tools/vscode-node/writePatentResultsTool';
import { assemble, details, fixtureSnapshot, claim8 } from './patentToolRoutingTestUtils';

vi.mock('../../../../../vscodeTypes', async () => import('../../../../../util/common/test/shims/vscodeTypesShim'));
vi.mock('vscode', async importOriginal => ({ ...await importOriginal<typeof vscode>(), env: { uriScheme: 'flowleap' } }));

interface Completion {
	choices: { message: { content?: string | null; tool_calls?: { id: string; function: { name: string; arguments: string } }[] } }[];
}

/** Serialize the actual assembled roles, content and tool-call IDs; never replace them with a patent-only prompt. */
function wireMessage(message: Raw.ChatMessage): object {
	const content = message.content.filter(part => part.type === Raw.ChatCompletionContentPartKind.Text).map(part => part.text).join('\n');
	if (message.role === Raw.ChatRole.Tool) { return { role: 'tool', tool_call_id: message.toolCallId, content }; }
	if (message.role === Raw.ChatRole.Assistant) { return { role: 'assistant', content, ...(message.toolCalls?.length ? { tool_calls: message.toolCalls.map(call => ({ id: call.id, type: 'function', function: { name: call.function.name, arguments: call.function.arguments } })) } : {}) }; }
	return { role: message.role === Raw.ChatRole.System ? 'system' : 'user', content };
}

const disposables = new DisposableStore();
afterEach(() => disposables.clear());

const enabled = process.env.PATENT_ROUTING_LIVE_EVAL === '1';
describe.skipIf(!enabled)('live provider patent routing (opt-in, metered; isolated captured public source)', () => {
	it('reads offloaded evidence through local lookup and completes a structured source-grounded report', async () => {
		const key = process.env.EVAL_API_KEY || process.env.OPENROUTER_API_KEY;
		if (!key) { throw new Error('Set EVAL_API_KEY or OPENROUTER_API_KEY to run the live evaluation.'); }
		const model = process.env.EVAL_MODEL || 'google/gemini-3.8-flash';
		const family = process.env.EVAL_PROMPT_FAMILY || model.replace(/^[^/]+\//, '');
		const manifest: { contributes: { languageModelTools: { name: string; modelDescription: string; inputSchema: object }[] } } = JSON.parse(readFileSync('package.json', 'utf8'));
		const tools: vscode.LanguageModelToolInformation[] = [ToolName.GetPatentDetails, ToolName.WritePatentResults, ToolName.ReadFile, ToolName.CreateFile].map(name => {
			const contribution = manifest.contributes.languageModelTools.find(tool => tool.name === getContributedToolName(name));
			if (!contribution) { throw new Error(`Missing real tool definition: ${name}`); }
			return { name, description: contribution.modelDescription, inputSchema: contribution.inputSchema, tags: [], source: undefined };
		});
		tools.push({ name: ToolName.CoreRunInTerminal, description: 'Run a shell command to execute code or inspect local files.', inputSchema: { type: 'object', properties: { command: { type: 'string' }, explanation: { type: 'string' }, isBackground: { type: 'boolean' } }, required: ['command', 'explanation', 'isBackground'] }, tags: [], source: undefined });
		const files = new MockFileSystemService();
		const log = new class extends mock<ILogService>() { override trace() { } override info() { } override warn() { } override error() { } }();
		const validationService = disposables.add(new NullToolsService(log));
		validationService.tools = tools;
		const workspace = new TestWorkspaceService([URI.file('/workspace')]);
		const ledger: IPatentExecutionLedger = { _serviceBrand: undefined, record: async () => 'Recorded', read: async () => fixtureSnapshot };
		const instantiation = new class extends mock<IInstantiationService>() { override invokeFunction<R>(): R { return undefined as R; } }();
		const writer = new WritePatentResultsTool(log, files, new PromptPathRepresentationService(workspace), instantiation, ledger, workspace);
		const query = 'The EP/WO scope and cutoff before 2002-02-21 were confirmed. The candidate source was already retrieved below. Finish this bounded candidate review using that retrieved source only and save /workspace/review.md. Compare F1: photocurable dental composite, and F5: essentially free of sub-100 nm filler. Include the essential combination and relevant loading range. Use exact supporting passages and preserve the scope of each claim and embodiment. State limitations; this is not a novelty opinion.';
		const rounds = [new ToolCallRound('Retrieved the candidate source.', [{ id: 'details', name: ToolName.GetPatentDetails, arguments: '{"publicationNumber":"EP0983762A1"}' }])];
		const results: Record<string, LanguageModelToolResult> = { details: new LanguageModelToolResult([new LanguageModelTextPart(details)]) };
		const calls: string[] = [];
		let finalText = '';
		for (let round = 0; round < 32; round++) {
			const assembled = await assemble(family, undefined, undefined, true, false, undefined, { query, rounds, results, tools });
			const response = await fetch(`${process.env.EVAL_BASE_URL || 'https://openrouter.ai/api/v1'}/chat/completions`, {
				method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
				body: JSON.stringify({ model, messages: assembled.messages.map(wireMessage), tools: tools.map(tool => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.inputSchema } })), temperature: 0, max_tokens: Number(process.env.EVAL_MAX_OUTPUT_TOKENS || 16000) }),
				signal: AbortSignal.timeout(120000),
			});
			if (!response.ok) { throw new Error(`Live provider returned HTTP ${response.status}; response body omitted.`); }
			const completion = await response.json() as Completion;
			const message = completion.choices[0].message;
			finalText = message.content ?? '';
			if (!message.tool_calls?.length) { break; }
			const toolCalls = message.tool_calls.map(call => ({ id: call.id, name: call.function.name, arguments: call.function.arguments }));
			rounds.push(new ToolCallRound(finalText, toolCalls));
			for (const call of toolCalls) {
				calls.push(call.name);
				console.info(JSON.stringify({ round, tool: call.name }));
				const validation = validationService.validateToolInput(call.name, call.arguments);
				if ('error' in validation) {
					results[call.id] = new LanguageModelToolResult([new LanguageModelTextPart(validation.error)]);
					continue;
				}
				if (call.name === ToolName.GetPatentDetails) {
					const input: { publicationNumber: string; evidenceLookup?: Parameters<typeof lookupPatentEvidence>[2] } = JSON.parse(call.arguments);
					expect(input.evidenceLookup, 'Already retrieved text should use local lookup, not another backend retrieval').toBeDefined();
					const body = lookupPatentEvidence(fixtureSnapshot, input.publicationNumber, input.evidenceLookup!);
					results[call.id] = new LanguageModelToolResult([new LanguageModelTextPart(body)]);
				} else if (call.name === ToolName.WritePatentResults) {
					const input: Parameters<WritePatentResultsTool['invoke']>[0]['input'] = JSON.parse(call.arguments);
					expect(input.template).toBe('prior-art-report');
					results[call.id] = await writer.invoke({ input, toolInvocationToken: undefined }, CancellationToken.None);
				} else {
					throw new Error(`Unnecessary file/shell detour for stored evidence: ${call.name}`);
				}
			}
		}
		expect(calls).toContain(ToolName.GetPatentDetails);
		expect(calls).toContain(ToolName.WritePatentResults);
		expect(await checkPriorArtReportCompletion([], { message: query, rounds, results }, files)).toBeUndefined();
		const report = new TextDecoder().decode(await files.readFile(URI.file('/workspace/review.md')));
		if (process.env.PATENT_ROUTING_EVAL_OUTPUT) { writeFileSync(process.env.PATENT_ROUTING_EVAL_OUTPUT, report); }
		// Narrow acceptance checks; a human still reviews scope and conclusions in the report.
		expect(report).toContain(claim8);
		expect(report).toContain('camphorquinone');
		expect(report).toContain('section=description');
		expect(report.toLowerCase()).toContain('essentially free');
		expect(report).not.toContain('Claim 1 and claim 8 explicitly mandate');
		expect(finalText.length).toBeGreaterThan(0);
		console.info(JSON.stringify({ model, family, calls, receiptVerified: true, capturedScopeCases: 'exact dependent claim and photoinitiator passage attached; human semantic review still required' }));
	}, 360000);
});
