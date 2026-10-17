/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { AGENT_HOST_MAIN_PROCESS_CLIENT_CTX, AgentHostChatMirrorRegistry, CHAT_MIRROR_PUBLICATION_VERSION, isRendererWindowConnection, type IAgentHostChatMirrorWindow, type IMirroredChatSummary, type IMirroredChatUpdate } from '../../common/agentHostChatMirror.js';

const CLIENT = 'window-1';
const CHAT = 'vscode-chat-session://local/Y2hhdC0x';

const window: IAgentHostChatMirrorWindow = {
	getChat: async () => undefined,
	sendMessage: async () => { },
	confirmToolCall: async () => false,
	cancel: async () => { },
};

suite('AgentHostChatMirrorRegistry', () => {

	const disposables = new DisposableStore();
	teardown(() => disposables.clear());
	ensureNoDisposablesAreLeakedInTestSuite();

	test('accepts publications of attached windows in this version only and withdraws a closed window', () => {
		const registry = disposables.add(new AgentHostChatMirrorRegistry());
		const events: string[] = [];
		disposables.add(registry.onDidChangeChats(publisher => events.push(`chats:${publisher.clientId}:${publisher.chats.length}`)));
		disposables.add(registry.onDidUpdateChat(({ clientId, update }) => events.push(`chat:${clientId}:${update.id}`)));
		disposables.add(registry.onDidWithdraw(clientId => events.push(`withdraw:${clientId}`)));
		const attachment = registry.attachWindow(CLIENT, window);
		const summary: IMirroredChatSummary = { id: CHAT, title: 'Hinge prior art', createdAt: 1, modifiedAt: 2 };
		const update: IMirroredChatUpdate = { id: CHAT, endedTurns: [], historyChanged: false };

		const accepted = [
			registry.publish({ version: CHAT_MIRROR_PUBLICATION_VERSION, kind: 'chat', clientId: CLIENT, update }),
			registry.publish({ version: CHAT_MIRROR_PUBLICATION_VERSION, kind: 'chats', clientId: 'unattached', chats: [summary] }),
			registry.publish({ version: 2 as typeof CHAT_MIRROR_PUBLICATION_VERSION, kind: 'chats', clientId: CLIENT, chats: [summary] }),
			registry.publish({ version: CHAT_MIRROR_PUBLICATION_VERSION, kind: 'chats', clientId: CLIENT, chats: [summary] }),
			registry.publish({ version: CHAT_MIRROR_PUBLICATION_VERSION, kind: 'chat', clientId: CLIENT, update }),
		];
		attachment.dispose();

		assert.deepStrictEqual({ accepted, events, publishers: [...registry.publishers].length }, {
			accepted: [false, false, false, true, true],
			events: [`chats:${CLIENT}:1`, `chat:${CLIENT}:${CHAT}`, `withdraw:${CLIENT}`],
			publishers: 0,
		});
	});

	test('reports publishers after the chat and withdrawal events, once per window (PRD 0018 C3)', () => {
		const registry = disposables.add(new AgentHostChatMirrorRegistry());
		const events: string[] = [];
		disposables.add(registry.onDidChangeChats(publisher => events.push(`chats:${publisher.clientId}`)));
		disposables.add(registry.onDidWithdraw(clientId => events.push(`withdraw:${clientId}`)));
		disposables.add(registry.onDidChangePublishers(() => events.push(`publishers:${registry.hasPublishers}`)));
		const first = registry.attachWindow(CLIENT, window);
		const second = registry.attachWindow('window-2', window);
		const summary: IMirroredChatSummary = { id: CHAT, title: 'Hinge prior art', createdAt: 1, modifiedAt: 2 };

		registry.publish({ version: CHAT_MIRROR_PUBLICATION_VERSION, kind: 'chats', clientId: CLIENT, chats: [summary] });
		registry.publish({ version: CHAT_MIRROR_PUBLICATION_VERSION, kind: 'chats', clientId: CLIENT, chats: [] });
		registry.publish({ version: CHAT_MIRROR_PUBLICATION_VERSION, kind: 'chats', clientId: 'window-2', chats: [] });
		registry.publish({ version: CHAT_MIRROR_PUBLICATION_VERSION, kind: 'withdraw', clientId: CLIENT });
		second.dispose();
		first.dispose();

		assert.deepStrictEqual(events, [
			`chats:${CLIENT}`, 'publishers:true',
			`chats:${CLIENT}`,
			'chats:window-2', 'publishers:true',
			`withdraw:${CLIENT}`, 'publishers:true',
			'withdraw:window-2', 'publishers:false',
		]);
	});

	test('treats renderer windows as mirror clients and the main process as not (spike gap 6)', () => {
		assert.deepStrictEqual({
			window: isRendererWindowConnection('40054cef-8e9b-411b-b61e-5c68a51f7fa3'),
			mainProcess: isRendererWindowConnection(AGENT_HOST_MAIN_PROCESS_CLIENT_CTX),
			empty: isRendererWindowConnection(''),
			notAString: isRendererWindowConnection(undefined),
		}, { window: true, mainProcess: false, empty: false, notAString: false });
	});
});
