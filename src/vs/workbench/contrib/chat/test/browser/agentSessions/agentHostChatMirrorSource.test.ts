/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { timeout } from '../../../../../../base/common/async.js';
import { Emitter, Event } from '../../../../../../base/common/event.js';
import { MarkdownString } from '../../../../../../base/common/htmlContent.js';
import { DisposableStore } from '../../../../../../base/common/lifecycle.js';
import { constObservable, IObservable, observableValue } from '../../../../../../base/common/observable.js';
import { URI } from '../../../../../../base/common/uri.js';
import { runWithFakedTimers } from '../../../../../../base/test/common/timeTravelScheduler.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../base/test/common/utils.js';
import type { ChatMirrorPublication } from '../../../../../../platform/agentHost/common/agentHostChatMirror.js';
import { IAgentHostService } from '../../../../../../platform/agentHost/common/agentService.js';
import { ResponsePartKind, type ResponsePart, type Turn } from '../../../../../../platform/agentHost/common/state/sessionState.js';
import { TestInstantiationService } from '../../../../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { ILogService, NullLogService } from '../../../../../../platform/log/common/log.js';
import { AgentHostChatMirrorSource } from '../../../browser/agentSessions/agentHost/agentHostChatMirrorSource.js';
import { mirroredChatFromModel } from '../../../browser/agentSessions/agentHost/importLocalConversationToAgentSession.js';
import { IChatWidgetService } from '../../../browser/chat.js';
import { ChatModeKind } from '../../../common/constants.js';
import { IChatService, IChatToolInvocation, ToolConfirmKind, type ChatSendResult, type ConfirmedReason, type IChatDetail, type IChatSendRequestOptions } from '../../../common/chatService/chatService.js';
import { IChatModeService } from '../../../common/chatModes.js';
import { ILanguageModelsService } from '../../../common/languageModels.js';
import type { IChatChangeEvent, IChatModel, IChatProgressResponseContent, IChatRequestModeInfo, IChatRequestModel } from '../../../common/model/chatModel.js';
import { LocalChatSessionUri } from '../../../common/model/chatUri.js';
import { IRemoteAccessService } from '../../../common/remoteAccess/remoteAccess.js';

const FILE = URI.file('/work/claims.md');

function markdown(value: string): IChatProgressResponseContent {
	return { kind: 'markdownContent', content: new MarkdownString(value) } as IChatProgressResponseContent;
}

/** A live tool invocation in the given state; `confirm` records the answer. */
function liveTool(toolCallId: string, state: Partial<IChatToolInvocation.State> & { type: IChatToolInvocation.StateKind }, answers: ConfirmedReason[] = []): IChatProgressResponseContent {
	const settable = observableValue<IChatToolInvocation.State>('state', { confirm: (reason: ConfirmedReason) => answers.push(reason), ...state } as IChatToolInvocation.State);
	return {
		kind: 'toolInvocation',
		toolCallId,
		toolId: 'run_in_terminal',
		invocationMessage: 'Running a command',
		toolSpecificData: { kind: 'input', rawInput: { command: 'echo ok' } },
		state: settable,
	} as unknown as IChatProgressResponseContent;
}

class FakeResponse {
	private readonly _onDidChange = new Emitter<void>();
	readonly onDidChange = this._onDidChange.event;
	readonly isCanceled = false;
	readonly result = undefined;
	readonly contentReferences = [{ kind: 'reference', reference: FILE }];
	constructor(public value: IChatProgressResponseContent[], public isComplete: boolean) { }
	get entireResponse() { return { value: this.value }; }
	change(): void { this._onDidChange.fire(); }
	dispose(): void { this._onDidChange.dispose(); }
}

function request(id: string, text: string, response: FakeResponse | undefined, extra?: Partial<IChatRequestModel>): IChatRequestModel {
	return { id, timestamp: 1000, message: { text }, response, isHiddenFromTranscript: false, ...extra } as unknown as IChatRequestModel;
}

