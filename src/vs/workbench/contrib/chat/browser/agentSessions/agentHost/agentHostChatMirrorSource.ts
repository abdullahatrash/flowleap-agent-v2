/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// FlowLeap (PRD 0018 C1, #719): the window half of the editor chat mirror. While Remote Access is
// on (D5), it publishes this window's local chats (D2: every chat of the window; D4: the Agents
// Window's Local chats too) to the agent host, and it answers a Viewer's message, permission
// answer and cancel through the same APIs the chat view uses. It logs ids and counts only.

import { mainWindow } from '../../../../../../base/browser/window.js';
import { CancellationToken } from '../../../../../../base/common/cancellation.js';
import { Disposable, DisposableMap, DisposableStore, IDisposable, MutableDisposable } from '../../../../../../base/common/lifecycle.js';
import { autorun, constObservable, observableSignalFromEvent } from '../../../../../../base/common/observable.js';
import { URI } from '../../../../../../base/common/uri.js';
import { CHAT_MIRROR_PUBLICATION_VERSION, type ChatMirrorPublication, type IAgentHostChatMirrorSource, type IMirroredChat, type IMirroredChatSummary, type IMirroredChatUpdate } from '../../../../../../platform/agentHost/common/agentHostChatMirror.js';
import { IAgentHostService } from '../../../../../../platform/agentHost/common/agentService.js';
import type { Turn } from '../../../../../../platform/agentHost/common/state/sessionState.js';
import { IInstantiationService } from '../../../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../../../platform/log/common/log.js';
import { ChatSendResult, IChatService, IChatToolInvocation, ToolConfirmKind, type IChatSendRequestOptions } from '../../../common/chatService/chatService.js';
import { ChatMode, IChatModeService } from '../../../common/chatModes.js';
import { ChatAgentLocation, ChatModeKind } from '../../../common/constants.js';
import { ILanguageModelsService } from '../../../common/languageModels.js';
import type { IChatModel, IChatRequestModel } from '../../../common/model/chatModel.js';
import { LocalChatSessionUri } from '../../../common/model/chatUri.js';
import type { UserSelectedTools } from '../../../common/participants/chatAgents.js';
import { IRemoteAccessService } from '../../../common/remoteAccess/remoteAccess.js';
import { IChatWidgetService } from '../../chat.js';
import { ChatSelectedTools } from '../../widget/input/chatSelectedTools.js';
import { isActiveChatRequest, mirroredActiveTurnFromRequest, mirroredChatFromModel, mirroredRequests, mirroredTurnFromRequest } from './importLocalConversationToAgentSession.js';

const LOG_PREFIX = '[AgentHostChatMirror]';

/** Coalesces bursts of chat model changes (streamed tokens) into one publication. */
const CHAT_UPDATE_DELAY_MS = 100;
/** The chat list changes rarely; a request, a title or a new chat. */
const CHAT_LIST_DELAY_MS = 250;

/** Runs `run` once, `delay` ms after the first of a burst of calls, on the main window's timer. */
class WindowThrottle implements IDisposable {
	private _handle: number | undefined;

	constructor(private readonly _delay: number, private readonly _run: () => void) { }

	schedule(): void {
		if (this._handle === undefined) {
			this._handle = mainWindow.setTimeout(() => {
				this._handle = undefined;
				this._run();
			}, this._delay);
		}
	}

	dispose(): void {
		if (this._handle !== undefined) {
			mainWindow.clearTimeout(this._handle);
			this._handle = undefined;
		}
	}
}

/** What one watched chat has published so far. */
interface IChatPublicationState {
	/** The serialized active turn last published, to drop updates that change nothing. */
	activeTurnJson: string | undefined;
	/** The finished request ids last published, in order. */
	finishedIds: readonly string[];
}

export class AgentHostChatMirrorSource extends Disposable implements IAgentHostChatMirrorSource {
	declare readonly _serviceBrand: undefined;

