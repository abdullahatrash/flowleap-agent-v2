/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { MockFileSystemService } from '../../../../platform/filesystem/node/test/mockFileSystemService';
import { IGitService, RepoContext } from '../../../../platform/git/common/gitService';
import { ILogService } from '../../../../platform/log/common/logService';
import { NullWorkspaceService } from '../../../../platform/workspace/common/workspaceService';
import { mock } from '../../../../util/common/test/simpleMock';
import { CancellationTokenSource } from '../../../../util/vs/base/common/cancellation';
import { DisposableStore } from '../../../../util/vs/base/common/lifecycle';
import { URI } from '../../../../util/vs/base/common/uri';
import { LanguageModelTextPart, LanguageModelToolResult2 } from '../../../../vscodeTypes';
import type { IToolsService } from '../../../tools/common/toolsService';
import { RepositoryProperties } from '../../common/chatSessionMetadataStore';
import { IChatSessionWorkspaceFolderService } from '../../common/chatSessionWorkspaceFolderService';
import { ChatSessionWorktreeFile, ChatSessionWorktreeProperties, IChatSessionWorktreeService } from '../../common/chatSessionWorktreeService';
import { IFolderRepositoryManager } from '../../common/folderRepositoryManager';
import { ClaudeFolderRepositoryManager } from '../folderRepositoryManagerImpl';
import { MockChatSessionMetadataStore } from '../../common/test/mockChatSessionMetadataStore';
import type { IClaudeSessionStateService } from '../../claude/common/claudeSessionStateService';
import type { ClaudeFolderInfo } from '../../claude/common/claudeFolderInfo';

/**
 * Fake implementation of IChatSessionWorktreeService for testing.
 */
class FakeChatSessionWorktreeService extends mock<IChatSessionWorktreeService>() {
	private _worktreeProperties = new Map<string, ChatSessionWorktreeProperties>();

	override createWorktree = vi.fn(async (_repositoryPath: vscode.Uri, _stream?: vscode.ChatResponseStream, _baseBranch?: string): Promise<ChatSessionWorktreeProperties | undefined> => {
		return undefined;
	});

	override getWorktreeProperties = vi.fn(async (sessionId: string | vscode.Uri): Promise<ChatSessionWorktreeProperties | undefined> => {
		return this._worktreeProperties.get(typeof sessionId === 'string' ? sessionId : sessionId.fsPath);
	});

	override setWorktreeProperties = vi.fn(async (sessionId: string, properties: string | ChatSessionWorktreeProperties): Promise<void> => {
		if (typeof properties === 'string') {
			return;
		}
		this._worktreeProperties.set(sessionId, properties);
	});

	override getWorktreePath = vi.fn(async (sessionId: string): Promise<vscode.Uri | undefined> => {
		const props = this._worktreeProperties.get(sessionId);
		return props ? vscode.Uri.file(props.worktreePath) : undefined;
	});

	setTestWorktreeProperties(sessionId: string, properties: ChatSessionWorktreeProperties): void {
		this._worktreeProperties.set(sessionId, properties);
	}
}

/**
 * Fake implementation of IChatSessionWorkspaceFolderService for testing.
 */
class FakeChatSessionWorkspaceFolderService extends mock<IChatSessionWorkspaceFolderService>() {
	private _sessionWorkspaceFolders = new Map<string, vscode.Uri>();
	private _sessionWorkspaceFolderRepositories = new Map<string, vscode.Uri | undefined>();
	private _workspaceChanges = new Map<string, readonly ChatSessionWorktreeFile[] | undefined>();

	override trackSessionWorkspaceFolder = vi.fn(async (sessionId: string, workspaceFolderUri: string, repositoryProperties?: RepositoryProperties): Promise<void> => {
		this._sessionWorkspaceFolders.set(sessionId, vscode.Uri.file(workspaceFolderUri));
		this._sessionWorkspaceFolderRepositories.set(sessionId, repositoryProperties?.repositoryPath ? vscode.Uri.file(repositoryProperties.repositoryPath) : undefined);
	});

	override deleteTrackedWorkspaceFolder = vi.fn(async (sessionId: string): Promise<void> => {
		this._sessionWorkspaceFolders.delete(sessionId);
		this._sessionWorkspaceFolderRepositories.delete(sessionId);
	});

	override getSessionWorkspaceFolder = vi.fn(async (sessionId: string): Promise<vscode.Uri | undefined> => {
		return this._sessionWorkspaceFolders.get(sessionId);
	});

	override getSessionWorkspaceFolderEntry = vi.fn(async (sessionId: string) => {
		const folder = this._sessionWorkspaceFolders.get(sessionId);
		if (!folder) {
			return undefined;
		}

		return {
			folderPath: folder.fsPath,
			timestamp: Date.now()
		};
	});

	override getRepositoryProperties = vi.fn(async (_sessionId: string): Promise<RepositoryProperties | undefined> => {
		return undefined;
	});

	override handleRequestCompleted = vi.fn(async (_sessionId: string): Promise<void> => { });

	override getWorkspaceChanges = vi.fn(async (sessionId: string): Promise<readonly ChatSessionWorktreeFile[] | undefined> => {
		return this._workspaceChanges.get(sessionId);
	});

