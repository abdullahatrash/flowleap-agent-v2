/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// FlowLeap (PRD 0018 C2, #719): the `flowleap-chat` bridge agent. It owns no model and runs no
// turn. It mirrors the editor Patent Agent chats that windows publish (see
// `common/agentHostChatMirror.ts`) and forwards a Viewer's message, permission answer and cancel
// to the window that owns the chat. Listing, subscriptions, state, reducers, the protocol server
// and the Relay transport are the agent host's own machinery, unchanged.
//
// Decisions (issue #719, 2026-10-17): D1 a neutral title on disk, the real one in memory and on
// the wire only; D3 a Viewer may allow once or skip, never "Allow in this Session", and the host's
// own approval rules never apply to an editor tool.
//
// Privacy (ADR 0009 decision 4, PRD 0018 A4): this file logs ids, counts and kinds only, never
// message text, tool input or titles.

import * as os from 'os';
import { decodeBase64, encodeBase64, VSBuffer } from '../../../base/common/buffer.js';
import { Emitter, Event } from '../../../base/common/event.js';
import { Disposable, IDisposable, toDisposable } from '../../../base/common/lifecycle.js';
import { observableValue } from '../../../base/common/observable.js';
import { URI } from '../../../base/common/uri.js';
import { localize } from '../../../nls.js';
import { ILogService } from '../../log/common/log.js';
import { AgentSession, resolveAgentChatContext, type AgentChatMigrationResult, type AgentSignal, type IActiveClient, type IAgent, type IAgentChatContext, type IAgentChatHistoryChange, type IAgentChatMetadata, type IAgentChats, type IAgentCreateChatResult, type IAgentDescriptor, type IAgentDiscoveredChat, type IAgentModelInfo, type IAgentPermissionResponseContext, type IAgentSessionProjectInfo, type IAgentSessionTitlePolicy } from '../common/agent.js';
import { FLOWLEAP_CHAT_AGENT_PROVIDER_ID, type AgentHostChatMirrorRegistry, type IAgentHostChatMirrorWindow, type IChatMirrorPublisher, type IMirroredActiveTurn, type IMirroredChatSummary, type IMirroredChatUpdate } from '../common/agentHostChatMirror.js';
import type { ResolveSessionConfigResult, SessionConfigCompletionsResult } from '../common/state/protocol/commands.js';
import type { ProtectedResourceMetadata } from '../common/state/protocol/state.js';
import { ActionType, type ChatAction } from '../common/state/sessionActions.js';
import { buildDefaultChatUri, parseChatUri, ResponsePartKind, ToolCallCancellationReason, ToolCallConfirmationReason, ToolCallStatus, TurnState, type ResponsePart, type ToolCallPendingConfirmationState, type ToolCallState, type Turn } from '../common/state/sessionState.js';

const LOG_PREFIX = '[FlowLeapChatMirror]';

/** The id of the one model entry: the model the editor chat uses, chosen in the editor. */
export const EDITOR_CHAT_MODEL_ID = 'editor';

/** A chat a window publishes now. */
interface IPublishedChat {
	readonly clientId: string;
	readonly summary: IMirroredChatSummary;
}

/** A turn of the window that the host state holds as its active turn. */
interface IEmittedTurn {
	/** The protocol turn id: the Viewer's id for a turn it started, else the window's request id. */
	readonly turnId: string;
	readonly windowTurnId: string;
	readonly startedAt: number;
	/** Markdown and reasoning part id → the content emitted so far. */
	readonly text: Map<string, string>;
	/** Other part ids already emitted (they do not grow). */
	readonly parts: Set<string>;
	/** Tool call id → the status emitted last. */
	readonly tools: Map<string, ToolCallStatus>;
	/** A part changed in a way no action can carry; the finished turn replaces it. */
	diverged: boolean;
}