	private readonly _publishing = this._register(new MutableDisposable<DisposableStore>());
	/** Chats loaded from history for a Viewer; released when publishing stops. */
	private readonly _loadedChats = this._register(new DisposableMap<string>());

	constructor(
		@IChatService private readonly _chatService: IChatService,
		@IChatWidgetService private readonly _widgetService: IChatWidgetService,
		@IChatModeService private readonly _chatModeService: IChatModeService,
		@ILanguageModelsService private readonly _languageModelsService: ILanguageModelsService,
		@IAgentHostService private readonly _agentHostService: IAgentHostService,
		@IRemoteAccessService remoteAccessService: IRemoteAccessService,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@ILogService private readonly _logService: ILogService,
	) {
		super();
		// D5: Remote Access is the one switch. Nothing is mirrored while it is off.
		this._register(autorun(reader => {
			if (remoteAccessService.enabled.read(reader)) {
				if (!this._publishing.value) {
					this._publishing.value = this._startPublishing();
				}
			} else if (this._publishing.value) {
				this._publishing.clear();
				this._loadedChats.clearAndDisposeAll();
				this._publish({ version: CHAT_MIRROR_PUBLICATION_VERSION, kind: 'withdraw', clientId: this._agentHostService.clientId });
			}
		}));
	}

	// ---- Publishing ---------------------------------------------------------------------------

	private _publish(publication: ChatMirrorPublication): void {
		const publishChatMirror = this._agentHostService.publishChatMirror;
		if (!publishChatMirror) {
			return;
		}
		publishChatMirror.call(this._agentHostService, publication).catch(error => {
			this._logService.warn(`${LOG_PREFIX} publication '${publication.kind}' failed: ${error instanceof Error ? error.name : 'unknown error'}`);
		});
	}

	private _startPublishing(): DisposableStore {
		const store = new DisposableStore();
		const watchers = store.add(new DisposableMap<string>());
		const listThrottle = store.add(new WindowThrottle(CHAT_LIST_DELAY_MS, () => void this._publishChatList(store)));

		store.add(autorun(reader => {
			const live = new Set<string>();
			for (const model of this._chatService.chatModels.read(reader)) {
				if (!LocalChatSessionUri.isLocalSession(model.sessionResource)) {
					continue;
				}
				const id = model.sessionResource.toString();
				live.add(id);
				if (!watchers.has(id)) {
					watchers.set(id, this._watch(id, model, () => listThrottle.schedule()));
				}
			}
			for (const id of [...watchers.keys()]) {
				if (!live.has(id)) {
					watchers.deleteAndDispose(id);
				}
			}
			listThrottle.schedule();
		}));
		store.add(this._chatService.onDidDisposeSession(() => listThrottle.schedule()));
		// A restarted agent host has forgotten this window: publish the list again.
		store.add(this._agentHostService.onAgentHostStart(() => listThrottle.schedule()));
		this._logService.info(`${LOG_PREFIX} publishing editor chats`);
		return store;
	}

	private async _publishChatList(store: DisposableStore): Promise<void> {
		const chats = await this._listChats();
		if (store.isDisposed) {
			return;
		}
		this._logService.trace(`${LOG_PREFIX} publishing ${chats.length} editor chat(s)`);
		this._publish({ version: CHAT_MIRROR_PUBLICATION_VERSION, kind: 'chats', clientId: this._agentHostService.clientId, chats });
	}

	/** Every local chat of this window that has at least one request (D2). */
	private async _listChats(): Promise<IMirroredChatSummary[]> {
		const [live, history] = await Promise.all([this._chatService.getLiveSessionItems(), this._chatService.getHistorySessionItems()]);
		const byId = new Map<string, IMirroredChatSummary>();
		for (const item of [...history, ...live]) {
			if (!LocalChatSessionUri.isLocalSession(item.sessionResource)) {
				continue;
			}
			const model = this._chatService.getSession(item.sessionResource);
			if (model && model.getRequests().length === 0) {
				continue;
			}
			const id = item.sessionResource.toString();
			byId.set(id, {
				id,
				title: item.title,
				createdAt: model?.timestamp ?? item.lastMessageDate,
				modifiedAt: item.lastMessageDate,
			});
		}
		return [...byId.values()];
	}

