/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { raceCancellationError, raceTimeout } from '../../../../../base/common/async.js';
import { CancellationToken, CancellationTokenSource } from '../../../../../base/common/cancellation.js';
import { Codicon } from '../../../../../base/common/codicons.js';
import { CancellationError } from '../../../../../base/common/errors.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { IMarkdownString, MarkdownString, markdownStringEqual } from '../../../../../base/common/htmlContent.js';
import { Disposable, DisposableMap, DisposableStore, IDisposable } from '../../../../../base/common/lifecycle.js';
import { Schemas } from '../../../../../base/common/network.js';
import { constObservable, IObservable, ISettableObservable, ITransaction, observableValue, observableValueOpts, transaction } from '../../../../../base/common/observable.js';
import { structuralEquals } from '../../../../../base/common/equals.js';
import { basename, dirname } from '../../../../../base/common/resources.js';
import { ThemeIcon } from '../../../../../base/common/themables.js';
import { URI } from '../../../../../base/common/uri.js';
import { generateUuid } from '../../../../../base/common/uuid.js';
import { localize } from '../../../../../nls.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { ILabelService } from '../../../../../platform/label/common/label.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { IUriIdentityService } from '../../../../../platform/uriIdentity/common/uriIdentity.js';
import { IAgentSession } from '../../../../../workbench/contrib/chat/browser/agentSessions/agentSessionsModel.js';
import { IAgentSessionsService } from '../../../../../workbench/contrib/chat/browser/agentSessions/agentSessionsService.js';
import { getRepositoryName } from '../../../../../workbench/contrib/chat/browser/agentSessions/agentSessionsViewer.js';
import { IChatService, IChatSendRequestOptions } from '../../../../../workbench/contrib/chat/common/chatService/chatService.js';
import { ChatSessionStatus, IChatSessionProviderOptionItem, IChatSessionsService } from '../../../../../workbench/contrib/chat/common/chatSessionsService.js';
import { ChatAgentLocation, ChatModeKind, ChatPermissionLevel } from '../../../../../workbench/contrib/chat/common/constants.js';
import { ILanguageModelsService } from '../../../../../workbench/contrib/chat/common/languageModels.js';
import { getRegisteredLanguageModels, resolveModelIdentifier, resolveModelIdentifierFromLanguageModels } from '../../../../../workbench/contrib/chat/common/modelSelection.js';
import { ChatInteractivity, ChatModelSource, IChat, IChatCheckpoints, ISession, ISessionChangesSummary, ISessionFileChange, ISessionFolder, ISessionGitRepository, ISessionType, ISessionWorkspace, ISessionWorkspaceBrowseAction, ISideChatSelection, SESSION_WORKSPACE_GROUP_LOCAL, SessionStatus, SessionTypeAuthRequirement, sessionFileChangesEqual, sessionWorkspaceEqual, toSessionId } from '../../../../services/sessions/common/session.js';
import { IDeleteChatOptions, ISendRequestOptions, ISessionChangeEvent, ISessionModelPickerOptions, ISessionModelsSnapshot, ISessionsProvider, ISessionsProviderCreateSessionOptions } from '../../../../services/sessions/common/sessionsProvider.js';
import { createLocalChangesets } from './localChangesets.js';

/**
 * FlowLeap: the chat session type contributed by the extension-host Claude
 * implementation in `extensions/copilot` (`chatSessions/claude`). Upstream
 * removed this implementation in favour of the agent host, which this product
 * does not run (PRD 0004, PRD 0017).
 */
export const CLAUDE_CODE_SESSION_TYPE_ID = 'claude-code';

/** Claude session type: a local agent powered by Claude, served by the extension host. */
export const ClaudeCodeSessionType: ISessionType = {
	id: CLAUDE_CODE_SESSION_TYPE_ID,
	label: localize('claudeCode', "Claude"),
	icon: Codicon.claude,
	// Claude runs on the user's own Claude credentials, not on a GitHub account.
	authRequirement: SessionTypeAuthRequirement.None,
};

/**
 * Provider ID for the Claude sessions provider. It is the ID the fork's Copilot
 * Chat sessions provider used for Claude sessions, so that stored per-session
 * state (pins, groups, sort overrides) that is keyed by session ID survives.
 * The upstream Copilot Chat sessions provider (same ID) is not registered.
 */
export const CLAUDE_PROVIDER_ID = 'default-copilot';

/** Chat session option through which the Claude extension reads the permission mode. */
export const CLAUDE_PERMISSION_MODE_OPTION_ID = 'permissionMode';

/**
 * The session facade the provider keeps per Claude chat: either a new session
 * that has not been sent yet, or an adapter over a committed {@link IAgentSession}.
 */