/**
 * The project of every editor chat (PRD 0018 C3). A client groups sessions by the project's name,
 * so a Viewer lists the Host's Editor Chats under "Editor Chats" instead of "Unknown". A client
 * also uses the project as a folder (for example as a terminal's working directory), so its URI
 * is a folder that exists: the Host's home folder, the agent host's default directory.
 */
export function editorChatsProject(): IAgentSessionProjectInfo {
	return { uri: URI.file(os.homedir()), displayName: localize('flowleapChat.group', "Editor Chats") };
}

/** The neutral title the host writes to disk for an editor chat (D1). */
export function neutralEditorChatTitle(createdAt: number | undefined): string {
	if (createdAt === undefined || !Number.isFinite(createdAt)) {
		return localize('flowleapChat.neutralTitleNoDate', "Editor chat");
	}
	return localize('flowleapChat.neutralTitle', "Editor chat, {0}", new Date(createdAt).toISOString().slice(0, 10));
}

export class FlowLeapChatMirrorAgent extends Disposable implements IAgent {

	readonly id = FLOWLEAP_CHAT_AGENT_PROVIDER_ID;
	readonly agentHostCapabilities = { workspaceConversion: false };
	// One read-only entry, so that a Viewer can send (it will not send without a model). The model
	// call stays in the window's extension host with the editor's BYOK model, never in this process.
	readonly models = observableValue<readonly IAgentModelInfo[]>(this, [{
		provider: FLOWLEAP_CHAT_AGENT_PROVIDER_ID,
		id: EDITOR_CHAT_MODEL_ID,
		name: localize('flowleapChat.model', "Model Chosen in the Editor"),
		supportsVision: false,
	}]);

	private readonly _onDidChatProgress = this._register(new Emitter<AgentSignal>());
	readonly onDidChatProgress = this._onDidChatProgress.event;
	private readonly _onDidDiscoverChats = this._register(new Emitter<readonly IAgentDiscoveredChat[]>());
	readonly onDidDiscoverChats = this._onDidDiscoverChats.event;
	private readonly _onDidChangeChatHistory = this._register(new Emitter<IAgentChatHistoryChange>());
	readonly onDidChangeChatHistory = this._onDidChangeChatHistory.event;
	readonly onDidMaterializeChat = Event.None;
	readonly onDidChangeChatData = Event.None;
	readonly onDidSpawnChat = Event.None;
	private readonly _onDidRetractSessions = this._register(new Emitter<readonly URI[]>());
	readonly onDidRetractSessions = this._onDidRetractSessions.event;

	/** Chat id (the window's chat model resource) → the window that publishes it. */
	private readonly _chats = new Map<string, IPublishedChat>();
	/** Chats a host client follows now: the host holds their state, so turns are mirrored. */
	private readonly _watched = new Set<string>();
	private readonly _emitted = new Map<string, IEmittedTurn>();
	/** Window request id → the protocol turn id a Viewer gave it. */
	private readonly _turnAliases = new Map<string, string>();
	/** Chat id → the turn a Viewer started that the window has not shown yet. */
	private readonly _pendingViewerTurns = new Map<string, string>();
	/** Window request ids whose protocol turn the host already ended (a Viewer cancelled it). */
	private readonly _abandonedTurns = new Set<string>();
	/** Tool call id → chat id, for tool confirmations published to the host. */
	private readonly _pendingConfirmations = new Map<string, string>();
	/** Tool call ids a Viewer answered: the host state has the answer already. */
	private readonly _viewerAnswers = new Set<string>();

	readonly sessionTitlePolicy: IAgentSessionTitlePolicy = {
		persisted: session => neutralEditorChatTitle(this._chats.get(this._chatId(session) ?? '')?.summary.createdAt),
		live: session => this._chats.get(this._chatId(session) ?? '')?.summary.title,
	};

