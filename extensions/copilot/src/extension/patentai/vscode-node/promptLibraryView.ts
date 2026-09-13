/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { IFileSystemService } from '../../../platform/filesystem/common/fileSystemService';
import { FileType } from '../../../platform/filesystem/common/fileTypes';
import { IVSCodeExtensionContext } from '../../../platform/extContext/common/extensionContext';
import { ILogService } from '../../../platform/log/common/logService';
import { compareBundledPromptNames, humanisePromptName, parsePromptFile, slugifyPromptTitle, uniquePromptSlug } from '../common/promptFile';

/**
 * The "Prompts" view under the FlowLeap activity-bar container (PRD 0014), contributed by this
 * extension INTO the flowleap shell's `flowleap-sidebar` container next to Projects and Setup.
 *
 * It lists the prompts this extension ships (also reachable as `/flowleap-*` slash commands) and
 * the prompts the user writes into global storage, and gives each one a Copy action. It never
 * touches the chat input: the owner decision for v1 is copy-only.
 */

export const PROMPT_LIBRARY_VIEW_ID = 'flowleap.promptLibrary';

export const PROMPT_LIBRARY_COPY_COMMAND = 'flowleap.promptLibrary.copy';
export const PROMPT_LIBRARY_ADD_COMMAND = 'flowleap.promptLibrary.add';
export const PROMPT_LIBRARY_EDIT_COMMAND = 'flowleap.promptLibrary.edit';
export const PROMPT_LIBRARY_DELETE_COMMAND = 'flowleap.promptLibrary.delete';
export const PROMPT_LIBRARY_REFRESH_COMMAND = 'flowleap.promptLibrary.refresh';

/** Folder under `globalStorageUri` that holds the user's own prompts. */
const USER_PROMPT_FOLDER = 'prompt-library';

/** Suffix every prompt file carries — the same one core's prompt-file contribution expects. */
const PROMPT_FILE_SUFFIX = '.prompt.md';

/** How much of the body the tooltip previews under the description. */
const TOOLTIP_BODY_PREVIEW_LENGTH = 300;

/** Where a prompt came from. Drives the `contextValue`, and so which actions the item offers. */
export type PromptSource = 'bundled' | 'user';

/** One prompt file, parsed and located. */
export interface PromptEntry {
	readonly name: string;
	readonly description: string;
	readonly body: string;
	readonly uri: vscode.Uri;
	readonly source: PromptSource;
}

/** A group header — "FlowLeap" or "My prompts". */
export interface PromptGroupNode {
	readonly kind: 'group';
	readonly id: string;
	readonly label: string;
	readonly children: readonly PromptTreeNode[];
}

/** A copyable prompt. */
export interface PromptLeafNode {
	readonly kind: 'prompt';
	readonly id: string;
	readonly label: string;
	readonly tooltip: string;
	readonly entry: PromptEntry;
}

/** The "My prompts" empty state. Carries no `contextValue`, so it offers no actions. */
export interface PromptPlaceholderNode {
	readonly kind: 'placeholder';
	readonly id: string;
	readonly label: string;
}

export type PromptTreeNode = PromptGroupNode | PromptLeafNode | PromptPlaceholderNode;

/** Description first, then the opening of the body, so hovering answers "what does this ask for?". */
function promptTooltip(entry: PromptEntry): string {
	const preview = entry.body.slice(0, TOOLTIP_BODY_PREVIEW_LENGTH);
	return entry.description ? `${entry.description}\n\n${preview}` : preview;
}

function promptLeaf(entry: PromptEntry): PromptLeafNode {
	return {
		kind: 'prompt',
		id: `${entry.source}:${entry.name}`,
		label: humanisePromptName(entry.name),
		tooltip: promptTooltip(entry),
		entry,
	};
}

/**
 * Compose the two groups the view shows. Pure, so the ordering, the labelling and the empty state
 * are testable without a file system or a tree view.
 *
 * @param bundled Prompts shipped with the extension.
 * @param user Prompts the user wrote into global storage.
 */
export function buildPromptTree(bundled: readonly PromptEntry[], user: readonly PromptEntry[]): readonly PromptTreeNode[] {
	const bundledLeaves = [...bundled]
		.sort((a, b) => compareBundledPromptNames(a.name, b.name))
		.map(promptLeaf);
	const userLeaves = [...user]
		.sort((a, b) => humanisePromptName(a.name).localeCompare(humanisePromptName(b.name)))
		.map(promptLeaf);

	const userChildren: readonly PromptTreeNode[] = userLeaves.length > 0
		? userLeaves
		: [{ kind: 'placeholder', id: 'user:empty', label: l10n.t('Add a prompt to reuse it later') }];

	return [
		{ kind: 'group', id: 'group:flowleap', label: l10n.t('FlowLeap'), children: bundledLeaves },
		{ kind: 'group', id: 'group:user', label: l10n.t('My prompts'), children: userChildren },
	];
}

