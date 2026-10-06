/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import { Event } from '../../../../../base/common/event.js';
import { Schemas } from '../../../../../base/common/network.js';
import { joinPath } from '../../../../../base/common/resources.js';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { FileService } from '../../../../../platform/files/common/fileService.js';
import { CorrelatingInMemoryFileSystemProvider } from '../../../../../platform/files/test/common/correlatingInMemoryFileSystemProvider.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { StorageScope, StorageTarget } from '../../../../../platform/storage/common/storage.js';
import { toUserDataProfile } from '../../../../../platform/userDataProfile/common/userDataProfile.js';
import { UserDataProfileService } from '../../../userDataProfile/common/userDataProfileService.js';
import { FileStorageDatabase, HostedStorageService } from '../../browser/hostedStorageService.js';

suite('HostedStorageService (#547)', () => {

	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	const userRoamingDataHome = URI.from({ scheme: Schemas.vscodeUserData, path: '/User' });
	const stateFile = joinPath(userRoamingDataHome, 'globalStorage', 'browserState.json');
	const logService = new NullLogService();

	let fileService: FileService;

	setup(() => {
		fileService = disposables.add(new FileService(logService));
		disposables.add(fileService.registerProvider(Schemas.vscodeUserData, disposables.add(new CorrelatingInMemoryFileSystemProvider())));
	});

	async function createStorageService(): Promise<HostedStorageService> {
		const defaultProfile = toUserDataProfile('default', 'Default', userRoamingDataHome, joinPath(userRoamingDataHome, 'caches'), undefined);
		const profileService = disposables.add(new UserDataProfileService({ ...defaultProfile, isDefault: true }));
		const storageService = disposables.add(new HostedStorageService({ id: 'workspace-a' }, profileService, userRoamingDataHome, joinPath(userRoamingDataHome, 'workspaceStorage'), fileService, logService));
		await storageService.initialize();
		return storageService;
	}

	test('state is kept in files on the server and found again by a new browser', async () => {
		const first = await createStorageService();
		first.store('chat.currentLanguageModel.panel', 'openrouter/anthropic/claude-sonnet-5', StorageScope.PROFILE, StorageTarget.USER);
		first.store('chat.ChatSessionStore.index', '{"version":1,"entries":{"s1":{}}}', StorageScope.WORKSPACE, StorageTarget.MACHINE);
		await first.flush();
		first.dispose();

		const files = [stateFile, joinPath(userRoamingDataHome, 'workspaceStorage', 'workspace-a', 'browserState.json')];
		const filesExist = await Promise.all(files.map(file => fileService.exists(file)));
		const second = await createStorageService();

		assert.deepStrictEqual({
			model: second.get('chat.currentLanguageModel.panel', StorageScope.PROFILE),
			index: second.get('chat.ChatSessionStore.index', StorageScope.WORKSPACE),
			isNew: second.isNew(StorageScope.APPLICATION),
			filesExist,
		}, {
			model: 'openrouter/anthropic/claude-sonnet-5',
			index: '{"version":1,"entries":{"s1":{}}}',
			isNew: false,
			filesExist: [true, true],
		});
	});

	test('a change written by another tab is reported, keys this tab wrote are kept', async () => {
		const tabA = disposables.add(await FileStorageDatabase.create(stateFile, true, fileService, logService));
		const tabB = disposables.add(await FileStorageDatabase.create(stateFile, true, fileService, logService));

		await tabA.updateItems({ insert: new Map([['a', '1']]) });
		const external = await Event.toPromise(tabB.onDidChangeItemsExternal);
		await tabB.updateItems({ insert: new Map([['b', '2']]) });

		assert.deepStrictEqual({
			external: [...external.changed ?? []],
			tabB: [...await tabB.getItems()],
			file: JSON.parse((await fileService.readFile(stateFile)).value.toString()),
		}, {
			external: [['a', '1']],
			tabB: [['a', '1'], ['b', '2']],
			file: { a: '1', b: '2' },
		});
	});

	test('a file that is not JSON starts empty instead of failing', async () => {
		await fileService.writeFile(stateFile, VSBuffer.fromString('not json'));
		const database = disposables.add(await FileStorageDatabase.create(stateFile, false, fileService, logService));
		assert.deepStrictEqual([...await database.getItems()], []);
	});
});