	constructor(
		private readonly _registry: AgentHostChatMirrorRegistry,
		@ILogService private readonly _logService: ILogService,
	) {
		super();
		this._register(this._registry.onDidChangeChats(publisher => this._onDidPublishChats(publisher)));
		this._register(this._registry.onDidUpdateChat(({ clientId, update }) => this._onDidUpdateChat(clientId, update)));
		this._register(this._registry.onDidWithdraw(clientId => this._onDidWithdraw(clientId)));
	}

	/**
	 * Offers the chats that windows publish already. The host calls it once the agent is
	 * registered, so that the host hears the discovery (see {@link FlowLeapChatAgentRegistration}).
	 */
	offerPublishedChats(): void {
		for (const publisher of this._registry.publishers) {
			this._onDidPublishChats(publisher);
		}
	}

	// ---- Identity -------------------------------------------------------------------------------

	private _sessionUri(chatId: string): URI {
		return AgentSession.uri(this.id, encodeBase64(VSBuffer.fromString(chatId), false, true));
	}

	private _chatUri(chatId: string): URI {
		return URI.parse(buildDefaultChatUri(this._sessionUri(chatId)));
	}

	/** The chat id of a session or chat channel URI of this agent. */
	private _chatId(uri: URI): string | undefined {
		const parsed = parseChatUri(uri);
		const session = parsed ? URI.parse(parsed.session) : uri;
		if (AgentSession.provider(session) !== this.id) {
			return undefined;
		}
		try {
			return decodeBase64(AgentSession.id(session)).toString();
		} catch {
			return undefined;
		}
	}

	private _window(chatId: string): IAgentHostChatMirrorWindow | undefined {
		const chat = this._chats.get(chatId);
		return chat ? this._registry.getPublisher(chat.clientId)?.window : undefined;
	}

	private _metadata(summary: IMirroredChatSummary): IAgentChatMetadata {
		return {
			chat: this._chatUri(summary.id),
			startTime: summary.createdAt,
			modifiedTime: summary.modifiedAt,
			project: editorChatsProject(),
			summary: summary.title,
		};
	}

	/** Whether a window publishes the chat of `session` now (PRD 0018 C3). */
	offersSession(session: URI): boolean {
		const chatId = this._chatId(session);
		return chatId !== undefined && this._chats.has(chatId);
	}

	/** Ends every mirrored chat; the host drops them from live state and from clients' lists. */
	private _retract(chatIds: readonly string[]): void {
		if (chatIds.length === 0) {
			return;
		}
		for (const chatId of chatIds) {
			this._forget(chatId);
		}
		this._onDidRetractSessions.fire(chatIds.map(chatId => this._sessionUri(chatId)));
	}

	// ---- Windows --------------------------------------------------------------------------------

	private _onDidPublishChats(publisher: IChatMirrorPublisher): void {
		const published = new Set(publisher.chats.map(chat => chat.id));
		const gone: string[] = [];
		for (const [chatId, chat] of this._chats) {
			if (chat.clientId === publisher.clientId && !published.has(chatId)) {
				gone.push(chatId);
			}
		}
		this._retract(gone);
		const discovered: IAgentDiscoveredChat[] = [];
		for (const summary of publisher.chats) {
			const previous = this._chats.get(summary.id);
			this._chats.set(summary.id, { clientId: publisher.clientId, summary });
			if (!previous || previous.clientId !== publisher.clientId || previous.summary.title !== summary.title || previous.summary.modifiedAt !== summary.modifiedAt) {
				// Not external: the host's external-session filter (hidden by default) must not hide them.
				discovered.push({ ...this._metadata(summary), external: false });
			}
		}
		this._logService.info(`${LOG_PREFIX} client ${publisher.clientId} publishes ${publisher.chats.length} editor chat(s), ${discovered.length} new or changed`);
		if (discovered.length > 0) {
			this._onDidDiscoverChats.fire(discovered);
		}
	}

	private _onDidWithdraw(clientId: string): void {
		const gone: string[] = [];
		for (const [chatId, chat] of this._chats) {
			if (chat.clientId === clientId) {
				gone.push(chatId);
			}
		}
		this._retract(gone);
		this._logService.info(`${LOG_PREFIX} client ${clientId} withdrew ${gone.length} editor chat(s)`);
	}

