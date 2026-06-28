/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import { HomeDashboardPanel } from './homeDashboard/homeDashboardPanel';
import { ProjectSidebarViewProvider, PatentProject, ProjectType, ProjectStatus } from './projectSidebar/projectTreeProvider';
import { ChatBarController, ChatInputPanel } from './chatBar/chatBarController';
import { registerUpdateNotifier } from './updateNotifier/updateNotifier';

let chatBarController: ChatBarController;
let projectSidebarProvider: ProjectSidebarViewProvider;

const PROJECT_TYPE_LABELS: Record<ProjectType, { label: string; icon: string; placeholder: string; description: string }> = {
	'patent-analysis': {
		label: 'Patent Analysis',
		icon: '$(file-text)',
		placeholder: 'e.g., EP1234567 — Valve mechanism',
		description: 'Analyze a specific patent or application'
	},
	'prior-art-search': {
		label: 'Prior Art Search',
		icon: '$(search)',
		placeholder: 'e.g., Self-healing concrete disclosure',
		description: 'Search prior art from an invention disclosure'
	},
	'custom': {
		label: 'Custom Project',
		icon: '$(folder)',
		placeholder: 'e.g., Client ABC landscape study',
		description: 'Blank project — organize it your way'
	}
};

const STATUS_LABELS: Record<ProjectStatus, { label: string; icon: string }> = {
	'draft': { label: 'Draft', icon: '$(circle-outline)' },
	'in-progress': { label: 'In Progress', icon: '$(circle-filled)' },
	'review': { label: 'Under Review', icon: '$(eye)' },
	'complete': { label: 'Complete', icon: '$(check)' }
};

function getProjectsDirectory(): string {
	const config = vscode.workspace.getConfiguration('flowleap');
	const customDir = config.get<string>('projectsDirectory', '');
	if (customDir) {
		return customDir.replace('~', os.homedir());
	}
	return path.join(os.homedir(), 'FlowLeap Projects');
}

function getNotesTemplate(projectName: string, projectType: ProjectType): string {
	const typeLabel = PROJECT_TYPE_LABELS[projectType].label;
	return `# ${projectName}

> ${typeLabel}

## Key Findings


## Open Questions


## References

`;
}

function getStoredProjects(context: vscode.ExtensionContext): PatentProject[] {
	return context.globalState.get<PatentProject[]>('flowleap.projects', []);
}

async function saveStoredProjects(context: vscode.ExtensionContext, projects: PatentProject[]): Promise<void> {
	await context.globalState.update('flowleap.projects', projects);
}

async function readProjectConfig(projectPath: string): Promise<Record<string, unknown> | undefined> {
	try {
		const configUri = vscode.Uri.file(path.join(projectPath, '.flowleap', 'config.json'));
		const data = await vscode.workspace.fs.readFile(configUri);
		return JSON.parse(Buffer.from(data).toString('utf-8'));
	} catch {
		return undefined;
	}
}

async function writeProjectConfig(projectPath: string, config: Record<string, unknown>): Promise<void> {
	const configUri = vscode.Uri.file(path.join(projectPath, '.flowleap', 'config.json'));
	await vscode.workspace.fs.writeFile(configUri, Buffer.from(JSON.stringify(config, null, '\t')));
}