export interface IClaudeChatSession {
	readonly sessionId: string;
	readonly resource: URI;
	readonly providerId: string;
	readonly sessionType: string;
	readonly icon: ThemeIcon;
	readonly createdAt: Date;
	readonly workspace: IObservable<ISessionWorkspace | undefined>;
	readonly title: IObservable<string>;
	readonly updatedAt: IObservable<Date>;
	readonly status: IObservable<SessionStatus>;
	readonly changes: IObservable<readonly ISessionFileChange[]>;
	readonly changesSummary: IObservable<ISessionChangesSummary | undefined>;
	readonly checkpoints: IObservable<IChatCheckpoints | undefined>;
	readonly modelId: IObservable<string | undefined>;
	readonly modelSource: IObservable<ChatModelSource | undefined>;
	readonly mode: IObservable<{ readonly id: string; readonly kind: string } | undefined>;
	readonly loading: IObservable<boolean>;
	readonly isArchived: IObservable<boolean>;
	readonly isRead: IObservable<boolean>;
	readonly description: IObservable<IMarkdownString | undefined>;
	readonly lastTurnEnd: IObservable<Date | undefined>;
	readonly mainChat: ISettableObservable<IChat>;
	setModelId(modelId: string | undefined, source: ChatModelSource): void;
	/** Sets a chat session option (for example the Claude permission mode). */
	setOption(optionId: string, value: IChatSessionProviderOptionItem | string): void;
}

function buildChat(chat: Omit<IClaudeChatSession, 'mainChat' | 'setModelId' | 'setOption'>, resource: URI): IChat {
	return {
		resource,
		createdAt: chat.createdAt,
		workspace: chat.workspace,
		title: chat.title,
		updatedAt: chat.updatedAt,
		status: chat.status,
		changes: chat.changes,
		checkpoints: chat.checkpoints,
		modelId: chat.modelId,
		modelSource: chat.modelSource,
		mode: chat.mode,
		isArchived: chat.isArchived,
		isRead: chat.isRead,
		interactivity: constObservable(ChatInteractivity.Full),
		description: chat.description,
		lastTurnEnd: chat.lastTurnEnd,
		changesets: constObservable(undefined),
	};
}

function setIfChanged<T>(observable: ISettableObservable<T>, value: T, tx: ITransaction, equals: (a: T, b: T) => boolean = Object.is): boolean {
	if (equals(observable.get(), value)) {
		return false;
	}
	observable.set(value, tx, undefined);
	return true;
}

function dateEquals(a: Date | undefined, b: Date | undefined): boolean {
	return a?.getTime() === b?.getTime();
}

function markdownStringEquals(a: IMarkdownString | undefined, b: IMarkdownString | undefined): boolean {
	return a === b || !!a && !!b && markdownStringEqual(a, b);
}

function isChangesSummary(changes: IAgentSession['changes']): changes is { readonly files: number; readonly insertions: number; readonly deletions: number } {
	return !!changes && !Array.isArray(changes);
}

function toSessionStatus(status: ChatSessionStatus): SessionStatus {
	switch (status) {
		case ChatSessionStatus.InProgress:
			return SessionStatus.InProgress;
		case ChatSessionStatus.NeedsInput:
			return SessionStatus.NeedsInput;
		case ChatSessionStatus.Completed:
			return SessionStatus.Completed;
		case ChatSessionStatus.Failed:
			return SessionStatus.Error;
	}
}

/**
 * A Claude session that the user is composing and has not sent yet.
 * The Claude agent manages its own worktrees and branches at runtime, so the
 * new session carries no isolation or branch state.
 */
class ClaudeCodeNewSession extends Disposable implements IClaudeChatSession {

	readonly sessionId: string;
	readonly providerId: string;
	readonly sessionType = CLAUDE_CODE_SESSION_TYPE_ID;
	readonly icon = ClaudeCodeSessionType.icon;
	readonly createdAt = new Date();

	private readonly _title = observableValue(this, '');
	readonly title: IObservable<string> = this._title;
	readonly updatedAt: IObservable<Date> = observableValue(this, new Date());
	private readonly _status = observableValue(this, SessionStatus.Untitled);
	readonly status: IObservable<SessionStatus> = this._status;
	readonly workspace: IObservable<ISessionWorkspace | undefined>;
	readonly changes: IObservable<readonly ISessionFileChange[]> = observableValueOpts<readonly ISessionFileChange[]>({ owner: this, equalsFn: sessionFileChangesEqual }, []);
	readonly changesSummary: IObservable<ISessionChangesSummary | undefined> = constObservable(undefined);
	readonly checkpoints: IObservable<IChatCheckpoints | undefined> = constObservable(undefined);
	private readonly _modelId = observableValue<string | undefined>(this, undefined);
	readonly modelId: IObservable<string | undefined> = this._modelId;
	private readonly _modelSource = observableValue<ChatModelSource | undefined>(this, undefined);
	readonly modelSource: IObservable<ChatModelSource | undefined> = this._modelSource;
	readonly mode: IObservable<{ readonly id: string; readonly kind: string } | undefined> = constObservable(undefined);
	readonly loading: IObservable<boolean> = constObservable(false);
	private readonly _isArchived = observableValue(this, false);
	readonly isArchived: IObservable<boolean> = this._isArchived;
	readonly isRead: IObservable<boolean> = constObservable(true);
	readonly description: IObservable<IMarkdownString | undefined> = constObservable(undefined);
	readonly lastTurnEnd: IObservable<Date | undefined> = constObservable(undefined);
	readonly mainChat: ISettableObservable<IChat>;

	readonly selectedOptions = new Map<string, IChatSessionProviderOptionItem>();

	get selectedModelId(): string | undefined { return this._modelId.get(); }

