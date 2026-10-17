/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { timeout } from '../../../../base/common/async.js';
import { encodeBase64, VSBuffer } from '../../../../base/common/buffer.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { Schemas } from '../../../../base/common/network.js';
import { URI } from '../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { FileService } from '../../../files/common/fileService.js';
import { InMemoryFileSystemProvider } from '../../../files/common/inMemoryFilesystemProvider.js';
import { NullLogService } from '../../../log/common/log.js';
import { IProductService } from '../../../product/common/productService.js';
import { AgentSession } from '../../common/agent.js';
import { AhpJsonlLogger } from '../../common/ahpJsonlLogger.js';
import { AgentHostChatMirrorRegistry, CHAT_MIRROR_PUBLICATION_VERSION, FLOWLEAP_CHAT_AGENT_PROVIDER_ID, type IAgentHostChatMirrorWindow, type IMirroredActiveTurn, type IMirroredChat, type IMirroredChatSummary, type IMirroredChatUpdate } from '../../common/agentHostChatMirror.js';
import { AgentHostGlobalAutoApproveEnabledConfigKey } from '../../common/agentHostSchema.js';
import { ActionType } from '../../common/state/sessionActions.js';
import { buildDefaultChatUri, MessageKind, ResponsePartKind, ROOT_STATE_URI, ToolCallConfirmationReason, ToolCallStatus, ToolResultContentType, TurnState, type ResponsePart, type ToolCallState, type Turn } from '../../common/state/sessionState.js';
import { AgentHostDatabase } from '../../node/agentHostDatabase.js';
import { AgentService } from '../../node/agentService.js';
import { EDITOR_CHATS_PROJECT_URI, FlowLeapChatAgentRegistration, FlowLeapChatMirrorAgent } from '../../node/flowleapChatMirrorAgent.js';
import { createNoopGitService, createSessionDataService, TestSessionDatabase } from '../common/sessionTestHelpers.js';
import { createTestAgentService, getTestAgentHostProviderService, getTestAgentStateManager, registerTestAgentProvider } from './agentServiceTestUtils.js';

const CLIENT = 'window-1';
const CHAT = 'vscode-chat-session://local/Y2hhdC0x';
const SESSION = AgentSession.uri(FLOWLEAP_CHAT_AGENT_PROVIDER_ID, encodeBase64(VSBuffer.fromString(CHAT), false, true));
const CHAT_CHANNEL = URI.parse(buildDefaultChatUri(SESSION));
const CREATED_AT = Date.UTC(2026, 9, 17, 8, 0, 0);

/** A distinctive string in every content field of a mirrored chat (A4 privacy test). */
const MARKER = 'FLWLP-MARKER-7f3a9c';

/** Collects every log line, at every level, with its arguments. */
class RecordingLogService extends NullLogService {
	readonly lines: string[] = [];
	private _record(message: string | Error, args: unknown[]): void {
		this.lines.push([String(message), ...args.map(arg => arg instanceof Error ? `${arg.name}: ${arg.message}` : JSON.stringify(arg) ?? String(arg))].join(' '));
	}
	override trace(message: string, ...args: unknown[]): void { this._record(message, args); }
	override debug(message: string, ...args: unknown[]): void { this._record(message, args); }
	override info(message: string, ...args: unknown[]): void { this._record(message, args); }
	override warn(message: string, ...args: unknown[]): void { this._record(message, args); }
	override error(message: string | Error, ...args: unknown[]): void { this._record(message, args); }
}

/** The window end of the mirror, as a test controls it. */
class FakeMirrorWindow implements IAgentHostChatMirrorWindow {
	chat: IMirroredChat = { id: CHAT, turns: [] };
	readonly calls: string[] = [];

	async getChat(): Promise<IMirroredChat | undefined> {
		return this.chat;
	}
	async sendMessage(_id: string, text: string): Promise<void> {
		this.calls.push(`send:${text}`);
	}
	async confirmToolCall(_id: string, toolCallId: string, approved: boolean): Promise<boolean> {
		this.calls.push(`confirm:${toolCallId}:${approved}`);
		return true;
	}
	async cancel(): Promise<void> {
		this.calls.push('cancel');
	}
}

