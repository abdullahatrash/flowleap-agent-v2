/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { AgentHostChatMirrorRegistry, CHAT_MIRROR_PUBLICATION_VERSION, type IAgentHostChatMirrorWindow, type IMirroredChatSummary, type IMirroredChatUpdate } from '../../common/agentHostChatMirror.js';

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
});