	constructor(
		readonly resource: URI,
		sessionWorkspace: ISessionWorkspace,
		providerId: string,
	) {
		super();
		this.sessionId = toSessionId(providerId, resource);
		this.providerId = providerId;
		this.workspace = constObservable(sessionWorkspace);
		this.mainChat = observableValue<IChat>(this, buildChat(this, resource));
	}

	setOption(optionId: string, value: IChatSessionProviderOptionItem | string): void {
		this.selectedOptions.set(optionId, typeof value === 'string' ? { id: value, name: value } : value);
	}

	setModelId(modelId: string | undefined, source: ChatModelSource): void {
		transaction(tx => {
			this._modelSource.set(modelId ? source : undefined, tx);
			this._modelId.set(modelId, tx);
		});
	}

	setTitle(title: string): void {
		this._title.set(title, undefined);
	}

	setStatus(status: SessionStatus): void {
		this._status.set(status, undefined);
	}

	setArchived(archived: boolean): void {
		this._isArchived.set(archived, undefined);
	}
}

/**
 * Adapts a committed Claude {@link IAgentSession} from the chat layer into the
 * {@link IClaudeChatSession} facade. The workspace comes from the repository and
 * worktree paths the extension puts in the session metadata.
 */
class ClaudeAgentSessionAdapter implements IClaudeChatSession {

	readonly sessionId: string;
	readonly resource: URI;
	readonly providerId: string;
	readonly sessionType: string;
	readonly icon = ClaudeCodeSessionType.icon;
	readonly createdAt: Date;

	private readonly _workspace: ISettableObservable<ISessionWorkspace | undefined>;
	readonly workspace: IObservable<ISessionWorkspace | undefined>;
	private readonly _title: ISettableObservable<string>;
	readonly title: IObservable<string>;
	private readonly _updatedAt: ISettableObservable<Date>;
	readonly updatedAt: IObservable<Date>;
	private readonly _status: ISettableObservable<SessionStatus>;
	readonly status: IObservable<SessionStatus>;
	private readonly _changes: ISettableObservable<readonly ISessionFileChange[]>;
	readonly changes: IObservable<readonly ISessionFileChange[]>;
	private readonly _changesSummary: ISettableObservable<ISessionChangesSummary | undefined>;
	readonly changesSummary: IObservable<ISessionChangesSummary | undefined>;
	private readonly _checkpoints: ISettableObservable<IChatCheckpoints | undefined>;
	readonly checkpoints: IObservable<IChatCheckpoints | undefined>;
	private readonly _modelId = observableValue<string | undefined>('claudeSessionModelId', undefined);
	readonly modelId: IObservable<string | undefined> = this._modelId;
	private readonly _modelSource = observableValue<ChatModelSource | undefined>('claudeSessionModelSource', undefined);
	readonly modelSource: IObservable<ChatModelSource | undefined> = this._modelSource;
	readonly mode: IObservable<{ readonly id: string; readonly kind: string } | undefined> = constObservable(undefined);
	readonly loading: IObservable<boolean> = constObservable(false);
	private readonly _isArchived: ISettableObservable<boolean>;
	readonly isArchived: IObservable<boolean>;
	private readonly _isRead: ISettableObservable<boolean>;
	readonly isRead: IObservable<boolean>;
	private readonly _description: ISettableObservable<IMarkdownString | undefined>;
	readonly description: IObservable<IMarkdownString | undefined>;
	private readonly _lastTurnEnd: ISettableObservable<Date | undefined>;
	readonly lastTurnEnd: IObservable<Date | undefined>;

	readonly mainChat: ISettableObservable<IChat>;

	constructor(
		session: IAgentSession,
		providerId: string,
		private readonly _chatSessionsService: IChatSessionsService,
	) {
		this.sessionId = toSessionId(providerId, session.resource);
		this.resource = session.resource;
		this.providerId = providerId;
		this.sessionType = session.providerType;
		this.createdAt = new Date(session.timing.created);

		this._workspace = observableValue(this, this._buildWorkspace(session));
		this.workspace = this._workspace;
		this._title = observableValue(this, session.label);
		this.title = this._title;
		this._updatedAt = observableValue(this, new Date(this._updatedTime(session)));
		this.updatedAt = this._updatedAt;
		this._status = observableValue(this, toSessionStatus(session.status));
		this.status = this._status;
		this._changes = observableValueOpts<readonly ISessionFileChange[]>({ owner: this, equalsFn: sessionFileChangesEqual }, this._extractChanges(session));
		this.changes = this._changes;
		this._changesSummary = observableValueOpts<ISessionChangesSummary | undefined>({ owner: this, equalsFn: structuralEquals }, this._extractChangesSummary(session));
		this.changesSummary = this._changesSummary;
		this._checkpoints = observableValueOpts<IChatCheckpoints | undefined>({ owner: this, equalsFn: structuralEquals }, this._extractCheckpoints(session));
		this.checkpoints = this._checkpoints;
		this._isArchived = observableValue(this, session.isArchived());
		this.isArchived = this._isArchived;
		this._isRead = observableValue(this, session.isRead());
		this.isRead = this._isRead;
		this._description = observableValue(this, this._extractDescription(session));
		this.description = this._description;
		this._lastTurnEnd = observableValue(this, session.timing.lastRequestEnded ? new Date(session.timing.lastRequestEnded) : undefined);
		this.lastTurnEnd = this._lastTurnEnd;

		this.mainChat = observableValue<IChat>(this, buildChat(this, this.resource));
	}

