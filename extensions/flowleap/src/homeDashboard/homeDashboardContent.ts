/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as path from 'path';
import { PatentProject, ProjectType, DisplayStatus, PROJECT_TYPE_LABELS, PROJECT_STATUS_LABELS, mapLegacyStatus, displayStatusOf } from '../projectSidebar/projectTreeProvider';

/**
 * A message posted by the home dashboard webview. Every command maps onto a
 * plain `executeCommand` call, so the same handler serves every host.
 */
export interface HomeDashboardMessage {
	command?: string;
	type?: string;
	path?: string;
}

/**
 * Render the home dashboard. The markup is shared by every host that shows the
 * dashboard — the editor panel and the activity-bar view — and adapts to the
 * width of the host through a narrow-width media query.
 */
export async function renderHomeDashboard(webview: vscode.Webview, context: vscode.ExtensionContext): Promise<string> {
	const hasWorkspace = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0;
	const recentProjects = await getRecentProjects(context);
	const currentProject = hasWorkspace ? await getCurrentProject() : undefined;
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

		.project-quick-links {
			display: flex;
			gap: 16px;
			margin-top: 14px;
		}

		.project-quick-link {
			font-size: 12px;
			color: var(--accent);
			cursor: pointer;
		}

		.project-quick-link:hover {
			text-decoration: underline;
		}

		/* Narrow host — the activity-bar view is about 300px wide. Single-column
		grids, tighter padding and a smaller header keep the dashboard usable
		there; the wide editor-panel rendering is untouched. */
		@media (max-width: 500px) {
			.container {
				padding: 16px;
			}

			.header {
				margin-bottom: 28px;
			}

			.logo {
				font-size: 28px;
			}

			.tagline {
				font-size: 13px;
			}

			.section {
				margin-bottom: 28px;
			}

			.type-cards {
				grid-template-columns: 1fr;
				gap: 10px;
			}

			.type-card {
				padding: 14px;
			}

			.type-card-icon {
				font-size: 22px;
				margin-bottom: 8px;
			}

			.project-summary {
				padding: 16px;
			}

			.project-summary-header {
				flex-wrap: wrap;
				gap: 8px;
			}

			.project-summary-name {
				font-size: 17px;
			}

			.project-summary-details {
				flex-direction: column;
				gap: 4px;
			}

			.project-actions {
				grid-template-columns: 1fr;
				gap: 8px;
			}

			.project-action-btn {
				padding: 10px;
			}

			.empty-state {
				padding: 20px 8px;
			}
		}
	</style>
</head>
<body>
	<div class="container">
		<div class="header">
			<div class="logo">FlowLeap</div>
			<p class="tagline">AI Patent Agent</p>
		</div>

		${currentProject ? renderProjectView(currentProject) : renderStartupView(recentProjects)}
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
				case 'browseFiles':
					vscode.postMessage({ command: 'browseFiles' });
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

/**
 * Act on a message from the home dashboard webview. Shared by every host, so
 * the dashboard behaves the same in the editor panel and in the activity bar.
 */
export function handleHomeDashboardMessage(message: HomeDashboardMessage): void {
	switch (message.command) {
		case 'openFolder':
			vscode.commands.executeCommand('workbench.action.files.openFolder');
			return;
		case 'browseFiles':
			// Reveal the open project's files, never the OS folder picker.
			vscode.commands.executeCommand('workbench.files.action.focusFilesExplorer');
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
}

function renderStartupView(recentProjects: RecentProject[]): string {
	return `
	<div class="section">
		<div class="section-title">New Project</div>
		<div class="type-cards">
			<div class="type-card" data-action="newProject" data-type="patent-analysis">
				<div class="type-card-icon">\u{1F4C4}</div>
				<div class="type-card-title">Patent Analysis</div>
				<div class="type-card-desc">Work on a specific patent, including invalidity</div>
			</div>
			<div class="type-card" data-action="newProject" data-type="prior-art-search">
				<div class="type-card-icon">\u{1F50D}</div>
				<div class="type-card-title">Prior-Art Search</div>
				<div class="type-card-desc">Search prior art from an invention disclosure</div>
			</div>
			<div class="type-card" data-action="newProject" data-type="freedom-to-operate">
				<div class="type-card-icon">\u{2696}\u{FE0F}</div>
				<div class="type-card-title">Freedom-to-Operate</div>
				<div class="type-card-desc">Clear a product against in-force patents</div>
			</div>
			<div class="type-card" data-action="newProject" data-type="patent-landscape">
				<div class="type-card-icon">\u{1F4CA}</div>
				<div class="type-card-title">Patent Landscape</div>
				<div class="type-card-desc">Map the activity across a technology area</div>
			</div>
			<div class="type-card" data-action="newProject" data-type="claim-analysis">
				<div class="type-card-icon">\u{1F4CB}</div>
				<div class="type-card-title">Claim Analysis</div>
				<div class="type-card-desc">Extract and analyze the claims of a patent</div>
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
			<div class="project-item" data-action="openRecentProject" data-path="${escapeHtml(p.path)}">
				<div class="project-status-dot ${p.status}"></div>
				<div class="project-info">
					<div class="project-name">${escapeHtml(p.name)}</div>
					<div class="project-meta">
						${p.type ? `<span class="project-type-badge">${escapeHtml(p.typeLabel)}</span>` : ''}
						${(p.tags ?? []).length > 0 ? `
						<div class="project-tags">
							${p.tags!.slice(0, 3).map(t => `<span class="project-tag">${escapeHtml(t)}</span>`).join('')}
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

function renderProjectView(project: CurrentProject): string {
	const display: DisplayStatus = project.archived ? 'archived' : mapLegacyStatus(project.status);

	return `
	<div class="project-summary">
		<div class="project-summary-header">
			<div class="project-summary-name">${escapeHtml(project.name)}</div>
			<div class="project-summary-status ${display}" data-action="setStatus" data-path="${escapeHtml(project.path)}">${PROJECT_STATUS_LABELS[display]}</div>
		</div>
		<div class="project-summary-details">
			<span>${PROJECT_TYPE_LABELS[project.type as ProjectType] ?? 'Project'}</span>
			${project.created ? `<span>Created ${formatDate(project.created)}</span>` : ''}
		</div>
		${(project.tags ?? []).length > 0 ? `
		<div class="project-summary-tags">
			${project.tags!.map(t => `<span class="project-tag">${escapeHtml(t)}</span>`).join('')}
		</div>` : ''}
		<div class="project-actions">
			<div class="project-action-btn" data-action="openNotes" data-path="${escapeHtml(project.path)}">
				<div class="project-action-icon">\u{1F4DD}</div>
				<div class="project-action-label">Open Notes</div>
			</div>
			<div class="project-action-btn" data-action="openChat">
				<div class="project-action-icon">\u{1F4AC}</div>
				<div class="project-action-label">AI Chat</div>
			</div>
			<div class="project-action-btn" data-action="browseFiles">
				<div class="project-action-icon">\u{1F4C2}</div>
				<div class="project-action-label">Browse Files</div>
			</div>
		</div>
		<div class="project-quick-links">
			<span class="project-quick-link" data-action="newProject">New Project…</span>
			<span class="project-quick-link" data-action="openRecent">Open Recent…</span>
		</div>
	</div>`;
}

async function getCurrentProject(): Promise<CurrentProject | undefined> {
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

async function getRecentProjects(context: vscode.ExtensionContext): Promise<RecentProject[]> {
	const storedProjects = context.globalState.get<PatentProject[]>('flowleap.projects', []);

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
			time: getTimeAgo(new Date(p.lastAccessed))
		}));
}

function getTimeAgo(date: Date): string {
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

function formatDate(isoString: string): string {
	try {
		const date = new Date(isoString);
		return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
	} catch {
		return '';
	}
}

function escapeHtml(text: string): string {
	return text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#039;');
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
