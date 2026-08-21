/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { URI } from '../../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../base/test/common/utils.js';
import { buildPlanReviewProgressContent, formatResponseTokenStats, reconcileChatItemHeight, renderChatRequestTimestamp, renderChatResponseDetails, shouldHideChatUserIdentity, shouldRenderInitialProgressiveContentImmediately, shouldScheduleInitialHeightChange } from '../../../browser/widget/chatListRenderer.js';
import { formatChatRequestTimestamp, formatChatResponseDetails, formatElapsedTime } from '../../../common/chatProgressFormatting.js';

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

	suite('formatChatResponseDetails', () => {
		test('formats completion metadata for the footer', () => {
			assert.deepStrictEqual([
				formatChatResponseDetails('GPT-5.6 Sol \u2022 1.5 credits', '4:56 PM'),
				formatChatResponseDetails('GPT-5.6 Sol', undefined),
				formatChatResponseDetails(undefined, '4:56 PM'),
				formatElapsedTime(83_000),
			], [
				'4:56 PM \u2022 GPT-5.6 Sol \u2022 1.5 credits',
				'GPT-5.6 Sol',
				'4:56 PM',
				'1m 23s',
			]);
		});

		test('renders completion time with elapsed-time alternate only in verbose mode', () => {
			const container = document.createElement('div');
			container.className = 'chat-footer-details';
			const completedAt = Date.now() - 60 * 60 * 1000;

			renderChatResponseDetails(container, 'Claude Opus 4.8', completedAt, 24_000, false);
			const compact = {
				text: container.textContent,
				timing: container.querySelector('.chat-response-timing'),
				tabIndex: container.tabIndex,
			};

			renderChatResponseDetails(container, 'Claude Opus 4.8', completedAt, 24_000, true);
			assert.deepStrictEqual({
				compact,
				completionDateTime: container.querySelector('time')?.dateTime,
				hasAlternate: container.querySelector('.chat-response-timing')?.classList.contains('has-alternate'),
				duration: container.querySelector('.chat-response-alternate')?.textContent,
				details: container.querySelector('.chat-response-model-details')?.textContent,
				separatorHidden: container.querySelector('.chat-response-details-separator')?.getAttribute('aria-hidden'),
				ariaIncludesElapsed: container.ariaLabel?.includes('24s') ?? false,
				tabIndex: container.tabIndex,
			}, {
				compact: {
					text: 'Claude Opus 4.8',
					timing: null,
					tabIndex: 0,
				},
				completionDateTime: new Date(completedAt).toISOString(),
				hasAlternate: true,
				duration: '24s',
				details: 'Claude Opus 4.8',
				separatorHidden: 'true',
				ariaIncludesElapsed: true,
				tabIndex: 0,
			});

			renderChatResponseDetails(container, undefined, undefined, 24_000, true);
			assert.deepStrictEqual({
				text: container.textContent,
				timing: container.querySelector('.chat-response-timing'),
				hidden: container.classList.contains('hidden'),
				tabIndex: container.tabIndex,
			}, {
				text: '',
				timing: null,
				hidden: true,
				tabIndex: -1,
			});

			const oldCompletion = Date.now() - 25 * 60 * 60 * 1000;
			renderChatResponseDetails(container, undefined, oldCompletion, 24_000, true);
			assert.deepStrictEqual({
				compact: container.querySelector('.chat-response-completed-at')?.textContent,
				alternateEndsWithElapsed: container.querySelector('.chat-response-alternate')?.textContent?.endsWith(' \u2022 24s'),
				hasAlternate: container.querySelector('.chat-response-timing')?.classList.contains('has-alternate'),
			}, {
				compact: '1 day',
				alternateEndsWithElapsed: true,
				hasAlternate: true,
			});
		});

		test('summarizes per-model token usage for the footer stat hover', () => {
			const stats = formatResponseTokenStats([
				{ model: 'Claude Opus 4.8', inputTokens: 12_400, cachedTokens: 9_000, outputTokens: 830 },
				{ model: 'gpt-5.5', inputTokens: 40, cachedTokens: 0, outputTokens: 12 },
			]);

			assert.deepStrictEqual({ markdown: stats?.markdown.value, ariaLabel: stats?.ariaLabel }, {
				markdown: '**Tokens used this turn**\n\nClaude Opus 4.8 — 12K in, 830 out, 9K cached\n\ngpt-5.5 — 40 in, 12 out\n\n',
				ariaLabel: 'Tokens used this turn. Claude Opus 4.8: 12400 input tokens, 830 output tokens, 9000 cached tokens. gpt-5.5: 40 input tokens, 12 output tokens',
			});
		});

		test('reports no token usage summary when the provider reported none', () => {
			assert.deepStrictEqual([
				formatResponseTokenStats(undefined),
				formatResponseTokenStats([]),
			], [
				undefined,
				undefined,
			]);
		});

		test('folds the token usage summary into the footer accessible name', () => {
			const container = document.createElement('div');
			const withStats = 'Tokens used this turn. gpt-5.5: 40 input tokens, 12 output tokens';

			renderChatResponseDetails(container, 'GPT-5.5 • 2 credits', undefined, undefined, false, withStats);
			const included = container.ariaLabel;

			renderChatResponseDetails(container, 'GPT-5.5 • 2 credits', undefined, undefined, false);
			assert.deepStrictEqual({ included, omitted: container.ariaLabel }, {
				included: `GPT-5.5 • 2 credits, ${withStats}`,
				omitted: 'GPT-5.5 • 2 credits',
			});
		});
	});

	suite('formatChatRequestTimestamp', () => {
		test('formats valid persisted timestamps and rejects legacy placeholders', () => {
			const timestamp = Date.UTC(2026, 6, 8, 23, 18, 41);
			const formatted = formatChatRequestTimestamp(timestamp);
			assert.deepStrictEqual({
				hasText: !!formatted?.text,
				hasFullText: !!formatted?.fullText,
				dateTime: formatted?.dateTime,
				invalid: formatChatRequestTimestamp(-1),
			}, {
				hasText: true,
				hasFullText: true,
				dateTime: '2026-07-08T23:18:41.000Z',
				invalid: undefined,
			});
		});

		test('uses relative days after 24 hours', () => {
			assert.deepStrictEqual([
				formatChatRequestTimestamp(Date.now() - 25 * 60 * 60 * 1000)?.text,
				formatChatRequestTimestamp(Date.now() - 49 * 60 * 60 * 1000)?.text,
			], [
				'1 day',
				'2 days',
			]);
		});

		test('renders compact days with an animated full date alternate', () => {
			const container = document.createElement('div');
			const timestamp = Date.now() - 25 * 60 * 60 * 1000;

			const rendered = renderChatRequestTimestamp(container, timestamp);

			assert.deepStrictEqual({
				compact: container.querySelector('.chat-request-relative')?.textContent,
				fullDate: container.querySelector('.chat-request-full-date')?.textContent,
				hasAlternate: container.querySelector('.chat-request-timing')?.classList.contains('has-alternate'),
				focusable: rendered?.element.tabIndex,
				managedHoverText: rendered?.hoverText,
			}, {
				compact: '1 day',
				fullDate: formatChatRequestTimestamp(timestamp)?.fullText,
				hasAlternate: true,
				focusable: 0,
				managedHoverText: undefined,
			});
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