	setTestSessionWorkspaceFolder(sessionId: string, folder: vscode.Uri): void {
		this._sessionWorkspaceFolders.set(sessionId, folder);
	}

	override clearWorkspaceChanges(sessionIdOrFolderUri: string | vscode.Uri): string[] {
		if (typeof sessionIdOrFolderUri === 'string') {
			this._workspaceChanges.delete(sessionIdOrFolderUri);
		}
		return [];
	}
}

/**
 * Fake implementation of IGitService for testing.
 */
class FakeGitService extends mock<IGitService>() {
	private _repositories = new Map<string, RepoContext>();
	private _recentRepositories: { rootUri: vscode.Uri; lastAccessTime: number }[] = [];
	private _activeRepo: RepoContext | undefined;

	override activeRepository = {
		get: () => this._activeRepo
	} as unknown as IGitService['activeRepository'];

	override repositories: RepoContext[] = [];

	override async getRepository(uri: vscode.Uri, _forceOpen?: boolean): Promise<RepoContext | undefined> {
		return this._repositories.get(uri.fsPath);
	}

	override getRecentRepositories = vi.fn((): { rootUri: vscode.Uri; lastAccessTime: number }[] => {
		return this._recentRepositories;
	});

	setTestRepository(uri: vscode.Uri, repo: RepoContext): void {
		this._repositories.set(uri.fsPath, repo);
	}

	setTestRecentRepositories(repos: { rootUri: vscode.Uri; lastAccessTime: number }[]): void {
		this._recentRepositories = repos;
	}

	setTestActiveRepository(repo: RepoContext | undefined): void {
		this._activeRepo = repo;
		if (repo) {
			this._repositories.set(repo.rootUri.fsPath, repo);
		}
	}
}

/**
 * Mock workspace service that tracks trust requests.
 */
/**
 * Fake implementation of IToolsService for testing.
 */
class FakeToolsService extends mock<IToolsService>() {
	nextConfirmationButton: string | undefined = undefined;
	override getTool(name: string) {
		if (name === 'vscode_get_modified_files_confirmation') {
			return { name } as any;
		}
		return undefined;
	}
	override invokeTool = vi.fn(async (name: string, _options: unknown, _token: unknown) => {
		if (name === 'vscode_get_modified_files_confirmation') {
			const button = this.nextConfirmationButton;
			if (button !== undefined) {
				return new LanguageModelToolResult2([new LanguageModelTextPart(button)]);
			}
			return new LanguageModelToolResult2([]);
		}
		return new LanguageModelToolResult2([]);
	});
}

/**
 * Mock workspace service that tracks trust requests.
 */
class MockWorkspaceService extends NullWorkspaceService {
	public trustRequests: vscode.Uri[] = [];
	public trustResponse = true;

	constructor(folders: vscode.Uri[] = []) {
		super(folders);
	}

	override async requestResourceTrust(options: { uri: vscode.Uri; message: string }): Promise<boolean> {
		this.trustRequests.push(options.uri);
		return this.trustResponse;
	}
}

/**
 * FakeFolderRepositoryManager for use in other tests.
 * Provides a configurable mock of IFolderRepositoryManager.
 */
export class FakeFolderRepositoryManager extends mock<IFolderRepositoryManager>() {
	private _untitledSessionFolders = new Map<string, vscode.Uri>();
	private _folderRepoInfo = new Map<string, {
		folder: vscode.Uri | undefined;
		repository: vscode.Uri | undefined;
		repositoryProperties?: RepositoryProperties;
		worktree: vscode.Uri | undefined;
		trusted: boolean | undefined;
		worktreeProperties: ChatSessionWorktreeProperties | undefined;
	}>();

	override setNewSessionFolder = vi.fn((sessionId: string, folderUri: vscode.Uri): void => {
		if (!sessionId.startsWith('untitled:') && !sessionId.startsWith('untitled-')) {
			throw new Error(`Cannot set folder for non-untitled session: ${sessionId}`);
		}
		this._untitledSessionFolders.set(sessionId, folderUri);
	});

	override getFolderRepository = vi.fn(async (
		sessionId: string,
		_options: { promptForTrust: true; stream: vscode.ChatResponseStream } | undefined,
		_token: vscode.CancellationToken
	) => {
		const info = this._folderRepoInfo.get(sessionId);
		return info ?? { folder: undefined, repository: undefined, repositoryProperties: undefined, worktree: undefined, trusted: undefined, worktreeProperties: undefined };
	});

	override initializeFolderRepository = vi.fn(async (
		sessionId: string | undefined,
		_options: { stream: vscode.ChatResponseStream; toolInvocationToken: vscode.ChatParticipantToolToken },
		_token: vscode.CancellationToken
	) => {
		const info = sessionId ? this._folderRepoInfo.get(sessionId) : undefined;
		return {
			folder: info?.folder,
			repository: info?.repository,
			repositoryProperties: info?.repositoryProperties,
			worktree: info?.worktree,
			trusted: info?.trusted ?? true,
			worktreeProperties: info?.worktreeProperties
		};
	});

