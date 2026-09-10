/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChatRequest, ChatResponseStream, LanguageModelToolInformation, LanguageModelToolResult } from 'vscode';
import { ChatFetchResponseType, ChatResponse } from '../../../../platform/chat/common/commonTypes';
import { IFileSystemService } from '../../../../platform/filesystem/common/fileSystemService';
import { MockFileSystemService } from '../../../../platform/filesystem/node/test/mockFileSystemService';
import { ChatResponseStreamImpl } from '../../../../util/common/chatResponseStreamImpl';
import { CancellationToken } from '../../../../util/vs/base/common/cancellation';
import { DisposableStore } from '../../../../util/vs/base/common/lifecycle';
import { URI } from '../../../../util/vs/base/common/uri';
import { IInstantiationService } from '../../../../util/vs/platform/instantiation/common/instantiation';
import { LanguageModelTextPart, LanguageModelToolResult as ToolResult } from '../../../../vscodeTypes';
import { Conversation, Turn } from '../../../prompt/common/conversation';
import { IBuildPromptResult, nullRenderPromptResult } from '../../../prompt/node/intents';
import { createExtensionUnitTestingServices } from '../../../test/node/services';
import { ToolName } from '../../../tools/common/toolNames';
import { priorArtReportReceipt } from '../../../tools/node/priorArtReportCompletion';
import { IToolCallingLoopOptions, IToolCallSingleResult, ToolCallingLoop } from '../../node/toolCallingLoop';

/** Exercise the production stop/continuation loop with scripted model/tool rounds. */
class PriorArtLoop extends ToolCallingLoop<IToolCallingLoopOptions> {
	readonly queries: string[] = [];
	writerResult: LanguageModelToolResult | undefined;
	writerAvailable = true;
	protected override async buildPrompt(): Promise<IBuildPromptResult> { return nullRenderPromptResult(); }
	protected override async getAvailableTools(): Promise<LanguageModelToolInformation[]> { return []; }
	protected override async fetch(): Promise<never> { throw new Error('Scripted runOne supplies the model response.'); }
	override async runOne(output: ChatResponseStream | undefined): Promise<IToolCallSingleResult> {
		const context = this.createPromptContext([], output);
		this.queries.push(context.query);
		const roundIndex = this.queries.length - 1;
		const writerRound = roundIndex === 2 && !!this.writerResult;
		if (writerRound && context.toolCallResults) { context.toolCallResults.write = this.writerResult!; }
		const response: ChatResponse = { type: ChatFetchResponseType.Success, value: 'Saved report.', requestId: 'request', serverRequestId: undefined, usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }, resolvedModel: 'fixture' };
		return { response, hadIgnoredFiles: false, lastRequestMessages: [], availableTools: this.writerAvailable ? [{ name: ToolName.WritePatentResults, description: 'Writer', inputSchema: {}, tags: [], source: undefined }] : [], round: {
			id: String(roundIndex), response: 'Saved report.', toolInputRetry: 0,
			toolCalls: roundIndex === 0 ? [{ id: 'search', name: ToolName.SearchPatents, arguments: '{}' }, { id: 'create', name: ToolName.CreateFile, arguments: '{"filePath":"/workspace/report.md"}' }] : writerRound ? [{ id: 'write', name: ToolName.WritePatentResults, arguments: '{"template":"prior-art-report","filePath":"/workspace/report.md"}' }] : [],
		} };
	}
}

const disposables = new DisposableStore();
afterEach(() => { disposables.clear(); vi.restoreAllMocks(); });
function setup() {
	const services = disposables.add(createExtensionUnitTestingServices());
	const files = new MockFileSystemService();
	services.define(IFileSystemService, files);
	const accessor = disposables.add(services.createTestingAccessor());
	const message = 'Search for prior art and save /workspace/report.md';
	const request = { prompt: message, references: [], toolReferences: [], tools: new Map(), id: 'request', sessionId: 'session', hasHooksEnabled: false } as Partial<ChatRequest>;
	const loop = disposables.add(accessor.get(IInstantiationService).createInstance(PriorArtLoop, { conversation: new Conversation('session', [new Turn('turn', { type: 'user', message })]), request: request as ChatRequest, toolCallLimit: 20 }));
	const stream = new ChatResponseStreamImpl(() => { }, () => { });
	const markdown = vi.spyOn(stream, 'markdown');
	return { loop, files, stream, markdown };
}

describe('prior-art finalization in the production tool loop', () => {
	it('recovers generic saves through the structured writer and stops normally', async () => {
		const { loop, files, stream, markdown } = setup();
		const report = URI.file('/workspace/report.md');
		const evidence = URI.file('/workspace/report.evidence.json');
		await files.writeFile(report, new TextEncoder().encode('Report'));
		await files.writeFile(evidence, new TextEncoder().encode('Evidence'));
		loop.writerResult = new ToolResult([new LanguageModelTextPart(priorArtReportReceipt(report, 'Report', evidence, 'Evidence'))]);
		await loop.run(stream, CancellationToken.None);
		expect({ rounds: loop.queries.length, recovery: loop.queries[2].includes('no successful structured finalization'), warnings: markdown.mock.calls.length }).toEqual({ rounds: 4, recovery: true, warnings: 0 });
	});
	it('limits recovery to two nudges and marks the remaining draft unvalidated', async () => {
		const { loop, stream, markdown } = setup();
		await loop.run(stream, CancellationToken.None);
		expect(loop.queries).toHaveLength(4);
		expect(markdown.mock.calls.at(-1)?.[0]).toContain('Report validation incomplete');
	});
	it('reports incomplete validation immediately when the writer is unavailable', async () => {
		const { loop, stream, markdown } = setup();
		loop.writerAvailable = false;
		await loop.run(stream, CancellationToken.None);
		expect(loop.queries).toHaveLength(2);
		expect(markdown.mock.calls.at(-1)?.[0]).toContain('unvalidated draft');
	});
});
