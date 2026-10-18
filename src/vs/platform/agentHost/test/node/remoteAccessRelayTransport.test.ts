/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import type * as wsTypes from 'ws';
import { DisposableStore, toDisposable } from '../../../../base/common/lifecycle.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { NullLogService } from '../../../log/common/log.js';
import {
	bytesToUuid, derivePairKey, generatePairSecret, RemoteAccessChannelCipher, RemoteAccessHandshake, RemoteAccessRole, uuidToBytes,
} from '../../common/remoteAccessCrypto.js';
import { RemoteAccessHostState } from '../../common/remoteAccessHost.js';
import type { ProtocolMessage } from '../../common/state/sessionProtocol.js';
import type { IProtocolTransport } from '../../common/state/sessionTransport.js';
import { isAllowedRelayUrl, RemoteAccessHostController } from '../../node/remoteAccessHostController.js';
import { decodePairFrame, encodeBroadcastFrame, encodePairFrame } from '../../common/remoteAccessRelayProtocol.js';
import { IRemoteAccessRelayOptions, RemoteAccessRelayProtocolServer } from '../../node/remoteAccessRelayTransport.js';

const HOST_ID = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const PAIR_ID = '0f8fad5b-d9cb-469f-a165-70867728950e';
const GOOD_TOKEN = 'good-token';
const FAST = { initialRetryMs: 10, maxRetryMs: 40, pingIntervalMs: 30, welcomeTimeoutMs: 2_000 };

async function until(condition: () => boolean, what: string, timeoutMs = 5_000): Promise<void> {
	const start = Date.now();
	while (!condition()) {
		if (Date.now() - start > timeoutMs) {
			throw new Error(`Timed out waiting for ${what}`);
		}
		await new Promise(resolve => setTimeout(resolve, 5));
	}
}

interface IHello { t: string; role: string; token: string; hostId?: string; pairId?: string; appVersion?: string; ahp?: unknown }

/**
 * A minimal Relay per RELAY-CONTRACT.md §3/§4: first-frame auth, welcome,
 * ping/pong, viewer online/offline, and blind forwarding with the pairId tag.
 */
class FakeRelay {
	readonly hellos: IHello[] = [];
	readonly controlFromHost: string[] = [];
	host: wsTypes.WebSocket | undefined;
	readonly viewers = new Map<string, wsTypes.WebSocket>();
	/** Bytes the Relay forwarded, to check it only ever sees ciphertext. */
	readonly forwarded: Uint8Array[] = [];
	tokenOverride: Map<string, number> = new Map([['revoked', 4401], ['unpaid', 4402]]);
	hostConnections = 0;

	private constructor(private readonly _server: wsTypes.WebSocketServer, private readonly _ws: typeof wsTypes) {
		_server.on('connection', socket => this._onSocket(socket));
	}

	static async create(): Promise<FakeRelay> {
		const ws = await import('ws');
		const server = new ws.WebSocketServer({ port: 0, host: '127.0.0.1' });
		await new Promise<void>(resolve => server.once('listening', () => resolve()));
		return new FakeRelay(server, ws);
	}

	get url(): string {
		const address = this._server.address() as { port: number };
		return `ws://127.0.0.1:${address.port}/v1/remote-access/host`;
	}