class FakeChatModel {
	readonly sessionResource = LocalChatSessionUri.forSession('chat-1');
	readonly timestamp = 1000;
	private readonly _onDidChange = new Emitter<IChatChangeEvent>();
	readonly onDidChange = this._onDidChange.event;
	readonly lastRequestObs = observableValue<IChatRequestModel | undefined>('lastRequest', undefined);
	requests: IChatRequestModel[] = [];
	getRequests(): IChatRequestModel[] { return this.requests; }
	get lastRequest(): IChatRequestModel | undefined { return this.requests.at(-1); }
	add(next: IChatRequestModel): void {
		this.requests = [...this.requests, next];
		this.lastRequestObs.set(next, undefined);
		this._onDidChange.fire({ kind: 'addRequest', request: next } as IChatChangeEvent);
	}
	dispose(): void { this._onDidChange.dispose(); }
}

function projectParts(parts: readonly ResponsePart[]) {
	return parts.map(part => part.kind === ResponsePartKind.ToolCall
		? { id: part.toolCall.toolCallId, status: part.toolCall.status }
		: part.kind === ResponsePartKind.Markdown || part.kind === ResponsePartKind.Reasoning ? { id: part.id, [part.kind]: part.content } : { kind: part.kind });
}

suite('Editor chat mirror converter', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('maps every response part kind with ids stable across updates', () => {
		const answers: ConfirmedReason[] = [];
		const parts: IChatProgressResponseContent[] = [
			markdown('Claim 1 is anticipated.'),
			{ kind: 'thinking', value: ['Reading ', 'D1'] },
			{ kind: 'inlineReference', inlineReference: FILE },
			{ kind: 'markdownVuln', content: new MarkdownString('vulnerable text'), vulnerabilities: [] },
			{ kind: 'warning', content: new MarkdownString('Quota low') },
			{ kind: 'info', content: new MarkdownString('Using EPO OPS') },
			{ kind: 'progressTaskSerialized', content: new MarkdownString('Searching CPC'), progress: [] },
			{ kind: 'textEditGroup', uri: FILE, edits: [], done: true },
			{ kind: 'notebookEditGroup', uri: FILE, edits: [], done: true },
			{ kind: 'workspaceEdit', edits: [{}, {}] },
			{ kind: 'confirmation', title: 'Continue?', message: 'More', data: undefined, isUsed: false },
			{ kind: 'elicitationSerialized', title: 'Pick a date', message: 'Priority date', subtitle: undefined, state: 'accepted' },
			{ kind: 'questionCarousel', questions: [], allowSkip: true, isUsed: true },
			{ kind: 'planReview', title: 'Plan', content: 'Steps' },
			{ kind: 'undoStop', id: 'u1' },
			{ kind: 'codeblockUri', uri: FILE },
			liveTool('tc-pending', { type: IChatToolInvocation.StateKind.WaitingForConfirmation, confirmationMessages: { title: 'Run zsh command?', message: 'echo ok' } }, answers),
			liveTool('tc-running', { type: IChatToolInvocation.StateKind.Executing, confirmed: { type: ToolConfirmKind.UserAction } }),
			liveTool('tc-streaming', { type: IChatToolInvocation.StateKind.Streaming }),
			liveTool('tc-skipped', { type: IChatToolInvocation.StateKind.Cancelled, reason: ToolConfirmKind.Skipped }),
			liveTool('tc-done', { type: IChatToolInvocation.StateKind.Completed, confirmed: { type: ToolConfirmKind.Setting, id: 's' }, resultDetails: { input: '', output: [{ type: 'embed', isText: true, value: 'ok' }] } }),
		] as IChatProgressResponseContent[];
		const response = new FakeResponse(parts, false);
		const model = { getRequests: () => [request('req-1', 'Find prior art', response)] } as unknown as IChatModel;

		const mirrored = mirroredChatFromModel('chat', model);
		response.dispose();

		assert.deepStrictEqual({ turns: mirrored.turns, active: projectParts(mirrored.activeTurn?.responseParts ?? []) }, {
			turns: [],
			active: [
				{ id: 'req-1:0', markdown: 'Claim 1 is anticipated.' },
				{ id: 'req-1:1', reasoning: 'Reading D1' },
				{ id: 'req-1:2', markdown: `[claims.md](${FILE.toString()})` },
				{ id: 'req-1:3', markdown: 'vulnerable text' },
				{ id: 'req-1:4', markdown: 'Warning: Quota low' },
				{ id: 'req-1:5', markdown: 'Using EPO OPS' },
				{ id: 'req-1:6', markdown: 'Searching CPC' },
				{ id: 'req-1:7', markdown: `Edited [claims.md](${FILE.toString()})` },
				{ id: 'req-1:8', markdown: `Edited [claims.md](${FILE.toString()})` },
				{ id: 'req-1:9', markdown: 'Edited 2 files' },
				{ id: 'req-1:10', markdown: 'Continue?: answer this in FlowLeap on the Host.' },
				{ id: 'req-1:11', markdown: 'Pick a date: answer this in FlowLeap on the Host.' },
				{ id: 'req-1:12', markdown: 'The Patent Agent asked questions (answered on the Host).' },
				{ id: 'req-1:13', markdown: 'Plan: review the plan in FlowLeap on the Host.' },
				{ id: 'tc-pending', status: 'pending-confirmation' },
				{ id: 'tc-running', status: 'running' },
				{ id: 'tc-skipped', status: 'cancelled' },
				{ id: 'tc-done', status: 'completed' },
			],
		});
	});

	test('splits finished turns from the running one, leaves hidden requests out and keeps system-initiated ones as agent turns', () => {
		const done = new FakeResponse([markdown('one')], true);
		const running = new FakeResponse([markdown('partial')], false);
		const model = {
			getRequests: () => [
				request('req-1', 'first', done),
				request('req-2', 'hidden', done, { isHiddenFromTranscript: true }),
				request('req-3', 'terminal finished', done, { isSystemInitiated: true }),
				request('req-4', 'second', running),
			],
		} as unknown as IChatModel;

		const mirrored = mirroredChatFromModel('chat', model);
		done.dispose();
		running.dispose();

		assert.deepStrictEqual({
			turns: mirrored.turns.map((turn: Turn) => ({ id: turn.id, text: turn.message.text, origin: turn.message.origin?.kind, parts: projectParts(turn.responseParts) })),
			active: mirrored.activeTurn && { id: mirrored.activeTurn.turnId, parts: projectParts(mirrored.activeTurn.responseParts) },
		}, {
			turns: [
				{ id: 'req-1', text: 'first', origin: 'user', parts: [{ id: 'req-1:0', markdown: 'one' }, { id: 'req-1:references', markdown: `Used references: [claims.md](${FILE.toString()})` }] },
				{ id: 'req-3', text: 'terminal finished', origin: 'agent', parts: [{ id: 'req-3:0', markdown: 'one' }, { id: 'req-3:references', markdown: `Used references: [claims.md](${FILE.toString()})` }] },
			],
			active: { id: 'req-4', parts: [{ id: 'req-4:0', markdown: 'partial' }] },
		});
	});
});

