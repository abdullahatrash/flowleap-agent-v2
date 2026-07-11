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

/**
 * Type guard for a project-type key. Used to reject stale/unchecked `preselectedType` values that
 * arrive from webview callers so the creation dialog can never render an "undefined" label.
 */
export function isProjectType(value: unknown): value is ProjectType {
	return typeof value === 'string' && Object.prototype.hasOwnProperty.call(PROJECT_TYPE_LABELS, value);
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

interface ProjectRowItem {
	readonly kind: 'project';
	readonly project: PatentProject;
}

interface ArchivedGroupItem {
	readonly kind: 'archivedGroup';
	readonly projects: PatentProject[];
}

interface NewProjectItem {
	readonly kind: 'newProject';
}

type TreeNode = ProjectRowItem | ArchivedGroupItem | NewProjectItem;

/**
 * Native tree for the Projects view. Live projects render as one flat list sorted newest-first;
 * archived projects sit under a single collapsed group at the bottom; a pinned "New Project" row
 * is always visible below everything. Row actions are wired through the extension's commands
 * (`package.json` `view/item/context`).
 */
export class ProjectTreeProvider implements vscode.TreeDataProvider<TreeNode>, vscode.Disposable {
	private readonly _onDidChangeTreeData = new vscode.EventEmitter<TreeNode | undefined | null | void>();
	readonly onDidChangeTreeData: vscode.Event<TreeNode | undefined | null | void> = this._onDidChangeTreeData.event;

	private liveProjects: PatentProject[] = [];
	private archivedProjects: PatentProject[] = [];

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
		this.liveProjects = this.sortByLastOpened(stored.filter(p => !p.archived));
		this.archivedProjects = this.sortByLastOpened(stored.filter(p => p.archived));
	}

	private sortByLastOpened(projects: PatentProject[]): PatentProject[] {
		return [...projects].sort((a, b) => new Date(b.lastAccessed).getTime() - new Date(a.lastAccessed).getTime());
	}

	getTreeItem(element: TreeNode): vscode.TreeItem {
		switch (element.kind) {
			case 'project':
				return this.createProjectItem(element.project);
			case 'archivedGroup':
				return this.createArchivedGroupItem(element);
			case 'newProject':
				return this.createNewProjectItem();
		}
	}

	getChildren(element?: TreeNode): Thenable<TreeNode[]> {
		if (!element) {
			// Empty tree renders the views-welcome content (its own New Project button), so only
			// pin the New Project row once there is at least one project to sit above.
			if (this.liveProjects.length === 0 && this.archivedProjects.length === 0) {
				return Promise.resolve([]);
			}
			const nodes: TreeNode[] = this.liveProjects.map(project => ({ kind: 'project' as const, project }));
			if (this.archivedProjects.length > 0) {
				nodes.push({ kind: 'archivedGroup' as const, projects: this.archivedProjects });
			}
			nodes.push({ kind: 'newProject' as const });
			return Promise.resolve(nodes);
		}
		if (element.kind === 'archivedGroup') {
			return Promise.resolve(element.projects.map(project => ({ kind: 'project' as const, project })));
		}
		return Promise.resolve([]);
	}

	private createArchivedGroupItem(group: ArchivedGroupItem): vscode.TreeItem {
		const item = new vscode.TreeItem(
			`Archived (${group.projects.length})`,
			vscode.TreeItemCollapsibleState.Collapsed
		);
		item.contextValue = 'flowleapProjectGroup';
		return item;
	}

	private createNewProjectItem(): vscode.TreeItem {
		const item = new vscode.TreeItem('New Project', vscode.TreeItemCollapsibleState.None);
		item.iconPath = new vscode.ThemeIcon('add');
		item.contextValue = 'flowleapNewProject';
		item.command = {
			command: 'flowleap.newProject',
			title: 'New Project'
		};
		return item;
	}

	private createProjectItem(project: PatentProject): vscode.TreeItem {
		const item = new vscode.TreeItem(project.name, vscode.TreeItemCollapsibleState.None);
		const display = displayStatusOf(project);

		item.description = this.describe(project, display);

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

	/**
	 * Row description: "Type · Status · age". The status word is omitted for Active (it is the
	 * common case and the timestamp already conveys idleness) and for Archived (the group says it).
	 */
	private describe(project: PatentProject, display: DisplayStatus): string {
		const parts: string[] = [PROJECT_TYPE_LABELS[project.type] ?? project.type];
		if (display !== 'active' && display !== 'archived') {
			parts.push(PROJECT_STATUS_LABELS[display]);
		}
		parts.push(this.shortAge(new Date(project.lastAccessed)));
		return parts.join(' · ');
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
		parts.push(`Last opened: ${lastAccessed.toLocaleString()}`);
		lines.push(parts.join('\n\n'));
		lines.push(project.path);
		return new vscode.MarkdownString(lines.join('\n\n'));
	}

	private shortAge(date: Date): string {
		const diff = Date.now() - date.getTime();
		const minutes = Math.floor(diff / 60000);
		if (minutes < 1) {
			return 'now';
		}
		if (minutes < 60) {
			return `${minutes}m`;
		}
		if (minutes < 60 * 24) {
			return `${Math.floor(minutes / 60)}h`;
		}
		if (minutes < 60 * 24 * 7) {
			return `${Math.floor(minutes / (60 * 24))}d`;
		}
		return `${Math.floor(minutes / (60 * 24 * 7))}w`;
	}
}
