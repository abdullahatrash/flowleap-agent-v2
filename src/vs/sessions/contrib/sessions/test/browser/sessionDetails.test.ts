/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { Codicon } from '../../../../../base/common/codicons.js';
import { constObservable } from '../../../../../base/common/observable.js';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IChat, ISession, ISessionWorkspace, SessionStatus } from '../../../../services/sessions/common/session.js';
import { formatSessionDetails } from '../../browser/sessionDetailsAction.js';

function createTestSession(title: string, options: { resourceId?: string; isArchived?: boolean; workspace?: ISessionWorkspace } = {}): ISession {
	const resourceId = options.resourceId ?? title;
	const now = new Date();
	return {
		sessionId: resourceId,
		resource: URI.parse(`test-session://${resourceId}`),
		providerId: 'test',
		sessionType: 'test',
		icon: Codicon.account,
		createdAt: now,
		workspace: constObservable(options.workspace),
		title: constObservable(title),
		updatedAt: constObservable(now),
		status: constObservable(SessionStatus.Completed),
		changesets: constObservable([]),
		changes: constObservable([]),
		modelId: constObservable(undefined),
		mode: constObservable(undefined),
		loading: constObservable(false),
		isArchived: constObservable(options.isArchived ?? false),
		isRead: constObservable(true),
		description: constObservable(undefined),
		lastTurnEnd: constObservable(undefined),
		chats: constObservable<readonly IChat[]>([]),
		mainChat: constObservable<IChat>(undefined!),
		capabilities: { supportsMultipleChats: false },
	};
}

suite('Session Details', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('lists exact working directories for non-archived sessions', () => {
		const localWorkingDirectory = URI.file('/repo.worktrees/feature');
		const workspace: ISessionWorkspace = {
			uri: URI.file('/repo'),
			label: 'repo',
			icon: Codicon.folder,
			folders: [
				{
					root: URI.file('/repo'),
					workingDirectory: localWorkingDirectory,
					name: 'repo',
					description: undefined,
				},
				{
					root: URI.parse('vscode-agent-host://host/home/user/repo'),
					workingDirectory: URI.parse('vscode-agent-host://host/home/user/repo'),
					name: 'remote-repo',
					description: undefined,
				},
			],
			requiresWorkspaceTrust: false,
			isVirtualWorkspace: false,
		};
		const working = createTestSession('Working', { resourceId: 'working', workspace });
		const noWorkspace = createTestSession('No Workspace', { resourceId: 'no-workspace' });
		const archived = createTestSession('Archived', { resourceId: 'archived', isArchived: true });

		assert.strictEqual(formatSessionDetails([working, archived, noWorkspace]), [
			'Session Details',
			'',
			'Session: Working',
			`Working directory: ${localWorkingDirectory.fsPath}`,
			'Working directory: vscode-agent-host://host/home/user/repo',
			'Resource: test-session://working',
			'',
			'Session: No Workspace',
			'Working directory: (none)',
			'Resource: test-session://no-workspace',
			'',
		].join('\n'));
	});

	test('reports when there are no non-archived sessions', () => {
		const archived = createTestSession('Archived', { isArchived: true });

		assert.strictEqual(formatSessionDetails([archived]), [
			'Session Details',
			'',
			'No non-archived user sessions.',
			'',
		].join('\n'));
	});
});
