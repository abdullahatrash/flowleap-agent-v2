/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// The Viewer transport (PRD 0018 B4) against an in-memory Relay that behaves
// like B3's fake Relay (contract section 3, section 4) and a fake Host peer
// that runs the same remoteAccessCrypto code as the Host transport: hello, the
// Viewer-first handshake, encrypted AHP both ways, Host offline as a page
// state, and the close codes.

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { NullLogService } from '../../../log/common/log.js';
import { RemoteAccessViewerTransport } from '../../browser/remoteAccessViewerTransport.js';
import {
	derivePairKey, generatePairSecret, getRemoteAccessFrameKind, RemoteAccessChannelCipher, RemoteAccessE2EFrameKind, RemoteAccessHandshake, RemoteAccessRole,
} from '../../common/remoteAccessCrypto.js';
import { IRemoteAccessViewerOptions, IRemoteAccessViewerStatus, RemoteAccessViewerState } from '../../common/remoteAccessViewer.js';
import type { ProtocolMessage } from '../../common/state/sessionProtocol.js';
import { NonReconnectableTransportError } from '../../common/state/sessionTransport.js';

const PAIR_ID = '0f8fad5b-d9cb-469f-a165-70867728950e';
const GOOD_TOKEN = 'good-token';
const VIEWER_FAST = { pingIntervalMs: 20, welcomeTimeoutMs: 2_000, handshakeTimeoutMs: 200 };

async function until(condition: () => boolean, what: string, timeoutMs = 5_000): Promise<void> {
	const start = Date.now();
	while (!condition()) {
		if (Date.now() - start > timeoutMs) {
			throw new Error(`Timed out waiting for ${what}`);
		}
		await new Promise(resolve => setTimeout(resolve, 5));
	}
}

function request(id: number, method: string): ProtocolMessage {
	return { jsonrpc: '2.0', id, method, params: {} } as unknown as ProtocolMessage;
}

type Listener = (event: { data?: unknown; code?: number; reason?: string; wasClean?: boolean }) => void;

/** A browser WebSocket stand-in whose far end is the fake Relay. Events arrive asynchronously, as on a real socket. */
class FakeSocket {
	readyState = 0;
	binaryType = 'blob';
	private readonly _listeners = new Map<string, Listener[]>();

	constructor(readonly url: string, private readonly _relay: FakeRelay) {
		setTimeout(() => {
			this.readyState = 1;
			this._emit('open', {});
		}, 0);
	}

	addEventListener(type: string, listener: Listener): void {
		this._listeners.set(type, [...(this._listeners.get(type) ?? []), listener]);
	}

	private _emit(type: string, event: Parameters<Listener>[0]): void {
		for (const listener of this._listeners.get(type) ?? []) {
			listener(event);
		}
	}

	send(data: string | Uint8Array): void {
		if (this.readyState !== 1) {
			throw new Error('send on a socket that is not open');
		}
		const copy = typeof data === 'string' ? data : new Uint8Array(data);
		setTimeout(() => this._relay.fromViewer(this, copy), 0);
	}

	/** Called by the Viewer transport. */
	close(code = 1005): void {
		this._closeWith(code, true);
	}

	/** The Relay delivers a frame. */
	deliver(data: string | Uint8Array): void {
		if (this.readyState !== 1) {
			return;
		}
		const payload = typeof data === 'string' ? data : new Uint8Array(data).buffer;
		setTimeout(() => this._emit('message', { data: payload }), 0);
	}

	/** The Relay closes the socket. */
	closeFromRelay(code: number): void {
		this._closeWith(code, false);
	}

	private _closeWith(code: number, local: boolean): void {
		if (this.readyState === 3 || this.readyState === 2) {
			return;
		}
		this.readyState = 2;
		setTimeout(() => {
			this.readyState = 3;
			if (local) {
				this._relay.viewerClosed(this);
			}
			this._emit('close', { code, reason: '', wasClean: true });
		}, 0);
	}
}

/**
 * The Host side, as B3's PairChannel runs it: answers each Viewer handshake
 * with a fresh ephemeral key, then decrypts and encrypts AHP messages.
 */
class FakeHostPeer {
	readonly received: ProtocolMessage[] = [];
	cipher: RemoteAccessChannelCipher | undefined;
	handshakes = 0;
	private _queue: Promise<void> = Promise.resolve();

	constructor(readonly appVersion: string, private readonly _pairKey: Uint8Array, private readonly _toViewer: (payload: Uint8Array) => void) { }

	accept(payload: Uint8Array): void {
		this._queue = this._queue.then(async () => {
			if (getRemoteAccessFrameKind(payload) === RemoteAccessE2EFrameKind.Handshake) {
				this.cipher = undefined;
				const handshake = await RemoteAccessHandshake.create(RemoteAccessRole.Host, this._pairKey, PAIR_ID);
				this.cipher = await handshake.complete(payload);
				this.handshakes++;
				this._toViewer(handshake.message);
			} else {
				const text = await this.cipher!.open(payload);
				if (text !== undefined) {
					this.received.push(JSON.parse(text));
				}
			}
		}).catch(() => {
			// A wrong pair key: the Host drops the handshake without an answer, as B3 does.
			this.cipher = undefined;
		});
	}

