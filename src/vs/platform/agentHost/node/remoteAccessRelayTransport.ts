/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Remote Access Host transport (docs/remote-access/RELAY-CONTRACT.md section 3, section 4, section 6, section 7).
//
// The Host does not listen. This IProtocolServer dials the FlowLeap Relay,
// authenticates with the first frame, and hands one IProtocolTransport per
// live Viewer to ProtocolServerHandler, exactly as WebSocketProtocolServer
// hands it a local socket. The bytes inside are end-to-end encrypted with the
// pair key, so the Relay forwards what it cannot read.
//
// Named `remoteAccessRelayTransport` (not `relayTransport`) because
// `common/relayTransport.ts` is upstream's unrelated shared-process relay.

import { Emitter } from '../../../base/common/event.js';
import { Disposable, toDisposable } from '../../../base/common/lifecycle.js';
import { ILogService } from '../../log/common/log.js';
import { AgentHostClientConnectionKind, AgentHostTransportKind } from '../common/agentHostTelemetry.js';
import {
	bytesToUuid, getRemoteAccessFrameKind, RemoteAccessChannelCipher, RemoteAccessCryptoError, RemoteAccessE2EFrameKind,
	RemoteAccessHandshake, RemoteAccessRole, uuidToBytes,
} from '../common/remoteAccessCrypto.js';
import { IRemoteAccessHostPair, IRemoteAccessHostStatus, RemoteAccessHostState } from '../common/remoteAccessHost.js';
import { JSON_RPC_PARSE_ERROR, type AhpServerNotification, type JsonRpcNotification, type JsonRpcParseErrorResponse, type JsonRpcRequest, type JsonRpcResponse, type ProtocolMessage } from '../common/state/sessionProtocol.js';
import type { IProtocolServer, IProtocolTransport } from '../common/state/sessionTransport.js';
import type * as wsTypes from 'ws';

/** Relay payload frame to or from one pair (section 4). */
export const RELAY_FRAME_PAIR = 0x01;
/** Relay payload frame from the Host to every live Viewer (section 4). AHP does not use it. */
export const RELAY_FRAME_BROADCAST = 0x02;

/** Relay close codes (section 3, section 4). */
export const enum RelayCloseCode {
	Unauthorized = 4401,
	SubscriptionRequired = 4402,
	Forbidden = 4403,
	Idle = 4408,
	Replaced = 4409,
	TooLarge = 4413,
}

export interface IRemoteAccessRelayOptions {
	/** `wss://…/v1/remote-access/host` */
	readonly relayUrl: string;
	/** The FlowLeap Session token. Kept in memory only, never logged. */
	readonly token: string;
	readonly hostId: string;
	readonly appVersion: string;
	readonly ahpVersions: readonly string[];
	readonly pairs: readonly IRemoteAccessHostPair[];
}

export interface IRemoteAccessRelayTimings {
	readonly initialRetryMs: number;
	readonly maxRetryMs: number;
	readonly pingIntervalMs: number;
	readonly welcomeTimeoutMs: number;
}

const DEFAULT_TIMINGS: IRemoteAccessRelayTimings = {
	initialRetryMs: 1_000,
	maxRetryMs: 60_000,
	pingIntervalMs: 25_000,
	welcomeTimeoutMs: 10_000,
};

const LOG_PREFIX = '[RemoteAccess]';

/** Builds the binary `[0x01][pairId 16 bytes][payload]` frame. */
export function encodePairFrame(pairId: string, payload: Uint8Array): Uint8Array {
	const frame = new Uint8Array(1 + 16 + payload.byteLength);
	frame[0] = RELAY_FRAME_PAIR;
	frame.set(uuidToBytes(pairId), 1);
	frame.set(payload, 17);
	return frame;
}

/** Builds the binary `[0x02][payload]` broadcast frame. Unused by AHP; kept for the attention work (B6). */
export function encodeBroadcastFrame(payload: Uint8Array): Uint8Array {
	const frame = new Uint8Array(1 + payload.byteLength);
	frame[0] = RELAY_FRAME_BROADCAST;
	frame.set(payload, 1);
	return frame;
}