	/** The window no longer offers the chat: end a turn the host still shows as running. */
	private _forget(chatId: string): void {
		const emitted = this._emitted.get(chatId);
		if (emitted) {
			this._fire(chatId, { type: ActionType.ChatTurnCancelled, turnId: emitted.turnId, duration: Date.now() - emitted.startedAt });
			this._emitted.delete(chatId);
		}
		this._pendingViewerTurns.delete(chatId);
		for (const [toolCallId, owner] of this._pendingConfirmations) {
			if (owner === chatId) {
				this._pendingConfirmations.delete(toolCallId);
			}
		}
		this._chats.delete(chatId);
	}

	// ---- Window updates → protocol actions ------------------------------------------------------

	private _fire(chatId: string, action: ChatAction): void {
		this._onDidChatProgress.fire({ kind: 'action', resource: this._chatUri(chatId), action });
	}

	/** Whether the host should see this chat's turns: a client follows it, or a turn is in flight. */
	private _mirrors(chatId: string): boolean {
		return this._watched.has(chatId) || this._emitted.has(chatId) || this._pendingViewerTurns.has(chatId);
	}

	private _onDidUpdateChat(clientId: string, update: IMirroredChatUpdate): void {
		const chatId = update.id;
		if (this._chats.get(chatId)?.clientId !== clientId) {
			return;
		}
		for (const turn of update.endedTurns) {
			if (this._abandonedTurns.delete(turn.id)) {
				continue;
			}
			const emitted = this._emitted.get(chatId);
			if (emitted?.windowTurnId === turn.id) {
				this._finishTurn(chatId, emitted, turn);
			} else if (this._mirrors(chatId)) {
				// The turn started and ended between two updates: show it whole.
				this._finishTurn(chatId, this._startTurn(chatId, { turnId: turn.id, startedAt: Date.now(), message: turn.message, responseParts: [] }), turn);
			}
		}
		const emitted = this._emitted.get(chatId);
		if (emitted && update.activeTurn?.turnId !== emitted.windowTurnId) {
			// The running request is gone without an end (removed in the editor).
			this._fire(chatId, { type: ActionType.ChatTurnCancelled, turnId: emitted.turnId, duration: Date.now() - emitted.startedAt });
			this._emitted.delete(chatId);
		}
		const active = update.activeTurn;
		if (active && !this._abandonedTurns.has(active.turnId) && this._mirrors(chatId)) {
			this._emitParts(chatId, this._emitted.get(chatId) ?? this._startTurn(chatId, active), active.responseParts);
		}
		if (update.historyChanged && !active && this._watched.has(chatId)) {
			void this._reloadHistory(chatId);
		}
	}

	/** Puts a window request into the host state as the chat's active turn. */
	private _startTurn(chatId: string, active: IMirroredActiveTurn): IEmittedTurn {
		const viewerTurnId = this._pendingViewerTurns.get(chatId);
		let turnId = this._turnAliases.get(active.turnId) ?? active.turnId;
		if (viewerTurnId) {
			// A Viewer started this turn: the host state has it already.
			this._pendingViewerTurns.delete(chatId);
			this._turnAliases.set(active.turnId, viewerTurnId);
			turnId = viewerTurnId;
		} else {
			// The editor user started it (or a client opened the chat mid-turn): a provider-started turn.
			this._fire(chatId, {
				type: ActionType.ChatTurnStarted,
				turnId,
				startedAt: new Date(active.startedAt).toISOString(),
				message: active.message,
			});
		}
		const emitted: IEmittedTurn = { turnId, windowTurnId: active.turnId, startedAt: active.startedAt, text: new Map(), parts: new Set(), tools: new Map(), diverged: false };
		this._emitted.set(chatId, emitted);
		this._logService.info(`${LOG_PREFIX} turn ${turnId} active (${viewerTurnId ? 'viewer' : 'editor'})`);
		return emitted;
	}

