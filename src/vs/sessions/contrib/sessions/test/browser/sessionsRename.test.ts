/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { mainWindow } from '../../../../../base/browser/window.js';
import { Codicon } from '../../../../../base/common/codicons.js';
import { constObservable, observableValue } from '../../../../../base/common/observable.js';
import { URI } from '../../../../../base/common/uri.js';
import { mock } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { CommandsRegistry } from '../../../../../platform/commands/common/commands.js';
import { TestInstantiationService } from '../../../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { IInputOptions, IQuickInputService } from '../../../../../platform/quickinput/common/quickInput.js';
import { SessionView } from '../../../../browser/parts/sessionView.js';
import { ISessionsPartService } from '../../../../services/sessions/browser/sessionsPartService.js';
import { ISessionsService } from '../../../../services/sessions/browser/sessionsService.js';
import { IActiveSession, ISessionsManagementService } from '../../../../services/sessions/common/sessionsManagement.js';
import { IChat, ISession, SessionStatus } from '../../../../services/sessions/common/session.js';
import { SessionsChatAccessibilityHelp } from '../../../chat/browser/sessionsChatAccessibilityHelp.js';
import '../../browser/views/sessionsViewActions.js';

const RENAME_SESSION_COMMAND_ID = 'sessionsViewPane.renameSession';

class TestSessionsManagementService extends mock<ISessionsManagementService>() {
	readonly renamed: { readonly session: ISession; readonly title: string }[] = [];
	renameError: Error | undefined;

	override async renameSession(session: ISession, title: string): Promise<void> {
		this.renamed.push({ session, title });
		if (this.renameError) {
			throw this.renameError;
		}
	}
}

class TestQuickInputService extends mock<IQuickInputService>() {
	result: string | undefined;
	options: IInputOptions | undefined;
	calls = 0;

	override async input(options?: IInputOptions): Promise<string | undefined> {
		this.calls++;
		this.options = options;
		return this.result;
	}
}

function createSession(title: string, supportsRename: boolean): ISession {
	const now = new Date();
	return {
		sessionId: title,
		resource: URI.parse(`test-session://${title}`),
		providerId: 'test',
		sessionType: 'test',
		icon: Codicon.account,
		createdAt: now,
		workspace: observableValue(`workspace-${title}`, undefined),
		title: observableValue(`title-${title}`, title),
		updatedAt: observableValue(`updatedAt-${title}`, now),
		status: observableValue(`status-${title}`, SessionStatus.Completed),
		changesets: observableValue(`changesets-${title}`, []),
		changes: observableValue(`changes-${title}`, []),
		modelId: observableValue(`modelId-${title}`, undefined),
		mode: observableValue(`mode-${title}`, undefined),
		loading: observableValue(`loading-${title}`, false),
		isArchived: observableValue(`isArchived-${title}`, false),
		isRead: observableValue(`isRead-${title}`, true),
		description: observableValue(`description-${title}`, undefined),
		lastTurnEnd: observableValue(`lastTurnEnd-${title}`, undefined),
		chats: observableValue<readonly IChat[]>(`chats-${title}`, []),
		mainChat: observableValue<IChat>(`mainChat-${title}`, undefined!),
		capabilities: { supportsMultipleChats: false, supportsRename },
	};
}

