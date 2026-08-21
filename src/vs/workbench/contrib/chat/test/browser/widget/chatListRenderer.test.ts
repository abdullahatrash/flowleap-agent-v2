/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { URI } from '../../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../base/test/common/utils.js';
import { buildPlanReviewProgressContent, reconcileChatItemHeight, shouldHideChatUserIdentity, shouldRenderInitialProgressiveContentImmediately, shouldScheduleInitialHeightChange } from '../../../browser/widget/chatListRenderer.js';

suite('ChatListRenderer', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	suite('shouldScheduleInitialHeightChange', () => {
		test('only schedules first measurement updates when needed to avoid clipping', () => {
			assert.deepStrictEqual([
				shouldScheduleInitialHeightChange(120, undefined),
				shouldScheduleInitialHeightChange(120, 120),
				shouldScheduleInitialHeightChange(120, 120.1),
				shouldScheduleInitialHeightChange(121, 120),
				shouldScheduleInitialHeightChange(121, 120.1),
			], [
				true,
				false,
				false,
				true,
				true,
			]);
		});
	});

	suite('shouldRenderInitialProgressiveContentImmediately', () => {
		test('renders accumulated markdown immediately only when progressive rendering has not started', () => {
			assert.deepStrictEqual([
				shouldRenderInitialProgressiveContentImmediately(false, true, false),
				shouldRenderInitialProgressiveContentImmediately(false, true, true),
				shouldRenderInitialProgressiveContentImmediately(true, true, false),
				shouldRenderInitialProgressiveContentImmediately(false, false, false),
			], [
				true,
				false,
				false,
				false,
			]);
		});
	});

	suite('reconcileChatItemHeight', () => {
		// Helper: run a sequence of measurements through the reconciler, threading
		// `currentRenderedHeight` the way `fireItemHeightChange` does, and capture the
		// notification kind + the stored height after each step. `initialStored` is the
		// element's `currentRenderedHeight` before the first step (undefined = never measured).
		const run = (steps: readonly { measured: number; isBeingRendered: boolean }[], allocatedHeight: number | undefined, initialStored: number | undefined) => {
			let stored: number | undefined = initialStored;
			return steps.map(({ measured, isBeingRendered }) => {
				const update = reconcileChatItemHeight(measured, stored, isBeingRendered, allocatedHeight);
				stored = update.nextRenderedHeight;
				return { kind: update.kind, height: update.height, stored };
			});
		};

		// Regression test for https://github.com/microsoft/vscode/issues/326952.
		// A row grows during streaming and is measured synchronously while it is being rendered
		// (notification suppressed). The stored height must NOT advance, and a deferred re-measure
		// must be requested, so a follow-up measurement of the grown height actually reaches the
		// tree instead of being deduped away (which would strand the content until a window resize).
		test('does not strand a grown height first seen while the row is being rendered', () => {
			assert.deepStrictEqual(
				run([
					{ measured: 900, isBeingRendered: true },   // grew mid-render -> suppressed, defer
					{ measured: 900, isBeingRendered: false },  // deferred re-measure delivers the height
				], /*allocatedHeight*/ 500, /*initialStored*/ 500),
				[
					{ kind: 'deferReMeasure', height: 900, stored: 500 },
					{ kind: 'fire', height: 900, stored: 900 },
				],
			);
		});

		test('notifies the tree on async growth and ignores an unchanged measurement', () => {
			assert.deepStrictEqual(
				run([
					{ measured: 700, isBeingRendered: false },  // async growth -> notify
					{ measured: 700, isBeingRendered: false },  // unchanged -> no-op
				], /*allocatedHeight*/ 500, /*initialStored*/ 500),
				[
					{ kind: 'fire', height: 700, stored: 700 },
					{ kind: 'none', height: 700, stored: 700 },
				],
			);
		});

		test('first measurement (no stored height) only schedules an update when content would clip', () => {
			assert.deepStrictEqual([
				// Initial measurement that fits within the allocated height -> no notification.
				run([{ measured: 500, isBeingRendered: false }], /*allocatedHeight*/ 500, /*initialStored*/ undefined),
				// Initial measurement larger than the allocation -> schedule an initial update.
				run([{ measured: 700, isBeingRendered: false }], /*allocatedHeight*/ 500, /*initialStored*/ undefined),
			], [
				[{ kind: 'none', height: 500, stored: 500 }],
				[{ kind: 'scheduleInitial', height: 700, stored: 700 }],
			]);
		});
	});

	suite('shouldHideChatUserIdentity', () => {
		test('hides local Copilot and Agent Host Copilot response identity', () => {
			assert.deepStrictEqual([
				shouldHideChatUserIdentity('GitHub Copilot', URI.from({ scheme: 'vscode-chat-editor' }), true, false, false),
				shouldHideChatUserIdentity('Copilot', URI.from({ scheme: 'agent-host-copilotcli' }), true, false, false),
				shouldHideChatUserIdentity('Copilot', URI.from({ scheme: 'agent-host-copilotcli' }), false, false, false),
				shouldHideChatUserIdentity('Copilot', URI.from({ scheme: 'remote-test-authority-copilotcli' }), true, false, false),
				shouldHideChatUserIdentity('Copilot', URI.from({ scheme: 'remote-test-authority-copilotcli' }), false, false, false),
				shouldHideChatUserIdentity('Claude', URI.from({ scheme: 'remote-test-authority-claude' }), true, false, false),
				shouldHideChatUserIdentity('Claude', URI.from({ scheme: 'agent-host-claude' }), true, false, false),
				shouldHideChatUserIdentity('Claude', URI.from({ scheme: 'agent-host-claude' }), true, true, false),
				shouldHideChatUserIdentity('User', URI.from({ scheme: 'vscode-chat-editor' }), false, false, true),
			], [
				true,
				true,
				false,
				true,
				false,
				false,
				false,
				true,
				true,
			]);
		});
	});

	suite('buildPlanReviewProgressContent', () => {
		test('keeps plan summary and full plan link after approval', () => {
			const content = buildPlanReviewProgressContent({
				kind: 'planReview',
				title: 'Review Plan',
				content: '## Plan summary',
				actions: [{ id: 'interactive', label: 'Implement Plan' }],
				canProvideFeedback: true,
				planUri: URI.file('/sessions/abc/plan.md').toJSON(),
				isUsed: true,
				data: { rejected: false, action: 'Implement Plan', actionId: 'interactive' },
			}, 'Approved plan');

			assert.strictEqual(content.value, 'Approved&nbsp;plan\n\n## Plan summary\n\n[Open full plan file (plan.md)](file:///sessions/abc/plan.md?vscodeLinkType=file)');
		});
	});
});