	/** Follows one loaded chat model and publishes its changes. */
	private _watch(id: string, model: IChatModel, onDidChangeList: () => void): IDisposable {
		const store = new DisposableStore();
		const state: IChatPublicationState = {
			activeTurnJson: undefined,
			finishedIds: mirroredRequests(model).filter(request => !isActiveChatRequest(request)).map(request => request.id),
		};
		const throttle = store.add(new WindowThrottle(CHAT_UPDATE_DELAY_MS, () => {
			const update = this._nextUpdate(id, model, state);
			if (update) {
				this._publish({ version: CHAT_MIRROR_PUBLICATION_VERSION, kind: 'chat', clientId: this._agentHostService.clientId, update });
			}
		}));
		store.add(model.onDidChange(e => {
			throttle.schedule();
			if (e.kind === 'addRequest' || e.kind === 'removeRequest' || e.kind === 'setCustomTitle') {
				onDidChangeList();
			}
		}));
		// Streamed response content and tool states change without a model event.
		store.add(autorun(reader => {
			const response = model.lastRequestObs.read(reader)?.response;
			if (response) {
				observableSignalFromEvent(this, response.onDidChange).read(reader);
				for (const part of response.entireResponse.value) {
					if (part.kind === 'toolInvocation') {
						part.state.read(reader);
					}
				}
			}
			throttle.schedule();
		}));
		return store;
	}

	/** The change since the last publication of a chat, or `undefined` when nothing changed. */
	private _nextUpdate(id: string, model: IChatModel, state: IChatPublicationState): IMirroredChatUpdate | undefined {
		const requests = mirroredRequests(model);
		const active = requests.find(isActiveChatRequest);
		const finished = requests.filter(request => !isActiveChatRequest(request));
		const finishedIds = finished.map(request => request.id);

		// Requests that finished since the last update are appended to the history; anything else
		// (a removed or edited request) is a history change the agent host reloads.
		const appended = startsWith(finishedIds, state.finishedIds) ? finished.slice(state.finishedIds.length) : [];
		const historyChanged = !startsWith(finishedIds, state.finishedIds);
		const endedTurns: Turn[] = appended.map(mirroredTurnFromRequest);

		const activeTurn = active ? mirroredActiveTurnFromRequest(active) : undefined;
		const activeTurnJson = activeTurn ? JSON.stringify(activeTurn) : undefined;
		const changed = endedTurns.length > 0 || historyChanged || activeTurnJson !== state.activeTurnJson;
		state.activeTurnJson = activeTurnJson;
		state.finishedIds = finishedIds;
		if (!changed) {
			return undefined;
		}
		return { id, ...(activeTurn ? { activeTurn } : {}), endedTurns, historyChanged };
	}

	// ---- Commands from the agent host -----------------------------------------------------------

	private async _model(id: string): Promise<IChatModel | undefined> {
		if (!this._publishing.value) {
			return undefined;
		}
		const resource = URI.parse(id);
		if (!LocalChatSessionUri.isLocalSession(resource)) {
			return undefined;
		}
		const model = this._chatService.getSession(resource);
		if (model) {
			return model;
		}
		const reference = await this._chatService.acquireOrLoadSession(resource, ChatAgentLocation.Chat, CancellationToken.None, 'agentHostChatMirror');
		if (!reference) {
			return undefined;
		}
		if (!this._publishing.value) {
			reference.dispose();
			return undefined;
		}
		this._loadedChats.set(id, reference);
		return reference.object;
	}

	async getChat(id: string): Promise<IMirroredChat | undefined> {
		const model = await this._model(id);
		return model ? mirroredChatFromModel(id, model) : undefined;
	}