	async send(message: object): Promise<void> {
		for (const frame of await this.cipher!.seal(JSON.stringify(message))) {
			this._toViewer(frame);
		}
	}
}

/** The Relay per contract section 3 and section 4, in memory. */
class FakeRelay {
	readonly hellos: unknown[] = [];
	pings = 0;
	/** Payload bytes the Relay forwarded, to check it only sees ciphertext. */
	readonly forwarded: Uint8Array[] = [];
	readonly tokenOverride = new Map<string, number>([['revoked', 4401], ['unpaid', 4402], ['forbidden', 4403], ['crowded', 4429]]);
	host: FakeHostPeer | undefined;
	private readonly _viewers = new Map<string, FakeSocket>();
	private readonly _welcomed = new Set<FakeSocket>();

	createSocket = (url: string) => new FakeSocket(url, this) as unknown as WebSocket;

	hostOnline(pairKey: Uint8Array, appVersion = '0.9.0'): FakeHostPeer {
		this.host = new FakeHostPeer(appVersion, pairKey, payload => this._toViewer(payload));
		for (const viewer of this._viewers.values()) {
			viewer.deliver(JSON.stringify({ t: 'host', online: true, appVersion, ahp: ['0.9.0'] }));
		}
		return this.host;
	}

	hostOffline(): void {
		this.host = undefined;
		for (const viewer of this._viewers.values()) {
			viewer.deliver(JSON.stringify({ t: 'host', online: false }));
		}
	}

	private _toViewer(payload: Uint8Array): void {
		this.forwarded.push(new Uint8Array(payload));
		const frame = new Uint8Array(1 + payload.byteLength);
		frame[0] = 0x01;
		frame.set(payload, 1);
		this._viewers.get(PAIR_ID)?.deliver(frame);
	}

	fromViewer(socket: FakeSocket, data: string | Uint8Array): void {
		if (!this._welcomed.has(socket)) {
			const hello = JSON.parse(data as string) as { token: string; pairId: string };
			this.hellos.push(hello);
			const refusal = this.tokenOverride.get(hello.token);
			if (refusal) {
				socket.closeFromRelay(refusal);
				return;
			}
			this._welcomed.add(socket);
			this._viewers.get(hello.pairId)?.closeFromRelay(4409);
			this._viewers.set(hello.pairId, socket);
			socket.deliver(JSON.stringify({ t: 'welcome', peer: this.host ? { online: true, appVersion: this.host.appVersion, ahp: ['0.9.0'] } : { online: false } }));
			return;
		}
		if (typeof data === 'string') {
			if (JSON.parse(data).t === 'ping') {
				this.pings++;
				socket.deliver(JSON.stringify({ t: 'pong' }));
			}
			return;
		}
		if (data[0] === 0x01 && this._viewers.get(PAIR_ID) === socket) {
			const payload = data.subarray(1);
			this.forwarded.push(new Uint8Array(payload));
			this.host?.accept(new Uint8Array(payload));
		}
	}

	viewerClosed(socket: FakeSocket): void {
		for (const [pairId, viewer] of this._viewers) {
			if (viewer === socket) {
				this._viewers.delete(pairId);
			}
		}
	}
}