export async function activate(context: vscode.ExtensionContext) {
	console.log('FlowLeap extension activated');

	// NOTE (ADR 0002): The UI shell does NOT register an authentication provider or run its
	// own OAuth flow. The single Clerk-backed `flowleap` provider lives in the copilot
	// extension's patent-ai service; this shell only *consumes* sign-in state via
	// `vscode.authentication.getSession('flowleap', …)` and aliases sign-in to `patent-ai.signIn`.

	// Register Project Sidebar
	projectSidebarProvider = new ProjectSidebarViewProvider(context.extensionUri, context);
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(
			ProjectSidebarViewProvider.viewType,
			projectSidebarProvider
		)
	);

	// Register Chat Input Panel
	const chatInputProvider = new ChatInputPanel(context.extensionUri, context);
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(
			ChatInputPanel.viewType,
			chatInputProvider
		)
	);

	// Register Chat Bar Controller (status bar)
	chatBarController = new ChatBarController(context);
	context.subscriptions.push(chatBarController);

	// Notify-only update checker (polls the website; never installs automatically)
	context.subscriptions.push(registerUpdateNotifier(context));

	// --- Commands ---

	// Open FlowLeap settings
	context.subscriptions.push(
		vscode.commands.registerCommand('flowleap.openSettings', () => {
			return vscode.commands.executeCommand('workbench.action.openSettings', '@flowleap');
		})
	);

	// Open Home Dashboard
	context.subscriptions.push(
		vscode.commands.registerCommand('flowleap.openHome', () => {
			HomeDashboardPanel.createOrShow(context.extensionUri, context);
		})
	);

	// New Project — type picker + name + auto-location
	context.subscriptions.push(
		vscode.commands.registerCommand('flowleap.newProject', async (preselectedType?: ProjectType) => {
			let projectType: ProjectType;

			if (preselectedType) {
				projectType = preselectedType;
			} else {
				// Pick project type
				const typeItems = Object.entries(PROJECT_TYPE_LABELS).map(([type, info]) => ({
					label: `${info.icon} ${info.label}`,
					description: info.description,
					type: type as ProjectType
				}));

				const picked = await vscode.window.showQuickPick(typeItems, {
					placeHolder: 'What type of project?',
					title: 'New Project'
				});

				if (!picked) {
					return;
				}
				projectType = picked.type;
			}

			// Ask for project name
			const typeInfo = PROJECT_TYPE_LABELS[projectType];
			const projectName = await vscode.window.showInputBox({
				prompt: 'Project name',
				placeHolder: typeInfo.placeholder,
				title: `New ${typeInfo.label}`
			});

			if (!projectName) {
				return;
			}

			// Sanitize folder name
			const folderName = projectName.replace(/[<>:"/\\|?*]/g, '-').trim();
			const projectsDir = getProjectsDirectory();
			const projectPath = path.join(projectsDir, folderName);
			const projectUri = vscode.Uri.file(projectPath);

			try {
				// Ensure projects directory exists
				await vscode.workspace.fs.createDirectory(vscode.Uri.file(projectsDir));

				// Create project structure
				await vscode.workspace.fs.createDirectory(projectUri);
				await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.join(projectPath, '.flowleap')));
				await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.join(projectPath, 'prior-art')));
				await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.join(projectPath, 'analysis')));
				await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.join(projectPath, 'outputs')));

				// Write config
				const config = {
					name: projectName,
					type: projectType,
					status: 'draft' as ProjectStatus,
					tags: [],
					archived: false,
					created: new Date().toISOString()
				};
				await writeProjectConfig(projectPath, config);

				// Write notes.md
				const notes = getNotesTemplate(projectName, projectType);
				await vscode.workspace.fs.writeFile(
					vscode.Uri.file(path.join(projectPath, 'notes.md')),
					Buffer.from(notes)
				);

				// Store project reference
				const storedProjects = getStoredProjects(context);
				storedProjects.push({
					id: projectPath,
					name: projectName,
					path: projectPath,
					type: projectType,
					status: 'draft',
					tags: [],
					archived: false,
					lastAccessed: new Date(),
					created: config.created
				});
				await saveStoredProjects(context, storedProjects);

				// Refresh sidebar + home dashboard
				refreshProjectViews();

				// Open the project
				await vscode.commands.executeCommand('vscode.openFolder', projectUri);
			} catch (error) {
				vscode.window.showErrorMessage(`Failed to create project: ${error}`);
			}
		})
	);

	// Open project
	context.subscriptions.push(
		vscode.commands.registerCommand('flowleap.openProject', async (project: PatentProject) => {
			if (project && project.path) {
				// Update last accessed
				const storedProjects = getStoredProjects(context);
				const stored = storedProjects.find(p => p.id === project.id);
				if (stored) {
					stored.lastAccessed = new Date();
					await saveStoredProjects(context, storedProjects);
				}
				await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(project.path));
			}
		})
	);

	// Show all projects
	context.subscriptions.push(
		vscode.commands.registerCommand('flowleap.showAllProjects', async () => {
			await vscode.commands.executeCommand('workbench.action.openRecent');
		})
	);

	// Refresh projects
	context.subscriptions.push(
		vscode.commands.registerCommand('flowleap.refreshProjects', () => {
			refreshProjectViews();
		})
	);

	// Open notes
	context.subscriptions.push(
		vscode.commands.registerCommand('flowleap.openNotes', async (projectOrPath?: PatentProject | string) => {
			let notesPath: string | undefined;

			if (typeof projectOrPath === 'string') {
				notesPath = path.join(projectOrPath, 'notes.md');
			} else if (projectOrPath) {
				notesPath = path.join(projectOrPath.path, 'notes.md');
			} else if (vscode.workspace.workspaceFolders?.length) {
				// Current workspace
				notesPath = path.join(vscode.workspace.workspaceFolders[0].uri.fsPath, 'notes.md');
			}

			if (!notesPath) {
				vscode.window.showWarningMessage('No project open');
				return;
			}

			const notesUri = vscode.Uri.file(notesPath);

			// Create notes.md if it doesn't exist
			try {
				await vscode.workspace.fs.stat(notesUri);
			} catch {
				const projectName = path.basename(path.dirname(notesPath));
				await vscode.workspace.fs.writeFile(notesUri, Buffer.from(getNotesTemplate(projectName, 'custom')));
			}

			await vscode.commands.executeCommand('vscode.open', notesUri);
		})
	);

	// Set project status
	context.subscriptions.push(
		vscode.commands.registerCommand('flowleap.setProjectStatus', async (projectOrPath?: PatentProject | string) => {
			const projectPath = resolveProjectPath(projectOrPath);
			if (!projectPath) {
				vscode.window.showWarningMessage('No project open');
				return;
			}

			const statusItems = Object.entries(STATUS_LABELS).map(([status, info]) => ({
				label: `${info.icon} ${info.label}`,
				status: status as ProjectStatus
			}));

			const picked = await vscode.window.showQuickPick(statusItems, {
				placeHolder: 'Set project status'
			});

			if (!picked) {
				return;
			}

			// Update config.json
			const config = await readProjectConfig(projectPath) ?? {};
			config.status = picked.status;
			await writeProjectConfig(projectPath, config);

			// Update globalState
			const storedProjects = getStoredProjects(context);
			const stored = storedProjects.find(p => p.path === projectPath);
			if (stored) {
				stored.status = picked.status;
				await saveStoredProjects(context, storedProjects);
			}

			refreshProjectViews();
			vscode.window.showInformationMessage(`Status set to ${STATUS_LABELS[picked.status].label}`);
		})
	);

	// Add tag
	context.subscriptions.push(
		vscode.commands.registerCommand('flowleap.addTag', async (projectOrPath?: PatentProject | string) => {
			const projectPath = resolveProjectPath(projectOrPath);
			if (!projectPath) {
				vscode.window.showWarningMessage('No project open');
				return;
			}

			// Gather existing tags for autocomplete suggestions
			const storedProjects = getStoredProjects(context);
			const allTags = new Set<string>();
			for (const p of storedProjects) {
				for (const t of p.tags ?? []) {
					allTags.add(t);
				}
			}

			const tag = await vscode.window.showInputBox({
				prompt: 'Tag name',
				placeHolder: 'e.g., urgent, client-ABC, mechanical'
			});

			if (!tag) {
				return;
			}

			const normalizedTag = tag.trim().toLowerCase();

			// Update config.json
			const config = await readProjectConfig(projectPath) ?? {};
			const tags: string[] = (config.tags as string[]) ?? [];
			if (!tags.includes(normalizedTag)) {
				tags.push(normalizedTag);
				config.tags = tags;
				await writeProjectConfig(projectPath, config);
			}

			// Update globalState
			const stored = storedProjects.find(p => p.path === projectPath);
			if (stored) {
				if (!stored.tags) {
					stored.tags = [];
				}
				if (!stored.tags.includes(normalizedTag)) {
					stored.tags.push(normalizedTag);
				}
				await saveStoredProjects(context, storedProjects);
			}

			refreshProjectViews();
		})
	);

	// Remove tag
	context.subscriptions.push(
		vscode.commands.registerCommand('flowleap.removeTag', async (projectOrPath?: PatentProject | string) => {
			const projectPath = resolveProjectPath(projectOrPath);
			if (!projectPath) {
				vscode.window.showWarningMessage('No project open');
				return;
			}

			const config = await readProjectConfig(projectPath) ?? {};
			const tags: string[] = (config.tags as string[]) ?? [];

			if (tags.length === 0) {
				vscode.window.showInformationMessage('No tags on this project');
				return;
			}

			const picked = await vscode.window.showQuickPick(tags, {
				placeHolder: 'Select tag to remove'
			});

			if (!picked) {
				return;
			}

			// Update config.json
			config.tags = tags.filter(t => t !== picked);
			await writeProjectConfig(projectPath, config);

			// Update globalState
			const storedProjects = getStoredProjects(context);
			const stored = storedProjects.find(p => p.path === projectPath);
			if (stored) {
				stored.tags = (stored.tags ?? []).filter(t => t !== picked);
				await saveStoredProjects(context, storedProjects);
			}

			refreshProjectViews();
		})
	);

	// Archive project
	context.subscriptions.push(
		vscode.commands.registerCommand('flowleap.archiveProject', async (projectOrPath?: PatentProject | string) => {
			const projectPath = resolveProjectPath(projectOrPath);
			if (!projectPath) {
				vscode.window.showWarningMessage('No project open');
				return;
			}

			const config = await readProjectConfig(projectPath) ?? {};
			config.archived = true;
			await writeProjectConfig(projectPath, config);

			const storedProjects = getStoredProjects(context);
			const stored = storedProjects.find(p => p.path === projectPath);
			if (stored) {
				stored.archived = true;
				await saveStoredProjects(context, storedProjects);
			}

			refreshProjectViews();
			vscode.window.showInformationMessage('Project archived');
		})
	);

	// Unarchive project
	context.subscriptions.push(
		vscode.commands.registerCommand('flowleap.unarchiveProject', async (projectOrPath?: PatentProject | string) => {
			const projectPath = resolveProjectPath(projectOrPath);
			if (!projectPath) {
				vscode.window.showWarningMessage('No project open');
				return;
			}

			const config = await readProjectConfig(projectPath) ?? {};
			config.archived = false;
			await writeProjectConfig(projectPath, config);

			const storedProjects = getStoredProjects(context);
			const stored = storedProjects.find(p => p.path === projectPath);
			if (stored) {
				stored.archived = false;
				await saveStoredProjects(context, storedProjects);
			}

			refreshProjectViews();
			vscode.window.showInformationMessage('Project unarchived');
		})
	);

	// Sign in is owned end-to-end by the copilot extension's `flowleap` auth provider, which
	// registers the canonical `flowleap.signIn` command (and the `patent-ai.signIn` alias) and runs
	// the Clerk deep-link OAuth flow (ADR 0002). The UI shell must NOT register `flowleap.signIn`:
	// a second registration of the same id throws "already exists", which — depending on activation
	// order — aborts the copilot registration and leaves sign-in bound to a dead no-op. The shell
	// just invokes the command (see `flowleap.showCurrentUser` below).

	// Show current user — reads sign-in state from the single `flowleap` provider (ADR 0002).
	// A silent (createIfNone: false) request returns undefined when no provider is registered yet,
	// so this stays quiet until the auth-consolidation layer ships the provider.
	context.subscriptions.push(
		vscode.commands.registerCommand('flowleap.showCurrentUser', async () => {
			try {
				const sessions = await vscode.authentication.getSession('flowleap', ['openid', 'profile', 'email'], { createIfNone: false });
				if (sessions) {
					vscode.window.showInformationMessage(
						`Signed in as ${sessions.account.label}\nUser ID: ${sessions.account.id}`,
						'OK'
					);
				} else {
					vscode.window.showInformationMessage('Not signed in to FlowLeap', 'Sign In').then(selection => {
						if (selection === 'Sign In') {
							vscode.commands.executeCommand('flowleap.signIn');
						}
					});
				}
			} catch (error) {
				vscode.window.showErrorMessage(`Failed to get user info: ${error}`);
			}
		})
	);

	// Show home dashboard on startup if configured
	const appConfig = vscode.workspace.getConfiguration('flowleap');
	const showHomeOnStartup = appConfig.get<boolean>('showHomeOnStartup', true);

	if (showHomeOnStartup) {
		setTimeout(() => {
			if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
				HomeDashboardPanel.createOrShow(context.extensionUri, context);
			}
		}, 500);
	}

	// Register webview serializer for home dashboard
	if (vscode.window.registerWebviewPanelSerializer) {
		vscode.window.registerWebviewPanelSerializer(HomeDashboardPanel.viewType, {
			async deserializeWebviewPanel(webviewPanel: vscode.WebviewPanel) {
				HomeDashboardPanel.revive(webviewPanel, context.extensionUri, context);
			}
		});
	}
}

/**
 * Refresh both project surfaces — the sidebar (right panel) and the home
 * dashboard (center tab) — so they always show the same project store.
 */
function refreshProjectViews(): void {
	projectSidebarProvider.refresh();
	HomeDashboardPanel.refresh();
}

function resolveProjectPath(projectOrPath?: PatentProject | string): string | undefined {
	if (typeof projectOrPath === 'string') {
		return projectOrPath;
	}
	if (projectOrPath) {
		return projectOrPath.path;
	}
	if (vscode.workspace.workspaceFolders?.length) {
		return vscode.workspace.workspaceFolders[0].uri.fsPath;
	}
	return undefined;
}

export function deactivate() {
	chatBarController?.dispose();
}
