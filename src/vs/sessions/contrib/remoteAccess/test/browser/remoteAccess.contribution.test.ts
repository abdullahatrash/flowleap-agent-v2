/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { Codicon } from '../../../../../base/common/codicons.js';
import { observableValue } from '../../../../../base/common/observable.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { isIMenuItem, MenuRegistry } from '../../../../../platform/actions/common/actions.js';
import { RemoteAccessHostState } from '../../../../../platform/agentHost/common/remoteAccessHost.js';
import { CommandsRegistry } from '../../../../../platform/commands/common/commands.js';
import { ContextKeyExpr } from '../../../../../platform/contextkey/common/contextkey.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { IsAuxiliaryWindowContext, IsSessionsWindowContext } from '../../../../../workbench/common/contextkeys.js';
import { RemoteAccessEnabledContext } from '../../../../../workbench/contrib/chat/common/remoteAccess/remoteAccess.js';
import { Menus } from '../../../../browser/menus.js';
import { ISession, SessionStatus } from '../../../../services/sessions/common/session.js';
import { describeHostStatus, MANAGE_VIEWERS_ID, PAIR_VIEWER_ID, TOGGLE_REMOTE_ACCESS_ID } from '../../browser/remoteAccess.contribution.js';
import { RemoteAccessKeepAwakeController } from '../../browser/remoteAccessKeepAwake.js';

suite('Sessions - RemoteAccess title bar', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('registers the Remote Access toggle in the Agents Window title bar', () => {
		const item = MenuRegistry.getMenuItems(Menus.TitleBarRightLayout)
			.filter(isIMenuItem)
			.find(candidate => candidate.command.id === TOGGLE_REMOTE_ACCESS_ID);
		assert.ok(item, 'toggle is in the title bar');
		assert.strictEqual(item.group, 'navigation');
		assert.strictEqual(item.command.icon, Codicon.radioTower);
		assert.strictEqual(item.command.toggled, RemoteAccessEnabledContext);
		assert.ok(item.when?.equals(ContextKeyExpr.and(IsSessionsWindowContext, IsAuxiliaryWindowContext.toNegated())!));
	});

	test('registers the toggle, Pairing and Viewer commands', () => {
		for (const id of [TOGGLE_REMOTE_ACCESS_ID, PAIR_VIEWER_ID, MANAGE_VIEWERS_ID]) {
			assert.ok(CommandsRegistry.getCommand(id), id);
		}
	});

	test('status lines use the Remote Access vocabulary', () => {
		assert.match(describeHostStatus({ state: RemoteAccessHostState.Connected, connectedPairIds: ['a'] }), /1 Viewer is following this Host/);
		assert.match(describeHostStatus({ state: RemoteAccessHostState.Connected, connectedPairIds: ['a', 'b'] }), /2 Viewers/);
		assert.match(describeHostStatus({ state: RemoteAccessHostState.SubscriptionRequired, connectedPairIds: [] }), /subscription/);
		assert.match(describeHostStatus({ state: RemoteAccessHostState.Stopped, connectedPairIds: [] }), /off/);
	});
});

suite('Sessions - RemoteAccess keep-awake', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	function fakeSession(status: SessionStatus, archived = false) {
		return {
			status: observableValue('status', status),
			isArchived: observableValue('archived', archived),
		};
	}

	function setup() {
		const enabled = observableValue('enabled', false);
		const setting = observableValue('keepAwake', true);
		const session = fakeSession(SessionStatus.Completed);
		const sessions = observableValue<readonly ISession[]>('sessions', [session as unknown as ISession]);
		const calls: string[] = [];
		let nextId = 1;
		const controller = store.add(new RemoteAccessKeepAwakeController(enabled, setting, sessions, {
			start: async () => { calls.push('start'); return nextId++; },
			stop: async id => { calls.push(`stop ${id}`); return true; },
		}, new NullLogService()));
		return { enabled, setting, session, sessions, calls, controller };
	}

	test('holds the blocker only while on, allowed and a session runs', async () => {
		const { enabled, setting, session, calls, controller } = setup();
		await controller.whenSettled();
		assert.deepStrictEqual(calls, []);

		enabled.set(true, undefined);
		await controller.whenSettled();
		assert.deepStrictEqual(calls, [], 'no running session yet');

		session.status.set(SessionStatus.InProgress, undefined);
		await controller.whenSettled();
		assert.deepStrictEqual(calls, ['start']);

		session.status.set(SessionStatus.NeedsInput, undefined);
		await controller.whenSettled();
		assert.deepStrictEqual(calls, ['start'], 'waiting for input still counts as running');

		setting.set(false, undefined);
		await controller.whenSettled();
		assert.deepStrictEqual(calls, ['start', 'stop 1']);

		setting.set(true, undefined);
		await controller.whenSettled();
		session.status.set(SessionStatus.Completed, undefined);
		await controller.whenSettled();
		assert.deepStrictEqual(calls, ['start', 'stop 1', 'start', 'stop 2']);
	});

	test('archived sessions do not keep the Host awake; dispose releases', async () => {
		const { enabled, sessions, calls, controller } = setup();
		enabled.set(true, undefined);
		sessions.set([fakeSession(SessionStatus.InProgress, true) as unknown as ISession], undefined);
		await controller.whenSettled();
		assert.deepStrictEqual(calls, []);

		sessions.set([fakeSession(SessionStatus.InProgress) as unknown as ISession], undefined);
		await controller.whenSettled();
		assert.deepStrictEqual(calls, ['start']);

		controller.dispose();
		await controller.whenSettled();
		assert.deepStrictEqual(calls, ['start', 'stop 1']);
	});
});