suite('RemoteAccessViewerTransport', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	let relay: FakeRelay;
	let pairKey: Uint8Array;

	setup(async () => {
		relay = new FakeRelay();
		pairKey = await derivePairKey(generatePairSecret(), PAIR_ID);
	});

	function createViewer(overrides?: Partial<IRemoteAccessViewerOptions>) {
		const statuses: IRemoteAccessViewerStatus[] = [];
		const options: IRemoteAccessViewerOptions = {
			relayUrl: 'wss://relay.test/v1/remote-access/viewer',
			pairId: PAIR_ID,
			pairKey,
			hostLabel: 'Studio Mac',
			buildVersion: '0.9.0',
			getToken: async () => GOOD_TOKEN,
			...overrides,
		};
		const transport = store.add(new RemoteAccessViewerTransport(options, status => statuses.push(status), VIEWER_FAST, relay.createSocket, new NullLogService()));
		const messages: ProtocolMessage[] = [];
		let closes = 0;
		store.add(transport.onMessage(message => messages.push(message)));
		store.add(transport.onClose(() => closes++));
		return { transport, statuses, messages, closes: () => closes };
	}

	test('hello, Viewer-first handshake, and encrypted AHP both ways', async () => {
		const host = relay.hostOnline(pairKey);
		const viewer = createViewer();

		await viewer.transport.connect();
		assert.ok(viewer.transport.isOpen);
		assert.deepStrictEqual(relay.hellos, [{ t: 'hello', role: 'viewer', token: GOOD_TOKEN, pairId: PAIR_ID }]);
		assert.strictEqual(host.handshakes, 1);
		assert.ok(viewer.statuses.some(status => status.state === RemoteAccessViewerState.Connecting && status.hostAppVersion === '0.9.0'), 'the Host version reaches the page');
		assert.strictEqual(viewer.statuses.at(-1)?.state, RemoteAccessViewerState.Connected);

		assert.ok(viewer.transport.send(request(1, 'initialize')));
		await until(() => host.received.length === 1, 'host receives');
		assert.deepStrictEqual(host.received[0], request(1, 'initialize'));

		await host.send({ jsonrpc: '2.0', id: 1, result: { ok: 'from host' } });
		await until(() => viewer.messages.length === 1, 'viewer receives');
		assert.deepStrictEqual(viewer.messages[0], { jsonrpc: '2.0', id: 1, result: { ok: 'from host' } });

		for (const payload of relay.forwarded) {
			const text = new TextDecoder().decode(payload);
			assert.ok(!text.includes('initialize') && !text.includes('from host'), 'plaintext crossed the Relay');
		}
	});

	test('messages keep their order, and one over a Relay frame is chunked', async () => {
		const host = relay.hostOnline(pairKey);
		const viewer = createViewer();
		await viewer.transport.connect();

		for (let i = 0; i < 20; i++) {
			viewer.transport.send(request(i, `m${i}`));
		}
		await until(() => host.received.length === 20, 'twenty messages');
		assert.deepStrictEqual(host.received.map(message => (message as unknown as { id: number }).id), [...Array(20).keys()]);

		const big = 'x'.repeat(1_500_000);
		await host.send({ jsonrpc: '2.0', id: 7, result: { big } });
		await until(() => viewer.messages.length === 1, 'big message', 10_000);
		assert.strictEqual((viewer.messages[0] as unknown as { result: { big: string } }).result.big.length, big.length);
	});

	test('Host offline is a page state: connect waits for the Host', async () => {
		const viewer = createViewer();
		let connected = false;
		const connecting = viewer.transport.connect().then(() => { connected = true; });

		await until(() => viewer.statuses.some(status => status.state === RemoteAccessViewerState.HostOffline), 'host offline state');
		assert.strictEqual(connected, false);

		relay.hostOnline(pairKey);
		await connecting;
		assert.strictEqual(viewer.statuses.at(-1)?.state, RemoteAccessViewerState.Connected);
	});

	test('a Host that goes offline closes the transport, without an error state', async () => {
		relay.hostOnline(pairKey);
		const viewer = createViewer();
		await viewer.transport.connect();

		relay.hostOffline();
		await until(() => viewer.closes() === 1, 'transport closed');
		assert.ok(viewer.statuses.some(status => status.state === RemoteAccessViewerState.HostOffline));
		assert.ok(!viewer.statuses.some(status => status.state === RemoteAccessViewerState.Disconnected), 'no error state for a Host that went offline');
		assert.strictEqual(viewer.transport.send(request(2, 'ping')), false);
	});

	for (const [token, code] of [['revoked', 4401], ['unpaid', 4402], ['forbidden', 4403], ['crowded', 4429]] as const) {
		test(`close ${code} refuses: connect fails for good, with a message`, async () => {
			const viewer = createViewer({ getToken: async () => token });
			await assert.rejects(viewer.transport.connect(), error => error instanceof NonReconnectableTransportError);
			const last = viewer.statuses.at(-1);
			assert.strictEqual(last?.state, RemoteAccessViewerState.Refused);
			assert.strictEqual(last?.closeCode, code);
			assert.ok(last?.message);
		});
	}

	test('each refusal code has its own message', async () => {
		const messages = new Set<string>();
		for (const token of ['revoked', 'unpaid', 'forbidden', 'crowded']) {
			const viewer = createViewer({ getToken: async () => token });
			await assert.rejects(viewer.transport.connect());
			messages.add(viewer.statuses.at(-1)!.message!);
		}
		assert.strictEqual(messages.size, 4);
	});

	test('a pair key the Host does not know times out the handshake, and the client may retry', async () => {
		relay.hostOnline(pairKey);
		const viewer = createViewer({ pairKey: await derivePairKey(generatePairSecret(), PAIR_ID) });
		await assert.rejects(viewer.transport.connect(), error => !(error instanceof NonReconnectableTransportError));
		assert.strictEqual(viewer.statuses.at(-1)?.state, RemoteAccessViewerState.Disconnected);
	});

	test('a second Viewer for the same pair replaces the first, which stops (4409)', async () => {
		relay.hostOnline(pairKey);
		const first = createViewer();
		await first.transport.connect();
		const second = createViewer();
		await second.transport.connect();
		await until(() => first.closes() === 1, 'first closed');
		assert.strictEqual(first.statuses.at(-1)?.state, RemoteAccessViewerState.Refused);
		assert.strictEqual(first.statuses.at(-1)?.closeCode, 4409);
	});

	test('pings the Relay while connected', async () => {
		relay.hostOnline(pairKey);
		const viewer = createViewer();
		await viewer.transport.connect();
		const before = relay.forwarded.length;
		await until(() => relay.pings >= 2, 'two pings');
		assert.strictEqual(relay.forwarded.length, before, 'pings are control frames, not payload');
		assert.ok(viewer.transport.isOpen);
	});
});
