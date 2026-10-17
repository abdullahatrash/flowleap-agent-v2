/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { bufferToStream, decodeBase64, VSBuffer } from '../../../../../../base/common/buffer.js';
import { Emitter, Event } from '../../../../../../base/common/event.js';
import { DisposableStore } from '../../../../../../base/common/lifecycle.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../base/test/common/utils.js';
import { IRequestContext, IRequestOptions } from '../../../../../../base/parts/request/common/request.js';
import { IAgentHostService } from '../../../../../../platform/agentHost/common/agentService.js';
import { computePairingProof, derivePairKey, parsePairingCode, toHex } from '../../../../../../platform/agentHost/common/remoteAccessCrypto.js';
import { IRemoteAccessHostConfig, IRemoteAccessHostStatus, RemoteAccessHostState } from '../../../../../../platform/agentHost/common/remoteAccessHost.js';
import { TestConfigurationService } from '../../../../../../platform/configuration/test/common/testConfigurationService.js';
import { MockContextKeyService } from '../../../../../../platform/keybinding/test/common/mockKeybindingService.js';
import { NullLogService } from '../../../../../../platform/log/common/log.js';
import { IProductService } from '../../../../../../platform/product/common/productService.js';
import { IRequestService } from '../../../../../../platform/request/common/request.js';
import { ISecretStorageService } from '../../../../../../platform/secrets/common/secrets.js';
import { InMemoryStorageService, StorageScope, StorageTarget } from '../../../../../../platform/storage/common/storage.js';
import { IAuthenticationService } from '../../../../../services/authentication/common/authentication.js';
import { RemoteAccessService } from '../../../browser/remoteAccess/remoteAccessService.js';
import { getRemoteAccessPairsUrl, REMOTE_ACCESS_PAIR_KEY_SECRET_PREFIX, RemoteAccessError, RemoteAccessErrorKind, RemoteAccessSettingId, RemoteAccessStorageKey } from '../../../common/remoteAccess/remoteAccess.js';

const PAIRS_URL = 'https://relay.test/v1/remote-access/pairs';
const PAIR_ID = '0f8fad5b-d9cb-469f-a165-70867728950e';
const OTHER_PAIR_ID = '1b4e28ba-2fa1-11d2-883f-0016d3cca427';

async function until(condition: () => boolean, what: string): Promise<void> {
	const start = Date.now();
	while (!condition()) {
		if (Date.now() - start > 3_000) {
			throw new Error(`Timed out waiting for ${what}`);
		}
		await new Promise(resolve => setTimeout(resolve, 2));
	}
}

interface IRecordedRequest { readonly type: string; readonly url: string; readonly authorization: string | undefined; readonly body: unknown }

class FakeRequestService {
	readonly requests: IRecordedRequest[] = [];
	/** Queued answers per HTTP method. GET defaults to an empty list, others to 204. */
	readonly responses = new Map<string, Array<{ status: number; body?: unknown }>>();

	respond(type: string, status: number, body?: unknown): void {
		const queue = this.responses.get(type) ?? [];
		queue.push({ status, body });
		this.responses.set(type, queue);
	}

	async request(options: IRequestOptions): Promise<IRequestContext> {
		const headers = options.headers ?? {};
		this.requests.push({
			type: options.type ?? 'GET',
			url: options.url ?? '',
			authorization: headers['Authorization'] as string | undefined,
			body: options.data ? JSON.parse(options.data) : undefined,
		});
		const type = options.type ?? 'GET';
		const response = this.responses.get(type)?.shift() ?? (type === 'GET' ? { status: 200, body: [] } : { status: 204 });
		return {
			res: { headers: {}, statusCode: response.status },
			stream: bufferToStream(VSBuffer.fromString(response.body === undefined ? '' : JSON.stringify(response.body))),
		};
	}
}

class FakeSecretStorage {
	readonly type = 'in-memory' as const;
	readonly values = new Map<string, string>();
	readonly onDidChangeSecret = Event.None;
	async get(key: string) { return this.values.get(key); }
	async set(key: string, value: string) { this.values.set(key, value); }
	async delete(key: string) { this.values.delete(key); }
}

class FakeAuthentication {
	token: string | undefined = 'session-token';
	readonly onDidChangeSessionsEmitter = new Emitter<{ providerId: string; label: string; event: { added?: unknown[]; removed?: unknown[]; changed?: unknown[] } }>();
	readonly onDidChangeSessions = this.onDidChangeSessionsEmitter.event;
	readonly onDidRegisterAuthenticationProvider = Event.None;
	async getSessions(providerId: string) {
		return providerId === 'flowleap' && this.token ? [{ id: 's', accessToken: this.token, account: { id: 'u', label: 'u' }, scopes: [] }] : [];
	}
	signOut(): void {
		this.token = undefined;
		this.onDidChangeSessionsEmitter.fire({ providerId: 'flowleap', label: 'FlowLeap', event: { removed: [{}] } });
	}
}

