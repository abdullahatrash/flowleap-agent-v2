/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { promises as fs } from 'fs';
import * as os from 'os';
import * as nodePath from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IConfigurationService } from '../../../../platform/configuration/common/configurationService';
import { IVSCodeExtensionContext } from '../../../../platform/extContext/common/extensionContext';
import { IGitCommitMessageService } from '../../../../platform/git/common/gitCommitMessageService';
import { RepoContext } from '../../../../platform/git/common/gitService';
import { Ref, RefQuery, Worktree } from '../../../../platform/git/vscode/git';
import { MockGitService } from '../../../../platform/ignore/node/test/mockGitService';
import { ILogService } from '../../../../platform/log/common/logService';
import { IWorkspaceService } from '../../../../platform/workspace/common/workspaceService';
import { mock } from '../../../../util/common/test/simpleMock';
import { constObservable } from '../../../../util/vs/base/common/observableInternal';
import { URI } from '../../../../util/vs/base/common/uri';
import { IAgentSessionsWorkspace } from '../../common/agentSessionsWorkspace';
import { IChatSessionMetadataStore } from '../../common/chatSessionMetadataStore';
import { ChatSessionWorktreeService } from '../chatSessionWorktreeServiceImpl';

class MockLogService extends mock<ILogService>() {
	override trace = vi.fn();
	override info = vi.fn();
	override warn = vi.fn();
	override error = vi.fn();
	override debug = vi.fn();
}

class MockConfigurationService extends mock<IConfigurationService>() {
	override getConfig<T>(): T {
		return true as T;
	}

	override getNonExtensionConfig<T>(): T | undefined {
		return undefined;
	}
}

class MockAgentSessionsWorkspace extends mock<IAgentSessionsWorkspace>() {
	override isAgentSessionsWorkspace = false;
}

class MockMetadataStore extends mock<IChatSessionMetadataStore>() {
	override storeWorktreeInfo = vi.fn(async () => { });
	override getWorktreeProperties = vi.fn(async () => undefined);
}

/**
 * Git service that models the two things a branch name can collide with: an existing
 * branch ref and an existing worktree.
 */
class WorktreeGitService extends MockGitService {
	readonly createdBranches: string[] = [];
	readonly existingRefs = new Set<string>();
	getRefsError: Error | undefined;

	constructor(private readonly repository: RepoContext) {
		super();
	}

	override getRepository(): Promise<RepoContext | undefined> {
		return Promise.resolve(this.repository);
	}

	override getRefs(_uri: URI, query: RefQuery): Promise<Ref[]> {
		if (this.getRefsError) {
			return Promise.reject(this.getRefsError);
		}
		const name = query.pattern?.substring('refs/heads/'.length);
		return Promise.resolve(name && this.existingRefs.has(name) ? [{ type: 0, name } as Ref] : []);
	}

	override async createWorktree(_uri: URI, options?: { branch?: string }): Promise<string | undefined> {
		// Yield so that a second, concurrent creation can interleave if it is not serialized.
		await Promise.resolve();
		this.createdBranches.push(options!.branch!);
		this.existingRefs.add(options!.branch!);
		return nodePath.join('/worktrees', options!.branch!);
	}
}

describe('ChatSessionWorktreeService', () => {
	let tempDir: string;
	let repositoryRoot: URI;
	let repository: RepoContext;
	let gitService: WorktreeGitService;
	let service: ChatSessionWorktreeService;

	function createRepoContext(worktrees: Worktree[]): RepoContext {
		return {
			rootUri: repositoryRoot,
			kind: 'repository',
			isUsingVirtualFileSystem: false,
			headIncomingChanges: undefined,
			headOutgoingChanges: undefined,
			headBranchName: 'main',
			headCommitHash: 'abc123',
			upstreamBranchName: undefined,
			upstreamRemote: undefined,
			isRebasing: false,
			remotes: [],
			worktrees,
			changes: undefined,
			headBranchNameObs: constObservable('main'),
			headCommitHashObs: constObservable('abc123'),
			upstreamBranchNameObs: constObservable(undefined),
			upstreamRemoteObs: constObservable(undefined),
			isRebasingObs: constObservable(false),
			isIgnored: vi.fn().mockResolvedValue(false),
		};
	}

	function createService(worktrees: Worktree[] = []): void {
		repository = createRepoContext(worktrees);
		gitService = new WorktreeGitService(repository);
		service = new ChatSessionWorktreeService(
			new MockAgentSessionsWorkspace(),
			new MockConfigurationService(),
			new (mock<IGitCommitMessageService>())(),
			gitService,
			new MockLogService(),
			new (mock<IVSCodeExtensionContext>())(),
			new (mock<IWorkspaceService>())(),
			new MockMetadataStore());
	}

	beforeEach(async () => {
		tempDir = await fs.mkdtemp(nodePath.join(os.tmpdir(), 'chat-session-worktree-'));
		repositoryRoot = URI.file(nodePath.join(tempDir, 'repo'));
		createService();
	});

	afterEach(async () => {
		service.dispose();
		await fs.rm(tempDir, { recursive: true, force: true });
	});

	it('uses the preferred branch name when nothing collides', async () => {
		const properties = await service.createWorktree(repositoryRoot, undefined, undefined, 'my-session');

		expect({ branchName: properties?.branchName, createdBranches: gitService.createdBranches })
			.toEqual({ branchName: 'copilot/my-session', createdBranches: ['copilot/my-session'] });
	});

	it('skips candidates taken by a branch ref, a registered worktree or a leftover directory', async () => {
		createService([{ name: 'copilot-my-session-2', path: '/elsewhere/copilot-my-session-2', ref: '', detached: false }]);
		gitService.existingRefs.add('copilot/my-session');
		await fs.mkdir(nodePath.join(tempDir, 'repo.worktrees', 'copilot-my-session-3'), { recursive: true });

		const properties = await service.createWorktree(repositoryRoot, undefined, undefined, 'my-session');

		expect(properties?.branchName).toBe('copilot/my-session-4');
	});

	it('serializes creation per repository so concurrent sessions get distinct branches', async () => {
		await Promise.all([
			service.createWorktree(repositoryRoot, undefined, undefined, 'my-session'),
			service.createWorktree(repositoryRoot, undefined, undefined, 'my-session'),
		]);

		expect(gitService.createdBranches).toEqual(['copilot/my-session', 'copilot/my-session-2']);
	});

	it('treats a failed branch check as a collision and falls back to a random suffix', async () => {
		gitService.getRefsError = new Error('git failed');

		const properties = await service.createWorktree(repositoryRoot, undefined, undefined, 'my-session');

		expect(properties?.branchName).toMatch(/^copilot\/my-session-[0-9a-f]{8}$/);
	});
});
