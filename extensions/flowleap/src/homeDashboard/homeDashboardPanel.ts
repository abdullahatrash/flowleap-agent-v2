/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as path from 'path';
import { PatentProject, ProjectType, DisplayStatus, PROJECT_TYPE_LABELS, PROJECT_STATUS_LABELS, mapLegacyStatus, displayStatusOf } from '../projectSidebar/projectTreeProvider';

export class HomeDashboardPanel {
	public static currentPanel: HomeDashboardPanel | undefined;

	public static readonly viewType = 'flowleap.homeDashboard';

	private readonly _panel: vscode.WebviewPanel;
	private readonly _extensionUri: vscode.Uri;
	private readonly _context: vscode.ExtensionContext;
	private _disposables: vscode.Disposable[] = [];

	public static createOrShow(extensionUri: vscode.Uri, context: vscode.ExtensionContext) {
		const column = vscode.window.activeTextEditor
			? vscode.window.activeTextEditor.viewColumn
			: undefined;

		if (HomeDashboardPanel.currentPanel) {
			HomeDashboardPanel.currentPanel._panel.reveal(column);
			return;
		}

		const panel = vscode.window.createWebviewPanel(
			HomeDashboardPanel.viewType,
			'FlowLeap',
			column || vscode.ViewColumn.One,
			{
				enableScripts: true,
				retainContextWhenHidden: true,
				localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')]
			}
		);

		HomeDashboardPanel.currentPanel = new HomeDashboardPanel(panel, extensionUri, context);
	}

	public static revive(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, context: vscode.ExtensionContext) {
		HomeDashboardPanel.currentPanel = new HomeDashboardPanel(panel, extensionUri, context);
	}

	/**
	 * Re-render the home dashboard if it is currently open, so it stays in sync
	 * with the project sidebar after the project store changes.
	 */
	public static refresh() {
		HomeDashboardPanel.currentPanel?._update();
	}

