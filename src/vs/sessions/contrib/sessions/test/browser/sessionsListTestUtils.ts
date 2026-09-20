/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { mainWindow } from '../../../../../base/browser/window.js';
import { Codicon } from '../../../../../base/common/codicons.js';
import { Event } from '../../../../../base/common/event.js';
import { ThemeIcon } from '../../../../../base/common/themables.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { IObservable, ISettableObservable, constObservable, observableValue } from '../../../../../base/common/observable.js';
import { URI } from '../../../../../base/common/uri.js';
import { mock } from '../../../../../base/test/common/mock.js';
import { IAccessibilityService } from '../../../../../platform/accessibility/common/accessibility.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { TestInstantiationService } from '../../../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { IWorkbenchAssignmentService } from '../../../../../workbench/services/assignment/common/assignmentService.js';
import { IAgentSessionsService } from '../../../../../workbench/contrib/chat/browser/agentSessions/agentSessionsService.js';
import { workbenchInstantiationService } from '../../../../../workbench/test/browser/workbenchTestServices.js';
import { ISessionGroupsService } from '../../../../services/sessions/browser/sessionGroupsService.js';
import { ISessionSectionOrderService } from '../../../../services/sessions/browser/sessionSectionOrderService.js';
import { ISessionsListModelService } from '../../../../services/sessions/browser/sessionsListModelService.js';
import { ISessionsProvidersService } from '../../../../services/sessions/browser/sessionsProvidersService.js';
import { IChatService } from '../../../../../workbench/contrib/chat/common/chatService/chatService.js';
import { IChatModel } from '../../../../../workbench/contrib/chat/common/model/chatModel.js';
import { ISessionsService } from '../../../../services/sessions/browser/sessionsService.js';
import { IChat, ISession, SessionStatus } from '../../../../services/sessions/common/session.js';
import { IActiveSession, ISessionsManagementService } from '../../../../services/sessions/common/sessionsManagement.js';

export class TestCommandService extends mock<ICommandService>() {
	readonly executed: { readonly id: string; readonly args: unknown[] }[] = [];

	override readonly onWillExecuteCommand = Event.None;
	override readonly onDidExecuteCommand = Event.None;

	override async executeCommand<T>(id: string, ...args: unknown[]): Promise<T | undefined> {
		this.executed.push({ id, args });
		return undefined;
	}
}

export class TestSessionsManagementService extends mock<ISessionsManagementService>() {
	readonly renamed: { readonly session: ISession; readonly title: string }[] = [];
	renameError: Error | undefined;
	sessions: ISession[] = [];

	override readonly onDidChangeSessions = Event.None;

	override getSessions(): ISession[] {
		return this.sessions;
	}

	override async renameSession(session: ISession, title: string): Promise<void> {
		this.renamed.push({ session, title });
		if (this.renameError) {
			throw this.renameError;
		}
	}
}

export interface ITestSessionOptions {
	readonly supportsRename?: boolean;
	readonly createdAt?: Date;
	readonly isArchived?: boolean;
}

export interface ITestSession {
	readonly session: ISession;
	readonly title: ISettableObservable<string>;
}

/**
 * Builds a session whose observables are settable, so a test can drive the same
 * reactive paths the renderer subscribes to.
 */
export function createTestSession(title: string, options: ITestSessionOptions = {}): ITestSession {
	const createdAt = options.createdAt ?? new Date();
	const titleObservable = observableValue<string>(`title-${title}`, title);
	const mainChat = new class extends mock<IChat>() {
		override readonly resource = URI.parse(`test-chat://${title}`);
		override readonly title: IObservable<string> = titleObservable;
	}();
	const session: ISession = {
		sessionId: title,
		resource: URI.parse(`test-session://${title}`),
		providerId: 'test',
		sessionType: 'test',
		icon: Codicon.account,
		createdAt,
		workspace: observableValue(`workspace-${title}`, undefined),
		title: titleObservable,
		updatedAt: observableValue(`updatedAt-${title}`, createdAt),
		status: observableValue(`status-${title}`, SessionStatus.Completed),
		changesets: observableValue(`changesets-${title}`, []),
		changes: observableValue(`changes-${title}`, []),
		modelId: observableValue(`modelId-${title}`, undefined),
		mode: observableValue(`mode-${title}`, undefined),
		loading: observableValue(`loading-${title}`, false),
		isArchived: observableValue(`isArchived-${title}`, options.isArchived ?? false),
		isRead: observableValue(`isRead-${title}`, true),
		description: observableValue(`description-${title}`, undefined),
		lastTurnEnd: observableValue(`lastTurnEnd-${title}`, undefined),
		chats: observableValue<readonly IChat[]>(`chats-${title}`, [mainChat]),
		mainChat: observableValue<IChat>(`mainChat-${title}`, mainChat),
		capabilities: { supportsMultipleChats: false, supportsRename: options.supportsRename ?? true },
	};
	return { session, title: titleObservable };
}

