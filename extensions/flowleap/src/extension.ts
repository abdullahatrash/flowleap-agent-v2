/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import { HomeDashboardPanel } from './homeDashboard/homeDashboardPanel';
import {
	ProjectTreeProvider,
	PatentProject,
	ProjectType,
	ProjectStatus,
	DisplayStatus,
	PROJECT_TYPE_LABELS,
	PROJECT_STATUS_LABELS
} from './projectSidebar/projectTreeProvider';
import { ChatBarController, ChatInputPanel } from './chatBar/chatBarController';
import { registerUpdateNotifier } from './updateNotifier/updateNotifier';

let chatBarController: ChatBarController;
let projectSidebarProvider: ProjectTreeProvider;

/**
 * Per-type creation metadata: the icon, a name placeholder example, and a one-line description
 * for the "New Project" quick-pick. The human-readable label lives in {@link PROJECT_TYPE_LABELS}
 * (shared with the tree), so the type name has a single source of truth.
 */
const PROJECT_TYPE_INFO: Record<ProjectType, { icon: string; placeholder: string; description: string }> = {
	'patent-analysis': {
		icon: '$(file-text)',
		placeholder: 'e.g., US10123456B2 — invalidity study',
		description: 'Work on a specific granted patent or application, including invalidity'
	},
	'prior-art-search': {
		icon: '$(search)',
		placeholder: 'e.g., Self-healing concrete disclosure',
		description: 'Search prior art from an invention disclosure'
	},
	'freedom-to-operate': {
		icon: '$(law)',
		placeholder: 'e.g., Drone delivery gimbal — US launch',
		description: 'Clear a product or feature against in-force patents'
	},
	'patent-landscape': {
		icon: '$(graph)',
		placeholder: 'e.g., Solid-state battery electrolytes 2018-2025',
		description: 'Map the patent activity across a technology area'
	},
	'claim-analysis': {
		icon: '$(list-tree)',
		placeholder: 'e.g., EP1234567 claim 1 — element mapping',
		description: 'Extract and analyze the claims of a patent'
	},
	'custom': {
		icon: '$(folder)',
		placeholder: 'e.g., Client ABC portfolio review',
		description: 'Blank project — organize it your way'
	}
};

/** Codicon shown against each display status in the "Set Project Status" quick-pick. */
const STATUS_PICK_ICONS: Record<DisplayStatus, string> = {
	'active': '$(circle-filled)',
	'in-review': '$(eye)',
	'complete': '$(pass-filled)',
	'archived': '$(archive)'
};

/** H2 sections seeded into `notes.md` for each project type. */
const NOTES_SECTIONS: Record<ProjectType, string[]> = {
	'patent-analysis': ['Patent Under Analysis', 'Claim Map', 'Prior Art of Record', 'Findings', 'Open Questions'],
	'prior-art-search': ['Search Scope', 'Search Queries', 'Relevant References', 'Gaps', 'References'],
	'freedom-to-operate': ['Product / Feature', 'Blocking Patents', 'Claim Charts', 'Design-Arounds', 'Conclusion'],
	'patent-landscape': ['Technology Scope', 'Key Players', 'Trends', 'Notable Patents', 'References'],
	'claim-analysis': ['Claims', 'Element Breakdown', 'Support in Specification', 'Findings', 'Open Questions'],
	'custom': ['Key Findings', 'Open Questions', 'References']
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
	const typeLabel = PROJECT_TYPE_LABELS[projectType];
	const body = NOTES_SECTIONS[projectType].map(section => `## ${section}\n\n`).join('\n');
	return `# ${projectName}\n\n> ${typeLabel}\n\n${body}`;
}

