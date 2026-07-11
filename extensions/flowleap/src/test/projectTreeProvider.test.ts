/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'mocha';
import * as assert from 'assert';
import * as vscode from 'vscode';
import {
	ProjectTreeProvider,
	PatentProject,
	DisplayStatus,
	mapLegacyStatus,
	displayStatusOf,
	isProjectType
} from '../projectSidebar/projectTreeProvider';

suite('ProjectTreeProvider', () => {

	function makeContext(projects: PatentProject[]): vscode.ExtensionContext {
		const globalState = {
			get: (key: string, defaultValue: unknown) => key === 'flowleap.projects' ? projects : defaultValue
		};
		return { globalState } as unknown as vscode.ExtensionContext;
	}

	function makeProject(overrides: Partial<PatentProject>): PatentProject {
		return {
			id: '/p',
			name: 'Project',
			path: '/p',
			type: 'custom',
			status: 'active',
			tags: [],
			archived: false,
			lastAccessed: new Date('2026-07-11T09:00:00Z'),
			created: '2026-07-01T00:00:00Z',
			...overrides
		};
	}

	// Reduce a rendered tree item to a stable snapshot. The volatile "age" tail of a project
	// description is stripped so the assertion does not depend on wall-clock time.
	function snapshot(item: vscode.TreeItem): Record<string, unknown> {
		const icon = item.iconPath as vscode.ThemeIcon | undefined;
		switch (item.contextValue) {
			case 'flowleapProject':
			case 'flowleapArchivedProject':
				return {
					kind: 'project',
					label: item.label,
					description: String(item.description).replace(/ · (now|\d+[mhdw])$/, ''),
					iconId: icon?.id,
					iconColor: icon?.color?.id,
					contextValue: item.contextValue
				};
			case 'flowleapProjectGroup':
				return {
					kind: 'group',
					label: item.label,
					collapsed: item.collapsibleState === vscode.TreeItemCollapsibleState.Collapsed
				};
			case 'flowleapNewProject':
				return { kind: 'action', label: item.label, iconId: icon?.id, command: item.command?.command };
			default:
				return { kind: 'unknown', label: item.label };
		}
	}

	test('mapLegacyStatus collapses every stored value onto the ratified set', () => {
		const cases = ['active', 'in-review', 'complete', 'draft', 'in-progress', 'review', 'unknown', undefined];
		const actual = Object.fromEntries(cases.map(value => [String(value), mapLegacyStatus(value)]));
		assert.deepStrictEqual(actual, {
			'active': 'active',
			'in-review': 'in-review',
			'complete': 'complete',
			'draft': 'active',
			'in-progress': 'active',
			'review': 'in-review',
			'unknown': 'active',
			'undefined': 'active'
		});
	});

	test('displayStatusOf lets the archived flag win over the working status', () => {
		const actual: Record<string, DisplayStatus> = {
			'active-live': displayStatusOf({ status: 'active', archived: false }),
			'review-live': displayStatusOf({ status: 'in-review', archived: false }),
			'complete-live': displayStatusOf({ status: 'complete', archived: false }),
			'legacy-draft-live': displayStatusOf({ status: 'draft' as PatentProject['status'], archived: false }),
			'active-archived': displayStatusOf({ status: 'active', archived: true })
		};
		assert.deepStrictEqual(actual, {
			'active-live': 'active',
			'review-live': 'in-review',
			'complete-live': 'complete',
			'legacy-draft-live': 'active',
			'active-archived': 'archived'
		});
	});

	test('isProjectType accepts only real type keys and rejects stale/non-string values', () => {
		const cases: unknown[] = ['patent-analysis', 'custom', 'freedom-to-operate', 'prior-art', '', 'undefined', undefined, 42, {}];
		assert.deepStrictEqual(cases.map(isProjectType), [true, true, true, false, false, false, false, false, false]);
	});

	test('tree renders a flat list sorted by last-opened, an archived group, and a pinned New Project row', async () => {
		const projects: PatentProject[] = [
			makeProject({ id: 'b', path: 'b', name: 'Bravo', type: 'prior-art-search', status: 'review' as PatentProject['status'], lastAccessed: new Date('2026-07-10T00:00:00Z') }),
			makeProject({ id: 'a', path: 'a', name: 'Alpha', type: 'patent-analysis', status: 'active', lastAccessed: new Date('2026-07-11T09:00:00Z') }),
			makeProject({ id: 'c', path: 'c', name: 'Charlie', type: 'claim-analysis', status: 'complete', lastAccessed: new Date('2026-07-11T08:00:00Z') }),
			makeProject({ id: 'd', path: 'd', name: 'Delta', type: 'custom', status: 'active', archived: true, lastAccessed: new Date('2026-07-05T00:00:00Z') })
		];
		const provider = new ProjectTreeProvider(makeContext(projects));

		const root = await provider.getChildren();
		const rootShape = root.map(node => snapshot(provider.getTreeItem(node)));

		assert.deepStrictEqual(rootShape, [
			{ kind: 'project', label: 'Alpha', description: 'Patent Analysis', iconId: 'circle-filled', iconColor: 'charts.green', contextValue: 'flowleapProject' },
			{ kind: 'project', label: 'Charlie', description: 'Claim Analysis · Complete', iconId: 'pass-filled', iconColor: 'charts.blue', contextValue: 'flowleapProject' },
			{ kind: 'project', label: 'Bravo', description: 'Prior-Art Search · In Review', iconId: 'eye', iconColor: 'charts.yellow', contextValue: 'flowleapProject' },
			{ kind: 'group', label: 'Archived (1)', collapsed: true },
			{ kind: 'action', label: 'New Project', iconId: 'add', command: 'flowleap.newProject' }
		]);

		const archivedGroup = root.find(node => provider.getTreeItem(node).contextValue === 'flowleapProjectGroup')!;
		const archivedRows = await provider.getChildren(archivedGroup);
		assert.deepStrictEqual(archivedRows.map(node => snapshot(provider.getTreeItem(node))), [
			{ kind: 'project', label: 'Delta', description: 'Custom', iconId: 'archive', iconColor: undefined, contextValue: 'flowleapArchivedProject' }
		]);
	});
});