function summary(title = 'Prior art for a hinge'): IMirroredChatSummary {
	return { id: CHAT, title, createdAt: CREATED_AT, modifiedAt: CREATED_AT };
}

function markdown(requestId: string, index: number, content: string): ResponsePart {
	return { kind: ResponsePartKind.Markdown, id: `${requestId}:${index}`, content };
}

function turn(id: string, text: string, responseParts: ResponsePart[], state = TurnState.Complete): Turn {
	return { id, message: { text, origin: { kind: MessageKind.User } }, responseParts, usage: undefined, state };
}

function active(turnId: string, text: string, responseParts: ResponsePart[]): IMirroredActiveTurn {
	return { turnId, startedAt: CREATED_AT, message: { text, origin: { kind: MessageKind.User } }, responseParts };
}

function tool(status: ToolCallStatus.PendingConfirmation | ToolCallStatus.Running | ToolCallStatus.Completed, input = 'echo ok', output = 'ok'): ResponsePart {
	const base = { toolCallId: 'tc-1', toolName: 'run_in_terminal', displayName: 'Run in Terminal', invocationMessage: 'Running a command', toolInput: input };
	const toolCall: ToolCallState = status === ToolCallStatus.PendingConfirmation
		? { ...base, status, confirmationTitle: 'Run zsh command?' }
		: status === ToolCallStatus.Running
			? { ...base, status, confirmed: ToolCallConfirmationReason.UserAction }
			: { ...base, status, confirmed: ToolCallConfirmationReason.UserAction, success: true, pastTenseMessage: 'Ran a command', content: [{ type: ToolResultContentType.Text, text: output }] };
	return { kind: ResponsePartKind.ToolCall, toolCall };
}

async function until<T>(read: () => T | undefined | false | Promise<T | undefined | false>, what: string): Promise<T> {
	for (let i = 0; i < 200; i++) {
		const value = await read();
		if (value) {
			return value;
		}
		await timeout(0);
	}
	throw new Error(`Timed out waiting for ${what}`);
}

