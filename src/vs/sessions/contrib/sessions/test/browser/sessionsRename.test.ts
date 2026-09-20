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
import { IViewsService } from '../../../../../workbench/services/views/common/viewsService.js';
import { SessionsChatAccessibilityHelp } from '../../../chat/browser/sessionsChatAccessibilityHelp.js';
import { ISessionsList, RENAME_SESSION_COMMAND_ID, SessionsGrouping, SessionsList, SessionsSorting, shouldMarkReadOnOpen } from '../../browser/views/sessionsList.js';
import { SessionsViewId } from '../../browser/views/sessionsView.js';
import { createListHarness, createTestSession } from './sessionsListTestUtils.js';
import '../../browser/views/sessionsViewActions.js';

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


	suite('inline rename in the list', () => {

		function createList(sessions: ReturnType<typeof createTestSession>[]) {
			const harness = createListHarness(disposables, sessions.map(s => s.session));
			const container = harness.createContainer();
			const opened: { readonly resource: URI; readonly preserveFocus: boolean }[] = [];
			const list = harness.store.add(harness.instantiationService.createInstance(SessionsList, container, {
				grouping: () => SessionsGrouping.Date,
				sorting: () => SessionsSorting.Created,
				onSessionOpen: (resource, preserveFocus) => { opened.push({ resource, preserveFocus }); },
			}));
			list.layout(300, 400);
			return { harness, container, list, opened };
		}

		function renameInput(container: HTMLElement): HTMLInputElement | null {
			return container.querySelector<HTMLInputElement>('.session-title-input input');
		}

		function press(input: HTMLInputElement, key: 'Enter' | 'Escape'): void {
			input.dispatchEvent(new KeyboardEvent('keydown', {
				key,
				keyCode: key === 'Enter' ? 13 : 27,
				bubbles: true,
				cancelable: true,
			}));
		}

		test('a double-click on the title row opens the editor and Enter commits the trimmed title', () => {
			const first = createTestSession('First');
			const { harness, container, list } = createList([first]);

			const titleRow = container.querySelector<HTMLElement>('.session-item .session-title-row');
			assert.ok(titleRow);
			titleRow.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, button: 0, detail: 2 }));

			const input = renameInput(container);
			assert.ok(input);
			const opened = {
				initialValue: input.value,
				focused: mainWindow.document.activeElement === input,
				rowRenaming: !!container.querySelector('.session-item.renaming'),
			};

			input.value = '  Renamed  ';
			input.dispatchEvent(new Event('input', { bubbles: true }));
			press(input, 'Enter');

			assert.deepStrictEqual({
				opened,
				renamed: harness.managementService.renamed.map(r => ({ id: r.session.sessionId, title: r.title })),
				stillRenaming: !!container.querySelector('.session-item.renaming'),
			}, {
				opened: { initialValue: 'First', focused: true, rowRenaming: true },
				renamed: [{ id: 'First', title: 'Renamed' }],
				stillRenaming: false,
			});
			assert.ok(list);
		});

		test('Escape cancels without renaming and an unchanged title commits nothing', () => {
			const first = createTestSession('First');
			const { harness, container, list } = createList([first]);

			assert.strictEqual(list.beginRenameSession(first.session), true);
			const cancelled = renameInput(container);
			assert.ok(cancelled);
			cancelled.value = 'Discarded';
			cancelled.dispatchEvent(new Event('input', { bubbles: true }));
			press(cancelled, 'Escape');
			const afterEscape = { renamed: [...harness.managementService.renamed], renaming: !!container.querySelector('.session-item.renaming') };

			assert.strictEqual(list.beginRenameSession(first.session), true);
			const unchanged = renameInput(container);
			assert.ok(unchanged);
			unchanged.value = '  First  ';
			unchanged.dispatchEvent(new Event('input', { bubbles: true }));
			press(unchanged, 'Enter');

			assert.deepStrictEqual({
				afterEscape: { renamedCount: afterEscape.renamed.length, renaming: afterEscape.renaming },
				afterUnchanged: harness.managementService.renamed,
			}, {
				afterEscape: { renamedCount: 0, renaming: false },
				afterUnchanged: [],
			});
		});

		test('Enter on a blank title keeps the editor open and renames nothing', () => {
			const first = createTestSession('First');
			const { harness, container, list } = createList([first]);

			assert.strictEqual(list.beginRenameSession(first.session), true);
			const input = renameInput(container);
			assert.ok(input);
			input.value = '   ';
			input.dispatchEvent(new Event('input', { bubbles: true }));
			press(input, 'Enter');

			assert.deepStrictEqual({
				stillOpen: !!renameInput(container),
				stillRenaming: !!container.querySelector('.session-item.renaming'),
				renamed: harness.managementService.renamed,
			}, {
				stillOpen: true,
				stillRenaming: true,
				renamed: [],
			});
		});

		test('a session that cannot be renamed never opens the editor', () => {
			const locked = createTestSession('Locked', { supportsRename: false });
			const { container, list } = createList([locked]);

			const titleRow = container.querySelector<HTMLElement>('.session-item .session-title-row');
			assert.ok(titleRow);
			titleRow.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, button: 0, detail: 2 }));

			assert.deepStrictEqual({
				fromDoubleClick: !!renameInput(container),
				fromApi: list.beginRenameSession(locked.session),
			}, {
				fromDoubleClick: false,
				fromApi: false,
			});
		});

		test('the rename draft survives a re-render of the row', () => {
			const first = createTestSession('First');
			const { container, list } = createList([first]);

			assert.strictEqual(list.beginRenameSession(first.session), true);
			const input = renameInput(container);
			assert.ok(input);
			input.value = 'Half typed';
			input.dispatchEvent(new Event('input', { bubbles: true }));

			list.refresh();

			const reRendered = renameInput(container);
			assert.deepStrictEqual({
				open: !!reRendered,
				value: reRendered?.value,
			}, {
				open: true,
				value: 'Half typed',
			});
		});
	});

	suite('mark read on open', () => {

		test('opening marks read unless the session is already the active one', () => {
			const { session } = createTestSession('First');
			const other = createTestSession('Second').session;

			assert.deepStrictEqual({
				noActiveSession: shouldMarkReadOnOpen(session, undefined),
				differentActiveSession: shouldMarkReadOnOpen(session, other as unknown as IActiveSession),
				sameActiveSession: shouldMarkReadOnOpen(session, session as unknown as IActiveSession),
			}, {
				noActiveSession: true,
				differentActiveSession: true,
				sameActiveSession: false,
			});
		});
	});

	suite('command routing', () => {

		function createRoutingHarness(focused: readonly ISession[] | undefined, beginRenameResult = true) {
			const instantiationService = disposables.add(new TestInstantiationService());
			const quickInputService = new TestQuickInputService();
			const managementService = new TestSessionsManagementService();
			const session = createSession('Existing', true);
			const beginRenameCalls: ISession[] = [];
			instantiationService.stub(IQuickInputService, quickInputService);
			instantiationService.stub(ISessionsManagementService, managementService);
			instantiationService.stub(ISessionsService, new class extends mock<ISessionsService>() {
				override readonly activeSession = constObservable<IActiveSession | undefined>(undefined);
			}());
			const sessionsControl = new class extends mock<ISessionsList>() {
				override getFocusedSessions(): readonly ISession[] | undefined { return focused; }
				override beginRenameSession(target: ISession): boolean {
					beginRenameCalls.push(target);
					return beginRenameResult;
				}
			}();
			instantiationService.stub(IViewsService, new class extends mock<IViewsService>() {
				override getViewWithId<T>(id: string): T | null {
					return id === SessionsViewId ? ({ sessionsControl } as unknown as T) : null;
				}
			}() as unknown as IViewsService);
			const handler = CommandsRegistry.getCommand(RENAME_SESSION_COMMAND_ID)?.handler;
			assert.ok(handler);
			return { handler, instantiationService, quickInputService, managementService, session, beginRenameCalls };
		}

		test('a row the list has focused renames in place, and every other caller gets the prompt', async () => {
			// The command resolves its own target from the list, so the session the
			// stub reports as focused is the one it should edit in place.
			const fromList = createRoutingHarness([createSession('Existing', true)]);
			await fromList.handler(fromList.instantiationService);

			const withExplicitArgument = createRoutingHarness([createSession('Existing', true)]);
			withExplicitArgument.quickInputService.result = undefined;
			await withExplicitArgument.handler(withExplicitArgument.instantiationService, withExplicitArgument.session);

			const listNotFocused = createRoutingHarness(undefined);
			listNotFocused.quickInputService.result = undefined;
			await listNotFocused.handler(listNotFocused.instantiationService);

			assert.deepStrictEqual({
				fromList: { inlineCalls: fromList.beginRenameCalls.length, promptCalls: fromList.quickInputService.calls },
				withExplicitArgument: { inlineCalls: withExplicitArgument.beginRenameCalls.length, promptCalls: withExplicitArgument.quickInputService.calls },
				listNotFocused: { inlineCalls: listNotFocused.beginRenameCalls.length, promptCalls: listNotFocused.quickInputService.calls },
			}, {
				fromList: { inlineCalls: 1, promptCalls: 0 },
				withExplicitArgument: { inlineCalls: 0, promptCalls: 1 },
				listNotFocused: { inlineCalls: 0, promptCalls: 0 },
			});
		});

		test('the prompt is used when the list declines to open an inline editor', async () => {
			const harness = createRoutingHarness([createSession('Existing', true)], false);
			harness.quickInputService.result = 'From prompt';

			await harness.handler(harness.instantiationService);

			assert.deepStrictEqual({
				inlineCalls: harness.beginRenameCalls.length,
				promptCalls: harness.quickInputService.calls,
				renamed: harness.managementService.renamed.map(r => r.title),
			}, {
				inlineCalls: 1,
				promptCalls: 1,
				renamed: ['From prompt'],
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