	setModelId(modelId: string | undefined, source: ChatModelSource): void {
		transaction(tx => {
			this._modelSource.set(modelId ? source : undefined, tx);
			this._modelId.set(modelId, tx);
		});
	}

	setOption(optionId: string, value: IChatSessionProviderOptionItem | string): void {
		this._chatSessionsService.setSessionOption(this.resource, optionId, value);
	}

	/** Updates the reactive properties from a refreshed agent session. */
	update(session: IAgentSession): boolean {
		let changed = false;
		transaction(tx => {
			changed = setIfChanged(this._title, session.label, tx) || changed;
			changed = setIfChanged(this._workspace, this._buildWorkspace(session), tx, sessionWorkspaceEqual) || changed;
			changed = setIfChanged(this._updatedAt, new Date(this._updatedTime(session)), tx, dateEquals) || changed;
			changed = setIfChanged(this._status, toSessionStatus(session.status), tx) || changed;
			changed = setIfChanged(this._changes, this._extractChanges(session), tx, sessionFileChangesEqual) || changed;
			changed = setIfChanged(this._changesSummary, this._extractChangesSummary(session), tx, structuralEquals) || changed;
			changed = setIfChanged(this._checkpoints, this._extractCheckpoints(session), tx, structuralEquals) || changed;
			changed = setIfChanged(this._isArchived, session.isArchived(), tx) || changed;
			changed = setIfChanged(this._isRead, session.isRead(), tx) || changed;
			changed = setIfChanged(this._description, this._extractDescription(session), tx, markdownStringEquals) || changed;
			changed = setIfChanged(this._lastTurnEnd, session.timing.lastRequestEnded ? new Date(session.timing.lastRequestEnded) : undefined, tx, dateEquals) || changed;
		});
		return changed;
	}

	private _updatedTime(session: IAgentSession): number {
		return session.timing.lastRequestEnded ?? session.timing.lastRequestStarted ?? session.timing.created;
	}

	private _extractDescription(session: IAgentSession): IMarkdownString | undefined {
		if (!session.description) {
			return undefined;
		}
		return typeof session.description === 'string' ? new MarkdownString(session.description) : session.description;
	}

	private _extractChanges(session: IAgentSession): readonly ISessionFileChange[] {
		return session.changes && !isChangesSummary(session.changes) ? session.changes : [];
	}

	private _extractChangesSummary(session: IAgentSession): ISessionChangesSummary | undefined {
		const changes = session.changes;
		if (!isChangesSummary(changes)) {
			return undefined;
		}
		return { files: changes.files, additions: changes.insertions, deletions: changes.deletions };
	}

	private _extractCheckpoints(session: IAgentSession): IChatCheckpoints | undefined {
		const metadata = session.metadata;
		if (typeof metadata?.firstCheckpointRef !== 'string' || typeof metadata?.lastCheckpointRef !== 'string') {
			return undefined;
		}
		return { firstCheckpointRef: metadata.firstCheckpointRef, lastCheckpointRef: metadata.lastCheckpointRef };
	}

	private _buildWorkspace(session: IAgentSession): ISessionWorkspace {
		const metadata = session.metadata;
		const repoUri = typeof metadata?.repositoryPath === 'string' ? URI.file(metadata.repositoryPath) : undefined;
		const worktreeUri = typeof metadata?.worktreePath === 'string' ? URI.file(metadata.worktreePath) : undefined;
		const branchName = typeof metadata?.branchName === 'string' ? metadata.branchName : undefined;
		const repoUriResolved = repoUri ?? URI.parse('unknown:///');

		const gitRepository: ISessionGitRepository = {
			uri: repoUriResolved,
			workTreeUri: worktreeUri,
			branchName,
			baseBranchName: typeof metadata?.baseBranchName === 'string' ? metadata.baseBranchName : undefined,
			baseBranchProtected: typeof metadata?.baseBranchProtected === 'boolean' ? metadata.baseBranchProtected : undefined,
			hasGitHubRemote: typeof metadata?.hasGitHubRemote === 'boolean' ? metadata.hasGitHubRemote : undefined,
			upstreamBranchName: typeof metadata?.upstreamBranchName === 'string' ? metadata.upstreamBranchName : undefined,
			incomingChanges: typeof metadata?.incomingChanges === 'number' ? metadata.incomingChanges : undefined,
			outgoingChanges: typeof metadata?.outgoingChanges === 'number' ? metadata.outgoingChanges : undefined,
			uncommittedChanges: typeof metadata?.uncommittedChanges === 'number' ? metadata.uncommittedChanges : undefined,
			hasGitOperationInProgress: typeof metadata?.hasGitOperationInProgress === 'boolean' ? metadata.hasGitOperationInProgress : undefined,
			gitHubInfo: constObservable(undefined),
		};

		const folder: ISessionFolder = {
			root: repoUriResolved,
			workingDirectory: worktreeUri ?? repoUriResolved,
			name: basename(repoUriResolved),
			description: branchName,
			gitRepository,
		};

		return {
			uri: repoUriResolved,
			label: getRepositoryName(session) ?? basename(repoUriResolved),
			icon: Codicon.folder,
			group: SESSION_WORKSPACE_GROUP_LOCAL,
			folders: [folder],
			requiresWorkspaceTrust: true,
			isVirtualWorkspace: false,
		};
	}
}

