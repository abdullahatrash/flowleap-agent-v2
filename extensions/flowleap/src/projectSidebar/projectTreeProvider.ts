/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

export type ProjectType = 'patent-analysis' | 'prior-art-search' | 'custom';
export type ProjectStatus = 'draft' | 'in-progress' | 'review' | 'complete';

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

export interface ProjectGroup {
	id: string;
	name: string;
	projects: PatentProject[];
	collapsed?: boolean;
}

type TreeItem = ProjectGroup | PatentProject | { type: 'more'; groupId: string };

export class ProjectTreeProvider implements vscode.TreeDataProvider<TreeItem> {
	private _onDidChangeTreeData: vscode.EventEmitter<TreeItem | undefined | null | void> = new vscode.EventEmitter<TreeItem | undefined | null | void>();
	readonly onDidChangeTreeData: vscode.Event<TreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

	private projectGroups: ProjectGroup[] = [];
	private expandedGroups: Set<string> = new Set(['in-progress', 'draft']);

	constructor(private readonly context: vscode.ExtensionContext) {
		this.loadProjects();
	}

	refresh(): void {
		this.loadProjects();
		this._onDidChangeTreeData.fire();
	}

	private async loadProjects(): Promise<void> {
		const storedProjects = this.context.globalState.get<PatentProject[]>('flowleap.projects', []);

		const active = storedProjects.filter(p => !p.archived && p.status === 'in-progress');
		const review = storedProjects.filter(p => !p.archived && p.status === 'review');
		const draft = storedProjects.filter(p => !p.archived && p.status === 'draft');
		const complete = storedProjects.filter(p => !p.archived && p.status === 'complete');
		const archived = storedProjects.filter(p => p.archived);

		this.projectGroups = [
			{ id: 'in-progress', name: 'IN PROGRESS', projects: active },
			{ id: 'review', name: 'UNDER REVIEW', projects: review },
			{ id: 'draft', name: 'DRAFT', projects: draft },
			{ id: 'complete', name: 'COMPLETE', projects: complete },
			{ id: 'archived', name: 'ARCHIVED', projects: archived },
		].filter(g => g.projects.length > 0);
	}

	getTreeItem(element: TreeItem): vscode.TreeItem {
		if ('projects' in element) {
			const group = element as ProjectGroup;
			const item = new vscode.TreeItem(
				`${group.name} (${group.projects.length})`,
				this.expandedGroups.has(group.id)
					? vscode.TreeItemCollapsibleState.Expanded
					: vscode.TreeItemCollapsibleState.Collapsed
			);
			item.contextValue = 'projectGroup';
			return item;
		} else if ('type' in element && (element as any).type === 'more') {
			const item = new vscode.TreeItem('More...', vscode.TreeItemCollapsibleState.None);
			item.command = {
				command: 'flowleap.showAllProjects',
				title: 'Show All Projects',
				arguments: [(element as any).groupId]
			};
			item.iconPath = new vscode.ThemeIcon('ellipsis');
			item.contextValue = 'more';
			return item;
		} else {
			const project = element as PatentProject;
			const item = new vscode.TreeItem(project.name, vscode.TreeItemCollapsibleState.None);

			const typeLabels: Record<string, string> = {
				'patent-analysis': 'Patent',
				'prior-art-search': 'Prior Art',
				'custom': 'Custom'
			};

			const parts: string[] = [];
			if (project.type && typeLabels[project.type]) {
				parts.push(typeLabels[project.type]);
			}
			if (project.tags?.length) {
				parts.push(project.tags.slice(0, 2).join(', '));
			}
			item.description = parts.join(' · ') || this.getTimeAgo(project.lastAccessed);

			const statusIcons: Record<string, string> = {
				'draft': 'circle-outline',
				'in-progress': 'circle-filled',
				'review': 'eye',
				'complete': 'check'
			};
			const statusColors: Record<string, string> = {
				'draft': 'foreground',
				'in-progress': 'charts.green',
				'review': 'editorWarning.foreground',
				'complete': 'charts.blue'
			};

			item.iconPath = new vscode.ThemeIcon(
				statusIcons[project.status] ?? 'circle-outline',
				new vscode.ThemeColor(statusColors[project.status] ?? 'foreground')
			);

			const tooltipLines = [`**${project.name}**`];
			if (project.type) {
				tooltipLines.push(`Type: ${typeLabels[project.type] ?? project.type}`);
			}
			tooltipLines.push(`Status: ${project.status}`);
			if (project.tags?.length) {
				tooltipLines.push(`Tags: ${project.tags.join(', ')}`);
			}
			tooltipLines.push(`\n${project.path}`);
			item.tooltip = new vscode.MarkdownString(tooltipLines.join('\n\n'));

			item.contextValue = project.archived ? 'archivedProject' : 'project';

			item.command = {
				command: 'flowleap.openProject',
				title: 'Open Project',
				arguments: [project]
			};

			return item;
		}
	}