/** Parses a Relay → Host `[0x01][pairId 16 bytes][payload]` frame. */
export function decodePairFrame(frame: Uint8Array): { readonly pairId: string; readonly payload: Uint8Array } | undefined {
	if (frame.byteLength < 18 || frame[0] !== RELAY_FRAME_PAIR) {
		return undefined;
	}
	return { pairId: bytesToUuid(frame.subarray(1, 17)), payload: frame.subarray(17) };
}

type ProtocolOutboundMessage = ProtocolMessage | AhpServerNotification | JsonRpcNotification | JsonRpcParseErrorResponse | JsonRpcResponse | JsonRpcRequest;

/**
 * One Viewer's decrypted AHP stream, as {@link ProtocolServerHandler} sees it.
 */
export class RemoteAccessRelayProtocolTransport extends Disposable implements IProtocolTransport {
	readonly transportKind = AgentHostTransportKind.WebSocket;
	readonly clientConnectionKind = AgentHostClientConnectionKind.Unknown;

	private readonly _onMessage = this._register(new Emitter<ProtocolMessage>());
	readonly onMessage = this._onMessage.event;

	private readonly _onClose = this._register(new Emitter<void>());
	readonly onClose = this._onClose.event;

	private _closed = false;

	constructor(
		readonly pairId: string,
		private readonly _send: (text: string) => void,
	) {
		super();
	}

	get isClosed(): boolean {
		return this._closed;
	}

	/** Delivers one decrypted AHP message. */
	acceptText(text: string): void {
		if (this._closed) {
			return;
		}
		let message: ProtocolMessage;
		try {
			message = JSON.parse(text) as ProtocolMessage;
		} catch {
			this.send({ jsonrpc: '2.0', id: null, error: { code: JSON_RPC_PARSE_ERROR, message: 'Parse error' } });
			return;
		}
		this._onMessage.fire(message);
	}

	send(message: ProtocolOutboundMessage): void {
		if (!this._closed) {
			this._send(JSON.stringify(message));
		}
	}

	/** Marks the stream closed and tells the handler once. */
	close(): void {
		if (this._closed) {
			return;
		}
		this._closed = true;
		this._onClose.fire();
	}

	override dispose(): void {
		this.close();
		super.dispose();
	}
}

/** Per-pair E2E state on the Host. */
class PairChannel {
	private _cipher: RemoteAccessChannelCipher | undefined;
	private _transport: RemoteAccessRelayProtocolTransport | undefined;
	/** Serializes incoming frames: the cipher needs strict order. */
	private _receiveQueue: Promise<void> = Promise.resolve();
	/** Serializes outgoing frames for the same reason. */
	private _sendQueue: Promise<void> = Promise.resolve();
	private _generation = 0;

	constructor(
		readonly pairId: string,
		private _pairKey: Uint8Array,
		private readonly _sendFrame: (payload: Uint8Array) => void,
		private readonly _onTransport: (transport: RemoteAccessRelayProtocolTransport) => void,
		private readonly _onDidChangeConnected: () => void,
		private readonly _logService: ILogService,
	) { }

	get connected(): boolean {
		return !!this._transport && !this._transport.isClosed;
	}

	setPairKey(pairKey: Uint8Array): void {
		this._pairKey = pairKey;
	}

	accept(payload: Uint8Array): void {
		const copy = new Uint8Array(payload);
		this._receiveQueue = this._receiveQueue.then(() => this._process(copy)).catch(error => {
			this._logService.warn(`${LOG_PREFIX} Dropped a Viewer stream: ${error instanceof RemoteAccessCryptoError ? error.message : 'unexpected error'}`);
			this.reset();
		});
	}

	/** Closes the current Viewer stream (Viewer offline, Relay gone, pair removed). */
	reset(): void {
		this._generation++;
		this._cipher = undefined;
		this._sendQueue = Promise.resolve();
		const transport = this._transport;
		this._transport = undefined;
		if (transport) {
			transport.dispose();
			this._onDidChangeConnected();
		}
	}