	private _finishTurn(chatId: string, emitted: IEmittedTurn, turn: Turn): void {
		this._emitParts(chatId, emitted, turn.responseParts);
		const duration = Math.max(0, Date.now() - emitted.startedAt);
		const errorPart = turn.responseParts.find(part => part.kind === ResponsePartKind.Error);
		if (turn.state === TurnState.Cancelled) {
			this._fire(chatId, { type: ActionType.ChatTurnCancelled, turnId: emitted.turnId, duration });
		} else if (turn.state === TurnState.Error && errorPart?.kind === ResponsePartKind.Error) {
			this._fire(chatId, { type: ActionType.ChatError, turnId: emitted.turnId, duration, part: errorPart });
		} else {
			this._fire(chatId, { type: ActionType.ChatTurnComplete, turnId: emitted.turnId, duration });
		}
		this._emitted.delete(chatId);
		for (const [toolCallId, owner] of this._pendingConfirmations) {
			if (owner === chatId && emitted.tools.has(toolCallId)) {
				this._pendingConfirmations.delete(toolCallId);
			}
		}
		this._logService.info(`${LOG_PREFIX} turn ${emitted.turnId} ended (${turn.state})`);
		if (emitted.diverged && this._watched.has(chatId)) {
			// Some part changed in a way no action carries: replace the turn with the finished one.
			this._onDidChangeChatHistory.fire({ chat: this._chatUri(chatId), turns: [this._aliased(turn)] });
		}
	}

	private _emitParts(chatId: string, turn: IEmittedTurn, parts: readonly ResponsePart[]): void {
		parts.forEach((part, index) => {
			switch (part.kind) {
				case ResponsePartKind.Markdown:
				case ResponsePartKind.Reasoning: {
					const previous = turn.text.get(part.id);
					if (previous === undefined) {
						this._fire(chatId, { type: ActionType.ChatResponsePart, turnId: turn.turnId, part });
					} else if (part.content.length > previous.length && part.content.startsWith(previous)) {
						const content = part.content.slice(previous.length);
						this._fire(chatId, part.kind === ResponsePartKind.Markdown
							? { type: ActionType.ChatDelta, turnId: turn.turnId, partId: part.id, content }
							: { type: ActionType.ChatReasoning, turnId: turn.turnId, partId: part.id, content });
					} else if (part.content !== previous) {
						turn.diverged = true;
						return;
					}
					turn.text.set(part.id, part.content);
					break;
				}
				case ResponsePartKind.ToolCall:
					this._emitToolCall(chatId, turn, part.toolCall);
					break;
				case ResponsePartKind.Error:
					// The turn's end carries it.
					break;
				default: {
					// The window appends parts in stream order, so the position names a part.
					const key = `${part.kind}:${index}`;
					if (!turn.parts.has(key)) {
						turn.parts.add(key);
						this._fire(chatId, { type: ActionType.ChatResponsePart, turnId: turn.turnId, part });
					}
				}
			}
		});
	}