	getChildren(element?: TreeItem): Thenable<TreeItem[]> {
		if (!element) {
			return Promise.resolve(this.projectGroups);
		}

		if ('projects' in element) {
			const group = element as ProjectGroup;
			const projects = group.projects.slice(0, 10);

			if (group.projects.length > 10) {
				return Promise.resolve([
					...projects,
					{ type: 'more' as const, groupId: group.id }
				]);
			}

			return Promise.resolve(projects);
		}

		return Promise.resolve([]);
	}

	private getTimeAgo(date: Date): string {
		const now = new Date();
		const diff = now.getTime() - new Date(date).getTime();
		const minutes = Math.floor(diff / 60000);

		if (minutes < 1) return 'now';
		if (minutes < 60) return `${minutes}m`;
		if (minutes < 60 * 24) return `${Math.floor(minutes / 60)}h`;
		if (minutes < 60 * 24 * 7) return `${Math.floor(minutes / (60 * 24))}d`;
		return `${Math.floor(minutes / (60 * 24 * 7))}w`;
	}
}

export class ProjectSidebarViewProvider implements vscode.WebviewViewProvider {
	public static readonly viewType = 'flowleap.projectSidebar';

	private _view?: vscode.WebviewView;

	constructor(
		private readonly _extensionUri: vscode.Uri,
		private readonly _context: vscode.ExtensionContext
	) { }

	public resolveWebviewView(
		webviewView: vscode.WebviewView,
		_context: vscode.WebviewViewResolveContext,
		_token: vscode.CancellationToken,
	) {
		this._view = webviewView;

		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [this._extensionUri]
		};

		webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);
		this._sendProjectData();

		webviewView.webview.onDidReceiveMessage(async data => {
			switch (data.type) {
				case 'openProject':
					if (data.path) {
						await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(data.path), { forceNewWindow: false });
					}
					break;
				case 'newProject':
					vscode.commands.executeCommand('flowleap.newProject');
					break;
				case 'setStatus':
					vscode.commands.executeCommand('flowleap.setProjectStatus', data.path);
					break;
				case 'addTag':
					vscode.commands.executeCommand('flowleap.addTag', data.path);
					break;
				case 'openNotes':
					vscode.commands.executeCommand('flowleap.openNotes', data.path);
					break;
				case 'archive':
					vscode.commands.executeCommand('flowleap.archiveProject', data.path);
					break;
				case 'unarchive':
					vscode.commands.executeCommand('flowleap.unarchiveProject', data.path);
					break;
				case 'requestProjects':
					this._sendProjectData();
					break;
			}
		});
	}

	public refresh(): void {
		this._sendProjectData();
	}

	private async _sendProjectData(): Promise<void> {
		if (!this._view) {
			return;
		}

		const projects = await this._getProjects();
		this._view.webview.postMessage({
			type: 'projectsData',
			projects
		});
	}

	private async _getProjects(): Promise<SidebarProject[]> {
		const storedProjects = this._context.globalState.get<PatentProject[]>('flowleap.projects', []);
		const projects: SidebarProject[] = [];

		const typeLabels: Record<string, string> = {
			'patent-analysis': 'Patent',
			'prior-art-search': 'Prior Art',
			'custom': 'Custom'
		};

		for (const p of storedProjects) {
			projects.push({
				name: p.name,
				path: p.path,
				type: p.type,
				typeLabel: typeLabels[p.type] ?? '',
				status: p.status ?? 'draft',
				tags: p.tags ?? [],
				archived: p.archived ?? false,
				time: this._getTimeAgo(new Date(p.lastAccessed))
			});
		}

		return projects;
	}

	private _getTimeAgo(date: Date): string {
		const now = new Date();
		const diff = now.getTime() - date.getTime();
		const minutes = Math.floor(diff / 60000);

		if (minutes < 1) return 'now';
		if (minutes < 60) return `${minutes}m`;
		if (minutes < 60 * 24) return `${Math.floor(minutes / 60)}h`;
		if (minutes < 60 * 24 * 7) return `${Math.floor(minutes / (60 * 24))}d`;
		return `${Math.floor(minutes / (60 * 24 * 7))}w`;
	}

	private _getHtmlForWebview(webview: vscode.Webview) {
		const nonce = getNonce();

		return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<style>
		:root {
			--bg: var(--vscode-sideBar-background);
			--card: var(--vscode-list-hoverBackground);
			--text: var(--vscode-foreground);
			--text-muted: var(--vscode-descriptionForeground);
			--accent: var(--vscode-focusBorder);
			--green: var(--vscode-testing-iconPassed, #22c55e);
			--yellow: var(--vscode-editorWarning-foreground, #f59e0b);
			--blue: var(--vscode-textLink-foreground, #3b82f6);
			--border: var(--vscode-panel-border, transparent);
		}

		body {
			padding: 8px;
			font-family: var(--vscode-font-family);
			font-size: var(--vscode-font-size);
			color: var(--text);
		}

		/* Filter bar */
		.filter-bar {
			display: flex;
			gap: 6px;
			margin-bottom: 10px;
		}

		.filter-input {
			flex: 1;
			background: var(--vscode-input-background);
			border: 1px solid var(--vscode-input-border, transparent);
			border-radius: 4px;
			padding: 5px 8px;
			font-size: 12px;
			color: var(--text);
			outline: none;
		}

		.filter-input:focus {
			border-color: var(--accent);
		}

		.filter-input::placeholder {
			color: var(--text-muted);
		}

		/* Status group */
		.group-header {
			font-size: 10px;
			font-weight: 600;
			text-transform: uppercase;
			letter-spacing: 0.06em;
			color: var(--text-muted);
			margin: 12px 0 6px 0;
			cursor: pointer;
			display: flex;
			align-items: center;
			gap: 4px;
			user-select: none;
		}

		.group-header:first-child {
			margin-top: 0;
		}

		.group-count {
			opacity: 0.6;
		}

		.group-chevron {
			font-size: 9px;
			transition: transform 0.15s;
		}

		.group-chevron.collapsed {
			transform: rotate(-90deg);
		}

		/* Project card */
		.project-card {
			display: flex;
			align-items: flex-start;
			gap: 10px;
			padding: 8px 10px;
			border-radius: 6px;
			cursor: pointer;
			margin-bottom: 2px;
			transition: background 0.12s;
			position: relative;
		}

		.project-card:hover {
			background: var(--card);
		}

		.status-dot {
			width: 8px;
			height: 8px;
			border-radius: 50%;
			flex-shrink: 0;
			margin-top: 5px;
		}

		.status-dot.draft { background: var(--text-muted); opacity: 0.5; }
		.status-dot.in-progress { background: var(--green); }
		.status-dot.review { background: var(--yellow); }
		.status-dot.complete { background: var(--blue); }

		.project-info {
			flex: 1;
			min-width: 0;
		}

		.project-name {
			font-size: 13px;
			font-weight: 500;
			white-space: nowrap;
			overflow: hidden;
			text-overflow: ellipsis;
		}

		.project-meta {
			display: flex;
			align-items: center;
			gap: 6px;
			margin-top: 2px;
			flex-wrap: wrap;
		}

		.type-label {
			font-size: 10px;
			color: var(--accent);
			opacity: 0.8;
		}

		.tag-pill {
			font-size: 10px;
			color: var(--text-muted);
			background: color-mix(in srgb, var(--text-muted) 12%, transparent);
			padding: 0 5px;
			border-radius: 3px;
		}

		.project-time {
			font-size: 11px;
			color: var(--text-muted);
			flex-shrink: 0;
			margin-top: 3px;
		}

		/* Context actions on hover */
		.project-actions {
			position: absolute;
			right: 6px;
			top: 6px;
			display: none;
			gap: 2px;
		}

		.project-card:hover .project-actions {
			display: flex;
		}

		.project-card:hover .project-time {
			display: none;
		}

		.action-btn {
			background: var(--card);
			border: 1px solid var(--border);
			border-radius: 4px;
			color: var(--text-muted);
			cursor: pointer;
			padding: 2px 5px;
			font-size: 11px;
			line-height: 1;
		}

		.action-btn:hover {
			color: var(--text);
			border-color: var(--accent);
		}

		/* New project button */
		.new-project-btn {
			display: flex;
			align-items: center;
			justify-content: center;
			gap: 6px;
			width: 100%;
			padding: 8px;
			margin-top: 12px;
			background: var(--accent);
			color: white;
			border: none;
			border-radius: 6px;
			cursor: pointer;
			font-size: 12px;
			font-family: inherit;
		}

		.new-project-btn:hover {
			opacity: 0.9;
		}

		/* Empty state */
		.empty-state {
			text-align: center;
			padding: 20px;
			color: var(--text-muted);
			font-size: 12px;
			line-height: 1.5;
		}

		.hidden { display: none !important; }
	</style>
</head>
<body>
	<div class="filter-bar">
		<input class="filter-input" id="filter" type="text" placeholder="Filter projects..." />
	</div>

	<div id="projects-container">
		<div class="empty-state">Loading projects...</div>
	</div>

	<button class="new-project-btn" id="new-project-btn">
		<span>+</span> New Project
	</button>

	<script nonce="${nonce}">
		const vscode = acquireVsCodeApi();
		let allProjects = [];
		let filterText = '';

		const STATUS_ORDER = ['in-progress', 'review', 'draft', 'complete', 'archived'];
		const STATUS_LABELS = {
			'in-progress': 'IN PROGRESS',
			'review': 'UNDER REVIEW',
			'draft': 'DRAFT',
			'complete': 'COMPLETE',
			'archived': 'ARCHIVED'
		};

		const collapsedGroups = new Set(['archived']);

		function escapeHtml(text) {
			const div = document.createElement('div');
			div.textContent = text;
			return div.innerHTML;
		}

		function matchesFilter(project) {
			if (!filterText) return true;
			const q = filterText.toLowerCase();
			if (project.name.toLowerCase().includes(q)) return true;
			if (project.typeLabel && project.typeLabel.toLowerCase().includes(q)) return true;
			if (project.tags && project.tags.some(t => t.toLowerCase().includes(q))) return true;

			// Support tag: prefix
			if (q.startsWith('tag:')) {
				const tagQuery = q.slice(4).trim();
				return project.tags && project.tags.some(t => t.toLowerCase().includes(tagQuery));
			}
			return false;
		}

		function render() {
			const container = document.getElementById('projects-container');
			const filtered = allProjects.filter(matchesFilter);

			if (filtered.length === 0) {
				container.innerHTML = '<div class="empty-state">' +
					(allProjects.length === 0
						? 'No projects yet.<br>Create your first project!'
						: 'No matching projects') +
					'</div>';
				return;
			}

			// Group by status
			const groups = {};
			for (const p of filtered) {
				const key = p.archived ? 'archived' : (p.status || 'draft');
				if (!groups[key]) groups[key] = [];
				groups[key].push(p);
			}

			let html = '';
			for (const status of STATUS_ORDER) {
				const projects = groups[status];
				if (!projects || projects.length === 0) continue;

				const isCollapsed = collapsedGroups.has(status);
				html += '<div class="group-header" data-group="' + status + '">';
				html += '<span class="group-chevron ' + (isCollapsed ? 'collapsed' : '') + '">\u25BC</span> ';
				html += STATUS_LABELS[status] + ' <span class="group-count">(' + projects.length + ')</span>';
				html += '</div>';

				if (!isCollapsed) {
					for (let i = 0; i < projects.length; i++) {
						const p = projects[i];
						const statusClass = p.archived ? 'draft' : (p.status || 'draft');
						html += '<div class="project-card" data-index="' + allProjects.indexOf(p) + '">';
						html += '<div class="status-dot ' + statusClass + '"></div>';
						html += '<div class="project-info">';
						html += '<div class="project-name">' + escapeHtml(p.name) + '</div>';
						html += '<div class="project-meta">';
						if (p.typeLabel) {
							html += '<span class="type-label">' + escapeHtml(p.typeLabel) + '</span>';
						}
						if (p.tags) {
							for (let t = 0; t < Math.min(p.tags.length, 2); t++) {
								html += '<span class="tag-pill">' + escapeHtml(p.tags[t]) + '</span>';
							}
						}
						html += '</div></div>';
						html += '<div class="project-time">' + p.time + '</div>';
						html += '<div class="project-actions">';
						html += '<button class="action-btn" data-btn="notes" title="Notes">\u{1F4DD}</button>';
						html += '<button class="action-btn" data-btn="status" title="Status">\u25CF</button>';
						if (p.archived) {
							html += '<button class="action-btn" data-btn="unarchive" title="Unarchive">\u{21A9}</button>';
						} else {
							html += '<button class="action-btn" data-btn="archive" title="Archive">\u{1F4E6}</button>';
						}
						html += '</div>';
						html += '</div>';
					}
				}
			}

			container.innerHTML = html;
		}

		// Event delegation
		document.getElementById('projects-container').addEventListener('click', (e) => {
			// Group header toggle
			const header = e.target.closest('.group-header');
			if (header) {
				const group = header.dataset.group;
				if (collapsedGroups.has(group)) {
					collapsedGroups.delete(group);
				} else {
					collapsedGroups.add(group);
				}
				render();
				return;
			}

			// Action button
			const btn = e.target.closest('.action-btn');
			if (btn) {
				const card = btn.closest('.project-card');
				const idx = parseInt(card.dataset.index, 10);
				const project = allProjects[idx];
				if (!project) return;

				switch (btn.dataset.btn) {
					case 'notes':
						vscode.postMessage({ type: 'openNotes', path: project.path });
						break;
					case 'status':
						vscode.postMessage({ type: 'setStatus', path: project.path });
						break;
					case 'archive':
						vscode.postMessage({ type: 'archive', path: project.path });
						break;
					case 'unarchive':
						vscode.postMessage({ type: 'unarchive', path: project.path });
						break;
				}
				return;
			}

			// Project card click
			const card = e.target.closest('.project-card');
			if (card) {
				const idx = parseInt(card.dataset.index, 10);
				const project = allProjects[idx];
				if (project) {
					vscode.postMessage({ type: 'openProject', path: project.path });
				}
			}
		});

		// Filter
		document.getElementById('filter').addEventListener('input', (e) => {
			filterText = e.target.value;
			render();
		});

		// New project
		document.getElementById('new-project-btn').addEventListener('click', () => {
			vscode.postMessage({ type: 'newProject' });
		});

		// Listen for data
		window.addEventListener('message', event => {
			const message = event.data;
			if (message.type === 'projectsData') {
				allProjects = message.projects || [];
				render();
			}
		});

		// Request data on load
		vscode.postMessage({ type: 'requestProjects' });
	</script>
</body>
</html>`;
	}
}

interface SidebarProject {
	name: string;
	path: string;
	type: string;
	typeLabel: string;
	status: string;
	tags: string[];
	archived: boolean;
	time: string;
}

function getNonce() {
	let text = '';
	const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	for (let i = 0; i < 32; i++) {
		text += possible.charAt(Math.floor(Math.random() * possible.length));
	}
	return text;
}