	private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, context: vscode.ExtensionContext) {
		this._panel = panel;
		this._extensionUri = extensionUri;
		this._context = context;

		this._update();

		this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

		this._panel.onDidChangeViewState(
			() => {
				if (this._panel.visible) {
					this._update();
				}
			},
			null,
			this._disposables
		);

		this._panel.webview.onDidReceiveMessage(
			message => {
				switch (message.command) {
					case 'openFolder':
						vscode.commands.executeCommand('workbench.action.files.openFolder');
						return;
					case 'newProject':
						vscode.commands.executeCommand('flowleap.newProject', message.type);
						return;
					case 'openRecent':
						vscode.commands.executeCommand('workbench.action.openRecent');
						return;
					case 'openSettings':
						vscode.commands.executeCommand('flowleap.openSettings');
						return;
					case 'openChat':
						vscode.commands.executeCommand('workbench.action.chat.open');
						return;
					case 'openRecentProject':
						if (message.path) {
							vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(message.path));
						}
						return;
					case 'openNotes':
						vscode.commands.executeCommand('flowleap.openNotes', message.path);
						return;
					case 'setStatus':
						vscode.commands.executeCommand('flowleap.setProjectStatus', message.path);
						return;
				}
			},
			null,
			this._disposables
		);
	}

	public dispose() {
		HomeDashboardPanel.currentPanel = undefined;

		this._panel.dispose();

		while (this._disposables.length) {
			const x = this._disposables.pop();
			if (x) {
				x.dispose();
			}
		}
	}

	private async _update() {
		const webview = this._panel.webview;
		this._panel.title = 'FlowLeap';
		this._panel.webview.html = await this._getHtmlForWebview(webview);
	}

	private async _getHtmlForWebview(webview: vscode.Webview) {
		const hasWorkspace = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0;
		const recentProjects = await this._getRecentProjects();
		const currentProject = hasWorkspace ? await this._getCurrentProject() : undefined;
		const nonce = getNonce();

		return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>FlowLeap</title>
	<style>
		:root {
			--background: var(--vscode-editor-background);
			--sidebar: var(--vscode-sideBar-background, var(--vscode-editor-background));
			--card: var(--vscode-editorWidget-background, var(--vscode-editor-background));
			--card-hover: var(--vscode-list-hoverBackground);
			--accent: var(--vscode-textLink-foreground);
			--accent-green: var(--vscode-testing-iconPassed, #22c55e);
			--accent-teal: var(--vscode-charts-green, #14b8a6);
			--accent-yellow: var(--vscode-editorWarning-foreground, #f59e0b);
			--text-primary: var(--vscode-foreground);
			--text-secondary: var(--vscode-descriptionForeground);
			--text-muted: var(--vscode-disabledForeground);
			--border: var(--vscode-widget-border, var(--vscode-editorWidget-border, transparent));
			--badge-bg: color-mix(in srgb, var(--accent) 15%, transparent);
			--badge-text: var(--accent);
		}

		* { margin: 0; padding: 0; box-sizing: border-box; }

		body {
			font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif);
			background: var(--background);
			color: var(--text-primary);
			min-height: 100vh;
		}

		.container {
			max-width: 860px;
			margin: 0 auto;
			padding: 48px 40px;
		}

		/* Header */
		.header {
			text-align: center;
			margin-bottom: 48px;
		}

		.logo {
			font-size: 42px;
			font-weight: 700;
			background: linear-gradient(135deg, var(--accent) 0%, var(--accent-teal) 100%);
			-webkit-background-clip: text;
			-webkit-text-fill-color: transparent;
			background-clip: text;
			margin-bottom: 8px;
		}

		.tagline {
			color: var(--text-secondary);
			font-size: 16px;
		}

		/* Section */
		.section {
			margin-bottom: 40px;
		}

		.section-title {
			color: var(--text-secondary);
			font-size: 11px;
			font-weight: 600;
			text-transform: uppercase;
			letter-spacing: 0.1em;
			margin-bottom: 14px;
		}

		/* Project type cards */
		.type-cards {
			display: grid;
			grid-template-columns: repeat(3, 1fr);
			gap: 14px;
		}

		.type-card {
			background: var(--card);
			border: 1px solid var(--border);
			border-radius: 10px;
			padding: 20px;
			cursor: pointer;
			transition: all 0.2s ease;
			text-align: center;
		}

		.type-card:hover {
			background: var(--card-hover);
			border-color: var(--accent);
			transform: translateY(-1px);
		}

		.type-card-icon {
			font-size: 28px;
			margin-bottom: 12px;
			opacity: 0.85;
		}

		.type-card-title {
			font-size: 14px;
			font-weight: 600;
			margin-bottom: 6px;
		}

		.type-card-desc {
			color: var(--text-secondary);
			font-size: 12px;
			line-height: 1.4;
		}

		/* Open existing — subtle link row */
		.open-row {
			display: flex;
			gap: 16px;
			margin-top: 14px;
			justify-content: center;
		}

		.open-link {
			color: var(--text-secondary);
			font-size: 13px;
			cursor: pointer;
			transition: color 0.15s;
		}

		.open-link:hover {
			color: var(--accent);
		}

		/* Recent projects list */
		.projects-list {
			display: flex;
			flex-direction: column;
			gap: 6px;
		}

		.project-item {
			background: var(--card);
			border: 1px solid var(--border);
			border-radius: 8px;
			padding: 14px 16px;
			cursor: pointer;
			transition: all 0.15s ease;
			display: flex;
			align-items: center;
			gap: 14px;
		}

		.project-item:hover {
			background: var(--card-hover);
			border-color: var(--accent);
		}

		.project-status-dot {
			width: 8px;
			height: 8px;
			border-radius: 50%;
			flex-shrink: 0;
		}

		.project-status-dot.active { background: var(--accent-green); }
		.project-status-dot.in-review { background: var(--accent-yellow); }
		.project-status-dot.complete { background: var(--accent); }
		.project-status-dot.archived { background: var(--text-muted); }

		.project-info {
			flex: 1;
			min-width: 0;
		}

		.project-name {
			font-size: 14px;
			font-weight: 500;
			white-space: nowrap;
			overflow: hidden;
			text-overflow: ellipsis;
		}

		.project-meta {
			display: flex;
			align-items: center;
			gap: 8px;
			margin-top: 3px;
		}

		.project-type-badge {
			font-size: 11px;
			color: var(--badge-text);
			background: var(--badge-bg);
			padding: 1px 7px;
			border-radius: 4px;
		}

		.project-tags {
			display: flex;
			gap: 4px;
		}

		.project-tag {
			font-size: 10px;
			color: var(--text-muted);
			background: color-mix(in srgb, var(--text-muted) 12%, transparent);
			padding: 1px 6px;
			border-radius: 3px;
		}

		.project-time {
			color: var(--text-muted);
			font-size: 12px;
			flex-shrink: 0;
		}

		/* Empty state */
		.empty-state {
			text-align: center;
			padding: 32px;
			color: var(--text-muted);
		}

		.empty-state-icon {
			font-size: 36px;
			margin-bottom: 12px;
			opacity: 0.4;
		}

		/* Current project summary */
		.project-summary {
			background: var(--card);
			border: 1px solid var(--border);
			border-radius: 12px;
			padding: 24px;
			margin-bottom: 32px;
		}

		.project-summary-header {
			display: flex;
			align-items: center;
			gap: 12px;
			margin-bottom: 16px;
		}

		.project-summary-name {
			font-size: 20px;
			font-weight: 600;
			flex: 1;
		}

		.project-summary-status {
			font-size: 12px;
			padding: 3px 10px;
			border-radius: 12px;
			cursor: pointer;
			transition: opacity 0.15s;
		}

		.project-summary-status:hover { opacity: 0.8; }
		.project-summary-status.active { background: color-mix(in srgb, var(--accent-green) 20%, transparent); color: var(--accent-green); }
		.project-summary-status.in-review { background: color-mix(in srgb, var(--accent-yellow) 20%, transparent); color: var(--accent-yellow); }
		.project-summary-status.complete { background: color-mix(in srgb, var(--accent) 20%, transparent); color: var(--accent); }
		.project-summary-status.archived { background: color-mix(in srgb, var(--text-muted) 20%, transparent); color: var(--text-secondary); }

		.project-summary-details {
			display: flex;
			gap: 24px;
			color: var(--text-secondary);
			font-size: 13px;
		}

		.project-summary-tags {
			display: flex;
			gap: 6px;
			margin-top: 12px;
		}

		.project-actions {
			display: grid;
			grid-template-columns: repeat(3, 1fr);
			gap: 12px;
			margin-top: 20px;
		}

		.project-action-btn {
			background: var(--card-hover);
			border: 1px solid var(--border);
			border-radius: 8px;
			padding: 14px;
			cursor: pointer;
			text-align: center;
			transition: all 0.15s;
			color: var(--text-primary);
		}

		.project-action-btn:hover {
			border-color: var(--accent);
		}

		.project-action-icon {
			font-size: 20px;
			margin-bottom: 6px;
		}

		.project-action-label {
			font-size: 12px;
			color: var(--text-secondary);
		}
	</style>
</head>
<body>
	<div class="container">
		<div class="header">
			<div class="logo">FlowLeap</div>
			<p class="tagline">AI-Powered Patent IDE</p>
		</div>

		${currentProject ? this._renderProjectView(currentProject) : this._renderStartupView(recentProjects)}
	</div>

	<script nonce="${nonce}">
		const vscode = acquireVsCodeApi();

		document.addEventListener('click', (e) => {
			const el = e.target.closest('[data-action]');
			if (!el) return;

			const action = el.dataset.action;
			switch (action) {
				case 'newProject':
					vscode.postMessage({ command: 'newProject', type: el.dataset.type || undefined });
					break;
				case 'openFolder':
					vscode.postMessage({ command: 'openFolder' });
					break;
				case 'openRecent':
					vscode.postMessage({ command: 'openRecent' });
					break;
				case 'openRecentProject':
					vscode.postMessage({ command: 'openRecentProject', path: el.dataset.path });
					break;
				case 'openChat':
					vscode.postMessage({ command: 'openChat' });
					break;
				case 'openNotes':
					vscode.postMessage({ command: 'openNotes', path: el.dataset.path });
					break;
				case 'setStatus':
					vscode.postMessage({ command: 'setStatus', path: el.dataset.path });
					break;
			}
		});
	</script>
</body>
</html>`;
	}

	private _renderStartupView(recentProjects: RecentProject[]): string {
		return `
		<div class="section">
			<div class="section-title">New Project</div>
			<div class="type-cards">
				<div class="type-card" data-action="newProject" data-type="patent-analysis">
					<div class="type-card-icon">\u{1F4C4}</div>
					<div class="type-card-title">Patent Analysis</div>
					<div class="type-card-desc">Analyze a specific patent or application</div>
				</div>
				<div class="type-card" data-action="newProject" data-type="prior-art-search">
					<div class="type-card-icon">\u{1F50D}</div>
					<div class="type-card-title">Prior Art Search</div>
					<div class="type-card-desc">Search from an invention disclosure</div>
				</div>
				<div class="type-card" data-action="newProject" data-type="custom">
					<div class="type-card-icon">\u{1F4C1}</div>
					<div class="type-card-title">Custom Project</div>
					<div class="type-card-desc">Blank project, organize your way</div>
				</div>
			</div>
			<div class="open-row">
				<span class="open-link" data-action="openFolder">Open Folder</span>
				<span class="open-link" data-action="openRecent">Open Recent</span>
			</div>
		</div>

		<div class="section">
			<div class="section-title">Recent Projects</div>
			${recentProjects.length > 0 ? `
			<div class="projects-list">
				${recentProjects.map(p => `
				<div class="project-item" data-action="openRecentProject" data-path="${this._escapeHtml(p.path)}">
					<div class="project-status-dot ${p.status}"></div>
					<div class="project-info">
						<div class="project-name">${this._escapeHtml(p.name)}</div>
						<div class="project-meta">
							${p.type ? `<span class="project-type-badge">${this._escapeHtml(p.typeLabel)}</span>` : ''}
							${(p.tags ?? []).length > 0 ? `
							<div class="project-tags">
								${p.tags!.slice(0, 3).map(t => `<span class="project-tag">${this._escapeHtml(t)}</span>`).join('')}
							</div>` : ''}
						</div>
					</div>
					<div class="project-time">${p.time}</div>
				</div>
				`).join('')}
			</div>
			` : `
			<div class="empty-state">
				<div class="empty-state-icon">\u{1F4CB}</div>
				<p>No recent projects</p>
				<p style="font-size: 12px; margin-top: 8px;">Create a new project to get started</p>
			</div>
			`}
		</div>`;
	}

	private _renderProjectView(project: CurrentProject): string {
		const display: DisplayStatus = project.archived ? 'archived' : mapLegacyStatus(project.status);

		return `
		<div class="project-summary">
			<div class="project-summary-header">
				<div class="project-summary-name">${this._escapeHtml(project.name)}</div>
				<div class="project-summary-status ${display}" data-action="setStatus" data-path="${this._escapeHtml(project.path)}">${PROJECT_STATUS_LABELS[display]}</div>
			</div>
			<div class="project-summary-details">
				<span>${PROJECT_TYPE_LABELS[project.type as ProjectType] ?? 'Project'}</span>
				${project.created ? `<span>Created ${this._formatDate(project.created)}</span>` : ''}
			</div>
			${(project.tags ?? []).length > 0 ? `
			<div class="project-summary-tags">
				${project.tags!.map(t => `<span class="project-tag">${this._escapeHtml(t)}</span>`).join('')}
			</div>` : ''}
			<div class="project-actions">
				<div class="project-action-btn" data-action="openNotes" data-path="${this._escapeHtml(project.path)}">
					<div class="project-action-icon">\u{1F4DD}</div>
					<div class="project-action-label">Open Notes</div>
				</div>
				<div class="project-action-btn" data-action="openChat">
					<div class="project-action-icon">\u{1F4AC}</div>
					<div class="project-action-label">AI Chat</div>
				</div>
				<div class="project-action-btn" data-action="openFolder">
					<div class="project-action-icon">\u{1F4C2}</div>
					<div class="project-action-label">Browse Files</div>
				</div>
			</div>
		</div>`;
	}

	private async _getCurrentProject(): Promise<CurrentProject | undefined> {
		if (!vscode.workspace.workspaceFolders?.length) {
			return undefined;
		}

		const workspacePath = vscode.workspace.workspaceFolders[0].uri.fsPath;

		// Try to read .flowleap/config.json
		try {
			const configUri = vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri, '.flowleap', 'config.json');
			const data = await vscode.workspace.fs.readFile(configUri);
			const config = JSON.parse(Buffer.from(data).toString('utf-8'));

			return {
				name: config.name || path.basename(workspacePath),
				path: workspacePath,
				type: config.type || 'custom',
				status: config.status || 'active',
				archived: config.archived ?? false,
				tags: config.tags || [],
				created: config.created
			};
		} catch {
			// Not a FlowLeap project — don't show project view
			return undefined;
		}
	}

	private async _getRecentProjects(): Promise<RecentProject[]> {
		const storedProjects = this._context.globalState.get<PatentProject[]>('flowleap.projects', []);

		// Mirror the project sidebar: only real FlowLeap projects, archived hidden,
		// sorted newest-first by last access.
		return storedProjects
			.filter(p => !p.archived)
			.sort((a, b) => new Date(b.lastAccessed).getTime() - new Date(a.lastAccessed).getTime())
			.slice(0, 8)
			.map(p => ({
				name: p.name,
				path: p.path,
				type: p.type,
				typeLabel: PROJECT_TYPE_LABELS[p.type] ?? '',
				status: displayStatusOf(p),
				tags: p.tags ?? [],
				time: this._getTimeAgo(new Date(p.lastAccessed))
			}));
	}

	private _getTimeAgo(date: Date): string {
		const now = Date.now();
		const diff = now - date.getTime();
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

	private _formatDate(isoString: string): string {
		try {
			const date = new Date(isoString);
			return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
		} catch {
			return '';
		}
	}

	private _escapeHtml(text: string): string {
		return text
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;')
			.replace(/'/g, '&#039;');
	}
}

interface RecentProject {
	name: string;
	path: string;
	type: string | undefined;
	typeLabel: string;
	status: string;
	tags: string[];
	time: string;
}

interface CurrentProject {
	name: string;
	path: string;
	type: string;
	status: string;
	archived: boolean;
	tags: string[];
	created?: string;
}

function getNonce() {
	let text = '';
	const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	for (let i = 0; i < 32; i++) {
		text += possible.charAt(Math.floor(Math.random() * possible.length));
	}
	return text;
}
