/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { SessionStatus } from '../../../../services/sessions/common/session.js';
import { SessionsGrouping, SessionsList, SessionsSorting } from '../../browser/views/sessionsList.js';
import { createListHarness, createTestSession } from './sessionsListTestUtils.js';

suite('Sessions list density', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	/**
	 * Builds a list over the given sessions whose compact state the caller can flip
	 * between renders, the way the view's Compact View action does.
	 *
	 * Grouped by date on purpose: the workspace badge is suppressed when the list is
	 * already sectioned by workspace, and the badge is what moves between the row
	 * and the hover slot.
	 */
	function createList(sessions: ReturnType<typeof createTestSession>[], compact: boolean) {
		const harness = createListHarness(disposables, sessions.map(s => s.session));
		const container = harness.createContainer();
		const state = { compact };
		const list = harness.store.add(harness.instantiationService.createInstance(SessionsList, container, {
			grouping: () => SessionsGrouping.Date,
			sorting: () => SessionsSorting.Created,
			compact: () => state.compact,
			onSessionOpen: () => { },
		}));
		list.layout(500, 400);
		return { harness, container, list, state };
	}

	function readRow(container: HTMLElement, list: SessionsList) {
		const item = container.querySelector<HTMLElement>('.session-item');
		const row = item?.closest<HTMLElement>('.monaco-list-row');
		assert.ok(item, 'expected a session row to render');
		assert.ok(row, 'expected the session row to sit in a list row');
		return {
			compactClass: list.element.classList.contains('compact'),
			insetRowClass: row.classList.contains('session-list-inset-row'),
			height: row.style.height,
			workspaceOnRow: item.querySelector('.session-details-row .session-badge')?.textContent ?? undefined,
			workspaceOnHover: item.querySelector('.session-compact-hover-description .session-badge')?.textContent ?? undefined,
			diff: item.querySelector('.session-diff')?.textContent ?? undefined,
			time: item.querySelector('.session-time')?.textContent ?? undefined,
		};
	}

	test('a compact row is title-only and carries its workspace on the hover slot', () => {
		const session = createTestSession('Implement compact view', {
			workspaceLabel: 'flowleap',
			changesSummary: { files: 2, additions: 12, deletions: 3 },
		});
		const { container, list, state } = createList([session], true);

		const compact = readRow(container, list);
		state.compact = false;
		list.setCompact();
		const standard = readRow(container, list);

		assert.deepStrictEqual({ compact, standard }, {
			compact: {
				compactClass: true,
				insetRowClass: true,
				// 28px compact row plus the 2px inset gap.
				height: '30px',
				workspaceOnRow: undefined,
				workspaceOnHover: 'flowleap',
				diff: undefined,
				time: undefined,
			},
			standard: {
				compactClass: false,
				insetRowClass: true,
				// 54px default row plus the 2px inset gap.
				height: '56px',
				workspaceOnRow: 'flowleap',
				workspaceOnHover: undefined,
				diff: '+12-3',
				time: 'now',
			},
		});
	});

	test('the diff stats come from the aggregate summary alone', () => {
		// The provider published no per-file changes, only the aggregate. Before the
		// summary-first reader this row and the hover both showed nothing.
		const session = createTestSession('Summary only', {
			changesSummary: { files: 4, additions: 40, deletions: 9 },
		});
		const { container, list } = createList([session], false);

		assert.strictEqual(readRow(container, list).diff, '+40-9');
	});

	test('a compact row waiting on the user gets a callout instead of the details row', () => {
		const needsInput = createTestSession('Waiting on you');
		const { container, list, state } = createList([needsInput], true);
		needsInput.status.set(SessionStatus.NeedsInput, undefined);

		const read = () => {
			const item = container.querySelector<HTMLElement>('.session-item');
			assert.ok(item);
			const row = item.closest<HTMLElement>('.monaco-list-row');
			assert.ok(row);
			return {
				visible: !!item.querySelector('.session-input-needed-row.visible'),
				label: item.querySelector('.session-input-needed-label')?.textContent ?? undefined,
				height: row.style.height,
			};
		};

		const compact = read();
		state.compact = false;
		list.setCompact();
		const standard = read();

		assert.deepStrictEqual({ compact, standard }, {
			// 28px compact row, 32px callout, 2px inset gap.
			compact: { visible: true, label: 'Input needed', height: '62px' },
			// The details row carries the status at the default density, so no callout.
			standard: { visible: false, label: '', height: '56px' },
		});
	});
});