/** Reads both prompt sources off disk. Missing or unreadable folders read as "no prompts". */
class PromptLibrary {

	constructor(
		private readonly _bundledDir: vscode.Uri,
		readonly userDir: vscode.Uri,
		private readonly _fileSystemService: IFileSystemService,
		private readonly _logService: ILogService,
	) { }

	/** Create the user folder so the watcher has something to watch and Add has somewhere to write. */
	async ensureUserDirectory(): Promise<void> {
		try {
			await this._fileSystemService.createDirectory(this.userDir);
		} catch (err) {
			this._logService.warn(`[Patent AI] Prompt library: cannot create ${this.userDir.toString()}: ${err}`);
		}
	}

	async readBundled(): Promise<PromptEntry[]> {
		return this._read(this._bundledDir, 'bundled');
	}

	async readUser(): Promise<PromptEntry[]> {
		return this._read(this.userDir, 'user');
	}

	/** Slugs already taken in the user folder, so Add can pick a free one. */
	async userSlugs(): Promise<string[]> {
		return (await this._listPromptFiles(this.userDir)).map(stem => stem);
	}

	private async _listPromptFiles(dir: vscode.Uri): Promise<string[]> {
		try {
			const entries = await this._fileSystemService.readDirectory(dir);
			return entries
				.filter(([name, type]) => type === FileType.File && name.endsWith(PROMPT_FILE_SUFFIX))
				.map(([name]) => name.slice(0, -PROMPT_FILE_SUFFIX.length));
		} catch {
			// A folder that does not exist yet (fresh profile) simply holds no prompts.
			return [];
		}
	}

	private async _read(dir: vscode.Uri, source: PromptSource): Promise<PromptEntry[]> {
		const stems = await this._listPromptFiles(dir);
		const entries: PromptEntry[] = [];
		for (const stem of stems) {
			const uri = vscode.Uri.joinPath(dir, `${stem}${PROMPT_FILE_SUFFIX}`);
			try {
				const bytes = await this._fileSystemService.readFile(uri);
				const parsed = parsePromptFile(new TextDecoder().decode(bytes), stem);
				entries.push({ ...parsed, uri, source });
			} catch (err) {
				this._logService.warn(`[Patent AI] Prompt library: cannot read ${uri.toString()}: ${err}`);
			}
		}
		return entries;
	}
}

class PromptLibraryTreeProvider implements vscode.TreeDataProvider<PromptTreeNode> {

	private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
	readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

	constructor(private readonly _library: PromptLibrary) { }

	refresh(): void {
		this._onDidChangeTreeData.fire();
	}

	async getChildren(element?: PromptTreeNode): Promise<PromptTreeNode[]> {
		if (!element) {
			const [bundled, user] = await Promise.all([this._library.readBundled(), this._library.readUser()]);
			return [...buildPromptTree(bundled, user)];
		}
		return element.kind === 'group' ? [...element.children] : [];
	}

	getTreeItem(node: PromptTreeNode): vscode.TreeItem {
		if (node.kind === 'group') {
			const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.Expanded);
			item.id = node.id;
			item.contextValue = 'flowleap.promptGroup';
			return item;
		}
		if (node.kind === 'placeholder') {
			const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None);
			item.id = node.id;
			item.iconPath = new vscode.ThemeIcon('info');
			return item;
		}
		const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None);
		item.id = node.id;
		item.tooltip = node.tooltip;
		item.iconPath = new vscode.ThemeIcon('note');
		item.contextValue = `flowleap.prompt.${node.entry.source}`;
		item.command = { command: 'vscode.open', title: l10n.t('Open Prompt'), arguments: [node.entry.uri] };
		return item;
	}
}

/** Front matter plus a starter line, so a new file is a valid prompt before the user types. */
function newPromptFileContents(slug: string, title: string): string {
	return `---\nname: ${slug}\ndescription: ${title}\n---\n${l10n.t('Write the prompt here.')}\n`;
}

async function openPrompt(uri: vscode.Uri): Promise<void> {
	await vscode.commands.executeCommand('vscode.open', uri);
}

/** The leaf a view action was invoked on, or `undefined` when it came from the command palette. */
function asPromptLeaf(node: PromptTreeNode | undefined): PromptLeafNode | undefined {
	return node?.kind === 'prompt' ? node : undefined;
}

function registerCopyCommand(): vscode.Disposable {
	return vscode.commands.registerCommand(PROMPT_LIBRARY_COPY_COMMAND, async (node?: PromptTreeNode) => {
		const leaf = asPromptLeaf(node);
		if (!leaf) {
			return;
		}
		await vscode.env.clipboard.writeText(leaf.entry.body);
		vscode.window.setStatusBarMessage(l10n.t('Prompt copied'), 3000);
	});
}

