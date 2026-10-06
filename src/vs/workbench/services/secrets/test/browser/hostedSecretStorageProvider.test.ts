/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { Event } from '../../../../../base/common/event.js';
import { Schemas } from '../../../../../base/common/network.js';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { FileService } from '../../../../../platform/files/common/fileService.js';
import { CorrelatingInMemoryFileSystemProvider } from '../../../../../platform/files/test/common/correlatingInMemoryFileSystemProvider.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { HostedSecretStorageProvider } from '../../browser/hostedSecretStorageProvider.js';
import { ISecretStorageCrypto, NetworkError } from '../../browser/secretStorageCrypto.js';

/** Reversible stand-in for the server-keyed AES crypto. */
class TestCrypto implements ISecretStorageCrypto {
	keyReachable = true;
	async seal(data: string): Promise<string> {
		return `sealed:${btoa(data)}`;
	}
	async unseal(data: string): Promise<string> {
		if (!this.keyReachable) {
			throw new NetworkError(new Error('key endpoint unreachable'));
		}
		return atob(data.substring('sealed:'.length));
	}
}

suite('HostedSecretStorageProvider (#547)', () => {

	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	const secretsFile = URI.from({ scheme: Schemas.vscodeUserData, path: '/User/secrets.json' });
	const logService = new NullLogService();

	let fileService: FileService;
	let crypto: TestCrypto;

	setup(() => {
		fileService = disposables.add(new FileService(logService));
		disposables.add(fileService.registerProvider(Schemas.vscodeUserData, disposables.add(new CorrelatingInMemoryFileSystemProvider())));
		crypto = new TestCrypto();
	});

	function createTab(): HostedSecretStorageProvider {
		return disposables.add(new HostedSecretStorageProvider(secretsFile, crypto, fileService, logService));
	}

	test('secrets are sealed in one file and read back by a new browser', async () => {
		await createTab().set('flowleap.byok.openrouter', 'sk-or-test-1');

		const newBrowser = createTab();
		const fileContent = (await fileService.readFile(secretsFile)).value.toString();

		assert.deepStrictEqual({
			value: await newBrowser.get('flowleap.byok.openrouter'),
			keys: await newBrowser.keys(),
			plaintextInFile: fileContent.includes('sk-or-test-1'),
		}, {
			value: 'sk-or-test-1',
			keys: ['flowleap.byok.openrouter'],
			plaintextInFile: false,
		});
	});

	test('two tabs do not overwrite each other, and a tab hears about the other tab', async () => {
		const tabA = createTab();
		const tabB = createTab();
		assert.strictEqual(await tabB.get('session'), undefined); // tab B has read the file once

		const heard = Event.toPromise(tabB.onDidChangeSecretExternally);
		await tabA.set('session', 'token-a');
		const changedKey = await heard;
		const heardByA = Event.toPromise(tabA.onDidChangeSecretExternally);
		await tabB.set('byok', 'key-b');
		await heardByA;

		assert.deepStrictEqual({
			changedKey,
			tabA: [await tabA.get('session'), await tabA.get('byok')],
			tabB: [await tabB.get('session'), await tabB.get('byok')],
		}, {
			changedKey: 'session',
			tabA: ['token-a', 'key-b'],
			tabB: ['token-a', 'key-b'],
		});
	});

	test('an unreachable key fails the read but keeps the stored secrets', async () => {
		await createTab().set('session', 'token-a');

		crypto.keyReachable = false;
		const tab = createTab();
		await assert.rejects(() => tab.get('session'));

		crypto.keyReachable = true;
		assert.strictEqual(await tab.get('session'), 'token-a');
	});
});
