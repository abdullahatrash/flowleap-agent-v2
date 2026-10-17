/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Remote Access Viewer transport (docs/remote-access/RELAY-CONTRACT.md section 3,
// section 4, section 6, section 8).
//
// The browser end of the Relay. It replaces `WebSocketClientTransport` for the
// Viewer: it dials the Relay's Viewer socket, sends the `hello` frame with a
// FlowLeap Session token, runs the end-to-end handshake with the Host (the
// Viewer sends its handshake first, section 6.1), and then carries the AHP byte
// stream to `AgentHostProtocolClient` exactly as a local WebSocket does. The
// Relay sees ciphertext only.
//
// One transport is one socket. `connect()` resolves when the end-to-end
// channel is up; while the Host is offline it stays pending and reports the
// `HostOffline` page state. A Host that goes offline after that closes the
// transport, and the protocol client's reconnect makes a new one.

import { Emitter } from '../../../base/common/event.js';
import { IntervalTimer } from '../../../base/common/async.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { ILogService } from '../../log/common/log.js';
import { AgentHostClientConnectionKind } from '../common/agentHostTelemetry.js';
import {
	getRemoteAccessFrameKind, RemoteAccessChannelCipher, RemoteAccessCryptoError, RemoteAccessE2EFrameKind, RemoteAccessHandshake, RemoteAccessRole,
} from '../common/remoteAccessCrypto.js';
import { createViewerHello, decodeViewerFrame, encodeViewerFrame, IRelayHostPeer, parseViewerControlFrame, RELAY_PING_INTERVAL_MS } from '../common/remoteAccessRelayProtocol.js';
import { getRemoteAccessViewerCloseMessage, IRemoteAccessViewerOptions, IRemoteAccessViewerStatus, isRemoteAccessViewerRefusal, RemoteAccessViewerState } from '../common/remoteAccessViewer.js';
import type { AhpServerNotification, JsonRpcNotification, JsonRpcRequest, JsonRpcResponse, ProtocolMessage } from '../common/state/sessionProtocol.js';
import { NonReconnectableTransportError, type IClientTransport, type ITransportCloseDetails } from '../common/state/sessionTransport.js';

const LOG_PREFIX = '[RemoteAccessViewer]';

export interface IRemoteAccessViewerTimings {
	readonly pingIntervalMs: number;
	readonly welcomeTimeoutMs: number;
	/**
	 * How long the Viewer waits for the Host's half of the handshake. A Host
	 * that does not know the pair key (the pair was removed and paired again)
	 * drops the Viewer's handshake without an answer.
	 */
	readonly handshakeTimeoutMs: number;
}

const DEFAULT_TIMINGS: IRemoteAccessViewerTimings = {
	pingIntervalMs: RELAY_PING_INTERVAL_MS,
	welcomeTimeoutMs: 10_000,
	handshakeTimeoutMs: 15_000,
};

/** The WebSocket subset the transport uses, so tests can supply their own socket. */
export type RemoteAccessViewerSocketFactory = (url: string) => WebSocket;

type ClientOutboundMessage = ProtocolMessage | AhpServerNotification | JsonRpcNotification | JsonRpcResponse | JsonRpcRequest;

/**
 * The Viewer's {@link IClientTransport} over the FlowLeap Relay.
 */
export class RemoteAccessViewerTransport extends Disposable implements IClientTransport {
	readonly clientConnectionKind = AgentHostClientConnectionKind.Unknown;

	private readonly _onMessage = this._register(new Emitter<ProtocolMessage>());
	readonly onMessage = this._onMessage.event;

	private readonly _onClose = this._register(new Emitter<void>());
	readonly onClose = this._onClose.event;

	private readonly _onDidCloseDetails = this._register(new Emitter<ITransportCloseDetails>());
	readonly onDidCloseDetails = this._onDidCloseDetails.event;

	private readonly _timings: IRemoteAccessViewerTimings;
	private _socket: WebSocket | undefined;
	private _handshake: RemoteAccessHandshake | undefined;
	private _cipher: RemoteAccessChannelCipher | undefined;
	/** Serializes incoming payloads: the cipher needs strict order. */
	private _receiveQueue: Promise<void> = Promise.resolve();
	/** Serializes outgoing payloads for the same reason. */
	private _sendQueue: Promise<void> = Promise.resolve();
	private readonly _pingTimer = this._register(new IntervalTimer());
	private _welcomeTimer: ReturnType<typeof setTimeout> | undefined;
	private _handshakeTimer: ReturnType<typeof setTimeout> | undefined;
	private _connectStarted = false;
	private _settleConnect: { resolve(): void; reject(error: Error): void } | undefined;
	private _closeFired = false;
	/** The next socket close is ours, after a Host change: the page already shows the state. */
	private _quietClose = false;

	constructor(
		private readonly _options: IRemoteAccessViewerOptions,
		private readonly _reportStatus: (status: IRemoteAccessViewerStatus) => void,
		timings: Partial<IRemoteAccessViewerTimings> | undefined,
		private readonly _createSocket: RemoteAccessViewerSocketFactory | undefined,
		@ILogService private readonly _logService: ILogService,
	) {
		super();
		this._timings = { ...DEFAULT_TIMINGS, ...timings };
	}

	/** Whether the end-to-end channel is up. */
	get isOpen(): boolean {
		return !!this._cipher && this._socket?.readyState === WebSocket.OPEN;
	}

	/**
	 * Opens the Viewer socket, authenticates, and waits for the Host's half
	 * of the end-to-end handshake. Rejects with
	 * {@link NonReconnectableTransportError} when the Relay refuses this
	 * Viewer (sign-in, subscription, removed pair, too many Viewers).
	 */
	connect(): Promise<void> {
		if (this._connectStarted) {
			return Promise.reject(new Error('The Viewer transport connects once.'));
		}
		this._connectStarted = true;
		return new Promise<void>((resolve, reject) => {
			this._settleConnect = { resolve, reject };
			this._open().catch(error => this._failConnect(error instanceof Error ? error : new Error(String(error))));
		});
	}

	private async _open(): Promise<void> {
		this._reportStatus({ state: RemoteAccessViewerState.Connecting });
		const token = await this._options.getToken();
		if (this._store.isDisposed) {
			throw new Error('The Viewer transport is disposed.');
		}
		const socket = this._createSocket ? this._createSocket(this._options.relayUrl) : new WebSocket(this._options.relayUrl);
		socket.binaryType = 'arraybuffer';
		this._socket = socket;

		socket.addEventListener('open', () => {
			if (this._socket !== socket) {
				return;
			}
			socket.send(createViewerHello(token, this._options.pairId));
			this._welcomeTimer = setTimeout(() => {
				this._welcomeTimer = undefined;
				if (this._socket === socket && !this._handshake && !this._cipher) {
					this._logService.warn(`${LOG_PREFIX} The Relay did not answer hello`);
					socket.close();
				}
			}, this._timings.welcomeTimeoutMs);
		});
		socket.addEventListener('message', event => {
			if (this._socket !== socket) {
				return;
			}
			if (typeof event.data === 'string') {
				this._onControl(event.data);
			} else if (event.data instanceof ArrayBuffer) {
				this._onBinary(new Uint8Array(event.data));
			}
		});
		socket.addEventListener('close', event => {
			if (this._socket !== socket) {
				return;
			}
			this._onSocketClosed(event.code, event.reason, event.wasClean);
		});
		socket.addEventListener('error', () => {
			// 'close' always follows and carries the code.
			this._logService.trace(`${LOG_PREFIX} Relay socket error`);
		});
	}

	private _onControl(text: string): void {
		const frame = parseViewerControlFrame(text);
		if (!frame) {
			return;
		}
		switch (frame.t) {
			case 'welcome':
				this._clearWelcomeTimer();
				this._startPing();
				this._onHostPeer(frame.peer);
				break;
			case 'host':
				this._onHostPeer(frame.peer);
				break;
			case 'pong':
				break;
		}
	}

	private _onHostPeer(peer: IRelayHostPeer): void {
		if (!peer.online) {
			if (this._cipher) {
				// The Host's AHP stream for this pair is gone. Close, so the
				// protocol client reconnects through a new transport that waits
				// for the Host.
				this._logService.info(`${LOG_PREFIX} The Host went offline`);
				this._reportStatus({ state: RemoteAccessViewerState.HostOffline });
				this._quietClose = true;
				this._closeSocket(1000);
				return;
			}
			this._handshake = undefined;
			this._reportStatus({ state: RemoteAccessViewerState.HostOffline });
			return;
		}
		if (this._cipher) {
			// A Host that comes back has a new stream: start again as above.
			this._reportStatus({ state: RemoteAccessViewerState.Connecting, hostAppVersion: peer.appVersion });
			this._quietClose = true;
			this._closeSocket(1000);
			return;
		}
		this._reportStatus({ state: RemoteAccessViewerState.Connecting, hostAppVersion: peer.appVersion });
		void this._sendHandshake();
	}

	/** The Viewer sends its handshake first (section 6.1), on every Host that comes online. */
	private async _sendHandshake(): Promise<void> {
		const handshake = await RemoteAccessHandshake.create(RemoteAccessRole.Viewer, this._options.pairKey, this._options.pairId);
		if (this._store.isDisposed || this._cipher) {
			return;
		}
		this._handshake = handshake;
		this._sendPayload(handshake.message);
		this._clearHandshakeTimer();
		this._handshakeTimer = setTimeout(() => {
			this._handshakeTimer = undefined;
			if (this._handshake === handshake && !this._cipher) {
				this._logService.warn(`${LOG_PREFIX} The Host did not answer the handshake; the pair key may be out of date`);
				this._closeSocket(1000);
			}
		}, this._timings.handshakeTimeoutMs);
	}

	private _onBinary(bytes: Uint8Array): void {
		const frame = decodeViewerFrame(bytes);
		if (!frame || frame.broadcast) {
			// AHP never broadcasts; the attention work (B6) will.
			return;
		}
		const payload = new Uint8Array(frame.payload);
		this._receiveQueue = this._receiveQueue.then(() => this._process(payload)).catch(error => {
			this._logService.warn(`${LOG_PREFIX} Dropped the Host stream: ${error instanceof RemoteAccessCryptoError ? error.message : 'unexpected error'}`);
			this._closeSocket(1000);
		});
	}

	private async _process(payload: Uint8Array): Promise<void> {
		const kind = getRemoteAccessFrameKind(payload);
		if (kind === RemoteAccessE2EFrameKind.Handshake) {
			const handshake = this._handshake;
			if (!handshake || this._cipher) {
				throw new RemoteAccessCryptoError('Unexpected handshake.');
			}
			this._cipher = await handshake.complete(payload);
			this._handshake = undefined;
			this._clearHandshakeTimer();
			this._logService.info(`${LOG_PREFIX} End-to-end channel to the Host is up`);
			this._reportStatus({ state: RemoteAccessViewerState.Connected });
			const settle = this._settleConnect;
			this._settleConnect = undefined;
			settle?.resolve();
			return;
		}
		if (kind === RemoteAccessE2EFrameKind.Data) {
			const cipher = this._cipher;
			if (!cipher) {
				throw new RemoteAccessCryptoError('Data before handshake.');
			}
			const text = await cipher.open(payload);
			if (text === undefined) {
				return;
			}
			let message: ProtocolMessage;
			try {
				message = JSON.parse(text) as ProtocolMessage;
			} catch {
				this._logService.warn(`${LOG_PREFIX} The Host sent a message that is not JSON`);
				return;
			}
			this._onMessage.fire(message);
			return;
		}
		throw new RemoteAccessCryptoError('Unknown frame kind.');
	}

	/**
	 * Encrypts and sends one AHP message. Returns `false` and closes the
	 * transport when the channel is not up, so the protocol client reconnects
	 * instead of losing the message.
	 */
	send(message: ClientOutboundMessage): boolean {
		const cipher = this._cipher;
		const socket = this._socket;
		if (!cipher || !socket || socket.readyState !== WebSocket.OPEN) {
			this._logService.warn(`${LOG_PREFIX} Message dropped: the channel to the Host is not open`);
			this._closeSocket(1000);
			this._fireClose();
			return false;
		}
		const text = JSON.stringify(message);
		this._sendQueue = this._sendQueue.then(async () => {
			const frames = await cipher.seal(text);
			if (this._cipher !== cipher) {
				return;
			}
			for (const frame of frames) {
				this._sendPayload(frame);
			}
		}).catch(error => {
			this._logService.warn(`${LOG_PREFIX} Failed to encrypt a message for the Host`, error instanceof Error ? error.message : undefined);
		});
		return true;
	}

	private _sendPayload(payload: Uint8Array): void {
		const socket = this._socket;
		if (socket && socket.readyState === WebSocket.OPEN) {
			socket.send(encodeViewerFrame(payload));
		}
	}

	private _startPing(): void {
		this._pingTimer.cancelAndSet(() => {
			const socket = this._socket;
			if (socket && socket.readyState === WebSocket.OPEN) {
				socket.send(JSON.stringify({ t: 'ping' }));
			}
		}, this._timings.pingIntervalMs);
	}

	private _onSocketClosed(code: number, reason: string, wasClean: boolean): void {
		this._socket = undefined;
		this._clearWelcomeTimer();
		this._clearHandshakeTimer();
		this._clearPing();
		this._cipher = undefined;
		this._handshake = undefined;
		this._logService.info(`${LOG_PREFIX} Relay socket closed (${code})`);
		this._onDidCloseDetails.fire({ code, reason, wasClean });

		const refused = isRemoteAccessViewerRefusal(code);
		const message = getRemoteAccessViewerCloseMessage(code);
		if (!this._quietClose || refused) {
			this._reportStatus({ state: refused ? RemoteAccessViewerState.Refused : RemoteAccessViewerState.Disconnected, closeCode: code, message });
		}
		this._quietClose = false;
		if (this._settleConnect) {
			this._failConnect(refused ? new NonReconnectableTransportError(message) : new Error(message));
			return;
		}
		this._fireClose();
	}

	private _failConnect(error: Error): void {
		const settle = this._settleConnect;
		this._settleConnect = undefined;
		settle?.reject(error);
		if (this._socket) {
			this._closeSocket(1000);
		}
	}

	private _fireClose(): void {
		if (!this._closeFired) {
			this._closeFired = true;
			this._onClose.fire();
		}
	}

	/** Closes the socket; its close event then settles {@link connect} or fires {@link onClose}. */
	private _closeSocket(code: number): void {
		const socket = this._socket;
		if (!socket) {
			return;
		}
		if (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN) {
			socket.close(code);
		} else {
			this._onSocketClosed(code, '', true);
		}
	}

	private _clearWelcomeTimer(): void {
		if (this._welcomeTimer) {
			clearTimeout(this._welcomeTimer);
			this._welcomeTimer = undefined;
		}
	}

	private _clearHandshakeTimer(): void {
		if (this._handshakeTimer) {
			clearTimeout(this._handshakeTimer);
			this._handshakeTimer = undefined;
		}
	}

	private _clearPing(): void {
		this._pingTimer.cancel();
	}

	override dispose(): void {
		this._clearWelcomeTimer();
		this._clearHandshakeTimer();
		this._clearPing();
		const socket = this._socket;
		this._socket = undefined;
		this._cipher = undefined;
		this._handshake = undefined;
		socket?.close(1000);
		const settle = this._settleConnect;
		this._settleConnect = undefined;
		settle?.reject(new Error('The Viewer transport is disposed.'));
		super.dispose();
	}
}