	override getFolderMRU = vi.fn(() => {
		return Promise.resolve([]);
	});

	override deleteNewSessionFolder = vi.fn((sessionId: string): void => {
		this._untitledSessionFolders.delete(sessionId);
	});

	override getRepositoryInfo = vi.fn(async (
		_folder: vscode.Uri,
		_token: vscode.CancellationToken
	) => {
		return { repository: undefined, headBranchName: undefined };
	});

	setTestFolderRepositoryInfo(sessionId: string, info: {
		folder: vscode.Uri | undefined;
		repository: vscode.Uri | undefined;
		repositoryProperties?: RepositoryProperties;
		worktree: vscode.Uri | undefined;
		trusted: boolean | undefined;
		worktreeProperties: ChatSessionWorktreeProperties | undefined;
	}): void {
		this._folderRepoInfo.set(sessionId, info);
	}
}

describe('ClaudeFolderRepositoryManager', () => {
	const disposables = new DisposableStore();
	let manager: ClaudeFolderRepositoryManager;
	let worktreeService: FakeChatSessionWorktreeService;
	let workspaceFolderService: FakeChatSessionWorkspaceFolderService;
	let gitService: FakeGitService;
	let workspaceService: MockWorkspaceService;
	let logService: ILogService;
	let toolsService: FakeToolsService;
	let sessionStateService: IClaudeSessionStateService;
	let folderInfoMap: Map<string, ClaudeFolderInfo>;
	let fileSystem: MockFileSystemService;

	beforeEach(() => {
		worktreeService = new FakeChatSessionWorktreeService();
		workspaceFolderService = new FakeChatSessionWorkspaceFolderService();
		gitService = new FakeGitService();
		workspaceService = new MockWorkspaceService([URI.file('/workspace')]);
		logService = new class extends mock<ILogService>() {
			override trace = vi.fn();
			override info = vi.fn();
			override warn = vi.fn();
			override error = vi.fn();
		}();
		toolsService = new FakeToolsService();
		fileSystem = new MockFileSystemService();

		folderInfoMap = new Map();
		sessionStateService = new class extends mock<IClaudeSessionStateService>() {
			override getFolderInfoForSession(sessionId: string): ClaudeFolderInfo | undefined {
				return folderInfoMap.get(sessionId);
			}
		}();

		manager = new ClaudeFolderRepositoryManager(
			worktreeService,
			workspaceFolderService,
			gitService,
			workspaceService,
			logService,
			toolsService,
			sessionStateService,
			fileSystem,
			new MockChatSessionMetadataStore()
		);
	});

	afterEach(() => {
		vi.restoreAllMocks();
		disposables.clear();
	});

	describe('getFolderRepository', () => {
		it('returns worktree info for sessions with worktrees', async () => {
			const sessionId = 'test-session';
			const token = disposables.add(new CancellationTokenSource()).token;

			worktreeService.setTestWorktreeProperties(sessionId, {
				autoCommit: true,
				baseCommit: 'abc123',
				branchName: 'test-branch',
				repositoryPath: '/repo/path',
				worktreePath: '/worktree/path',
				version: 1
			});

			const result = await manager.getFolderRepository(sessionId, undefined, token);

			expect(result.folder?.fsPath).toBe(vscode.Uri.file('/repo/path').fsPath);
			expect(result.worktree?.fsPath).toBe(vscode.Uri.file('/worktree/path').fsPath);
		});

		it('returns workspace folder for sessions without worktrees', async () => {
			const sessionId = 'test-session';
			const token = disposables.add(new CancellationTokenSource()).token;

			workspaceFolderService.setTestSessionWorkspaceFolder(sessionId, vscode.Uri.file('/workspace/folder'));

			const result = await manager.getFolderRepository(sessionId, undefined, token);

			expect(result.folder?.fsPath).toBe(vscode.Uri.file('/workspace/folder').fsPath);
		});

		it('falls back to session state folder info', async () => {
			const sessionId = 'test-session';
			const token = disposables.add(new CancellationTokenSource()).token;

			folderInfoMap.set(sessionId, { cwd: '/claude/project', additionalDirectories: [] });
			await fileSystem.createDirectory(URI.file('/claude/project'));

			const result = await manager.getFolderRepository(sessionId, undefined, token);

			expect(result.folder?.fsPath).toBe(vscode.Uri.file('/claude/project').fsPath);
		});

		it('returns empty result when fallback folder does not exist', async () => {
			const sessionId = 'test-session';
			const token = disposables.add(new CancellationTokenSource()).token;

			folderInfoMap.set(sessionId, { cwd: '/nonexistent/path', additionalDirectories: [] });

			const result = await manager.getFolderRepository(sessionId, undefined, token);

			expect(result.folder).toBeUndefined();
		});

		it('returns empty result when no folder info available', async () => {
			const sessionId = 'unknown-session';
			const token = disposables.add(new CancellationTokenSource()).token;

			const result = await manager.getFolderRepository(sessionId, undefined, token);

			expect(result.folder).toBeUndefined();
			expect(result.repository).toBeUndefined();
			expect(result.worktree).toBeUndefined();
		});
	});
});