	private async _process(payload: Uint8Array): Promise<void> {
		const kind = getRemoteAccessFrameKind(payload);
		if (kind === RemoteAccessE2EFrameKind.Handshake) {
			await this._handshake(payload);
		} else if (kind === RemoteAccessE2EFrameKind.Data) {
			const cipher = this._cipher;
			const transport = this._transport;
			if (!cipher || !transport) {
				throw new RemoteAccessCryptoError('Data before handshake.');
			}
			const text = await cipher.open(payload);
			if (text !== undefined) {
				transport.acceptText(text);
			}
		} else {
			throw new RemoteAccessCryptoError('Unknown frame kind.');
		}
	}

	/** A Viewer (re)connected: answer with a fresh ephemeral key and open a new stream. */
	private async _handshake(peerMessage: Uint8Array): Promise<void> {
		this.reset();
		const generation = this._generation;
		const handshake = await RemoteAccessHandshake.create(RemoteAccessRole.Host, this._pairKey, this.pairId);
		const cipher = await handshake.complete(peerMessage);
		if (generation !== this._generation) {
			return;
		}
		this._cipher = cipher;
		this._sendFrame(handshake.message);
		const transport = new RemoteAccessRelayProtocolTransport(this.pairId, text => this._enqueueSend(generation, cipher, text));
		this._transport = transport;
		this._onDidChangeConnected();
		this._onTransport(transport);
	}

	private _enqueueSend(generation: number, cipher: RemoteAccessChannelCipher, text: string): void {
		this._sendQueue = this._sendQueue.then(async () => {
			if (generation !== this._generation) {
				return;
			}
			const frames = await cipher.seal(text);
			if (generation !== this._generation) {
				return;
			}
			for (const frame of frames) {
				this._sendFrame(frame);
			}
		}).catch(error => {
			this._logService.warn(`${LOG_PREFIX} Failed to encrypt a message for a Viewer`, error instanceof Error ? error.message : undefined);
		});
	}
}

/**
 * The outbound Remote Access transport. Construct, then {@link start}.
 * Reconnects with exponential backoff (1 s → 60 s) until disposed, unless
 * the Relay refuses the identity (4401, 4402) or another socket took the
 * same Host (4409); {@link updateOptions} with a new token retries those.
 */
export class RemoteAccessRelayProtocolServer extends Disposable implements IProtocolServer {

	private readonly _onConnection = this._register(new Emitter<IProtocolTransport>());
	readonly onConnection = this._onConnection.event;

	private readonly _onDidChangeStatus = this._register(new Emitter<IRemoteAccessHostStatus>());
	readonly onDidChangeStatus = this._onDidChangeStatus.event;

	private _options: IRemoteAccessRelayOptions;
	private readonly _timings: IRemoteAccessRelayTimings;
	private readonly _pairs = new Map<string, PairChannel>();
	private _socket: wsTypes.WebSocket | undefined;
	private _wsModule: typeof wsTypes | undefined;
	private _started = false;
	private _attempt = 0;
	private _retryTimer: ReturnType<typeof setTimeout> | undefined;
	private _pingTimer: ReturnType<typeof setInterval> | undefined;
	private _welcomeTimer: ReturnType<typeof setTimeout> | undefined;
	private _state: RemoteAccessHostState = RemoteAccessHostState.Stopped;
	private _lastCloseCode: number | undefined;
	private _connectionSerial = 0;

	constructor(
		options: IRemoteAccessRelayOptions,
		private readonly _logService: ILogService,
		timings?: Partial<IRemoteAccessRelayTimings>,
	) {
		super();
		this._options = options;
		this._timings = { ...DEFAULT_TIMINGS, ...timings };
		this._syncPairs();
		this._register(toDisposable(() => this._stop()));
	}

	get address(): string | undefined {
		return this._options.relayUrl;
	}

	get status(): IRemoteAccessHostStatus {
		return {
			state: this._state,
			connectedPairIds: [...this._pairs.values()].filter(p => p.connected).map(p => p.pairId),
			lastCloseCode: this._lastCloseCode,
		};
	}

	start(): void {
		if (this._started) {
			return;
		}
		this._started = true;
		this._connect();
	}

