/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// FlowLeap (PRD 0018 C1, #719): the editor chat mirror. A window publishes its editor Patent
// Agent chats (workbench chat models, extension-host participant, BYOK) to the local agent host,
// so that the `flowleap-chat` agent can serve them over the agent host protocol to a remote
// Viewer. The window is the source of truth; the agent host only mirrors. Model calls never move:
// they stay in the window's extension host (ADR 0009 decision 2).
//
// Two directions, one MessagePort connection per window:
// - window → agent host: `publishChatMirror` on the Management channel (as B3's
//   `setRemoteAccessHost`). The window publishes only while Remote Access is on (D5).
// - agent host → window: the `agentHostClientChatMirror` reverse channel, for a Viewer's send,
//   permission answer and cancel. The agent host calls only a window that published.

import { Emitter, Event } from '../../../base/common/event.js';
import { Disposable, IDisposable, toDisposable } from '../../../base/common/lifecycle.js';
import { IChannel, IServerChannel } from '../../../base/parts/ipc/common/ipc.js';
import { createDecorator } from '../../instantiation/common/instantiation.js';
import type { ResponsePart, Turn } from './state/sessionState.js';

/** The provider id of the agent host agent that serves mirrored editor chats. */
export const FLOWLEAP_CHAT_AGENT_PROVIDER_ID = 'flowleap-chat';

/**
 * Whether the agent host registers the `flowleap-chat` agent and windows publish their chats.
 * Off until C3 (#720) hides the agent in the local Agents Window, which would otherwise list every
 * editor chat a second time (the Local provider already lists them).
 */
export const FLOWLEAP_CHAT_MIRROR_ENABLED = false;

/** The version of {@link ChatMirrorPublication}. The agent host drops other versions. */
export const CHAT_MIRROR_PUBLICATION_VERSION = 1;

/**
 * IPC channel name for the agent host → window commands. The window registers a server channel
 * under this name on its `MessagePortClient`; the agent host reaches it with
 * `server.getChannel(name, c => c.ctx === clientId)`, as for the BYOK bridge.
 */
export const AGENT_HOST_CLIENT_CHAT_MIRROR_CHANNEL = 'agentHostClientChatMirror';

/** One editor chat that a window offers. */
export interface IMirroredChatSummary {
	/** The chat model resource. Stable across reloads of the window. */
	readonly id: string;
	/** The editor's title. It stays in memory and on the wire; the agent host writes a neutral title to disk (D1). */
	readonly title: string;
	readonly createdAt: number;
	readonly modifiedAt: number;
}

/** The request that runs now in the window. */
export interface IMirroredActiveTurn {
	/** The window's request id. */
	readonly turnId: string;
	readonly startedAt: number;
	readonly message: Turn['message'];
	/** Part ids are stable across updates: `<requestId>:<index>`. */
	readonly responseParts: readonly ResponsePart[];
}

/** The full state of one chat. */
export interface IMirroredChat {
	readonly id: string;
	/** Finished requests only, in order. */
	readonly turns: readonly Turn[];
	readonly activeTurn?: IMirroredActiveTurn;
}

/** A change of one chat, as the window publishes it while a Viewer may follow. */
export interface IMirroredChatUpdate {
	readonly id: string;
	readonly activeTurn?: IMirroredActiveTurn;
	/** Requests that finished since the previous update of this chat, oldest first. */
	readonly endedTurns: readonly Turn[];
	/** The finished history changed in another way, for example a request was removed in the editor. */
	readonly historyChanged: boolean;
}

/** What a window publishes on the Management channel. */
export type ChatMirrorPublication =
	/** The complete list of the window's chats. Replaces the previous list. */
	| { readonly version: typeof CHAT_MIRROR_PUBLICATION_VERSION; readonly kind: 'chats'; readonly clientId: string; readonly chats: readonly IMirroredChatSummary[] }
	| { readonly version: typeof CHAT_MIRROR_PUBLICATION_VERSION; readonly kind: 'chat'; readonly clientId: string; readonly update: IMirroredChatUpdate }
	/** The window stops publishing (Remote Access off, or the window closes). */
	| { readonly version: typeof CHAT_MIRROR_PUBLICATION_VERSION; readonly kind: 'withdraw'; readonly clientId: string };

/** The commands the agent host sends to the window that owns a chat. */
export interface IAgentHostChatMirrorWindow {
	getChat(id: string): Promise<IMirroredChat | undefined>;
	/** Sends the next message the way the chat view would, with its mode, model and tools. */
	sendMessage(id: string, text: string): Promise<void>;
	/** Answers a pending tool confirmation once. Returns `false` when it no longer waits. */
	confirmToolCall(id: string, toolCallId: string, approved: boolean): Promise<boolean>;
	cancel(id: string): Promise<void>;
}

/** The window side of the mirror: implemented over `IChatService` in the workbench. */
export interface IAgentHostChatMirrorSource extends IAgentHostChatMirrorWindow {
	readonly _serviceBrand: undefined;
}

export const IAgentHostChatMirrorSource = createDecorator<IAgentHostChatMirrorSource>('agentHostChatMirrorSource');