	private _emitToolCall(chatId: string, turn: IEmittedTurn, toolCall: ToolCallState): void {
		const status = toolCall.status;
		const previous = turn.tools.get(toolCall.toolCallId);
		if (status === ToolCallStatus.Streaming || status === previous) {
			return;
		}
		// The tool's `_meta` (its kind) rides every lifecycle action, so a Viewer renders it as the
		// agent host's own agents' tools (a terminal tool stays a terminal tool after it completes).
		const base = { turnId: turn.turnId, toolCallId: toolCall.toolCallId, ...(toolCall._meta ? { _meta: toolCall._meta } : {}) };
		if (status === ToolCallStatus.PendingConfirmation) {
			this._requestConfirmation(chatId, toolCall);
			turn.tools.set(toolCall.toolCallId, status);
			return;
		}
		if (previous === undefined) {
			this._fire(chatId, { type: ActionType.ChatToolCallStart, ...base, toolName: toolCall.toolName, displayName: toolCall.displayName });
			if (status === ToolCallStatus.Cancelled) {
				this._fire(chatId, { type: ActionType.ChatToolCallConfirmed, ...base, approved: false, reason: cancellationReason(toolCall) });
				turn.tools.set(toolCall.toolCallId, status);
				return;
			}
			this._fire(chatId, {
				type: ActionType.ChatToolCallReady, ...base,
				invocationMessage: toolCall.invocationMessage,
				toolInput: toolCall.toolInput,
				confirmed: toolCall.status === ToolCallStatus.Running || toolCall.status === ToolCallStatus.Completed ? toolCall.confirmed : ToolCallConfirmationReason.NotNeeded,
			});
		} else if (previous === ToolCallStatus.PendingConfirmation) {
			this._pendingConfirmations.delete(toolCall.toolCallId);
			if (!this._viewerAnswers.delete(toolCall.toolCallId)) {
				// Answered in the editor window: tell the host, so that Viewers stop asking.
				this._fire(chatId, status === ToolCallStatus.Cancelled
					? { type: ActionType.ChatToolCallConfirmed, ...base, approved: false, reason: cancellationReason(toolCall) }
					: { type: ActionType.ChatToolCallConfirmed, ...base, approved: true, confirmed: ToolCallConfirmationReason.UserAction });
			}
		}
		if (status === ToolCallStatus.Completed) {
			this._fire(chatId, {
				type: ActionType.ChatToolCallComplete, ...base,
				result: {
					success: toolCall.success,
					pastTenseMessage: toolCall.pastTenseMessage,
					...(toolCall.content ? { content: toolCall.content } : {}),
					...(toolCall.error ? { error: toolCall.error } : {}),
				},
			});
		}
		turn.tools.set(toolCall.toolCallId, status);
	}

	/**
	 * Publishes an editor tool confirmation to the host (D3). `managedApprovalRequired` keeps the
	 * host's auto-approval rules out (the editor already decided to ask), offers Allow Once and Skip
	 * only, and stops the host from writing an "Allow in this Session" rule.
	 */
	private _requestConfirmation(chatId: string, toolCall: ToolCallPendingConfirmationState): void {
		this._pendingConfirmations.set(toolCall.toolCallId, chatId);
		this._onDidChatProgress.fire({
			kind: 'pending_confirmation',
			chat: this._chatUri(chatId),
			state: toolCall,
			permissionKind: 'custom-tool',
			managedApprovalRequired: true,
		});
		this._logService.info(`${LOG_PREFIX} tool confirmation ${toolCall.toolCallId} published`);
	}

	private async _reloadHistory(chatId: string): Promise<void> {
		const chat = await this._window(chatId)?.getChat(chatId).catch(() => undefined);
		if (chat && this._watched.has(chatId)) {
			this._onDidChangeChatHistory.fire({ chat: this._chatUri(chatId), turns: chat.turns.map(turn => this._aliased(turn)) });
		}
	}

	private _aliased(turn: Turn): Turn {
		const turnId = this._turnAliases.get(turn.id);
		return turnId ? { ...turn, id: turnId } : turn;
	}

	// ---- IAgent ---------------------------------------------------------------------------------

	getDescriptor(): IAgentDescriptor {
		return {
			provider: this.id,
			displayName: localize('flowleapChat.displayName', "Editor Chat"),
			description: localize('flowleapChat.description', "The Patent Agent chats of this Host's editor windows, followed with Remote Access."),
		};
	}

