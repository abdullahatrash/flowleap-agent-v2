/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { Codicon } from '../../../../../../base/common/codicons.js';
import { Emitter, Event } from '../../../../../../base/common/event.js';
import { URI } from '../../../../../../base/common/uri.js';
import { extUri } from '../../../../../../base/common/resources.js';
import { mock } from '../../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../base/test/common/utils.js';
import { ICommandService } from '../../../../../../platform/commands/common/commands.js';
import { TestInstantiationService } from '../../../../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { ILabelService } from '../../../../../../platform/label/common/label.js';
import { ILogService, NullLogService } from '../../../../../../platform/log/common/log.js';
import { IUriIdentityService } from '../../../../../../platform/uriIdentity/common/uriIdentity.js';
import { IAgentSession, IAgentSessionsModel } from '../../../../../../workbench/contrib/chat/browser/agentSessions/agentSessionsModel.js';
import { IAgentSessionsService } from '../../../../../../workbench/contrib/chat/browser/agentSessions/agentSessionsService.js';
import { IChatService } from '../../../../../../workbench/contrib/chat/common/chatService/chatService.js';
import { ChatSessionStatus, IChatSessionsService } from '../../../../../../workbench/contrib/chat/common/chatSessionsService.js';
import { ILanguageModelsService } from '../../../../../../workbench/contrib/chat/common/languageModels.js';
import { MockLabelService } from '../../../../../../workbench/services/label/test/common/mockLabelService.js';
import { SessionTypeAuthRequirement } from '../../../../../services/sessions/common/session.js';
import { CLAUDE_CODE_SESSION_TYPE_ID, CLAUDE_PROVIDER_ID, ClaudeChatSessionsProvider } from '../../browser/claudeChatSessionsProvider.js';

function createAgentSession(resource: URI, providerType: string, title: string): IAgentSession {
	return new class extends mock<IAgentSession>() {
		override readonly resource = resource;
		override readonly providerType = providerType;
		override readonly label = title;
		override readonly status = ChatSessionStatus.Completed;
		override readonly icon = Codicon.claude;
		override readonly timing = { created: 1, lastRequestStarted: undefined, lastRequestEnded: undefined };
		override readonly metadata = { repositoryPath: '/repo' };
		override isArchived(): boolean { return false; }
		override isRead(): boolean { return true; }
	}();
}

suite('ClaudeChatSessionsProvider', () => {

	const store = ensureNoDisposablesAreLeakedInTestSuite();

	function createProvider(sessions: IAgentSession[]): ClaudeChatSessionsProvider {
		const onDidChangeSessions = store.add(new Emitter<void>());
		const instantiationService = store.add(new TestInstantiationService());
		instantiationService.stub(IAgentSessionsService, new class extends mock<IAgentSessionsService>() {
			override readonly model = new class extends mock<IAgentSessionsModel>() {
				override readonly onDidChangeSessions = onDidChangeSessions.event;
				override get sessions() { return sessions; }
			}();
			override getSession(resource: URI) { return sessions.find(s => s.resource.toString() === resource.toString()); }
		}());
		instantiationService.stub(IChatService, new class extends mock<IChatService>() { }());
		instantiationService.stub(IChatSessionsService, new class extends mock<IChatSessionsService>() { }());
		instantiationService.stub(ICommandService, new class extends mock<ICommandService>() { }());
		instantiationService.stub(ILanguageModelsService, new class extends mock<ILanguageModelsService>() {
			override readonly onDidChangeLanguageModels = Event.None;
		}());
		instantiationService.stub(ILogService, new NullLogService());
		instantiationService.stub(ILabelService, new MockLabelService());
		instantiationService.stub(IUriIdentityService, new class extends mock<IUriIdentityService>() {
			override readonly extUri = extUri;
		}());
		return store.add(instantiationService.createInstance(ClaudeChatSessionsProvider));
	}

	test('offers only the Claude session type, for local folders', () => {
		const provider = createProvider([]);
		assert.deepStrictEqual({
			providerId: provider.id,
			types: provider.sessionTypes.map(t => ({ id: t.id, authRequirement: t.authRequirement })),
			folderTypes: provider.getSessionTypes(URI.file('/repo')).map(t => t.id),
			remoteTypes: provider.getSessionTypes(URI.from({ scheme: 'github-remote-file', path: '/owner/repo' })).map(t => t.id),
		}, {
			providerId: CLAUDE_PROVIDER_ID,
			types: [{ id: CLAUDE_CODE_SESSION_TYPE_ID, authRequirement: SessionTypeAuthRequirement.None }],
			folderTypes: [CLAUDE_CODE_SESSION_TYPE_ID],
			remoteTypes: [],
		});
	});

	test('creates a new Claude session on a local folder', () => {
		const provider = createProvider([]);
		const session = provider.createNewSession(URI.file('/repo'), CLAUDE_CODE_SESSION_TYPE_ID);
		assert.deepStrictEqual({
			sessionType: session.sessionType,
			scheme: session.resource.scheme,
			workspace: session.workspace.get()?.uri.toString(),
			known: provider.getSession(session.sessionId) !== undefined,
		}, {
			sessionType: CLAUDE_CODE_SESSION_TYPE_ID,
			scheme: CLAUDE_CODE_SESSION_TYPE_ID,
			workspace: URI.file('/repo').toString(),
			known: true,
		});
		provider.deleteNewSession(session.sessionId);
	});

	test('lists committed Claude sessions and ignores other session types', () => {
		const provider = createProvider([
			createAgentSession(URI.from({ scheme: CLAUDE_CODE_SESSION_TYPE_ID, path: '/one' }), CLAUDE_CODE_SESSION_TYPE_ID, 'One'),
			createAgentSession(URI.from({ scheme: 'copilotcli', path: '/two' }), 'copilotcli', 'Two'),
		]);
		assert.deepStrictEqual(provider.getSessions().map(s => ({ title: s.title.get(), workspace: s.workspace.get()?.uri.fsPath })), [
			{ title: 'One', workspace: URI.file('/repo').fsPath },
		]);
	});
});
