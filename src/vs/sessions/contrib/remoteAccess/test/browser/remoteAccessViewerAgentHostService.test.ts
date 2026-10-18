/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IRemoteAccessViewerOptions } from '../../../../../platform/agentHost/common/remoteAccessViewer.js';
import { RemoteAgentHostEntryType } from '../../../../../platform/agentHost/common/remoteAgentHostService.js';
import { TestInstantiationService } from '../../../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { REMOTE_ACCESS_VIEWER_RECONNECT_POLICY, remoteAccessViewerAddress, RemoteAccessViewerConnectionFactory } from '../../browser/viewer/remoteAccessViewerAgentHostService.js';

const PAIR_ID = '0F8FAD5B-D9CB-469F-A165-70867728950E';

suite('RemoteAccessViewerAgentHostService', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	const options: IRemoteAccessViewerOptions = {
		relayUrl: 'wss://api.example/v1/remote-access/viewer',
		pairId: PAIR_ID,
		pairKey: new Uint8Array(32),
		hostLabel: 'Studio Mac',
		buildVersion: '0.9.0',
		getToken: async () => 't',
	};

	test('the Viewer publishes exactly one entry: the pair\'s Host', () => {
		const factory = new RemoteAccessViewerConnectionFactory(options, store.add(new TestInstantiationService()));
		assert.strictEqual(factory.kind, RemoteAgentHostEntryType.WebSocket);
		assert.deepStrictEqual(factory.entries.get(), [{
			name: 'Studio Mac',
			connection: { type: RemoteAgentHostEntryType.WebSocket, address: 'remote-access-0f8fad5b-d9cb-469f-a165-70867728950e' },
		}]);
		assert.strictEqual(remoteAccessViewerAddress(PAIR_ID), 'remote-access-0f8fad5b-d9cb-469f-a165-70867728950e');
	});

	test('it dials nothing but its own entry', () => {
		const factory = new RemoteAccessViewerConnectionFactory(options, store.add(new TestInstantiationService()));
		assert.throws(() => factory.createConnection({ name: 'x', connection: { type: RemoteAgentHostEntryType.WebSocket, address: 'localhost:3000' } }, { userInitiated: false }));
	});

	test('the Viewer keeps trying while the page is open', () => {
		assert.strictEqual(REMOTE_ACCESS_VIEWER_RECONNECT_POLICY.autoRestore, true);
		assert.ok(REMOTE_ACCESS_VIEWER_RECONNECT_POLICY.maxAttempts > 1_000_000);
		assert.strictEqual(REMOTE_ACCESS_VIEWER_RECONNECT_POLICY.maxElapsedTimeMs, undefined);
	});
});