	private _onSocket(socket: wsTypes.WebSocket): void {
		let role: 'host' | 'viewer' | undefined;
		let pairId: string | undefined;
		socket.on('message', (data: Buffer, isBinary: boolean) => {
			if (!role) {
				const hello = JSON.parse(data.toString('utf-8')) as IHello;
				this.hellos.push(hello);
				const refusal = this.tokenOverride.get(hello.token);
				if (refusal) {
					socket.close(refusal);
					return;
				}
				if (hello.role === 'host') {
					role = 'host';
					this.hostConnections++;
					this.host?.close(4409);
					this.host = socket;
					socket.send(JSON.stringify({ t: 'welcome', pairs: [...this.viewers.keys()] }));
				} else {
					role = 'viewer';
					pairId = hello.pairId!;
					this.viewers.set(pairId, socket);
					socket.send(JSON.stringify({ t: 'welcome', peer: { online: !!this.host, appVersion: '0.0.0', ahp: [] } }));
					this.host?.send(JSON.stringify({ t: 'viewer', pairId, online: true }));
				}
				return;
			}
			if (!isBinary) {
				const text = data.toString('utf-8');
				if (role === 'host') {
					this.controlFromHost.push(text);
				}
				if (JSON.parse(text).t === 'ping') {
					socket.send(JSON.stringify({ t: 'pong' }));
				}
				return;
			}
			const bytes = new Uint8Array(data);
			if (role === 'host') {
				const frame = decodePairFrame(bytes);
				if (frame) {
					this.forwarded.push(frame.payload);
					const out = new Uint8Array(1 + frame.payload.byteLength);
					out[0] = 0x01;
					out.set(frame.payload, 1);
					this.viewers.get(frame.pairId)?.send(out);
				}
			} else if (pairId && bytes[0] === 0x01) {
				const payload = bytes.subarray(1);
				this.forwarded.push(new Uint8Array(payload));
				this.host?.send(encodePairFrame(pairId, payload));
			}
		});
		socket.on('close', () => {
			if (role === 'viewer' && pairId && this.viewers.get(pairId) === socket) {
				this.viewers.delete(pairId);
				this.host?.send(JSON.stringify({ t: 'viewer', pairId, online: false }));
			}
			if (role === 'host' && this.host === socket) {
				this.host = undefined;
			}
		});
	}

	dropHost(code = 1011): void {
		this.host?.close(code);
	}

	async connectViewer(pairId: string, pairKey: Uint8Array): Promise<FakeViewer> {
		const socket = new this._ws.WebSocket(this.url.replace('/host', '/viewer'));
		await new Promise<void>((resolve, reject) => { socket.once('open', () => resolve()); socket.once('error', reject); });
		const viewer = new FakeViewer(socket, pairId, pairKey);
		socket.send(JSON.stringify({ t: 'hello', role: 'viewer', token: GOOD_TOKEN, pairId }));
		await until(() => viewer.welcomed, 'viewer welcome');
		return viewer;
	}

	async dispose(): Promise<void> {
		for (const client of this._server.clients) {
			client.terminate();
		}
		await new Promise<void>(resolve => this._server.close(() => resolve()));
	}
}

/** A Viewer that runs the same crypto as the B4 web Viewer will. */
class FakeViewer {
	welcomed = false;
	cipher: RemoteAccessChannelCipher | undefined;
	readonly received: string[] = [];
	private _handshake: RemoteAccessHandshake | undefined;
	private _queue: Promise<void> = Promise.resolve();
	error: unknown;

	constructor(readonly socket: wsTypes.WebSocket, readonly pairId: string, private readonly _pairKey: Uint8Array) {
		socket.on('message', (data: Buffer, isBinary: boolean) => {
			if (!isBinary) {
				if (JSON.parse(data.toString('utf-8')).t === 'welcome') {
					this.welcomed = true;
				}
				return;
			}
			const payload = new Uint8Array(data).subarray(1);
			this._queue = this._queue.then(async () => {
				if (payload[0] === 0x01) {
					this.cipher = await this._handshake!.complete(payload);
				} else {
					const text = await this.cipher!.open(payload);
					if (text !== undefined) {
						this.received.push(text);
					}
				}
			}).catch(error => { this.error = error; });
		});
	}

	async handshake(): Promise<void> {
		this._handshake = await RemoteAccessHandshake.create(RemoteAccessRole.Viewer, this._pairKey, this.pairId);
		this._sendPayload(this._handshake.message);
		await until(() => !!this.cipher || !!this.error, 'viewer handshake');
		if (this.error) {
			throw this.error;
		}
	}

