/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { computePairingProof, derivePairKey, formatPairingCode, formatPairingUrl, generatePairSecret } from '../../../../../platform/agentHost/common/remoteAccessCrypto.js';
import {
	claimPairing, clerkFrontendApiFromPublishableKey, defaultViewerLabel, IRemoteAccessViewerBuilds, pairingCodeFromLocation, parsePairList, parseViewerBuilds,
	parseViewerConfig, pickBuildForHost, pickLoadedBuild, relayViewerUrl, RemoteAccessViewerApi, ViewerApiError, ViewerApiErrorKind, ViewerBuildPick, ViewerFetch,
	viewerPairStatus, ViewerPairStatus,
} from '../../common/remoteAccessViewerBoot.js';

const HOST_ID = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const PAIR_ID = '0f8fad5b-d9cb-469f-a165-70867728950e';
const OTHER_PAIR_ID = '1b4e28ba-2fa1-11d2-883f-0016d3cca427';

interface IRecordedCall {
	readonly url: string;
	readonly method: string;
	readonly headers: Record<string, string>;
	readonly body?: unknown;
}

/** A `fetch` that answers from a table and records the calls. */
function fakeFetch(answers: Record<string, { status: number; body?: unknown }>): { fetch: ViewerFetch; calls: IRecordedCall[] } {
	const calls: IRecordedCall[] = [];
	const fetch: ViewerFetch = async (url, init) => {
		calls.push({ url, method: init.method, headers: init.headers, body: init.body ? JSON.parse(init.body) : undefined });
		const answer = answers[`${init.method} ${new URL(url).pathname}`];
		if (!answer) {
			throw new TypeError('network down');
		}
		return { status: answer.status, json: async () => answer.body };
	};
	return { fetch, calls };
}

function pairRow(pairId: string, state: 'offered' | 'paired') {
	return { pairId, hostId: HOST_ID, hostLabel: 'Studio Mac', viewerLabel: state === 'paired' ? 'iPhone' : null, state, createdAt: '2026-10-17T10:00:00.000Z', lastSeenAt: null };
}