	async sendMessage(id: string, text: string): Promise<void> {
		const model = await this._model(id);
		if (!model) {
			throw new Error('The editor chat is not published by this window.');
		}
		this._logService.info(`${LOG_PREFIX} a Viewer sends the next message`);
		const widget = this._widgetService.getWidgetBySessionResource(model.sessionResource);
		if (widget) {
			// The open chat view sends exactly as if the user typed: its mode, model and tools.
			await widget.acceptInput(text);
			return;
		}
		const result = await this._chatService.sendRequest(model.sessionResource, text, this._requestOptions(model));
		if (ChatSendResult.isRejected(result)) {
			throw new Error('The editor chat rejected the message.');
		}
	}

	/**
	 * What the chat view would send with when it is closed (spike gap 2): the mode, model and tool
	 * selection of the chat's last request. A chat loaded from disk has no tool selection, so it
	 * takes the stored selection of the mode, as the chat view's tool picker does.
	 */
	private _requestOptions(model: IChatModel): IChatSendRequestOptions {
		const last = [...model.getRequests()].reverse().find(request => !request.isSystemInitiated);
		const modeKind = last?.modeInfo?.kind ?? ChatModeKind.Agent;
		const tools = last?.userSelectedTools ?? this._storedToolSelection(model, modeKind, last);
		return {
			location: ChatAgentLocation.Chat,
			...(last?.modelId ? { userSelectedModelId: last.modelId } : {}),
			...(last?.modelConfiguration ? { userSelectedModelConfiguration: last.modelConfiguration } : {}),
			...(last?.modeInfo ? { modeInfo: last.modeInfo } : {}),
			userSelectedTools: constObservable(tools),
			parserContext: { mode: modeKind },
			instructionContext: {
				modeKind,
				enabledTools: modeKind === ChatModeKind.Agent ? tools : undefined,
				enabledSubAgents: last?.modeInfo?.modeInstructions?.allowedSubagents,
			},
		};
	}

	private _storedToolSelection(model: IChatModel, modeKind: ChatModeKind, last: IChatRequestModel | undefined): UserSelectedTools {
		const store = new DisposableStore();
		try {
			const modes = store.add(this._chatModeService.createModes(model.sessionResource));
			const customModeName = last?.modeInfo?.isBuiltin === false ? last.modeInfo.modeInstructions?.name : undefined;
			const mode = (customModeName ? modes.findModeByName(customModeName) : undefined) ?? modes.findModeById(modeKind) ?? ChatMode.Agent;
			const metadata = last?.modelId ? this._languageModelsService.lookupLanguageModel(last.modelId) : undefined;
			const languageModel = metadata && last?.modelId ? { metadata, identifier: last.modelId } : undefined;
			const selection = store.add(this._instantiationService.createInstance(ChatSelectedTools, constObservable(mode), constObservable(languageModel)));
			return selection.userSelectedTools.get();
		} finally {
			store.dispose();
		}
	}

	async confirmToolCall(id: string, toolCallId: string, approved: boolean): Promise<boolean> {
		const model = await this._model(id);
		const invocation = model?.lastRequest?.response?.entireResponse.value.find((part): part is IChatToolInvocation => part.kind === 'toolInvocation' && part.toolCallId === toolCallId);
		// D3: a Viewer allows once or skips. It never writes an approval rule.
		const answered = IChatToolInvocation.confirmWith(invocation, approved ? { type: ToolConfirmKind.UserAction } : { type: ToolConfirmKind.Denied });
		this._logService.info(`${LOG_PREFIX} a Viewer answered a tool confirmation: ${approved ? 'allow' : 'skip'}${answered ? '' : ' (no longer pending)'}`);
		return answered;
	}

	async cancel(id: string): Promise<void> {
		const model = await this._model(id);
		if (model) {
			await this._chatService.cancelCurrentRequestForSession(model.sessionResource, 'remoteAccess');
		}
	}
}

function startsWith(values: readonly string[], prefix: readonly string[]): boolean {
	return prefix.length <= values.length && prefix.every((value, index) => values[index] === value);
}