	readonly chats: IAgentChats = {
		createChat: async (): Promise<IAgentCreateChatResult | void> => {
			throw new Error('A Viewer cannot create an editor chat (Remote Access v1).');
		},
		disposeChat: async () => { },
		releaseChat: async () => { },
		sendMessage: async (chat, prompt, _workingDirectories, _attachments, turnId) => {
			const chatId = this._chatId(chat);
			const window = chatId ? this._window(chatId) : undefined;
			if (!chatId || !window) {
				throw new Error('The window that owns this editor chat is not open.');
			}
			if (turnId) {
				this._pendingViewerTurns.set(chatId, turnId);
			}
			this._logService.info(`${LOG_PREFIX} viewer message for turn ${turnId ?? '(none)'}`);
			try {
				await window.sendMessage(chatId, prompt);
			} catch (error) {
				this._pendingViewerTurns.delete(chatId);
				throw error;
			}
		},
		abort: async chat => {
			const chatId = this._chatId(chat);
			if (!chatId) {
				return;
			}
			// The host ended its turn already; the window's cancelled request must not end it again.
			const emitted = this._emitted.get(chatId);
			if (emitted) {
				this._emitted.delete(chatId);
				this._abandonedTurns.add(emitted.windowTurnId);
			}
			this._pendingViewerTurns.delete(chatId);
			await this._window(chatId)?.cancel(chatId);
		},
		changeModel: async () => { },
		changeAgent: async () => { },
		getMessages: async chat => {
			const chatId = this._chatId(chat);
			const window = chatId ? this._window(chatId) : undefined;
			if (!chatId || !window) {
				return [];
			}
			if (!this._watched.has(chatId) && !this._pendingViewerTurns.has(chatId)) {
				// A restore: the host state starts from these finished turns, without an active turn.
				// `watchChatHistory` puts a running turn back once the restored state exists.
				this._emitted.delete(chatId);
			}
			const mirrored = await window.getChat(chatId);
			return mirrored ? mirrored.turns.map(turn => this._aliased(turn)) : [];
		},
	};

	/**
	 * The host calls this once a client subscribes to a chat whose state exists (after a restore,
	 * or when the first client comes back). It is the resync for a Viewer that opens a chat while
	 * the editor runs a turn: the running turn goes back into the host state.
	 */
	watchChatHistory(chat: URI): IDisposable {
		const chatId = this._chatId(chat);
		if (!chatId) {
			return toDisposable(() => { });
		}
		this._watched.add(chatId);
		void this._resync(chatId);
		return toDisposable(() => this._watched.delete(chatId));
	}

	private async _resync(chatId: string): Promise<void> {
		if (this._emitted.has(chatId)) {
			return;
		}
		const mirrored = await this._window(chatId)?.getChat(chatId).catch(() => undefined);
		const active = mirrored?.activeTurn;
		if (!active || !this._watched.has(chatId) || this._emitted.has(chatId) || this._abandonedTurns.has(active.turnId)) {
			return;
		}
		this._emitParts(chatId, this._startTurn(chatId, active), active.responseParts);
	}

	async materializeChat(): Promise<void> { }

	async setWorkingDirectory(): Promise<void> {
		throw new Error('An editor chat has no working directory to change.');
	}

	getOrCreateActiveClient(_chat: URI, _context: URI | IAgentChatContext, client: { readonly clientId: string; readonly displayName?: string }): IActiveClient {
		return { clientId: client.clientId, displayName: client.displayName, tools: [], customizations: [] };
	}

	removeActiveClient(): void { }

	onClientToolCallComplete(): void { }

	/**
	 * Forwards a Viewer's answer to the window, once (D3). The host also calls this to refuse a
	 * request on its own (a turn that ended, a request without a turn); those calls carry no client
	 * origin and are ignored, because only the editor or a Viewer may answer an editor tool.
	 */
	respondToPermissionRequest(requestId: string, approved: boolean, context?: IAgentPermissionResponseContext): void {
		const chatId = this._pendingConfirmations.get(requestId);
		if (!chatId) {
			return;
		}
		if (!context?.origin) {
			this._logService.trace(`${LOG_PREFIX} host-side answer for ${requestId} ignored`);
			return;
		}
		const window = this._window(chatId);
		if (!window) {
			this._logService.warn(`${LOG_PREFIX} no window for tool confirmation ${requestId}`);
			return;
		}
		this._viewerAnswers.add(requestId);
		this._logService.info(`${LOG_PREFIX} viewer answered ${requestId}: ${approved ? 'allow' : 'skip'}`);
		window.confirmToolCall(chatId, requestId, approved).then(answered => {
			if (!answered) {
				this._viewerAnswers.delete(requestId);
			}
		}, () => this._viewerAnswers.delete(requestId));
	}