suite('FlowLeapChatMirrorAgent', () => {

	const disposables = new DisposableStore();
	teardown(() => disposables.clear());
	ensureNoDisposablesAreLeakedInTestSuite();

	interface IHarness {
		readonly service: AgentService;
		readonly agent: FlowLeapChatMirrorAgent;
		readonly registry: AgentHostChatMirrorRegistry;
		readonly window: FakeMirrorWindow;
		readonly catalog: AgentHostDatabase;
		readonly sessionDatabase: TestSessionDatabase;
		readonly log: RecordingLogService;
		readonly fileService: FileService;
		publishChats(chats: IMirroredChatSummary[]): void;
		publishUpdate(update: Partial<IMirroredChatUpdate>): void;
		chatState(): ReturnType<ReturnType<typeof getTestAgentStateManager>['getChatState']>;
	}

	async function createHarness(): Promise<IHarness> {
		const log = new RecordingLogService();
		const fileService = disposables.add(new FileService(new NullLogService()));
		disposables.add(fileService.registerProvider(Schemas.inMemory, disposables.add(new InMemoryFileSystemProvider())));
		const catalog = disposables.add(new AgentHostDatabase(':memory:'));
		const sessionDatabase = new TestSessionDatabase();
		const service = disposables.add(createTestAgentService(log, fileService, createSessionDataService(sessionDatabase), { _serviceBrand: undefined } as IProductService, createNoopGitService(), undefined, undefined, undefined, undefined, undefined, [], undefined, undefined, catalog));
		const registry = disposables.add(new AgentHostChatMirrorRegistry());
		const window = new FakeMirrorWindow();
		disposables.add(registry.attachWindow(CLIENT, window));
		const agent = disposables.add(new FlowLeapChatMirrorAgent(registry, log));
		registerTestAgentProvider(service, agent);
		return {
			service, agent, registry, window, catalog, sessionDatabase, log, fileService,
			publishChats: chats => assert.ok(registry.publish({ version: CHAT_MIRROR_PUBLICATION_VERSION, kind: 'chats', clientId: CLIENT, chats })),
			publishUpdate: update => assert.ok(registry.publish({ version: CHAT_MIRROR_PUBLICATION_VERSION, kind: 'chat', clientId: CLIENT, update: { id: CHAT, endedTurns: [], historyChanged: false, ...update } })),
			chatState: () => getTestAgentStateManager(service).getChatState(CHAT_CHANNEL.toString()),
		};
	}

	async function publishAndRegister(harness: IHarness, title?: string): Promise<void> {
		harness.publishChats([summary(title)]);
		for (let i = 0; i < 200; i++) {
			if ((await harness.service.getRegisteredSessions()).some(session => session.toString() === SESSION.toString())) {
				return;
			}
			await timeout(0);
		}
		throw new Error('Timed out waiting for the registration');
	}

	function projectTurns(turns: readonly Turn[] | undefined) {
		return turns?.map(t => ({ id: t.id, text: t.message.text, state: t.state, parts: t.responseParts.map(projectPart) }));
	}

	function projectPart(part: ResponsePart) {
		if (part.kind === ResponsePartKind.ToolCall) {
			const options = part.toolCall.status === ToolCallStatus.PendingConfirmation ? part.toolCall.options?.map(option => option.id) : undefined;
			return { tool: part.toolCall.toolCallId, status: part.toolCall.status, ...(options ? { options } : {}) };
		}
		return part.kind === ResponsePartKind.Markdown || part.kind === ResponsePartKind.Reasoning ? { [part.kind]: part.content } : { kind: part.kind };
	}

	test('lists a published editor chat with its real title and stores only the neutral title (D1)', async () => {
		const harness = await createHarness();
		await publishAndRegister(harness, `Title ${MARKER}`);
		await until(() => harness.log.lines.some(line => line.includes(`discovery for provider ${FLOWLEAP_CHAT_AGENT_PROVIDER_ID}`)), 'the discovery pass');
		const listed = (await harness.service.listSessions()).find(session => session.session.toString() === SESSION.toString());
		const rows = await harness.catalog.listSessionsV2();
		const disk = JSON.stringify(rows) + JSON.stringify(harness.sessionDatabase.setMetadataCalls);

		assert.deepStrictEqual({
			listed: listed?.summary,
			rows: rows.length,
			neutralOnDisk: disk.includes('Editor chat, 2026-10-17'),
			markerOnDisk: disk.includes(MARKER),
		}, {
			listed: `Title ${MARKER}`,
			rows: 1,
			neutralOnDisk: true,
			markerOnDisk: false,
		});
	});

	test('restores finished turns and follows an editor turn live', async () => {
		const harness = await createHarness();
		harness.window.chat = { id: CHAT, turns: [turn('req-1', 'first', [markdown('req-1', 0, 'one')])] };
		await publishAndRegister(harness);
		await harness.service.subscribe(CHAT_CHANNEL, 'viewer');

		harness.publishUpdate({ activeTurn: active('req-2', 'second', [markdown('req-2', 0, 'Hel')]) });
		const live = await until(() => harness.chatState()?.activeTurn, 'the live turn');
		const liveSnapshot = { id: live.id, parts: live.responseParts.map(projectPart) };
		harness.publishUpdate({ activeTurn: active('req-2', 'second', [markdown('req-2', 0, 'Hello'), markdown('req-2', 1, 'there')]) });
		const grown = harness.chatState()?.activeTurn?.responseParts.map(projectPart);
		harness.publishUpdate({ endedTurns: [turn('req-2', 'second', [markdown('req-2', 0, 'Hello'), markdown('req-2', 1, 'there')])] });

		assert.deepStrictEqual({ liveSnapshot, grown, active: harness.chatState()?.activeTurn, turns: projectTurns(harness.chatState()?.turns) }, {
			liveSnapshot: { id: 'req-2', parts: [{ markdown: 'Hel' }] },
			grown: [{ markdown: 'Hello' }, { markdown: 'there' }],
			active: undefined,
			turns: [
				{ id: 'req-1', text: 'first', state: TurnState.Complete, parts: [{ markdown: 'one' }] },
				{ id: 'req-2', text: 'second', state: TurnState.Complete, parts: [{ markdown: 'Hello' }, { markdown: 'there' }] },
			],
		});
	});

	test('a client that opens a chat during an editor turn gets the running turn without a timer', async () => {
		const harness = await createHarness();
		harness.window.chat = { id: CHAT, turns: [], activeTurn: active('req-1', 'running', [markdown('req-1', 0, 'partial')]) };
		await publishAndRegister(harness);
		await harness.service.subscribe(CHAT_CHANNEL, 'viewer');
		const running = await until(() => harness.chatState()?.activeTurn, 'the resynced turn');

		assert.deepStrictEqual({ id: running.id, text: running.message.text, parts: running.responseParts.map(projectPart) }, {
			id: 'req-1', text: 'running', parts: [{ markdown: 'partial' }],
		});
	});

	test('an editor tool confirmation offers Allow Once and Skip only, ignores host auto-approval and reaches the window once (D3)', async () => {
		const harness = await createHarness();
		getTestAgentStateManager(harness.service).dispatchServerAction(ROOT_STATE_URI, { type: ActionType.RootConfigChanged, config: { [AgentHostGlobalAutoApproveEnabledConfigKey]: true } });
		await publishAndRegister(harness);
		await harness.service.subscribe(CHAT_CHANNEL, 'viewer');

		harness.publishUpdate({ activeTurn: active('req-1', 'run it', [tool(ToolCallStatus.PendingConfirmation)]) });
		const pendingPart = await until(() => harness.chatState()?.activeTurn?.responseParts.find(part => part.kind === ResponsePartKind.ToolCall && part.toolCall.status === ToolCallStatus.PendingConfirmation), 'the pending tool');
		const pending = projectPart(pendingPart);
		harness.service.dispatchAction(CHAT_CHANNEL.toString(), { type: ActionType.ChatToolCallConfirmed, turnId: 'req-1', toolCallId: 'tc-1', approved: true, confirmed: ToolCallConfirmationReason.UserAction, selectedOptionId: 'allow-once' }, 'viewer', 1);
		await until(() => harness.window.calls.length > 0, 'the answer');
		harness.publishUpdate({ activeTurn: active('req-1', 'run it', [tool(ToolCallStatus.Running)]) });
		harness.publishUpdate({ endedTurns: [turn('req-1', 'run it', [tool(ToolCallStatus.Completed)])] });

		assert.deepStrictEqual({ pending, calls: harness.window.calls, turns: projectTurns(harness.chatState()?.turns) }, {
			pending: { tool: 'tc-1', status: ToolCallStatus.PendingConfirmation, options: ['allow-once', 'skip'] },
			calls: ['confirm:tc-1:true'],
			turns: [{ id: 'req-1', text: 'run it', state: TurnState.Complete, parts: [{ tool: 'tc-1', status: ToolCallStatus.Completed }] }],
		});
	});

	test('the host\'s own refusals never answer an editor tool; an answer in the editor ends the prompt for Viewers', async () => {
		const harness = await createHarness();
		await publishAndRegister(harness);
		await harness.service.subscribe(CHAT_CHANNEL, 'viewer');

		harness.publishUpdate({ activeTurn: active('req-1', 'run it', [tool(ToolCallStatus.PendingConfirmation)]) });
		await until(() => harness.chatState()?.activeTurn?.responseParts.some(part => part.kind === ResponsePartKind.ToolCall), 'the pending tool');
		harness.agent.respondToPermissionRequest('tc-1', false);
		harness.publishUpdate({ activeTurn: active('req-1', 'run it', [tool(ToolCallStatus.Running)]) });

		assert.deepStrictEqual({ calls: harness.window.calls, parts: harness.chatState()?.activeTurn?.responseParts.map(projectPart) }, {
			calls: [],
			parts: [{ tool: 'tc-1', status: ToolCallStatus.Running }],
		});
	});

	test('a window that closes during a turn ends that turn, then its chat leaves the host (C3)', async () => {
		const harness = await createHarness();
		await publishAndRegister(harness);
		await harness.service.subscribe(CHAT_CHANNEL, 'viewer');
		harness.publishUpdate({ activeTurn: active('req-1', 'long task', [markdown('req-1', 0, 'working')]) });
		await until(() => harness.chatState()?.activeTurn, 'the live turn');
		const actions: string[] = [];
		disposables.add(harness.service.onDidAction(envelope => actions.push(envelope.action.type)));
		// A Viewer listed the session, so the host owes it a removal.
		const listedSummary = getTestAgentStateManager(harness.service).getSessionSummary(SESSION.toString());
		assert.ok(listedSummary);
		getTestAgentStateManager(harness.service).prepareSessionSummariesForListing([listedSummary]);
		const removed: string[] = [];
		disposables.add(getTestAgentStateManager(harness.service).onDidEmitNotification(notification => {
			if (notification.type === 'root/sessionRemoved') {
				removed.push(notification.session.toString());
			}
		}));

		assert.ok(harness.registry.publish({ version: CHAT_MIRROR_PUBLICATION_VERSION, kind: 'withdraw', clientId: CLIENT }));
		const listed = (await harness.service.listSessions()).map(session => session.session.toString());

		assert.deepStrictEqual({ cancelled: actions.includes(ActionType.ChatTurnCancelled), state: harness.chatState(), offered: harness.agent.offersSession(SESSION), listed, removed }, {
			cancelled: true,
			state: undefined,
			offered: false,
			listed: [],
			removed: [SESSION.toString()],
		});
	});

	test('the agent exists only while a window publishes, and lists its chats under Editor Chats (D5, C3)', async () => {
		const log = new RecordingLogService();
		const fileService = disposables.add(new FileService(new NullLogService()));
		const service = disposables.add(createTestAgentService(log, fileService, createSessionDataService(new TestSessionDatabase()), { _serviceBrand: undefined } as IProductService, createNoopGitService(), undefined, undefined, undefined, undefined, undefined, [], undefined, undefined, disposables.add(new AgentHostDatabase(':memory:'))));
		const providers = getTestAgentHostProviderService(service);
		const registry = disposables.add(new AgentHostChatMirrorRegistry());
		disposables.add(registry.attachWindow(CLIENT, new FakeMirrorWindow()));
		const registration = disposables.add(new FlowLeapChatAgentRegistration(registry, providers, () => new FlowLeapChatMirrorAgent(registry, log), log));
		const agents = () => providers.getProviders().map(agent => agent.id);
		const listed = async () => (await service.listSessions()).map(session => ({ session: session.session.toString(), title: session.summary, group: session.project?.displayName, project: session.project?.uri.toString() }));
		const before = agents();

		assert.ok(registry.publish({ version: CHAT_MIRROR_PUBLICATION_VERSION, kind: 'chats', clientId: CLIENT, chats: [summary('Hinge prior art')] }));
		const whilePublishing = await until(async () => {
			const sessions = await listed();
			return sessions.length > 0 ? sessions : undefined;
		}, 'the listing');
		const agentsWhilePublishing = agents();
		assert.ok(registry.publish({ version: CHAT_MIRROR_PUBLICATION_VERSION, kind: 'withdraw', clientId: CLIENT }));
		const afterWithdrawal = { agents: agents(), registered: registration.registered, listed: await listed() };
		assert.ok(registry.publish({ version: CHAT_MIRROR_PUBLICATION_VERSION, kind: 'chats', clientId: CLIENT, chats: [summary('Hinge prior art')] }));
		const republished = await until(async () => {
			const sessions = await listed();
			return sessions.length > 0 ? sessions : undefined;
		}, 'the second listing');

		assert.deepStrictEqual({ before, whilePublishing: { agents: agentsWhilePublishing, listed: whilePublishing }, afterWithdrawal, republished }, {
			before: [],
			whilePublishing: {
				agents: [FLOWLEAP_CHAT_AGENT_PROVIDER_ID],
				listed: [{ session: SESSION.toString(), title: 'Hinge prior art', group: 'Editor Chats', project: EDITOR_CHATS_PROJECT_URI.toString() }],
			},
			afterWithdrawal: { agents: [], registered: false, listed: [] },
			republished: [{ session: SESSION.toString(), title: 'Hinge prior art', group: 'Editor Chats', project: EDITOR_CHATS_PROJECT_URI.toString() }],
		});
	});

	test('a Viewer message reaches the window and its request runs under the Viewer turn id', async () => {
		const harness = await createHarness();
		await publishAndRegister(harness);
		await harness.service.subscribe(CHAT_CHANNEL, 'viewer');

		harness.service.dispatchAction(CHAT_CHANNEL.toString(), { type: ActionType.ChatTurnStarted, turnId: 'viewer-turn', startedAt: new Date(CREATED_AT).toISOString(), message: { text: 'next step', origin: { kind: MessageKind.User } } }, 'viewer', 1);
		await until(() => harness.window.calls.includes('send:next step'), 'the send');
		harness.publishUpdate({ activeTurn: active('req-9', 'next step', [markdown('req-9', 0, 'Working')]) });
		const live = await until(() => harness.chatState()?.activeTurn?.responseParts.length ? harness.chatState()?.activeTurn : undefined, 'the reply');
		const liveSnapshot = { id: live.id, parts: live.responseParts.map(projectPart) };
		harness.publishUpdate({ endedTurns: [turn('req-9', 'next step', [markdown('req-9', 0, 'Working, done')])] });

		assert.deepStrictEqual({ calls: harness.window.calls, liveSnapshot, turns: projectTurns(harness.chatState()?.turns) }, {
			calls: ['send:next step'],
			liveSnapshot: { id: 'viewer-turn', parts: [{ markdown: 'Working' }] },
			turns: [{ id: 'viewer-turn', text: 'next step', state: TurnState.Complete, parts: [{ markdown: 'Working, done' }] }],
		});
	});

	test('mirrored content never reaches the agent host log or the AHP JSONL log on the default policy (A4)', async () => {
		const harness = await createHarness();
		const logsHome = URI.from({ scheme: Schemas.inMemory, path: '/logs' });
		const jsonl = disposables.add(new AhpJsonlLogger({ logsHome, logId: 'local', connectionId: 'viewer', transport: 'test' }, harness.fileService, new NullLogService()));
		disposables.add(harness.service.onDidAction(envelope => jsonl.log({ jsonrpc: '2.0', method: 'action', params: envelope }, 's2c')));

		harness.window.chat = { id: CHAT, turns: [turn('req-1', `Question ${MARKER}`, [markdown('req-1', 0, `Answer ${MARKER}`)])] };
		await publishAndRegister(harness, `Title ${MARKER}`);
		const snapshot = await harness.service.subscribe(CHAT_CHANNEL, 'viewer');
		jsonl.log({ jsonrpc: '2.0', id: 1, result: { snapshot } }, 's2c');
		harness.publishUpdate({ activeTurn: active('req-2', `Run ${MARKER}`, [markdown('req-2', 0, `Thinking ${MARKER}`), tool(ToolCallStatus.PendingConfirmation, `echo ${MARKER}`)]) });
		await until(() => harness.chatState()?.activeTurn?.responseParts.some(part => part.kind === ResponsePartKind.ToolCall), 'the pending tool');
		const answer = { type: ActionType.ChatToolCallConfirmed, turnId: 'req-2', toolCallId: 'tc-1', approved: true, confirmed: ToolCallConfirmationReason.UserAction, selectedOptionId: 'allow-once' } as const;
		jsonl.log({ jsonrpc: '2.0', method: 'dispatchAction', params: { channel: CHAT_CHANNEL.toString(), action: answer } }, 'c2s');
		harness.service.dispatchAction(CHAT_CHANNEL.toString(), answer, 'viewer', 1);
		harness.publishUpdate({ endedTurns: [turn('req-2', `Run ${MARKER}`, [markdown('req-2', 0, `Thinking ${MARKER}`), tool(ToolCallStatus.Completed, `echo ${MARKER}`, `out ${MARKER}`)])] });
		await harness.service.whenCatalogReconciliationIdle();
		await jsonl.flush();
		const file = (await harness.fileService.readFile(jsonl.resource)).value.toString();
		const state = JSON.stringify(harness.chatState());

		assert.deepStrictEqual({
			markerInHostState: state.includes(MARKER),
			jsonlLines: file.trim().split('\n').length > 3,
			markerInJsonl: file.includes(MARKER),
			markerInLog: harness.log.lines.some(line => line.includes(MARKER)),
		}, {
			markerInHostState: true,
			jsonlLines: true,
			markerInJsonl: false,
			markerInLog: false,
		});
	});
});

