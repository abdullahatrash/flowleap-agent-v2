/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import {
	bytesToUuid, computePairingProof, decodeBase32, derivePairKey, encodeBase32, formatPairingCode, formatPairingUrl,
	generatePairSecret, parsePairingCode, REMOTE_ACCESS_MAX_CHUNK_BYTES, RemoteAccessChannelCipher, RemoteAccessCryptoError,
	RemoteAccessHandshake, RemoteAccessRole, toHex, uuidToBytes,
} from '../../common/remoteAccessCrypto.js';

const PAIR_ID = '0f8fad5b-d9cb-469f-a165-70867728950e';
const HOST_ID = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

async function pairOfCiphers(hostKey: Uint8Array, viewerKey = hostKey): Promise<{ host: RemoteAccessChannelCipher; viewer: RemoteAccessChannelCipher }> {
	const viewerHandshake = await RemoteAccessHandshake.create(RemoteAccessRole.Viewer, viewerKey, PAIR_ID);
	const hostHandshake = await RemoteAccessHandshake.create(RemoteAccessRole.Host, hostKey, PAIR_ID);
	const host = await hostHandshake.complete(viewerHandshake.message);
	const viewer = await viewerHandshake.complete(hostHandshake.message);
	return { host, viewer };
}

suite('RemoteAccessCrypto', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('base32 round trip matches RFC 4648 vectors', () => {
		const text = new TextEncoder().encode('foobar');
		assert.strictEqual(encodeBase32(text), 'mzxw6ytboi');
		assert.deepStrictEqual(decodeBase32('MZXW6YTBOI'), text);
		assert.strictEqual(decodeBase32('not base32!'), undefined);
		const secret = generatePairSecret();
		assert.strictEqual(encodeBase32(secret).length, 26);
		assert.deepStrictEqual(decodeBase32(encodeBase32(secret)), secret);
	});

	test('uuid bytes round trip', () => {
		assert.strictEqual(bytesToUuid(uuidToBytes(PAIR_ID.toUpperCase())), PAIR_ID);
		assert.throws(() => uuidToBytes('nope'), RemoteAccessCryptoError);
	});

	test('pairing code and URL parse back to the same secret', () => {
		const secret = generatePairSecret();
		const code = formatPairingCode(PAIR_ID, secret);
		const url = formatPairingUrl(PAIR_ID, secret);
		assert.ok(url.startsWith('https://remote.flowleap.co/pair#'));
		assert.ok(url.endsWith(code));
		for (const input of [code, url, `  ${code.toUpperCase()}  `]) {
			const parsed = parsePairingCode(input);
			assert.ok(parsed);
			assert.strictEqual(parsed.pairId, PAIR_ID);
			assert.deepStrictEqual(parsed.pairSecret, secret);
		}
		assert.strictEqual(parsePairingCode('abc'), undefined);
		assert.strictEqual(parsePairingCode(`${PAIR_ID}.mzxw6`), undefined, 'short secret');
	});

	test('pairing proof is HMAC-SHA256(secret, hostId) in hex', async () => {
		// RFC 4231 test case 2 shape: key "Jefe", data "what do ya want for nothing?".
		const proof = await computePairingProof(new TextEncoder().encode('Jefe'), 'what do ya want for nothing?');
		assert.strictEqual(proof, '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843');
		const secret = generatePairSecret();
		assert.strictEqual(await computePairingProof(secret, HOST_ID), await computePairingProof(secret, HOST_ID));
		assert.notStrictEqual(await computePairingProof(secret, HOST_ID), await computePairingProof(generatePairSecret(), HOST_ID));
	});

	test('pair key is deterministic per secret and pair id', async () => {
		const secret = generatePairSecret();
		const a = await derivePairKey(secret, PAIR_ID);
		const b = await derivePairKey(secret, PAIR_ID);
		const c = await derivePairKey(secret, HOST_ID);
		assert.strictEqual(a.byteLength, 32);
		assert.strictEqual(toHex(a), toHex(b));
		assert.notStrictEqual(toHex(a), toHex(c));
	});

	test('handshake then messages round trip in both directions', async () => {
		const pairKey = await derivePairKey(generatePairSecret(), PAIR_ID);
		const { host, viewer } = await pairOfCiphers(pairKey);

		for (const text of ['{"jsonrpc":"2.0","method":"initialize"}', '', 'ü 🚀 unicode']) {
			const frames = await viewer.seal(text);
			assert.strictEqual(frames.length, 1);
			assert.strictEqual(await host.open(frames[0]), text);
		}
		const reply = await host.seal('{"jsonrpc":"2.0","id":1,"result":{}}');
		assert.strictEqual(await viewer.open(reply[0]), '{"jsonrpc":"2.0","id":1,"result":{}}');
	});

	test('a message over one chunk is split and reassembled', async () => {
		const pairKey = await derivePairKey(generatePairSecret(), PAIR_ID);
		const { host, viewer } = await pairOfCiphers(pairKey);
		const big = 'x'.repeat(REMOTE_ACCESS_MAX_CHUNK_BYTES * 2 + 17);
		const frames = await host.seal(big);
		assert.strictEqual(frames.length, 3);
		assert.strictEqual(await viewer.open(frames[0]), undefined);
		assert.strictEqual(await viewer.open(frames[1]), undefined);
		assert.strictEqual(await viewer.open(frames[2]), big);
	});

	test('a handshake under another pair key is refused', async () => {
		const hostKey = await derivePairKey(generatePairSecret(), PAIR_ID);
		const otherKey = await derivePairKey(generatePairSecret(), PAIR_ID);
		await assert.rejects(pairOfCiphers(hostKey, otherKey), RemoteAccessCryptoError);
	});

	test('a handshake from the same role is refused', async () => {
		const pairKey = await derivePairKey(generatePairSecret(), PAIR_ID);
		const a = await RemoteAccessHandshake.create(RemoteAccessRole.Host, pairKey, PAIR_ID);
		const b = await RemoteAccessHandshake.create(RemoteAccessRole.Host, pairKey, PAIR_ID);
		await assert.rejects(a.complete(b.message), /unexpected role/);
	});

	test('tampered, replayed and reordered frames are refused', async () => {
		const pairKey = await derivePairKey(generatePairSecret(), PAIR_ID);

		let { host, viewer } = await pairOfCiphers(pairKey);
		const tampered = (await viewer.seal('hello'))[0];
		tampered[tampered.length - 1] ^= 0xff;
		await assert.rejects(host.open(tampered), /authentication/);

		({ host, viewer } = await pairOfCiphers(pairKey));
		const first = (await viewer.seal('one'))[0];
		const second = (await viewer.seal('two'))[0];
		await assert.rejects(host.open(second), /out of order/);

		({ host, viewer } = await pairOfCiphers(pairKey));
		const once = (await viewer.seal('one'))[0];
		assert.strictEqual(await host.open(once), 'one');
		await assert.rejects(host.open(once), /out of order/, 'replay');
		assert.ok(first);
	});

	test('a frame cannot be reflected back to its sender', async () => {
		const pairKey = await derivePairKey(generatePairSecret(), PAIR_ID);
		const { host } = await pairOfCiphers(pairKey);
		const own = (await host.seal('mine'))[0];
		await assert.rejects(host.open(own), /authentication/);
	});
});