	respondToUserInputRequest(): void { }

	async resolveChatConfig(): Promise<ResolveSessionConfigResult> {
		return { schema: { type: 'object', properties: {} }, values: {} };
	}

	getInheritedChatConfig(): undefined {
		return undefined;
	}

	async chatConfigCompletions(): Promise<SessionConfigCompletionsResult> {
		return { items: [] };
	}

	async getChatCustomizations() {
		return [];
	}

	async listChatsToMigrate(): Promise<AgentChatMigrationResult> {
		return [];
	}

	async getChatMetadata(chat: URI, context: URI | IAgentChatContext): Promise<IAgentChatMetadata | undefined> {
		const chatId = this._chatId(resolveAgentChatContext(context, chat).configurationResource) ?? this._chatId(chat);
		const published = chatId ? this._chats.get(chatId) : undefined;
		return published ? { ...this._metadata(published.summary), chat } : undefined;
	}

	getProtectedResources(): ProtectedResourceMetadata[] {
		return [];
	}

	async authenticate(): Promise<boolean> {
		return true;
	}

	async shutdown(): Promise<void> { }
}

function cancellationReason(toolCall: ToolCallState): ToolCallCancellationReason.Denied | ToolCallCancellationReason.Skipped {
	return toolCall.status === ToolCallStatus.Cancelled && toolCall.reason === ToolCallCancellationReason.Skipped
		? ToolCallCancellationReason.Skipped
		: ToolCallCancellationReason.Denied;
}

/** What {@link FlowLeapChatAgentRegistration} needs of the provider service. */
export interface IFlowLeapChatAgentProviders {
	registerProvider(provider: IAgent): void;
	unregisterProvider(provider: string): void;
}

/**
 * Registers the `flowleap-chat` agent while at least one window publishes its chats, and removes
 * it when the last one stops (PRD 0018 C3, decision D5). A window publishes only while Remote
 * Access is on, so with Remote Access off the agent does not exist: Viewers see no Editor Chat
 * agent and no Editor Chats.
 */
export class FlowLeapChatAgentRegistration extends Disposable {

	private _registered = false;

	constructor(
		private readonly _registry: AgentHostChatMirrorRegistry,
		private readonly _providers: IFlowLeapChatAgentProviders,
		private readonly _createAgent: () => FlowLeapChatMirrorAgent,
		private readonly _logService: ILogService,
	) {
		super();
		this._register(this._registry.onDidChangePublishers(() => this._update()));
		this._update();
	}

	get registered(): boolean {
		return this._registered;
	}

	private _update(): void {
		if (this._registry.hasPublishers === this._registered) {
			return;
		}
		if (this._registered) {
			// The agent already retracted the chats of the window that withdrew (it hears the
			// withdrawal first); removing it disposes it.
			this._registered = false;
			this._providers.unregisterProvider(FLOWLEAP_CHAT_AGENT_PROVIDER_ID);
			this._logService.info(`${LOG_PREFIX} no window publishes: agent removed`);
			return;
		}
		const agent = this._createAgent();
		try {
			this._providers.registerProvider(agent);
		} catch (error) {
			agent.dispose();
			this._logService.warn(`${LOG_PREFIX} agent registration failed: ${error instanceof Error ? error.name : 'unknown error'}`);
			return;
		}
		this._registered = true;
		this._logService.info(`${LOG_PREFIX} a window publishes: agent registered`);
		agent.offerPublishedChats();
	}
}