suite('RemoteAccessViewerBoot', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	const builds: IRemoteAccessViewerBuilds = { latest: '0.9.0', versions: ['0.9.0', '0.8.1', '0.8.0'] };

	test('config: a Clerk key or, on localhost only, a dev token', () => {
		assert.deepStrictEqual(parseViewerConfig({ clerkPublishableKey: 'pk_live_abc', apiBaseUrl: 'https://api.flowleap.co/' }, 'remote.flowleap.co'), {
			clerkPublishableKey: 'pk_live_abc',
			apiBaseUrl: 'https://api.flowleap.co',
			relayUrl: 'wss://api.flowleap.co/v1/remote-access/viewer',
			devToken: undefined,
		});
		assert.strictEqual(parseViewerConfig({ apiBaseUrl: 'https://api.flowleap.co', devToken: 'dev' }, 'remote.flowleap.co'), undefined, 'a dev token is ignored off localhost');
		assert.strictEqual(parseViewerConfig({ apiBaseUrl: 'http://127.0.0.1:8000', devToken: 'dev' }, '127.0.0.1')?.relayUrl, 'ws://127.0.0.1:8000/v1/remote-access/viewer');
		assert.strictEqual(parseViewerConfig({ clerkPublishableKey: 'sk_live_secret', apiBaseUrl: 'https://api.flowleap.co' }, 'remote.flowleap.co'), undefined, 'not a publishable key');
		assert.strictEqual(parseViewerConfig({ clerkPublishableKey: 'pk_live_abc' }, 'remote.flowleap.co'), undefined);
		assert.strictEqual(parseViewerConfig(undefined, 'remote.flowleap.co'), undefined);
		assert.strictEqual(relayViewerUrl('https://api.flowleap.co'), 'wss://api.flowleap.co/v1/remote-access/viewer');
	});

	test('Clerk Frontend API host from a publishable key', () => {
		assert.strictEqual(clerkFrontendApiFromPublishableKey(`pk_live_${btoa('clerk.flowleap.co$')}`), 'clerk.flowleap.co');
		assert.strictEqual(clerkFrontendApiFromPublishableKey(`pk_test_${btoa('fine-cat-1.clerk.accounts.dev$')}`), 'fine-cat-1.clerk.accounts.dev');
		assert.strictEqual(clerkFrontendApiFromPublishableKey(`pk_live_${btoa('evil.example/x$')}`), undefined);
		assert.strictEqual(clerkFrontendApiFromPublishableKey('pk_live_%%%'), undefined);
		assert.strictEqual(clerkFrontendApiFromPublishableKey('pk_live'), undefined);
	});

	test('builds: versions.json and the folder the page loads', () => {
		assert.deepStrictEqual(parseViewerBuilds({ latest: '0.9.0', versions: ['0.9.0', '0.8.1', '../etc', 7] }), { latest: '0.9.0', versions: ['0.9.0', '0.8.1'] });
		assert.deepStrictEqual(parseViewerBuilds({ versions: ['0.8.1'] }), { latest: '0.8.1', versions: ['0.8.1'] });
		assert.strictEqual(parseViewerBuilds({ latest: '0.9.0', versions: [] }), undefined);

		assert.strictEqual(pickLoadedBuild('/', builds), '0.9.0');
		assert.strictEqual(pickLoadedBuild('/pair', builds), '0.9.0');
		assert.strictEqual(pickLoadedBuild('/0.8.1/', builds), '0.8.1');
		assert.strictEqual(pickLoadedBuild('/0.8.1', builds), '0.8.1');
		assert.strictEqual(pickLoadedBuild('/0.7.0/', builds), '0.9.0', 'a pruned build falls back to the newest');
	});

	test('build pick for the Host version (contract section 8)', () => {
		assert.deepStrictEqual(pickBuildForHost('0.9.0', undefined, builds), { pick: ViewerBuildPick.Stay, version: '0.9.0' });
		assert.deepStrictEqual(pickBuildForHost('0.9.0', '0.9.0', builds), { pick: ViewerBuildPick.Stay, version: '0.9.0' });
		assert.deepStrictEqual(pickBuildForHost('0.9.0', '0.8.1', builds), { pick: ViewerBuildPick.Switch, version: '0.8.1' });
		assert.deepStrictEqual(pickBuildForHost('0.8.1', '0.9.0', builds), { pick: ViewerBuildPick.Switch, version: '0.9.0' });
		assert.deepStrictEqual(pickBuildForHost('0.9.0', '0.7.0', builds), { pick: ViewerBuildPick.Missing, version: '0.7.0' });
	});

	test('the pairing code in a /pair link', () => {
		const secret = generatePairSecret();
		const url = new URL(formatPairingUrl(PAIR_ID, secret));
		assert.deepStrictEqual(pairingCodeFromLocation(url.pathname, url.hash), { pairId: PAIR_ID, pairSecret: secret });
		assert.strictEqual(pairingCodeFromLocation('/0.9.0/', url.hash), undefined, 'only on /pair');
		assert.strictEqual(pairingCodeFromLocation('/pair', ''), undefined);
		assert.strictEqual(pairingCodeFromLocation('/pair', '#not-a-code'), undefined);
	});

	test('pair list: rows that are not pairs are dropped; status per device', () => {
		const rows = parsePairList({ pairs: [pairRow(PAIR_ID.toUpperCase(), 'paired'), pairRow(OTHER_PAIR_ID, 'offered'), { pairId: 'x' }, null] });
		assert.deepStrictEqual(rows.map(row => [row.pairId, row.state]), [[PAIR_ID, 'paired'], [OTHER_PAIR_ID, 'offered']]);
		assert.deepStrictEqual(parsePairList({}), []);
		assert.strictEqual(viewerPairStatus(rows[0], true), ViewerPairStatus.Ready);
		assert.strictEqual(viewerPairStatus(rows[0], false), ViewerPairStatus.OtherDevice);
		assert.strictEqual(viewerPairStatus(rows[1], false), ViewerPairStatus.Offered);
	});

	test('viewer label from the user agent', () => {
		assert.strictEqual(defaultViewerLabel('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)'), 'iPhone');
		assert.strictEqual(defaultViewerLabel('Mozilla/5.0 (Linux; Android 15; Pixel 9) Mobile Safari'), 'Android phone');
		assert.strictEqual(defaultViewerLabel('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'), 'Mac browser');
	});

	test('claim: the proof is HMAC(pairSecret, hostId) and the pair key is derived locally', async () => {
		const secret = generatePairSecret();
		const { fetch, calls } = fakeFetch({
			'GET /v1/remote-access/pairs': { status: 200, body: { pairs: [pairRow(PAIR_ID, 'offered')] } },
			[`POST /v1/remote-access/pairs/${PAIR_ID}/claim`]: { status: 200, body: pairRow(PAIR_ID, 'paired') },
		});
		const api = new RemoteAccessViewerApi('https://api.example', async () => 'token-1', fetch);
		const claimed = await claimPairing(api, { pairId: PAIR_ID, pairSecret: secret }, 'iPhone');

		assert.strictEqual(calls.length, 2);
		assert.strictEqual(calls[0].headers['Authorization'], 'Bearer token-1');
		assert.deepStrictEqual(calls[1].body, { viewerLabel: 'iPhone', proof: await computePairingProof(secret, HOST_ID) });
		assert.ok(!JSON.stringify(calls).includes(formatPairingCode(PAIR_ID, secret).split('.')[1]), 'the secret never leaves the page');
		assert.deepStrictEqual(claimed.pairKey, await derivePairKey(secret, PAIR_ID));
		assert.strictEqual(claimed.hostLabel, 'Studio Mac');
	});

	test('claim: expired, already used, wrong code, network', async () => {
		const secret = generatePairSecret();
		const code = { pairId: PAIR_ID, pairSecret: secret };
		const run = async (answers: Record<string, { status: number; body?: unknown }>) => {
			const api = new RemoteAccessViewerApi('https://api.example', async () => 't', fakeFetch(answers).fetch);
			try {
				await claimPairing(api, code, 'iPhone');
			} catch (error) {
				assert.ok(error instanceof ViewerApiError);
				return [error.kind, error.attemptsLeft];
			}
			return assert.fail('claim should fail');
		};
		const list = (state: 'offered' | 'paired') => ({ 'GET /v1/remote-access/pairs': { status: 200, body: { pairs: [pairRow(PAIR_ID, state)] } } });
		const claimPath = `POST /v1/remote-access/pairs/${PAIR_ID}/claim`;

		assert.deepStrictEqual(await run({ 'GET /v1/remote-access/pairs': { status: 200, body: { pairs: [] } } }), [ViewerApiErrorKind.PairNotFound, undefined]);
		assert.deepStrictEqual(await run(list('paired')), [ViewerApiErrorKind.AlreadyClaimed, undefined]);
		assert.deepStrictEqual(await run({ ...list('offered'), [claimPath]: { status: 403, body: { error: { attemptsLeft: 3 } } } }), [ViewerApiErrorKind.CodeMismatch, 3]);
		assert.deepStrictEqual(await run({ ...list('offered'), [claimPath]: { status: 409 } }), [ViewerApiErrorKind.AlreadyClaimed, undefined]);
		assert.deepStrictEqual(await run({ ...list('offered'), [claimPath]: { status: 402 } }), [ViewerApiErrorKind.SubscriptionRequired, undefined]);
		assert.deepStrictEqual(await run({ 'GET /v1/remote-access/pairs': { status: 404 } }), [ViewerApiErrorKind.NotEnabled, undefined]);
		assert.deepStrictEqual(await run({}), [ViewerApiErrorKind.Network, undefined]);
	});

	test('remove: 204 has no body', async () => {
		const { fetch, calls } = fakeFetch({ [`DELETE /v1/remote-access/pairs/${PAIR_ID}`]: { status: 204 } });
		await new RemoteAccessViewerApi('https://api.example', async () => 't', fetch).remove(PAIR_ID);
		assert.strictEqual(calls[0].method, 'DELETE');
	});
});