export interface IListHarness {
	readonly store: DisposableStore;
	readonly instantiationService: TestInstantiationService;
	readonly managementService: TestSessionsManagementService;
	readonly commandService: TestCommandService;
	readonly activeSession: ISettableObservable<IActiveSession | undefined>;
	createContainer(): HTMLElement;
}

/**
 * Stubs every service the sessions list reaches for, so a test can instantiate a
 * real list against real DOM. Only the services the list actually calls are
 * given behaviour; the rest are left as bare mocks on purpose, so a future
 * dependency fails loudly instead of silently returning `undefined`.
 */
export function createListHarness(disposables: Pick<DisposableStore, 'add'>, sessions: ISession[]): IListHarness {
	const store = disposables.add(new DisposableStore());
	const instantiationService = workbenchInstantiationService(undefined, store);
	const managementService = new TestSessionsManagementService();
	managementService.sessions = sessions;
	const commandService = new TestCommandService();
	const activeSession = observableValue<IActiveSession | undefined>('activeSession', undefined);
	const pinned = new Set<string>();
	const read = new Set<string>();

	instantiationService.stub(ISessionsManagementService, managementService as unknown as ISessionsManagementService);
	instantiationService.stub(ICommandService, commandService);
	instantiationService.stub(IAccessibilityService, new class extends mock<IAccessibilityService>() {
		override readonly onDidChangeScreenReaderOptimized = Event.None;
		override readonly onDidChangeReducedMotion = Event.None;
		override isScreenReaderOptimized(): boolean { return false; }
	}());
	instantiationService.stub(ISessionsService, new class extends mock<ISessionsService>() {
		override readonly activeSession = activeSession;
		override readonly visibleSessions = constObservable<readonly (IActiveSession | undefined)[]>([]);
		override async openSession(): Promise<void> { }
		override async openChat(): Promise<void> { }
	}());
	instantiationService.stub(ISessionsListModelService, new class extends mock<ISessionsListModelService>() {
		override readonly onDidChange = Event.None;
		override isSessionPinned(session: ISession): boolean { return pinned.has(session.sessionId); }
		override isSessionRead(session: ISession): boolean { return read.has(session.sessionId); }
		override getStatusIcon(): ThemeIcon { return Codicon.circle; }
		override getSortKey(session: ISession): number { return session.createdAt.getTime(); }
		override getNaturalSortKey(session: ISession): number { return session.createdAt.getTime(); }
		override markRead(session: ISession): void { read.add(session.sessionId); }
		override markUnread(session: ISession): void { read.delete(session.sessionId); }
		override pinSession(session: ISession): void { pinned.add(session.sessionId); }
		override unpinSession(session: ISession): void { pinned.delete(session.sessionId); }
		override applySortChanges(): void { }
	}() as unknown as ISessionsListModelService);
	instantiationService.stub(ISessionGroupsService, new class extends mock<ISessionGroupsService>() {
		override readonly onDidChange = Event.None;
		override getGroups() { return []; }
		override getGroup() { return undefined; }
		override getGroupOfSession() { return undefined; }
		override getSessionIdsInGroup() { return []; }
	}());
	instantiationService.stub(ISessionSectionOrderService, new class extends mock<ISessionSectionOrderService>() {
		override readonly onDidChange = Event.None;
		override resolveOrder(defaultOrderedIds: readonly string[]): string[] { return [...defaultOrderedIds]; }
		override isPromoted(): boolean { return false; }
		override retain(): void { }
	}());
	instantiationService.stub(IWorkbenchAssignmentService, new class extends mock<IWorkbenchAssignmentService>() {
		override readonly onDidRefetchAssignments = Event.None;
		override async getTreatment<T extends string | number | boolean>(): Promise<T | undefined> { return undefined; }
	}());
	// The approval model reads the chat service's models observable.
	instantiationService.stub(IChatService, new class extends mock<IChatService>() {
		override readonly chatModels = constObservable<readonly IChatModel[]>([]);
	}() as unknown as IChatService);
	instantiationService.stub(ISessionsProvidersService, new class extends mock<ISessionsProvidersService>() {
		override getProvider() { return undefined; }
	}());
	instantiationService.stub(IAgentSessionsService, new class extends mock<IAgentSessionsService>() {
		override readonly model = { observeSession: () => { } } as unknown as IAgentSessionsService['model'];
	}() as unknown as IAgentSessionsService);

	return {
		store,
		instantiationService,
		managementService,
		commandService,
		activeSession,
		createContainer(): HTMLElement {
			const container = mainWindow.document.createElement('div');
			container.style.width = '400px';
			container.style.height = '300px';
			mainWindow.document.body.appendChild(container);
			store.add({ dispose: () => container.remove() });
			return container;
		},
	};
}