suite('Sessions rename', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	suite('action', () => {
		function createActionHarness(title = 'Existing', supportsRename = true) {
			const instantiationService = disposables.add(new TestInstantiationService());
			const quickInputService = new TestQuickInputService();
			const managementService = new TestSessionsManagementService();
			const session = createSession(title, supportsRename);
			instantiationService.stub(IQuickInputService, quickInputService);
			instantiationService.stub(ISessionsManagementService, managementService);
			const handler = CommandsRegistry.getCommand(RENAME_SESSION_COMMAND_ID)?.handler;
			assert.ok(handler);
			return { handler, instantiationService, quickInputService, managementService, session };
		}

		test('direct invocation is capability-gated', async () => {
			const harness = createActionHarness('Existing', false);

			await harness.handler(harness.instantiationService, harness.session);

			assert.deepStrictEqual({ inputCalls: harness.quickInputService.calls, renamed: harness.managementService.renamed }, { inputCalls: 0, renamed: [] });
		});

		test('validates input and ignores cancellation, whitespace, and unchanged titles', async () => {
			const cancelled = createActionHarness();
			cancelled.quickInputService.result = undefined;
			await cancelled.handler(cancelled.instantiationService, cancelled.session);

			const whitespace = createActionHarness();
			whitespace.quickInputService.result = '   ';
			await whitespace.handler(whitespace.instantiationService, whitespace.session);
			const validationMessage = await whitespace.quickInputService.options?.validateInput?.('   ');

			const unchanged = createActionHarness();
			unchanged.quickInputService.result = ' Existing ';
			await unchanged.handler(unchanged.instantiationService, unchanged.session);

			assert.deepStrictEqual({
				cancelled: cancelled.managementService.renamed,
				whitespace: whitespace.managementService.renamed,
				validationMessage,
				unchanged: unchanged.managementService.renamed,
			}, {
				cancelled: [],
				whitespace: [],
				validationMessage: 'Title cannot be empty',
				unchanged: [],
			});
		});

		test('trims changed titles and propagates provider errors', async () => {
			const success = createActionHarness();
			success.quickInputService.result = ' New title ';
			await success.handler(success.instantiationService, success.session);

			const failure = createActionHarness();
			failure.quickInputService.result = 'Fails';
			failure.managementService.renameError = new Error('rename failed');

			await assert.rejects(async () => {
				await failure.handler(failure.instantiationService, failure.session);
			}, failure.managementService.renameError);
			assert.deepStrictEqual({
				success: success.managementService.renamed,
				failure: failure.managementService.renamed,
			}, {
				success: [{ session: success.session, title: 'New title' }],
				failure: [{ session: failure.session, title: 'Fails' }],
			});
		});
	});

	suite('accessibility help', () => {
		function createHelpProvider(origin: HTMLElement, removeOrigin = false) {
			const instantiationService = disposables.add(new TestInstantiationService());
			let fallbackFocusCount = 0;
			const fallbackView = new class extends mock<SessionView>() {
				override focus(): void { fallbackFocusCount++; }
			};
			const activeSession = new class extends mock<IActiveSession>() {
				override readonly sessionId = 'active';
			};
			instantiationService.stub(ISessionsPartService, new class extends mock<ISessionsPartService>() {
				override getSessionView() { return fallbackView; }
			});
			instantiationService.stub(ISessionsService, new class extends mock<ISessionsService>() {
				override readonly activeSession = constObservable<IActiveSession | undefined>(activeSession);
			});

			mainWindow.document.body.appendChild(origin);
			disposables.add({ dispose: () => origin.remove() });
			origin.focus();
			const provider = disposables.add(new SessionsChatAccessibilityHelp().getProvider(instantiationService));
			if (removeOrigin) {
				origin.remove();
			}
			return { provider, fallbackFocusCount: () => fallbackFocusCount };
		}

		test('documents pointer and keyboard rename paths and restores originating focus', () => {
			const origin = mainWindow.document.createElement('button');
			const { provider, fallbackFocusCount } = createHelpProvider(origin);

			const content = provider.provideContent();
			provider.onClose();

			assert.deepStrictEqual({
				hasDoubleClick: content.includes('double-click its title'),
				hasContextMenu: content.includes('open its context menu'),
				activeElement: mainWindow.document.activeElement,
				fallbackFocusCount: fallbackFocusCount(),
			}, {
				hasDoubleClick: true,
				hasContextMenu: true,
				activeElement: origin,
				fallbackFocusCount: 0,
			});
		});

		test('falls back to the active session when the originating element is gone', () => {
			const origin = mainWindow.document.createElement('button');
			const { provider, fallbackFocusCount } = createHelpProvider(origin, true);

			provider.onClose();

			assert.strictEqual(fallbackFocusCount(), 1);
		});
	});
});
