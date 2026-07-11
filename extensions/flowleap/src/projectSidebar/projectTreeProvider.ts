/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

/**
 * The investigation kind a Patent Project was created as. Organizational label and
 * notes-template seed only — it does not change agent behavior (see CONTEXT.md glossary).
 */
export type ProjectType =
	| 'patent-analysis'
	| 'prior-art-search'
	| 'freedom-to-operate'
	| 'patent-landscape'
	| 'claim-analysis'
	| 'custom';

/**
 * The working lifecycle state of a Patent Project. "Archived" is a fourth display state
 * but is persisted through the separate `archived` flag (see {@link DisplayStatus}).
 */
export type ProjectStatus = 'active' | 'in-review' | 'complete';

/**
 * The four statuses a project can be grouped under in the tree. Equal to the three working
 * {@link ProjectStatus} values plus "archived", which is derived from the `archived` flag.
 */
export type DisplayStatus = ProjectStatus | 'archived';

export interface PatentProject {
	id: string;
	name: string;
	path: string;
	type: ProjectType;
	status: ProjectStatus;
	tags: string[];
	archived: boolean;
	lastAccessed: Date;
	created: string;
}

/** Human-readable label for each project type, shown as the tree row's description. */
export const PROJECT_TYPE_LABELS: Record<ProjectType, string> = {
	'patent-analysis': 'Patent Analysis',
	'prior-art-search': 'Prior-Art Search',
	'freedom-to-operate': 'Freedom-to-Operate',
	'patent-landscape': 'Patent Landscape',
	'claim-analysis': 'Claim Analysis',
	'custom': 'Custom'
};

/** Human-readable label for each of the four display statuses. */
export const PROJECT_STATUS_LABELS: Record<DisplayStatus, string> = {
	'active': 'Active',
	'in-review': 'In Review',
	'complete': 'Complete',
	'archived': 'Archived'
};

/**
 * Map a stored status value onto the ratified working-status set. Legacy projects were written
 * with `draft` / `in-progress` / `review`; those are collapsed onto the current vocabulary
 * (CONTEXT.md: "draft" describes documents, not investigations). Pure function — callers rewrite
 * the stored value lazily on the next write, there is no mass migration.
 */
export function mapLegacyStatus(raw: string | undefined): ProjectStatus {
	switch (raw) {
		case 'active':
			return 'active';
		case 'in-review':
			return 'in-review';
		case 'complete':
			return 'complete';
		// Legacy values.
		case 'draft':
		case 'in-progress':
			return 'active';
		case 'review':
			return 'in-review';
		default:
			return 'active';
	}
}

/** The display group a project belongs to: "archived" wins over its working status. */
export function displayStatusOf(project: Pick<PatentProject, 'status' | 'archived'>): DisplayStatus {
	if (project.archived) {
		return 'archived';
	}
	return mapLegacyStatus(project.status);
}

interface StatusIconSpec {
	readonly icon: string;
	readonly color?: string;
}

/** One clear theme icon per display status — no faded dots, no group-header duplication. */
const STATUS_ICONS: Record<DisplayStatus, StatusIconSpec> = {
	'active': { icon: 'circle-filled', color: 'charts.green' },
	'in-review': { icon: 'eye', color: 'charts.yellow' },
	'complete': { icon: 'pass-filled', color: 'charts.blue' },
	'archived': { icon: 'archive' }
};

/** Fixed top-to-bottom order of the status groups in the tree. */
const STATUS_ORDER: readonly DisplayStatus[] = ['active', 'in-review', 'complete', 'archived'];

const MAX_ROWS_PER_GROUP = 10;

interface ProjectGroupItem {
	readonly kind: 'group';
	readonly id: DisplayStatus;
	readonly projects: PatentProject[];
}

interface ProjectRowItem {
	readonly kind: 'project';
	readonly project: PatentProject;
}

interface MoreItem {
	readonly kind: 'more';
	readonly groupId: DisplayStatus;
}

type TreeNode = ProjectGroupItem | ProjectRowItem | MoreItem;

/**
 * Native tree for the Projects view. Groups stored projects under the four ratified statuses,
 * renders the project type as the row description, and exposes inline / context-menu actions
 * through the extension's commands (wired in `package.json` `view/item/context`).
 */
export class ProjectTreeProvider implements vscode.TreeDataProvider<TreeNode>, vscode.Disposable {
	private readonly _onDidChangeTreeData = new vscode.EventEmitter<TreeNode | undefined | null | void>();
	readonly onDidChangeTreeData: vscode.Event<TreeNode | undefined | null | void> = this._onDidChangeTreeData.event;