suite('AgentHostChatMirrorSource', () => {

	const disposables = new DisposableStore();
	teardown(() => disposables.clear());
	ensureNoDisposablesAreLeakedInTestSuite();

	interface ISetup {
		readonly source: AgentHostChatMirrorSource;
		readonly enabled: ReturnType<typeof observableValue<boolean>>;
		readonly model: FakeChatModel;
		readonly publications: ChatMirrorPublication[];
		readonly sent: { text: string; options: IChatSendRequestOptions | undefined }[];
	}

	function setup(): ISetup {
		const enabled = observableValue('enabled', false);
		const model = disposables.add(new FakeChatModel());
		const publications: ChatMirrorPublication[] = [];
		const sent: ISetup['sent'] = [];
		const instantiationService = disposables.add(new TestInstantiationService());
		instantiationService.stub(ILogService, new NullLogService());
		instantiationService.stub(IRemoteAccessService, { enabled });
		instantiationService.stub(IAgentHostService, {
			clientId: 'window-1',
			onAgentHostStart: Event.None,
			publishChatMirror: async (publication: ChatMirrorPublication) => { publications.push(publication); },
		});
		instantiationService.stub(IChatService, {
			chatModels: constObservable([model as unknown as IChatModel]),
			onDidDisposeSession: Event.None,
			getLiveSessionItems: async () => [{ sessionResource: model.sessionResource, title: 'Hinge prior art', lastMessageDate: 2000 } as IChatDetail],
			getHistorySessionItems: async () => [],
			getSession: () => model as unknown as IChatModel,
			sendRequest: async (_resource: URI, text: string, options?: IChatSendRequestOptions) => {
				sent.push({ text, options });
				return { kind: 'sent' } as ChatSendResult;
			},
		});
		instantiationService.stub(IChatWidgetService, { getWidgetBySessionResource: () => undefined });
		instantiationService.stub(IChatModeService, {});
		instantiationService.stub(ILanguageModelsService, {});
		const source = disposables.add(instantiationService.createInstance(AgentHostChatMirrorSource));
		return { source, enabled, model, publications, sent };
	}

	function project(publications: readonly ChatMirrorPublication[]) {
		return publications.map(publication => {
			switch (publication.kind) {
				case 'chats': return { chats: publication.chats.map(chat => chat.title) };
				case 'chat': return {
					active: publication.update.activeTurn && projectParts(publication.update.activeTurn.responseParts),
					ended: publication.update.endedTurns.map(turn => turn.id),
				};
				case 'withdraw': return { withdraw: publication.clientId };
			}
		});
	}

	test('publishes only while Remote Access is on: the chat list, live updates, then a withdrawal (D5)', () => runWithFakedTimers({}, async () => {
		const { enabled, model, publications } = setup();
		const response = disposables.add(new FakeResponse([markdown('Hel')], false));
		model.add(request('req-1', 'Find prior art', response));
		await timeout(1000);
		const whileOff = publications.length;

		enabled.set(true, undefined);
		await timeout(1000);
		response.value = [markdown('Hello')];
		response.change();
		await timeout(1000);
		response.isComplete = true;
		response.change();
		await timeout(1000);
		enabled.set(false, undefined);

		assert.deepStrictEqual({ whileOff, publications: project(publications) }, {
			whileOff: 0,
			publications: [
				{ active: [{ id: 'req-1:0', markdown: 'Hel' }], ended: [] },
				{ chats: ['Hinge prior art'] },
				{ active: [{ id: 'req-1:0', markdown: 'Hello' }], ended: [] },
				{ active: undefined, ended: ['req-1'] },
				{ withdraw: 'window-1' },
			],
		});
	}));

	test('a Viewer message without an open chat view carries the mode, model and tools of the last request (spike gap 2)', () => runWithFakedTimers({}, async () => {
		const { source, enabled, model, sent } = setup();
		const done = disposables.add(new FakeResponse([markdown('one')], true));
		const tools = { patent_search: true, run_in_terminal: false };
		const modeInfo: IChatRequestModeInfo = { kind: ChatModeKind.Agent, isBuiltin: true, modeInstructions: undefined, telemetryModeId: 'agent', applyCodeBlockSuggestionId: undefined };
		model.add(request('req-1', 'first', done, { modeInfo, modelId: 'openrouter/claude-haiku', userSelectedTools: tools }));
		enabled.set(true, undefined);

		await source.sendMessage(model.sessionResource.toString(), 'next step');
		const options = sent[0]?.options;
		enabled.set(false, undefined);

		assert.deepStrictEqual({
			text: sent[0]?.text,
			model: options?.userSelectedModelId,
			mode: options?.modeInfo,
			tools: (options?.userSelectedTools as IObservable<Record<string, boolean>> | undefined)?.get(),
			instructions: options?.instructionContext,
		}, {
			text: 'next step',
			model: 'openrouter/claude-haiku',
			mode: modeInfo,
			tools,
			instructions: { modeKind: ChatModeKind.Agent, enabledTools: tools, enabledSubAgents: undefined },
		});
	}));

	test('a Viewer answer confirms the editor tool once, as Allow or Skip (D3)', () => runWithFakedTimers({}, async () => {
		const { source, enabled, model } = setup();
		const answers: ConfirmedReason[] = [];
		const running = disposables.add(new FakeResponse([liveTool('tc-1', { type: IChatToolInvocation.StateKind.WaitingForConfirmation }, answers)], false));
		model.add(request('req-1', 'run it', running));
		enabled.set(true, undefined);

		const results = [
			await source.confirmToolCall(model.sessionResource.toString(), 'tc-1', true),
			await source.confirmToolCall(model.sessionResource.toString(), 'missing', false),
		];
		enabled.set(false, undefined);
		const refused = await source.confirmToolCall(model.sessionResource.toString(), 'tc-1', false);

		assert.deepStrictEqual({ results, refused, answers }, {
			results: [true, false],
			refused: false,
			answers: [{ type: ToolConfirmKind.UserAction }],
		});
	}));
});