	async send(message: object): Promise<void> {
		for (const frame of await this.cipher!.seal(JSON.stringify(message))) {
			this._sendPayload(frame);
		}
	}

	sendRaw(payload: Uint8Array): void {
		this._sendPayload(payload);
	}

	private _sendPayload(payload: Uint8Array): void {
		const frame = new Uint8Array(1 + payload.byteLength);
		frame[0] = 0x01;
		frame.set(payload, 1);
		this.socket.send(frame);
	}

	close(): Promise<void> {
		return new Promise(resolve => {
			this.socket.once('close', () => resolve());
			this.socket.close();
		});
	}
}

suite('RemoteAccessRelayTransport', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	let relay: FakeRelay;
	let pairKey: Uint8Array;

	setup(async () => {
		relay = await FakeRelay.create();
		pairKey = await derivePairKey(generatePairSecret(), PAIR_ID);
	});

	teardown(async () => {
		await relay.dispose();
	});

	function options(overrides?: Partial<IRemoteAccessRelayOptions>): IRemoteAccessRelayOptions {
		return {
			relayUrl: relay.url,
			token: GOOD_TOKEN,
			hostId: HOST_ID,
			appVersion: '0.8.0',
			ahpVersions: ['0.9.0'],
			pairs: [{ pairId: PAIR_ID, pairKey }],
			...overrides,
		};
	}

	function createServer(overrides?: Partial<IRemoteAccessRelayOptions>): { server: RemoteAccessRelayProtocolServer; transports: IProtocolTransport[]; messages: ProtocolMessage[] } {
		const server = store.add(new RemoteAccessRelayProtocolServer(options(overrides), new NullLogService(), FAST));
		const transports: IProtocolTransport[] = [];
		const messages: ProtocolMessage[] = [];
		const connections = store.add(new DisposableStore());
		connections.add(server.onConnection(transport => {
			transports.push(transport);
			connections.add(transport.onMessage(message => messages.push(message)));
		}));
		server.start();
		return { server, transports, messages };
	}

	test('frame helpers', () => {
		const payload = new Uint8Array([9, 8, 7]);
		const frame = encodePairFrame(PAIR_ID, payload);
		assert.strictEqual(frame[0], 0x01);
		assert.deepStrictEqual(frame.subarray(1, 17), uuidToBytes(PAIR_ID));
		assert.deepStrictEqual(decodePairFrame(frame), { pairId: PAIR_ID, payload });
		assert.strictEqual(decodePairFrame(new Uint8Array([0x02, 1])), undefined);
		assert.deepStrictEqual([...encodeBroadcastFrame(payload)], [0x02, 9, 8, 7]);
		assert.strictEqual(bytesToUuid(frame.subarray(1, 17)), PAIR_ID);
	});

	test('relay URL must be wss, except to this machine', () => {
		assert.strictEqual(isAllowedRelayUrl('wss://api.flowleap.co/v1/remote-access/host'), true);
		assert.strictEqual(isAllowedRelayUrl('ws://127.0.0.1:9/x'), true);
		assert.strictEqual(isAllowedRelayUrl('ws://api.flowleap.co/v1/remote-access/host'), false);
		assert.strictEqual(isAllowedRelayUrl('https://api.flowleap.co'), false);
		assert.strictEqual(isAllowedRelayUrl('not a url'), false);
	});

	test('sends the §3 hello first and reaches Connected on welcome', async () => {
		const { server } = createServer();
		await until(() => server.status.state === RemoteAccessHostState.Connected, 'connected');
		assert.deepStrictEqual(relay.hellos[0], { t: 'hello', role: 'host', token: GOOD_TOKEN, hostId: HOST_ID, appVersion: '0.8.0', ahp: ['0.9.0'] });
	});

	test('pings the Relay on the interval', async () => {
		createServer();
		await until(() => relay.controlFromHost.filter(text => text === '{"t":"ping"}').length >= 2, 'two pings');
	});

	test('a Viewer handshake opens one decrypted AHP stream in both directions', async () => {
		const { server, transports, messages } = createServer();
		await until(() => server.status.state === RemoteAccessHostState.Connected, 'connected');

		const viewer = await relay.connectViewer(PAIR_ID, pairKey);
		await viewer.handshake();
		await until(() => transports.length === 1, 'transport');
		assert.deepStrictEqual(server.status.connectedPairIds, [PAIR_ID]);

		await viewer.send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersions: ['0.9.0'] } });
		await until(() => messages.length === 1, 'host receives initialize');
		assert.deepStrictEqual(messages[0], { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersions: ['0.9.0'] } });

		transports[0].send({ jsonrpc: '2.0', id: 1, result: { ok: true } } as unknown as ProtocolMessage);
		await until(() => viewer.received.length === 1, 'viewer receives result');
		assert.deepStrictEqual(JSON.parse(viewer.received[0]), { jsonrpc: '2.0', id: 1, result: { ok: true } });

		// The Relay saw only handshake and ciphertext frames, never the JSON.
		for (const payload of relay.forwarded) {
			assert.ok(!new TextDecoder().decode(payload).includes('initialize'));
			assert.ok(payload[0] === 0x01 || payload[0] === 0x02);
		}
		await viewer.close();
	});

	test('a message larger than one Relay frame arrives whole', async () => {
		const { server, transports } = createServer();
		await until(() => server.status.state === RemoteAccessHostState.Connected, 'connected');
		const viewer = await relay.connectViewer(PAIR_ID, pairKey);
		await viewer.handshake();
		await until(() => transports.length === 1, 'transport');
		const big = 'y'.repeat(2_500_000);
		transports[0].send({ jsonrpc: '2.0', method: 'big', params: { big } } as unknown as ProtocolMessage);
		await until(() => viewer.received.length === 1, 'big message', 10_000);
		assert.strictEqual(JSON.parse(viewer.received[0]).params.big.length, big.length);
		await viewer.close();
	});

	test('a Viewer with the wrong pair key gets no stream', async () => {
		const { server, transports } = createServer();
		await until(() => server.status.state === RemoteAccessHostState.Connected, 'connected');
		const wrongKey = await derivePairKey(generatePairSecret(), PAIR_ID);
		const viewer = await relay.connectViewer(PAIR_ID, wrongKey);
		const handshake = await RemoteAccessHandshake.create(RemoteAccessRole.Viewer, wrongKey, PAIR_ID);
		viewer.sendRaw(handshake.message);
		await new Promise(resolve => setTimeout(resolve, 100));
		assert.strictEqual(transports.length, 0);
		assert.strictEqual(viewer.received.length, 0);
		await viewer.close();
	});

	test('Viewer offline closes its stream; a new handshake opens a new one', async () => {
		const { server, transports } = createServer();
		await until(() => server.status.state === RemoteAccessHostState.Connected, 'connected');
		const first = await relay.connectViewer(PAIR_ID, pairKey);
		await first.handshake();
		await until(() => transports.length === 1, 'first transport');
		let closed = false;
		store.add(transports[0].onClose(() => closed = true));
		await first.close();
		await until(() => closed, 'stream closed');
		assert.deepStrictEqual(server.status.connectedPairIds, []);

		const second = await relay.connectViewer(PAIR_ID, pairKey);
		await second.handshake();
		await until(() => transports.length === 2, 'second transport');
		await second.close();
	});

	test('a tampered data frame drops the stream', async () => {
		const { server, transports, messages } = createServer();
		await until(() => server.status.state === RemoteAccessHostState.Connected, 'connected');
		const viewer = await relay.connectViewer(PAIR_ID, pairKey);
		await viewer.handshake();
		await until(() => transports.length === 1, 'transport');
		let closed = false;
		store.add(transports[0].onClose(() => closed = true));
		const frame = (await viewer.cipher!.seal('{"jsonrpc":"2.0","method":"x"}'))[0];
		frame[frame.length - 1] ^= 0xff;
		viewer.sendRaw(frame);
		await until(() => closed, 'stream dropped');
		assert.strictEqual(messages.length, 0);
		await viewer.close();
	});

	test('frames for an unknown pair are ignored', async () => {
		const { server, transports } = createServer({ pairs: [] });
		await until(() => server.status.state === RemoteAccessHostState.Connected, 'connected');
		const viewer = await relay.connectViewer(PAIR_ID, pairKey);
		const handshake = await RemoteAccessHandshake.create(RemoteAccessRole.Viewer, pairKey, PAIR_ID);
		viewer.sendRaw(handshake.message);
		await new Promise(resolve => setTimeout(resolve, 100));
		assert.strictEqual(transports.length, 0);
		await viewer.close();
	});

	test('reconnects with backoff after the Relay drops the socket', async () => {
		const { server } = createServer();
		await until(() => server.status.state === RemoteAccessHostState.Connected, 'connected');
		relay.dropHost(1011);
		await until(() => relay.hostConnections === 2 && server.status.state === RemoteAccessHostState.Connected, 'reconnected');
		assert.strictEqual(server.status.lastCloseCode, undefined);
	});

	test('4401 waits for a new token, then reconnects', async () => {
		const { server } = createServer({ token: 'revoked' });
		await until(() => server.status.state === RemoteAccessHostState.Unauthorized, 'unauthorized');
		const hellos = relay.hellos.length;
		await new Promise(resolve => setTimeout(resolve, 100));
		assert.strictEqual(relay.hellos.length, hellos, 'no retry with the refused token');
		server.updateOptions(options());
		await until(() => server.status.state === RemoteAccessHostState.Connected, 'connected with new token');
	});

	test('4402 reports subscription required', async () => {
		const { server } = createServer({ token: 'unpaid' });
		await until(() => server.status.state === RemoteAccessHostState.SubscriptionRequired, 'subscription required');
		assert.strictEqual(server.status.lastCloseCode, 4402);
	});

	test('removing a pair closes its stream', async () => {
		const { server, transports } = createServer();
		await until(() => server.status.state === RemoteAccessHostState.Connected, 'connected');
		const viewer = await relay.connectViewer(PAIR_ID, pairKey);
		await viewer.handshake();
		await until(() => transports.length === 1, 'transport');
		let closed = false;
		store.add(transports[0].onClose(() => closed = true));
		server.updateOptions(options({ pairs: [] }));
		assert.strictEqual(closed, true);
		await viewer.close();
	});

	test('controller switches the transport on, refreshes it and switches it off', async () => {
		const attached: string[] = [];
		const controller = store.add(new RemoteAccessHostController('0.8.0', ['0.9.0'], server => {
			attached.push(server.address ?? '');
			return toDisposable(() => attached.push('detached'));
		}, new NullLogService(), FAST));
		assert.strictEqual(controller.status.state, RemoteAccessHostState.Stopped);
		const base64Key = btoa(String.fromCharCode(...pairKey));
		controller.setConfig({ relayUrl: relay.url, token: GOOD_TOKEN, hostId: HOST_ID, pairs: [{ pairId: PAIR_ID, pairKey: base64Key }] });
		await until(() => controller.status.state === RemoteAccessHostState.Connected, 'connected');
		controller.setConfig({ relayUrl: relay.url, token: 'rotated', hostId: HOST_ID, pairs: [] });
		assert.deepStrictEqual(attached, [relay.url], 'a token refresh keeps the same transport');
		assert.throws(() => controller.setConfig({ relayUrl: 'ws://example.com/x', token: GOOD_TOKEN, hostId: HOST_ID, pairs: [] }));
		controller.setConfig(undefined);
		assert.deepStrictEqual(attached, [relay.url, 'detached']);
		assert.strictEqual(controller.status.state, RemoteAccessHostState.Stopped);
	});
});