/** Convert a project name into a filesystem-safe folder name. */
function toFolderName(name: string): string {
	return name.replace(/[<>:"/\\|?*]/g, '-').trim();
}

/**
 * Validate a project name for the creation and rename input boxes: non-empty, yields a usable
 * folder name, and does not collide with an existing project's folder (excluding `currentPath`,
 * so renaming a project to its own name is allowed).
 */
function validateProjectName(value: string, existing: PatentProject[], currentPath?: string): string | undefined {
	const trimmed = value.trim();
	if (!trimmed) {
		return 'Project name cannot be empty';
	}
	const folderName = toFolderName(trimmed);
	if (!folderName) {
		return 'Project name must contain a usable character';
	}
	const targetPath = path.join(getProjectsDirectory(), folderName);
	if (existing.some(p => p.path === targetPath && p.path !== currentPath)) {
		return `A project named "${folderName}" already exists`;
	}
	return undefined;
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

	// Register Project Sidebar (native tree)
	projectSidebarProvider = new ProjectTreeProvider(context);
	context.subscriptions.push(
		vscode.window.registerTreeDataProvider('flowleap.projectSidebar', projectSidebarProvider)
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

	// Open FlowLeap settings — the FlowLeap Settings sidebar (patent-data key fields + BYOK
	// entry), owned by the Patent Agent extension and invoked by command string (same
	// cross-extension pattern as flowleap.signIn). It links out to the native @flowleap
	// preferences.
	context.subscriptions.push(
		vscode.commands.registerCommand('flowleap.openSettings', () => {
			return vscode.commands.executeCommand('flowleap.patentDataKeys');
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
				const typeItems = (Object.keys(PROJECT_TYPE_INFO) as ProjectType[]).map(type => ({
					label: `${PROJECT_TYPE_INFO[type].icon} ${PROJECT_TYPE_LABELS[type]}`,
					description: PROJECT_TYPE_INFO[type].description,
					type
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
			const projectName = await vscode.window.showInputBox({
				prompt: 'Project name',
				placeHolder: PROJECT_TYPE_INFO[projectType].placeholder,
				title: `New ${PROJECT_TYPE_LABELS[projectType]}`,
				validateInput: value => validateProjectName(value, getStoredProjects(context))
			});

			if (!projectName) {
				return;
			}

			// Sanitize folder name
			const folderName = toFolderName(projectName);
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
					status: 'active' as ProjectStatus,
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
					status: 'active',
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

			const statusItems = (Object.keys(PROJECT_STATUS_LABELS) as DisplayStatus[]).map(status => ({
				label: `${STATUS_PICK_ICONS[status]} ${PROJECT_STATUS_LABELS[status]}`,
				status
			}));

			const picked = await vscode.window.showQuickPick(statusItems, {
				placeHolder: 'Set project status'
			});

			if (!picked) {
				return;
			}

			// "Archived" is persisted through the separate `archived` flag; the three working
			// statuses clear it. Writing here also lazily rewrites any legacy stored status.
			const nowArchived = picked.status === 'archived';

			// Update config.json
			const config = await readProjectConfig(projectPath) ?? {};
			config.archived = nowArchived;
			if (picked.status !== 'archived') {
				config.status = picked.status;
			}
			await writeProjectConfig(projectPath, config);

			// Update globalState
			const storedProjects = getStoredProjects(context);
			const stored = storedProjects.find(p => p.path === projectPath);
			if (stored) {
				stored.archived = nowArchived;
				if (picked.status !== 'archived') {
					stored.status = picked.status;
				}
				await saveStoredProjects(context, storedProjects);
			}

			refreshProjectViews();
			vscode.window.showInformationMessage(`Status set to ${PROJECT_STATUS_LABELS[picked.status]}`);
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

	// Rename project — renames the folder and updates config + stored state together.
	context.subscriptions.push(
		vscode.commands.registerCommand('flowleap.renameProject', async (projectOrPath?: PatentProject | string) => {
			const projectPath = resolveProjectPath(projectOrPath);
			if (!projectPath) {
				vscode.window.showWarningMessage('No project selected');
				return;
			}

			const storedProjects = getStoredProjects(context);
			const stored = storedProjects.find(p => p.path === projectPath);
			const currentName = stored?.name ?? path.basename(projectPath);

			const newName = await vscode.window.showInputBox({
				prompt: 'New project name',
				title: 'Rename Project',
				value: currentName,
				validateInput: value => validateProjectName(value, storedProjects, projectPath)
			});

			if (!newName || newName.trim() === currentName) {
				return;
			}

			const newPath = path.join(getProjectsDirectory(), toFolderName(newName));

			try {
				if (newPath !== projectPath) {
					// Guard against a folder that exists on disk but is not a tracked project.
					let exists = true;
					try {
						await vscode.workspace.fs.stat(vscode.Uri.file(newPath));
					} catch {
						exists = false;
					}
					if (exists) {
						vscode.window.showErrorMessage(`A folder named "${toFolderName(newName)}" already exists`);
						return;
					}
					await vscode.workspace.fs.rename(vscode.Uri.file(projectPath), vscode.Uri.file(newPath), { overwrite: false });
				}

				// Update config.json.
				const config = await readProjectConfig(newPath) ?? {};
				config.name = newName;
				await writeProjectConfig(newPath, config);

				// Update globalState (name + path + id all move together).
				if (stored) {
					stored.name = newName;
					stored.path = newPath;
					stored.id = newPath;
					await saveStoredProjects(context, storedProjects);
				}

				refreshProjectViews();

				const isOpenWorkspace = vscode.workspace.workspaceFolders?.some(f => f.uri.fsPath === projectPath) ?? false;
				if (isOpenWorkspace && newPath !== projectPath) {
					const choice = await vscode.window.showInformationMessage(
						`Renamed to "${newName}". Reopen the folder to continue working in it.`,
						'Reopen'
					);
					if (choice === 'Reopen') {
						await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(newPath));
					}
				} else {
					vscode.window.showInformationMessage(`Project renamed to "${newName}"`);
				}
			} catch (error) {
				vscode.window.showErrorMessage(`Failed to rename project: ${error}`);
			}
		})
	);

	// Delete project — moves the folder to the OS trash (never a hard delete) after confirmation.
	context.subscriptions.push(
		vscode.commands.registerCommand('flowleap.deleteProject', async (projectOrPath?: PatentProject | string) => {
			const projectPath = resolveProjectPath(projectOrPath);
			if (!projectPath) {
				vscode.window.showWarningMessage('No project selected');
				return;
			}

			const storedProjects = getStoredProjects(context);
			const stored = storedProjects.find(p => p.path === projectPath);
			const name = stored?.name ?? path.basename(projectPath);

			const confirm = await vscode.window.showWarningMessage(
				`Delete "${name}"? The project folder will be moved to the trash.`,
				{ modal: true },
				'Delete'
			);
			if (confirm !== 'Delete') {
				return;
			}

			try {
				await vscode.workspace.fs.delete(vscode.Uri.file(projectPath), { recursive: true, useTrash: true });
			} catch (error) {
				vscode.window.showErrorMessage(`Failed to delete project: ${error}`);
				return;
			}

			await saveStoredProjects(context, storedProjects.filter(p => p.path !== projectPath));
			refreshProjectViews();

			const isOpenWorkspace = vscode.workspace.workspaceFolders?.some(f => f.uri.fsPath === projectPath) ?? false;
			if (isOpenWorkspace) {
				const choice = await vscode.window.showInformationMessage(
					`"${name}" was moved to the trash. Close this folder?`,
					'Close Folder'
				);
				if (choice === 'Close Folder') {
					await vscode.commands.executeCommand('workbench.action.closeFolder');
				}
			} else {
				vscode.window.showInformationMessage(`"${name}" moved to the trash`);
			}
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