class FakeAgentHost {
	readonly pushes: Array<IRemoteAccessHostConfig | undefined> = [];
	readonly onAgentHostStartEmitter = new Emitter<void>();
	readonly onAgentHostStart = this.onAgentHostStartEmitter.event;
	async setRemoteAccessHost(config: IRemoteAccessHostConfig | undefined): Promise<void> { this.pushes.push(config); }
	async getRemoteAccessHostStatus(): Promise<IRemoteAccessHostStatus> { return { state: RemoteAccessHostState.Connected, connectedPairIds: [] }; }
	get last(): IRemoteAccessHostConfig | undefined { return this.pushes[this.pushes.length - 1]; }
}

suite('RemoteAccessService', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	let storage: InMemoryStorageService;
	let secrets: FakeSecretStorage;
	let auth: FakeAuthentication;
	let requests: FakeRequestService;
	let agentHost: FakeAgentHost;
	let configuration: TestConfigurationService;

	setup(() => {
		storage = store.add(new InMemoryStorageService());
		secrets = new FakeSecretStorage();
		auth = new FakeAuthentication();
		store.add(auth.onDidChangeSessionsEmitter);
		requests = new FakeRequestService();
		agentHost = new FakeAgentHost();
		store.add(agentHost.onAgentHostStartEmitter);
		configuration = new TestConfigurationService({ [RemoteAccessSettingId.RelayUrl]: 'wss://relay.test/v1/remote-access/host' });
	});

	function createService(disposables: Pick<DisposableStore, 'add'> = store): RemoteAccessService {
		return disposables.add(new RemoteAccessService(
			storage,
			secrets as unknown as ISecretStorageService,
			auth as unknown as IAuthenticationService,
			requests as unknown as IRequestService,
			configuration,
			{ nameShort: 'FlowLeap' } as IProductService,
			new MockContextKeyService(),
			new NullLogService(),
			agentHost as unknown as IAgentHostService,
		));
	}

	test('pairs URL derives from the Relay Host socket URL', () => {
		assert.strictEqual(getRemoteAccessPairsUrl('wss://api.flowleap.co/v1/remote-access/host'), 'https://api.flowleap.co/v1/remote-access/pairs');
		assert.strictEqual(getRemoteAccessPairsUrl('ws://127.0.0.1:8000/v1/remote-access/host'), 'http://127.0.0.1:8000/v1/remote-access/pairs');
	});

	test('the Host id is created once and kept machine-local', () => {
		const first = createService();
		const second = createService();
		assert.match(first.hostId, /^[0-9a-f-]{36}$/);
		assert.strictEqual(second.hostId, first.hostId);
		assert.strictEqual(storage.get(RemoteAccessStorageKey.HostId, StorageScope.APPLICATION), first.hostId);
	});

	test('switching on needs a FlowLeap Session', async () => {
		auth.token = undefined;
		const service = createService();
		await assert.rejects(service.setEnabled(true), (error: unknown) => error instanceof RemoteAccessError && error.kind === RemoteAccessErrorKind.NotSignedIn);
		assert.strictEqual(service.enabled.get(), false);
	});

	test('switching on pushes the token and Host id; switching off pushes nothing', async () => {
		const service = createService();
				await service.setEnabled(true);
		await until(() => !!agentHost.last, 'push on');
		assert.deepStrictEqual(agentHost.last, { relayUrl: 'wss://relay.test/v1/remote-access/host', token: 'session-token', hostId: service.hostId, pairs: [] });
		assert.strictEqual(storage.getBoolean(RemoteAccessStorageKey.Enabled, StorageScope.APPLICATION), true);
		await until(() => service.hostStatus.get().state === RemoteAccessHostState.Connected, 'status');

		await service.setEnabled(false);
		await until(() => agentHost.pushes.length > 0 && agentHost.last === undefined, 'push off');
		assert.strictEqual(service.hostStatus.get().state, RemoteAccessHostState.Stopped);
	});

	test('Pairing posts the proof, keeps only the derived pair key, and pushes it', async () => {
		const service = createService();
				await service.setEnabled(true);
		requests.respond('POST', 201, { pairId: PAIR_ID });

		const offer = await service.startPairing();

		const post = requests.requests.find(r => r.type === 'POST')!;
		assert.strictEqual(post.url, PAIRS_URL);
		assert.strictEqual(post.authorization, 'Bearer session-token');
		const parsed = parsePairingCode(offer.code)!;
		assert.strictEqual(parsed.pairId, PAIR_ID);
		assert.strictEqual(offer.url, `https://remote.flowleap.co/pair#${offer.code}`);
		assert.deepStrictEqual(post.body, { hostId: service.hostId, hostLabel: (post.body as { hostLabel: string }).hostLabel, proof: await computePairingProof(parsed.pairSecret, service.hostId) });
		assert.ok(!JSON.stringify(post.body).includes(offer.code.split('.')[1]), 'the secret never goes to the Relay');

		const stored = secrets.values.get(REMOTE_ACCESS_PAIR_KEY_SECRET_PREFIX + PAIR_ID)!;
		assert.strictEqual(toHex(decodeBase64(stored).buffer), toHex(await derivePairKey(parsed.pairSecret, PAIR_ID)));
		assert.deepStrictEqual([...secrets.values.keys()], [REMOTE_ACCESS_PAIR_KEY_SECRET_PREFIX + PAIR_ID], 'no secret stored besides the pair key');

		await until(() => agentHost.last?.pairs.length === 1, 'push with pair');
		assert.deepStrictEqual(agentHost.last?.pairs, [{ pairId: PAIR_ID, pairKey: stored }]);
	});

	test('refresh keeps this Host\'s pairs and forgets keys the Relay no longer lists', async () => {
		const service = createService();
		secrets.values.set(REMOTE_ACCESS_PAIR_KEY_SECRET_PREFIX + OTHER_PAIR_ID, 'a2V5');
		storage.store(RemoteAccessStorageKey.PairKeyIds, JSON.stringify([OTHER_PAIR_ID]), StorageScope.APPLICATION, StorageTarget.MACHINE);
		requests.respond('GET', 200, [
				{ pairId: PAIR_ID, hostId: service.hostId, viewerLabel: 'Phone' },
				{ pairId: '9b2e8a3c-1d4f-4e5a-8b6c-7d8e9f0a1b2c', hostId: 'another-host' },
		]);
		await service.refreshPairs();
		assert.deepStrictEqual(service.pairs.get().map(p => p.pairId), [PAIR_ID]);
		assert.strictEqual(service.pairs.get()[0].viewerLabel, 'Phone');
		assert.strictEqual(secrets.values.has(REMOTE_ACCESS_PAIR_KEY_SECRET_PREFIX + OTHER_PAIR_ID), false);
	});

	test('a fresh offer survives a refresh before the Viewer claims it', async () => {
		const service = createService();
		requests.respond('POST', 201, { pairId: PAIR_ID });
		await service.startPairing();
		await service.refreshPairs();
		assert.strictEqual(secrets.values.has(REMOTE_ACCESS_PAIR_KEY_SECRET_PREFIX + PAIR_ID), true);
	});

	test('removing a pair deletes it on the Relay and locally', async () => {
		const service = createService();
		requests.respond('POST', 201, { pairId: PAIR_ID });
		await service.startPairing();
		requests.respond('DELETE', 204);
		await service.removePair(PAIR_ID);
		const del = requests.requests.find(r => r.type === 'DELETE')!;
		assert.deepStrictEqual([del.type, del.url], ['DELETE', `${PAIRS_URL}/${PAIR_ID}`]);
		assert.strictEqual(secrets.values.size, 0);
	});

	test('a 402 answer reports that a subscription is needed', async () => {
		const service = createService();
		requests.respond('POST', 402, { error: { code: 'subscription_required' } });
		await assert.rejects(service.startPairing(), (error: unknown) => error instanceof RemoteAccessError && error.kind === RemoteAccessErrorKind.SubscriptionRequired);
		assert.strictEqual(secrets.values.size, 0);
	});

	test('sign-out revokes this Host\'s pairs with the last token and switches off', async () => {
		const service = createService();
		await service.setEnabled(true);
		requests.respond('POST', 201, { pairId: PAIR_ID });
		await service.startPairing();

		auth.signOut();
		await until(() => service.enabled.get() === false, 'switched off');
		const del = requests.requests.find(r => r.type === 'DELETE')!;
		assert.strictEqual(del.url, `${PAIRS_URL}?hostId=${service.hostId}`);
		assert.strictEqual(del.authorization, 'Bearer session-token');
		assert.strictEqual(secrets.values.size, 0);
		assert.deepStrictEqual(service.pairs.get(), []);
		await until(() => agentHost.last === undefined, 'push off');
		assert.strictEqual(service.signedIn.get(), false);
	});

	test('the agent host gets the config again when it restarts', async () => {
		const service = createService();
		await service.setEnabled(true);
		await until(() => !!agentHost.last, 'first push');
		const count = agentHost.pushes.length;
		agentHost.onAgentHostStartEmitter.fire();
		await until(() => agentHost.pushes.length > count, 'push after restart');
		assert.strictEqual(agentHost.last?.hostId, service.hostId);
	});
});