	/**
	 * Applies new options. A new Relay URL or Host id reconnects. A new token
	 * is used from the next connection, and reconnects at once when the Relay
	 * refused the previous identity. Removed pairs lose their stream.
	 */
	updateOptions(options: IRemoteAccessRelayOptions): void {
		const previous = this._options;
		this._options = options;
		this._syncPairs();
		if (!this._started) {
			return;
		}
		const endpointChanged = previous.relayUrl !== options.relayUrl || previous.hostId !== options.hostId;
		const tokenChanged = previous.token !== options.token;
		const refused = this._state === RemoteAccessHostState.Unauthorized
			|| this._state === RemoteAccessHostState.SubscriptionRequired
			|| this._state === RemoteAccessHostState.Replaced;
		if (endpointChanged || (tokenChanged && refused)) {
			this._closeSocket();
			this._attempt = 0;
			this._connect();
		}
	}

	private _syncPairs(): void {
		const wanted = new Map(this._options.pairs.map(pair => [pair.pairId.toLowerCase(), pair.pairKey]));
		for (const [pairId, channel] of this._pairs) {
			if (!wanted.has(pairId)) {
				channel.reset();
				this._pairs.delete(pairId);
			}
		}
		for (const [pairId, pairKey] of wanted) {
			const existing = this._pairs.get(pairId);
			if (existing) {
				existing.setPairKey(pairKey);
				continue;
			}
			this._pairs.set(pairId, new PairChannel(
				pairId,
				pairKey,
				payload => this._sendBinary(encodePairFrame(pairId, payload)),
				transport => this._onConnection.fire(transport),
				() => this._fireStatus(),
				this._logService,
			));
		}
	}

	private _setState(state: RemoteAccessHostState): void {
		if (this._state !== state) {
			this._state = state;
			this._fireStatus();
		}
	}

	private _fireStatus(): void {
		this._onDidChangeStatus.fire(this.status);
	}

	private async _loadWs(): Promise<typeof wsTypes> {
		if (!this._wsModule) {
			this._wsModule = await import('ws');
		}
		return this._wsModule;
	}

	private _connect(): void {
		if (this._store.isDisposed) {
			return;
		}
		const serial = ++this._connectionSerial;
		this._setState(this._attempt === 0 ? RemoteAccessHostState.Connecting : RemoteAccessHostState.Retrying);
		void this._loadWs().then(ws => {
			if (serial !== this._connectionSerial || this._store.isDisposed) {
				return;
			}
			let socket: wsTypes.WebSocket;
			try {
				socket = new ws.WebSocket(this._options.relayUrl, { maxPayload: 2 * 1024 * 1024 });
			} catch (error) {
				this._logService.warn(`${LOG_PREFIX} Cannot open the Relay socket`, error instanceof Error ? error.message : undefined);
				this._scheduleRetry();
				return;
			}
			this._socket = socket;
			this._wire(socket, serial);
		}, error => {
			this._logService.error(`${LOG_PREFIX} Cannot load ws`, error);
			this._scheduleRetry();
		});
	}

	private _wire(socket: wsTypes.WebSocket, serial: number): void {
		const isCurrent = () => serial === this._connectionSerial && this._socket === socket;

		socket.on('open', () => {
			if (!isCurrent()) {
				return;
			}
			const hello = {
				t: 'hello',
				role: 'host',
				token: this._options.token,
				hostId: this._options.hostId,
				appVersion: this._options.appVersion,
				ahp: this._options.ahpVersions,
			};
			socket.send(JSON.stringify(hello));
			this._welcomeTimer = setTimeout(() => {
				if (isCurrent()) {
					this._logService.warn(`${LOG_PREFIX} The Relay did not answer hello`);
					socket.close();
				}
			}, this._timings.welcomeTimeoutMs);
		});

		socket.on('message', (data: Buffer | ArrayBuffer | Buffer[], isBinary: boolean) => {
			if (!isCurrent()) {
				return;
			}
			const bytes = Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data as ArrayBuffer);
			if (isBinary) {
				this._onBinary(bytes);
			} else {
				this._onControl(bytes.toString('utf-8'));
			}
		});

		socket.on('close', (code: number) => {
			if (!isCurrent()) {
				return;
			}
			this._onSocketClosed(code);
		});