/**
 * FlowLeap sessions provider for extension-host Claude sessions
 * (chat session type `claude-code`, served by `extensions/copilot`).
 *
 * New sessions are created through the extension's chat session item provider
 * and sent through {@link IChatService}. Committed sessions are listed from
 * {@link IAgentSessionsService} and resumed through the extension's chat session
 * content provider when the user opens them.
 */
export class ClaudeChatSessionsProvider extends Disposable implements ISessionsProvider {

	readonly id = CLAUDE_PROVIDER_ID;
	readonly label = localize('claudeChatSessionsProvider', "FlowLeap Chat");
	readonly icon = Codicon.robot;
	readonly order = 0;
	readonly sessionTypes: readonly ISessionType[] = [ClaudeCodeSessionType];
	readonly browseActions: readonly ISessionWorkspaceBrowseAction[] = [];
	readonly supportsLocalWorkspaces = true;

	private readonly _onDidChangeSessionTypes = this._register(new Emitter<void>());
	readonly onDidChangeSessionTypes: Event<void> = this._onDidChangeSessionTypes.event;

	private readonly _onDidChangeSessions = this._register(new Emitter<ISessionChangeEvent>());
	readonly onDidChangeSessions: Event<ISessionChangeEvent> = this._onDidChangeSessions.event;

	private readonly _onDidReplaceSession = this._register(new Emitter<{ readonly from: ISession; readonly to: ISession }>());
	readonly onDidReplaceSession: Event<{ readonly from: ISession; readonly to: ISession }> = this._onDidReplaceSession.event;

	/** Committed and in-flight chats, keyed by resource URI string. */
	private readonly _sessionCache = new Map<string, ClaudeAgentSessionAdapter | ClaudeCodeNewSession>();

	/** Committed resources that a first send is still waiting on; protected from removal. */
	private readonly _inFlightCommits = new Set<string>();

	/** {@link ISession} wrappers, keyed by session ID. */
	private readonly _sessionWrapperCache = new Map<string, ISession>();

	private readonly _newSessions = this._register(new DisposableMap<string, ClaudeCodeNewSession>());

	constructor(
		@IAgentSessionsService private readonly agentSessionsService: IAgentSessionsService,
		@IChatService private readonly chatService: IChatService,
		@IChatSessionsService private readonly chatSessionsService: IChatSessionsService,
		@ICommandService private readonly commandService: ICommandService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@ILanguageModelsService private readonly languageModelsService: ILanguageModelsService,
		@ILogService private readonly logService: ILogService,
		@ILabelService private readonly labelService: ILabelService,
		@IUriIdentityService private readonly uriIdentityService: IUriIdentityService,
	) {
		super();

		this._register(this.agentSessionsService.model.onDidChangeSessions(() => this._refreshSessionCache()));
		this._refreshSessionCache();
	}

	// -- Sessions --

	getSessionTypes(workspaceUri: URI): ISessionType[] {
		return workspaceUri.scheme === Schemas.file ? [ClaudeCodeSessionType] : [];
	}

	getSessions(): ISession[] {
		return Array.from(this._sessionCache.values(), chat => this._chatToSession(chat));
	}

	getSession(sessionId: string): IClaudeChatSession | undefined {
		return this._newSessions.get(sessionId) ?? this._findChatSession(sessionId);
	}

	resolveWorkspace(uri: URI): ISessionWorkspace | undefined {
		if (uri.scheme !== Schemas.file) {
			return undefined;
		}
		const folder: ISessionFolder = {
			root: uri,
			workingDirectory: uri,
			name: basename(uri),
			description: undefined,
		};
		return {
			uri,
			label: basename(uri),
			description: this.labelService.getUriLabel(dirname(uri), { relative: false }),
			group: SESSION_WORKSPACE_GROUP_LOCAL,
			icon: Codicon.folder,
			folders: [folder],
			requiresWorkspaceTrust: true,
			isVirtualWorkspace: false,
		};
	}

	createNewSession(workspaceUri: URI, sessionTypeId: string, options?: ISessionsProviderCreateSessionOptions): ISession {
		if (sessionTypeId !== CLAUDE_CODE_SESSION_TYPE_ID) {
			throw new Error(`Unsupported session type '${sessionTypeId}'`);
		}
		const workspace = this.resolveWorkspace(workspaceUri);
		if (!workspace) {
			throw new Error(`Cannot resolve workspace for URI: ${workspaceUri.toString()}`);
		}
		const resource = URI.from({ scheme: CLAUDE_CODE_SESSION_TYPE_ID, path: `/untitled-${generateUuid()}` });
		const session = new ClaudeCodeNewSession(resource, workspace, this.id);
		if (options?.modelId) {
			session.setModelId(options.modelId, ChatModelSource.Chosen);
		}
		this._newSessions.set(session.sessionId, session);
		return this._chatToSession(session);
	}

	createQuickChat(_sessionTypeId: string, _options?: ISessionsProviderCreateSessionOptions): ISession {
		throw new Error('ClaudeChatSessionsProvider does not support quick chats');
	}

	deleteNewSession(sessionId: string): void {
		if (this._newSessions.has(sessionId)) {
			this._newSessions.deleteAndDispose(sessionId);
			this._sessionWrapperCache.delete(sessionId);
		}
	}