interface ISendMessageArgs {
	readonly id: string;
	readonly text: string;
}

interface IConfirmToolCallArgs {
	readonly id: string;
	readonly toolCallId: string;
	readonly approved: boolean;
}

/** The agent host end of the reverse channel to one window. */
export function createAgentHostChatMirrorWindow(channel: IChannel): IAgentHostChatMirrorWindow {
	return {
		getChat: id => channel.call<IMirroredChat | undefined>('getChat', id),
		sendMessage: (id, text) => channel.call<void>('sendMessage', { id, text } satisfies ISendMessageArgs),
		confirmToolCall: (id, toolCallId, approved) => channel.call<boolean>('confirmToolCall', { id, toolCallId, approved } satisfies IConfirmToolCallArgs),
		cancel: id => channel.call<void>('cancel', id),
	};
}

/** The window end of the reverse channel: a thin adapter over {@link IAgentHostChatMirrorSource}. */
export class AgentHostClientChatMirrorChannel implements IServerChannel {

	constructor(@IAgentHostChatMirrorSource private readonly _source: IAgentHostChatMirrorSource) { }

	listen<T>(_ctx: unknown, event: string): Event<T> {
		throw new Error(`No event '${event}' on ${AGENT_HOST_CLIENT_CHAT_MIRROR_CHANNEL}`);
	}

	async call<T>(_ctx: unknown, command: string, arg?: unknown): Promise<T> {
		switch (command) {
			case 'getChat': return await this._source.getChat(arg as string) as T;
			case 'sendMessage': {
				const { id, text } = arg as ISendMessageArgs;
				return await this._source.sendMessage(id, text) as T;
			}
			case 'confirmToolCall': {
				const { id, toolCallId, approved } = arg as IConfirmToolCallArgs;
				return await this._source.confirmToolCall(id, toolCallId, approved) as T;
			}
			case 'cancel': return await this._source.cancel(arg as string) as T;
		}
		throw new Error(`Unknown command '${command}' on ${AGENT_HOST_CLIENT_CHAT_MIRROR_CHANNEL}`);
	}
}

/** A window that publishes chats, as the agent host sees it. */
export interface IChatMirrorPublisher {
	readonly clientId: string;
	readonly window: IAgentHostChatMirrorWindow;
	readonly chats: readonly IMirroredChatSummary[];
}

/**
 * The agent host's view of every window that publishes. A window is known once its connection is
 * attached ({@link attachWindow}); it publishes once it sends a chat list. Publications from a
 * client without an attached connection, or with another version, are dropped.
 */
export class AgentHostChatMirrorRegistry extends Disposable {

	private readonly _windows = new Map<string, IAgentHostChatMirrorWindow>();
	private readonly _publishers = new Map<string, IChatMirrorPublisher>();

	private readonly _onDidChangeChats = this._register(new Emitter<IChatMirrorPublisher>());
	/** A window published a new chat list. */
	readonly onDidChangeChats = this._onDidChangeChats.event;

	private readonly _onDidUpdateChat = this._register(new Emitter<{ readonly clientId: string; readonly update: IMirroredChatUpdate }>());
	readonly onDidUpdateChat = this._onDidUpdateChat.event;

	private readonly _onDidWithdraw = this._register(new Emitter<string>());
	/** A window stopped publishing: its chats are gone. */
	readonly onDidWithdraw = this._onDidWithdraw.event;

	get publishers(): Iterable<IChatMirrorPublisher> {
		return this._publishers.values();
	}

	getPublisher(clientId: string): IChatMirrorPublisher | undefined {
		return this._publishers.get(clientId);
	}

	/** Attaches the reverse channel of one renderer window. Disposing withdraws its chats. */
	attachWindow(clientId: string, window: IAgentHostChatMirrorWindow): IDisposable {
		this._windows.set(clientId, window);
		return toDisposable(() => {
			if (this._windows.get(clientId) === window) {
				this._windows.delete(clientId);
				this._withdraw(clientId);
			}
		});
	}

	/** Returns whether the publication was accepted. */
	publish(publication: ChatMirrorPublication): boolean {
		if (publication.version !== CHAT_MIRROR_PUBLICATION_VERSION) {
			return false;
		}
		const window = this._windows.get(publication.clientId);
		if (!window) {
			return false;
		}
		switch (publication.kind) {
			case 'chats': {
				const publisher: IChatMirrorPublisher = { clientId: publication.clientId, window, chats: publication.chats };
				this._publishers.set(publication.clientId, publisher);
				this._onDidChangeChats.fire(publisher);
				return true;
			}
			case 'chat':
				if (!this._publishers.has(publication.clientId)) {
					return false;
				}
				this._onDidUpdateChat.fire({ clientId: publication.clientId, update: publication.update });
				return true;
			case 'withdraw':
				this._withdraw(publication.clientId);
				return true;
		}
	}

	private _withdraw(clientId: string): void {
		if (this._publishers.delete(clientId)) {
			this._onDidWithdraw.fire(clientId);
		}
	}
}