		socket.on('error', (error: Error) => {
			// 'close' always follows.
			if (isCurrent()) {
				this._logService.trace(`${LOG_PREFIX} Relay socket error: ${error.message}`);
			}
		});
	}

	private _onControl(text: string): void {
		let frame: { t?: unknown; pairId?: unknown; online?: unknown; pairs?: unknown };
		try {
			frame = JSON.parse(text);
		} catch {
			return;
		}
		switch (frame.t) {
			case 'welcome': {
				this._clearTimer('welcome');
				this._attempt = 0;
				this._lastCloseCode = undefined;
				this._startPing();
				this._setState(RemoteAccessHostState.Connected);
				this._logService.info(`${LOG_PREFIX} Connected to the Relay`);
				break;
			}
			case 'viewer': {
				if (typeof frame.pairId === 'string' && frame.online === false) {
					this._pairs.get(frame.pairId.toLowerCase())?.reset();
				}
				break;
			}
			case 'pong':
			default:
				break;
		}
	}

	private _onBinary(bytes: Uint8Array): void {
		const frame = decodePairFrame(bytes);
		if (!frame) {
			return;
		}
		const channel = this._pairs.get(frame.pairId);
		if (!channel) {
			this._logService.trace(`${LOG_PREFIX} Frame for a pair this Host does not know`);
			return;
		}
		channel.accept(frame.payload);
	}

	private _sendBinary(frame: Uint8Array): void {
		const socket = this._socket;
		if (socket && this._wsModule && socket.readyState === this._wsModule.WebSocket.OPEN) {
			socket.send(frame);
		}
	}

	private _startPing(): void {
		this._clearTimer('ping');
		this._pingTimer = setInterval(() => {
			const socket = this._socket;
			if (socket && this._wsModule && socket.readyState === this._wsModule.WebSocket.OPEN) {
				socket.send(JSON.stringify({ t: 'ping' }));
			}
		}, this._timings.pingIntervalMs);
	}

	private _onSocketClosed(code: number): void {
		this._socket = undefined;
		this._clearTimer('welcome');
		this._clearTimer('ping');
		this._lastCloseCode = code;
		for (const channel of this._pairs.values()) {
			channel.reset();
		}
		this._logService.info(`${LOG_PREFIX} Relay socket closed (${code})`);
		switch (code) {
			case RelayCloseCode.Unauthorized:
				this._setState(RemoteAccessHostState.Unauthorized);
				return;
			case RelayCloseCode.SubscriptionRequired:
				this._setState(RemoteAccessHostState.SubscriptionRequired);
				return;
			case RelayCloseCode.Replaced:
				this._setState(RemoteAccessHostState.Replaced);
				return;
		}
		this._scheduleRetry();
	}

	private _scheduleRetry(): void {
		if (this._store.isDisposed) {
			return;
		}
		this._clearTimer('retry');
		const delay = Math.min(this._timings.initialRetryMs * 2 ** this._attempt, this._timings.maxRetryMs);
		this._attempt++;
		this._setState(RemoteAccessHostState.Retrying);
		this._retryTimer = setTimeout(() => {
			this._retryTimer = undefined;
			this._connect();
		}, delay);
	}

	private _clearTimer(which: 'retry' | 'ping' | 'welcome'): void {
		if (which === 'retry' && this._retryTimer) {
			clearTimeout(this._retryTimer);
			this._retryTimer = undefined;
		} else if (which === 'ping' && this._pingTimer) {
			clearInterval(this._pingTimer);
			this._pingTimer = undefined;
		} else if (which === 'welcome' && this._welcomeTimer) {
			clearTimeout(this._welcomeTimer);
			this._welcomeTimer = undefined;
		}
	}

	private _closeSocket(): void {
		this._connectionSerial++;
		this._clearTimer('retry');
		this._clearTimer('ping');
		this._clearTimer('welcome');
		const socket = this._socket;
		this._socket = undefined;
		for (const channel of this._pairs.values()) {
			channel.reset();
		}
		if (socket) {
			socket.removeAllListeners('message');
			socket.on('error', () => { /* closing */ });
			socket.close(1000);
		}
	}

	private _stop(): void {
		this._closeSocket();
		this._state = RemoteAccessHostState.Stopped;
	}
}