function registerAddCommand(library: PromptLibrary, provider: PromptLibraryTreeProvider, fileSystemService: IFileSystemService, logService: ILogService): vscode.Disposable {
	return vscode.commands.registerCommand(PROMPT_LIBRARY_ADD_COMMAND, async () => {
		const title = await vscode.window.showInputBox({
			title: l10n.t('New Prompt'),
			prompt: l10n.t('Name this prompt so you can find it later.'),
			placeHolder: l10n.t('Prior-art search for battery patents'),
		});
		if (!title) {
			return;
		}

		await library.ensureUserDirectory();
		const slug = uniquePromptSlug(slugifyPromptTitle(title), await library.userSlugs());
		const uri = vscode.Uri.joinPath(library.userDir, `${slug}${PROMPT_FILE_SUFFIX}`);
		try {
			await fileSystemService.writeFile(uri, new TextEncoder().encode(newPromptFileContents(slug, title.trim())));
		} catch (err) {
			logService.error(`[Patent AI] Prompt library: cannot write ${uri.toString()}: ${err}`);
			vscode.window.showErrorMessage(l10n.t('Could not create the prompt file.'));
			return;
		}
		provider.refresh();
		await openPrompt(uri);
	});
}

function registerEditCommand(): vscode.Disposable {
	return vscode.commands.registerCommand(PROMPT_LIBRARY_EDIT_COMMAND, async (node?: PromptTreeNode) => {
		const leaf = asPromptLeaf(node);
		if (leaf) {
			await openPrompt(leaf.entry.uri);
		}
	});
}

function registerDeleteCommand(provider: PromptLibraryTreeProvider, fileSystemService: IFileSystemService, logService: ILogService): vscode.Disposable {
	return vscode.commands.registerCommand(PROMPT_LIBRARY_DELETE_COMMAND, async (node?: PromptTreeNode) => {
		const leaf = asPromptLeaf(node);
		if (!leaf || leaf.entry.source !== 'user') {
			return;
		}
		const confirm = l10n.t('Delete');
		const answer = await vscode.window.showWarningMessage(
			l10n.t('Delete the prompt "{0}"?', leaf.label),
			{ modal: true, detail: l10n.t('This removes the prompt file. It cannot be undone.') },
			confirm,
		);
		if (answer !== confirm) {
			return;
		}
		try {
			// No trash: the file lives in extension global storage, which is not always on a volume
			// with a usable trash. The modal above already warned that the delete is final.
			await fileSystemService.delete(leaf.entry.uri);
		} catch (err) {
			logService.error(`[Patent AI] Prompt library: cannot delete ${leaf.entry.uri.toString()}: ${err}`);
			vscode.window.showErrorMessage(l10n.t('Could not delete the prompt file.'));
			return;
		}
		provider.refresh();
	});
}

/**
 * Register the Prompts tree view, its actions, and the watcher that keeps it in step with the
 * user's prompt folder.
 *
 * @param context Extension context, for the bundled prompt folder and global storage.
 * @param fileSystemService Reads and writes the prompt files.
 * @param logService Records unreadable or unwritable prompt files.
 */
export function registerPromptLibraryView(context: IVSCodeExtensionContext, fileSystemService: IFileSystemService, logService: ILogService): vscode.Disposable {
	const bundledDir = vscode.Uri.joinPath(context.extensionUri, 'assets', 'prompts', 'flowleap');
	const userDir = vscode.Uri.joinPath(context.globalStorageUri, USER_PROMPT_FOLDER);
	const library = new PromptLibrary(bundledDir, userDir, fileSystemService, logService);
	const provider = new PromptLibraryTreeProvider(library);

	const watcher = fileSystemService.createFileSystemWatcher(new vscode.RelativePattern(userDir, `*${PROMPT_FILE_SUFFIX}`));
	const disposables: vscode.Disposable[] = [
		vscode.window.registerTreeDataProvider(PROMPT_LIBRARY_VIEW_ID, provider),
		watcher,
		watcher.onDidCreate(() => provider.refresh()),
		watcher.onDidChange(() => provider.refresh()),
		watcher.onDidDelete(() => provider.refresh()),
		registerCopyCommand(),
		registerAddCommand(library, provider, fileSystemService, logService),
		registerEditCommand(),
		registerDeleteCommand(provider, fileSystemService, logService),
		vscode.commands.registerCommand(PROMPT_LIBRARY_REFRESH_COMMAND, () => provider.refresh()),
	];

	// The folder only has to exist before the first Add, but creating it now means the watcher has
	// a real directory to follow from the start.
	void library.ensureUserDirectory();

	logService.info('[Patent AI] FlowLeap Prompts view registered');
	return vscode.Disposable.from(...disposables);
}
