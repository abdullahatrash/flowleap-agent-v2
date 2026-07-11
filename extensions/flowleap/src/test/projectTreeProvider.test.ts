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
	displayStatusOf
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

	test('tree groups projects by status and renders each row shape from the public interface', async () => {
		const projects: PatentProject[] = [
			makeProject({ id: 'a', path: 'a', name: 'Alpha', type: 'patent-analysis', status: 'active' }),
			makeProject({ id: 'b', path: 'b', name: 'Bravo', type: 'prior-art-search', status: 'review' as PatentProject['status'] }),
			makeProject({ id: 'c', path: 'c', name: 'Charlie', type: 'claim-analysis', status: 'complete' }),
			makeProject({ id: 'd', path: 'd', name: 'Delta', type: 'custom', status: 'active', archived: true })
		];
		const provider = new ProjectTreeProvider(makeContext(projects));

		const groups = await provider.getChildren();
		const snapshot = [];
		for (const group of groups) {
			const groupItem = provider.getTreeItem(group);
			const rows = await provider.getChildren(group);
			snapshot.push({
				group: groupItem.label,
				rows: rows.map(row => {
					const item = provider.getTreeItem(row);
					const icon = item.iconPath as vscode.ThemeIcon;
					return {
						label: item.label,
						description: item.description,
						iconId: icon.id,
						iconColor: icon.color?.id,
						contextValue: item.contextValue
					};
				})
			});
		}

		assert.deepStrictEqual(snapshot, [
			{
				group: 'Active (1)',
				rows: [{ label: 'Alpha', description: 'Patent Analysis', iconId: 'circle-filled', iconColor: 'charts.green', contextValue: 'flowleapProject' }]
			},
			{
				group: 'In Review (1)',
				rows: [{ label: 'Bravo', description: 'Prior-Art Search', iconId: 'eye', iconColor: 'charts.yellow', contextValue: 'flowleapProject' }]
			},
			{
				group: 'Complete (1)',
				rows: [{ label: 'Charlie', description: 'Claim Analysis', iconId: 'pass-filled', iconColor: 'charts.blue', contextValue: 'flowleapProject' }]
			},
			{
				group: 'Archived (1)',
				rows: [{ label: 'Delta', description: 'Custom', iconId: 'archive', iconColor: undefined, contextValue: 'flowleapArchivedProject' }]
			}
		]);
	});
});