	// -- Models --

	get onDidChangeModels(): Event<void> {
		return Event.signal(this.languageModelsService.onDidChangeLanguageModels);
	}

	getModelsSnapshot(sessionId: string, desiredModelId?: string): ISessionModelsSnapshot {
		const sessionType = this.getSession(sessionId)?.sessionType;
		if (!sessionType) {
			return { models: [], desiredModelResolution: resolveModelIdentifier([], desiredModelId, false), modelTarget: undefined };
		}
		// Claude models are registered by the extension against `targetChatSessionType`.
		const allModels = getRegisteredLanguageModels(this.languageModelsService);
		const models = allModels.filter(model => model.metadata.targetChatSessionType === sessionType);
		return {
			models,
			desiredModelResolution: resolveModelIdentifierFromLanguageModels(models, desiredModelId, this.languageModelsService, allModels),
			modelTarget: sessionType,
		};
	}

	getModelPickerOptions(sessionId: string): ISessionModelPickerOptions {
		const sessionType = this.getSession(sessionId)?.sessionType;
		return {
			useGroupedModelPicker: true,
			showFeatured: true,
			showUnavailableFeatured: false,
			showManageModelsAction: false,
			showAutoModel: !sessionType || this.chatSessionsService.supportsAutoModelForSessionType(sessionType),
		};
	}

	setModel(sessionId: string, chatResource: URI, modelId: string, source: ChatModelSource): void {
		const chat = this._newSessions.get(sessionId) ?? this._sessionCache.get(chatResource.toString()) ?? this._findChatSession(sessionId);
		chat?.setModelId(modelId, source);
	}

	// -- Session actions --

	async archiveSession(sessionId: string): Promise<void> {
		await this._setArchived(sessionId, true);
	}

	async unarchiveSession(sessionId: string): Promise<void> {
		await this._setArchived(sessionId, false);
	}

	private async _setArchived(sessionId: string, archived: boolean): Promise<void> {
		const chat = this._findChatSession(sessionId);
		if (chat instanceof ClaudeCodeNewSession) {
			// An uncommitted session has no agent session to carry the state.
			chat.setArchived(archived);
			this._onDidChangeSessions.fire({ added: [], removed: [], changed: [this._chatToSession(chat)] });
			return;
		}
		this._findAgentSession(sessionId)?.setArchived(archived);
	}

	async setSessionReadState(sessionId: string, isRead: boolean): Promise<void> {
		const agentSession = this._findAgentSession(sessionId);
		if (agentSession && agentSession.isRead() !== isRead) {
			agentSession.setRead(isRead);
		}
	}

	async deleteSession(sessionId: string): Promise<void> {
		const agentSession = this._findAgentSession(sessionId);
		if (!agentSession) {
			this._cleanupTempSession(sessionId);
			return;
		}
		await this.chatService.removeHistoryEntry(agentSession.resource);
		this._sessionWrapperCache.delete(sessionId);
		this._refreshSessionCache();
	}

	async deleteSessions(sessionIds: readonly string[]): Promise<void> {
		for (const sessionId of sessionIds) {
			await this.deleteSession(sessionId);
		}
	}

	async renameChat(_sessionId: string, chatUri: URI, title: string): Promise<void> {
		await this.commandService.executeCommand('github.copilot.claude.sessions.rename', { resource: chatUri }, title);
	}

	async renameSession(sessionId: string, title: string): Promise<void> {
		const chat = this._findChatSession(sessionId);
		if (chat) {
			await this.renameChat(sessionId, chat.mainChat.get().resource, title);
		}
	}

	async deleteChat(_sessionId: string, _chatUri: URI, _options?: IDeleteChatOptions): Promise<boolean> {
		throw new Error('Deleting individual chats is not supported for Claude sessions');
	}

	async forkChat(sessionId: string, _sourceChat: URI, _turnId: string): Promise<IChat> {
		throw new Error(`Session '${sessionId}' does not support forking into a chat`);
	}

	async createSideChat(sessionId: string, _sourceChat: URI, _turnId: string, _selection?: ISideChatSelection): Promise<IChat> {
		throw new Error(`Session '${sessionId}' does not support side chats`);
	}

	/**
	 * For a new session, asks the extension to create the Claude chat session
	 * item. Claude assigns the real session resource here, before the first send,
	 * so the main chat is re-pointed at it.
	 */
	async createNewChat(sessionId: string, prompt?: string): Promise<IChat> {
		const session = this._newSessions.get(sessionId);
		if (!session) {
			throw new Error(`[ClaudeChatSessionsProvider] Session '${sessionId}' does not support multiple chats`);
		}
		const newItem = await this.chatSessionsService.createNewChatSessionItem(
			CLAUDE_CODE_SESSION_TYPE_ID,
			{ prompt: prompt ?? '', initialSessionOptions: session.selectedOptions.size > 0 ? session.selectedOptions : undefined, untitledResource: session.resource },
			CancellationToken.None,
		);
		if (!newItem) {
			throw new Error('[ClaudeChatSessionsProvider] Failed to create Claude session item');
		}
		await this.chatSessionsService.getOrCreateChatSession(newItem.resource, CancellationToken.None);
		(await this._updateChatSessionState(newItem.resource, session)).dispose();
		const newChat = this._withChangesets(buildChat(session, newItem.resource), session.workspace);
		session.mainChat.set(newChat, undefined);
		return newChat;
	}