	private groups: ProjectGroupItem[] = [];
	private readonly expandedGroups: Set<DisplayStatus> = new Set(['active', 'in-review', 'complete']);

	constructor(private readonly context: vscode.ExtensionContext) {
		this.loadProjects();
	}

	refresh(): void {
		this.loadProjects();
		this._onDidChangeTreeData.fire();
	}

	dispose(): void {
		this._onDidChangeTreeData.dispose();
	}

	private loadProjects(): void {
		const stored = this.context.globalState.get<PatentProject[]>('flowleap.projects', []);
		this.groups = STATUS_ORDER
			.map(id => ({
				kind: 'group' as const,
				id,
				projects: stored.filter(p => displayStatusOf(p) === id)
			}))
			.filter(group => group.projects.length > 0);
	}

	getTreeItem(element: TreeNode): vscode.TreeItem {
		switch (element.kind) {
			case 'group':
				return this.createGroupItem(element);
			case 'more':
				return this.createMoreItem(element);
			case 'project':
				return this.createProjectItem(element.project);
		}
	}

	getChildren(element?: TreeNode): Thenable<TreeNode[]> {
		if (!element) {
			return Promise.resolve(this.groups);
		}
		if (element.kind === 'group') {
			const rows: TreeNode[] = element.projects
				.slice(0, MAX_ROWS_PER_GROUP)
				.map(project => ({ kind: 'project' as const, project }));
			if (element.projects.length > MAX_ROWS_PER_GROUP) {
				rows.push({ kind: 'more' as const, groupId: element.id });
			}
			return Promise.resolve(rows);
		}
		return Promise.resolve([]);
	}

	private createGroupItem(group: ProjectGroupItem): vscode.TreeItem {
		const label = `${PROJECT_STATUS_LABELS[group.id]} (${group.projects.length})`;
		const item = new vscode.TreeItem(
			label,
			this.expandedGroups.has(group.id)
				? vscode.TreeItemCollapsibleState.Expanded
				: vscode.TreeItemCollapsibleState.Collapsed
		);
		item.contextValue = 'flowleapProjectGroup';
		return item;
	}

	private createMoreItem(element: MoreItem): vscode.TreeItem {
		const item = new vscode.TreeItem('More…', vscode.TreeItemCollapsibleState.None);
		item.iconPath = new vscode.ThemeIcon('ellipsis');
		item.contextValue = 'flowleapMore';
		item.command = {
			command: 'flowleap.showAllProjects',
			title: 'Show All Projects',
			arguments: [element.groupId]
		};
		return item;
	}

	private createProjectItem(project: PatentProject): vscode.TreeItem {
		const item = new vscode.TreeItem(project.name, vscode.TreeItemCollapsibleState.None);
		const display = displayStatusOf(project);

		item.description = PROJECT_TYPE_LABELS[project.type] ?? '';

		const statusIcon = STATUS_ICONS[display];
		item.iconPath = new vscode.ThemeIcon(
			statusIcon.icon,
			statusIcon.color ? new vscode.ThemeColor(statusIcon.color) : undefined
		);

		item.tooltip = this.createTooltip(project, display);
		item.contextValue = project.archived ? 'flowleapArchivedProject' : 'flowleapProject';
		item.command = {
			command: 'flowleap.openProject',
			title: 'Open Project',
			arguments: [project]
		};

		return item;
	}

	private createTooltip(project: PatentProject, display: DisplayStatus): vscode.MarkdownString {
		const lines: string[] = [`**${project.name}**`];
		const parts: string[] = [
			`Type: ${PROJECT_TYPE_LABELS[project.type] ?? project.type}`,
			`Status: ${PROJECT_STATUS_LABELS[display]}`
		];
		if (project.tags?.length) {
			parts.push(`Tags: ${project.tags.join(', ')}`);
		}
		const lastAccessed = new Date(project.lastAccessed);
		parts.push(`Last opened: ${this.getTimeAgo(lastAccessed)} (${lastAccessed.toLocaleString()})`);
		lines.push(parts.join('\n\n'));
		lines.push(project.path);
		return new vscode.MarkdownString(lines.join('\n\n'));
	}

	private getTimeAgo(date: Date): string {
		const diff = Date.now() - date.getTime();
		const minutes = Math.floor(diff / 60000);
		if (minutes < 1) {
			return 'just now';
		}
		if (minutes < 60) {
			return `${minutes}m ago`;
		}
		if (minutes < 60 * 24) {
			return `${Math.floor(minutes / 60)}h ago`;
		}
		if (minutes < 60 * 24 * 7) {
			return `${Math.floor(minutes / (60 * 24))}d ago`;
		}
		return `${Math.floor(minutes / (60 * 24 * 7))}w ago`;
	}
}