	async sendRequest(sessionId: string, chatResource: URI, options: ISendRequestOptions): Promise<ISession> {
		const newSession = this._newSessions.get(sessionId);
		if (newSession) {
			if (!this.uriIdentityService.extUri.isEqual(newSession.mainChat.get().resource, chatResource)) {
				throw new Error('Chat resource does not match the main chat of the current new session');
			}
			return this._sendFirstChat(newSession, chatResource, options);
		}
		if (!this._findChatSession(sessionId)) {
			throw new Error(`Session '${sessionId}' not found`);
		}
		// Follow-up turns on committed sessions are sent from their chat directly.
		throw new Error('Multiple chats per session is not supported');
	}

	private async _sendFirstChat(session: ClaudeCodeNewSession, chatResource: URI, options: ISendRequestOptions): Promise<ISession> {
		const { query, attachedContext } = options;

		session.setTitle((options.title || query.split('\n')[0]).substring(0, 100) || localize('newSession', "New Session"));
		session.setStatus(SessionStatus.InProgress);
		this._sessionCache.set(session.resource.toString(), session);

		// Claude commits the session resource before the send (see createNewChat),
		// so protect it from removal by a concurrent cache refresh.
		const committedKey = chatResource.toString();
		this._inFlightCommits.add(committedKey);

		const newSession = this._chatToSession(session);
		this._onDidChangeSessions.fire({ added: [newSession], removed: [], changed: [] });

		const contribution = this.chatSessionsService.getChatSessionContribution(CLAUDE_CODE_SESSION_TYPE_ID);
		const sendOptions: IChatSendRequestOptions = {
			location: ChatAgentLocation.Chat,
			userSelectedModelId: session.selectedModelId,
			modeInfo: {
				kind: ChatModeKind.Agent,
				isBuiltin: true,
				modeInstructions: undefined,
				telemetryModeId: ChatModeKind.Agent,
				applyCodeBlockSuggestionId: undefined,
				permissionLevel: ChatPermissionLevel.Default,
			},
			agentIdSilent: contribution?.type,
			attachedContext,
			hideFromTranscript: options.hideFromTranscript,
			onDidCreateResponse: options.onDidCreateResponse,
		};

		const ref = await this._updateChatSessionState(chatResource, session);
		try {
			const result = await this.chatService.sendRequest(chatResource, query, sendOptions);
			if (result.kind === 'rejected') {
				this._removeTempSession(session, newSession);
				throw new Error(`[ClaudeChatSessionsProvider] sendRequest rejected: ${result.reason}`);
			}
			const cts = new CancellationTokenSource();
			const responseCreatedPromise = result.kind === 'sent' ? result.data.responseCreatedPromise : undefined;
			responseCreatedPromise?.then(response => {
				if (response?.isCanceled) {
					cts.cancel();
				}
			});

			try {
				const committedChat = await this._waitForSessionInCache(chatResource, cts.token);
				this._sessionCache.delete(session.resource.toString());
				this._clearNewSessionIfMatch(session);
				const committedSession = this._chatToSession(committedChat);
				this._sessionWrapperCache.delete(session.sessionId);
				this._onDidReplaceSession.fire({ from: newSession, to: committedSession });
				return committedSession;
			} catch (error) {
				this._clearNewSessionIfMatch(session, /* leak */ true);
				if (error instanceof CancellationError) {
					session.setStatus(SessionStatus.Completed);
					this._onDidChangeSessions.fire({ added: [], removed: [], changed: [newSession] });
					return newSession;
				}
				this._removeTempSession(session, newSession);
				throw error;
			} finally {
				cts.dispose();
			}
		} catch (error) {
			this.logService.error(`[ClaudeChatSessionsProvider] Failed to send first chat for session ${session.sessionId}:`, error);
			throw error;
		} finally {
			this._inFlightCommits.delete(committedKey);
			ref.dispose();
		}
	}

	private _removeTempSession(session: ClaudeCodeNewSession, wrapper: ISession): void {
		this._sessionCache.delete(session.resource.toString());
		this._sessionWrapperCache.delete(session.sessionId);
		this._clearNewSessionIfMatch(session, /* leak */ true);
		this._onDidChangeSessions.fire({ added: [], removed: [wrapper], changed: [] });
		session.dispose();
	}

	/**
	 * Clears the tracked new session, but only if the map still holds exactly
	 * this instance: async flows may finish after the entry was replaced.
	 */
	private _clearNewSessionIfMatch(session: ClaudeCodeNewSession, leak?: boolean): void {
		if (this._newSessions.get(session.sessionId) === session) {
			if (leak) {
				this._newSessions.deleteAndLeak(session.sessionId);
			} else {
				this._newSessions.deleteAndDispose(session.sessionId);
			}
		}
	}

	private async _updateChatSessionState(resource: URI, session: ClaudeCodeNewSession): Promise<IDisposable> {
		const modelRef = await this.chatService.acquireOrLoadSession(resource, ChatAgentLocation.Chat, CancellationToken.None);
		if (!modelRef) {
			return Disposable.None;
		}
		const selectedModelId = session.selectedModelId;
		if (selectedModelId) {
			const metadata = this.languageModelsService.lookupLanguageModel(selectedModelId);
			if (metadata) {
				modelRef.object.inputModel.setState({ selectedModel: { identifier: selectedModelId, metadata } });
			}
		}
		if (session.selectedOptions.size > 0) {
			this.chatSessionsService.updateSessionOptions(resource, session.selectedOptions);
		}
		return modelRef;
	}

	/**
	 * Waits for the committed adapter with the given resource to appear in the
	 * cache (filled by {@link _refreshSessionCache} from the agent sessions model).
	 */
	private async _waitForSessionInCache(resource: URI, token: CancellationToken): Promise<ClaudeAgentSessionAdapter> {
		const key = resource.toString();
		const existing = this._sessionCache.get(key);
		if (existing instanceof ClaudeAgentSessionAdapter) {
			return existing;
		}
		const disposables = new DisposableStore();
		try {
			const sessionPromise = new Promise<ClaudeAgentSessionAdapter>(resolve => {
				disposables.add(this.onDidChangeSessions(() => {
					const cached = this._sessionCache.get(key);
					if (cached instanceof ClaudeAgentSessionAdapter) {
						resolve(cached);
					}
				}));
			});
			const result = await raceTimeout(raceCancellationError(sessionPromise, token), 30_000);
			if (!result) {
				throw new Error('Timed out waiting for committed session in cache');
			}
			return result;
		} finally {
			disposables.dispose();
		}
	}

	// -- Cache --

	private _cleanupTempSession(sessionId: string): void {
		const chat = this._findChatSession(sessionId);
		if (chat instanceof ClaudeCodeNewSession) {
			this._removeTempSession(chat, this._chatToSession(chat));
		}
	}

	private _refreshSessionCache(): void {
		const currentKeys = new Set<string>();
		const added: IClaudeChatSession[] = [];
		const changed: IClaudeChatSession[] = [];

		for (const session of this.agentSessionsService.model.sessions) {
			if (session.providerType !== CLAUDE_CODE_SESSION_TYPE_ID) {
				continue;
			}
			const key = session.resource.toString();
			currentKeys.add(key);
			const existing = this._sessionCache.get(key);
			if (existing instanceof ClaudeAgentSessionAdapter) {
				if (existing.update(session)) {
					changed.push(existing);
				}
			} else {
				const adapter = new ClaudeAgentSessionAdapter(session, this.id, this.chatSessionsService);
				this._sessionCache.set(key, adapter);
				added.push(adapter);
			}
		}

		const removed: IClaudeChatSession[] = [];
		for (const [key, chat] of this._sessionCache) {
			if (chat instanceof ClaudeAgentSessionAdapter && !currentKeys.has(key) && !this._inFlightCommits.has(key)) {
				removed.push(chat);
			}
		}
		for (const chat of removed) {
			this._sessionCache.delete(chat.resource.toString());
		}

		if (added.length > 0 || removed.length > 0 || changed.length > 0) {
			this._onDidChangeSessions.fire({
				added: added.map(chat => this._chatToSession(chat)),
				removed: removed.map(chat => {
					const session = this._chatToSession(chat);
					this._sessionWrapperCache.delete(chat.sessionId);
					return session;
				}),
				changed: changed.map(chat => this._chatToSession(chat)),
			});
		}
	}

	private _findChatSession(sessionId: string): IClaudeChatSession | undefined {
		const prefix = `${this.id}:`;
		const localId = sessionId.startsWith(prefix) ? sessionId.substring(prefix.length) : sessionId;
		return this._sessionCache.get(localId);
	}

	private _findAgentSession(sessionId: string): IAgentSession | undefined {
		const chat = this._findChatSession(sessionId);
		return chat ? this.agentSessionsService.getSession(chat.resource) : undefined;
	}

	/**
	 * Wraps a chat into an {@link ISession} with a single chat. Wrappers are
	 * cached per session so repeated lookups return the same instance.
	 */
	private _chatToSession(chat: IClaudeChatSession): ISession {
		const cached = this._sessionWrapperCache.get(chat.sessionId);
		if (cached) {
			return cached;
		}
		const mainChat = chat.mainChat.map(value => this._withChangesets(value, chat.workspace));
		const session: ISession = {
			sessionId: chat.sessionId,
			resource: chat.resource,
			providerId: chat.providerId,
			sessionType: chat.sessionType,
			icon: chat.icon,
			createdAt: chat.createdAt,
			workspace: chat.workspace,
			title: chat.title,
			updatedAt: chat.updatedAt,
			status: chat.status,
			changesSummary: chat.changesSummary,
			modelId: chat.modelId,
			mode: chat.mode,
			loading: chat.loading,
			isArchived: chat.isArchived,
			isRead: chat.isRead,
			description: chat.description,
			lastTurnEnd: chat.lastTurnEnd,
			chats: mainChat.map(value => [value] as readonly IChat[]),
			mainChat,
			capabilities: constObservable({
				supportsMultipleChats: false,
				supportsRename: true,
				supportsDelete: false,
			}),
		};
		this._sessionWrapperCache.set(chat.sessionId, session);
		return session;
	}

	private _withChangesets(chat: IChat, workspace: IObservable<ISessionWorkspace | undefined>): IChat {
		return { ...chat, changesets: createLocalChangesets(workspace, constObservable([chat]), this.instantiationService) };
	}
}
