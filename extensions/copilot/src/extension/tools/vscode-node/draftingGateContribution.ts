/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { IFileSystemService } from '../../../platform/filesystem/common/fileSystemService';
import { IWorkspaceService } from '../../../platform/workspace/common/workspaceService';
import { Disposable } from '../../../util/vs/base/common/lifecycle';
import { extUriBiasedIgnorePathCase } from '../../../util/vs/base/common/resources';
import { URI } from '../../../util/vs/base/common/uri';
import { IInstantiationService } from '../../../util/vs/platform/instantiation/common/instantiation';
import { WorkspaceEdit } from '../../../vscodeTypes';
import { IExtensionContribution } from '../../common/contributions';
import { DRAFTING_WAIVE_COMMAND_ID, DRAFTING_WAIVE_ERRORS_COMMAND_ID } from '../common/drafting/findingsFile';
import { DRAFTING_FILE_NAMES, DraftingFolder, matchDraftingPath, resolveDraftingFolder } from '../common/drafting/folderContract';
import { DRAFTING_GATE_BUTTON_COMMAND_IDS, DRAFTING_GATE_COMMAND_ID, DraftingGateFlag, parseDraftingFrontmatter, readGateFlag } from '../common/drafting/frontmatter';
import { AskWaiverReason, DRAFTING_FINDINGS_SELECTOR, DRAFTING_GATE_SELECTOR, DraftingActionFile, draftingGateEdit, DraftingGateDocument, DraftingGateLensProvider, draftingPreviewFile, draftingWaiverEdit, DraftingWaiverLensProvider, DraftingWaiveChoice, findingsWaiveChoices } from './draftingGateLens';
import { DraftingEditors, DraftingWorkspace, vscodeEditors } from './draftingWorkspace';

/** The context key that names the {@link DraftingActionFile} the active markdown preview shows; the editor-title buttons of the preview read it. */
const PREVIEW_FILE_CONTEXT_KEY = 'flowleap.drafting.previewFile';

/** A text document of a drafting file, as the gate actions use it: the text the edits read, and the save after the edit. */
export type DraftingGateTextDocument = DraftingGateDocument & Pick<vscode.TextDocument, 'save'>;

/** A drafting file the attorney can pick when more than one matter has the file. */
interface DraftingFilePick extends vscode.QuickPickItem {
	readonly uri: vscode.Uri;
}

/**
 * The window, as the gate actions use it: documents, edits, the input box, the quick pick, the
 * file search and the message. The default is the VS Code window; the tests, which have no
 * window, inject a fake over the file system.
 */
export interface DraftingGateWindow {
	openDocument(uri: vscode.Uri): Thenable<DraftingGateTextDocument>;
	/** Applies the edit; false when the editor did not apply it. */
	applyEdit(edit: WorkspaceEdit): Thenable<boolean>;
	askReason: AskWaiverReason;
	/** Asks the attorney to pick one item; `undefined` when the attorney cancels. */
	pick<T extends vscode.QuickPickItem>(items: readonly T[], placeHolder: string): Thenable<T | undefined>;
	/** The files of the workspace that match the glob. */
	findFiles(pattern: string): Thenable<readonly vscode.Uri[]>;
	/** Tells the attorney why nothing was written. */
	inform(message: string): void;
}

/** The VS Code window as {@link DraftingGateWindow}. */
const vscodeGateWindow: DraftingGateWindow = {
	openDocument: uri => vscode.workspace.openTextDocument(uri),
	applyEdit: edit => vscode.workspace.applyEdit(edit),
	askReason: prompt => vscode.window.showInputBox({ prompt, ignoreFocusOut: true }),
	pick: (items, placeHolder) => vscode.window.showQuickPick(items, { placeHolder, ignoreFocusOut: true }),
	findFiles: pattern => vscode.workspace.findFiles(pattern),
	inform: message => { vscode.window.showInformationMessage(message); },
};

/**
 * The gate actions of Application Drafting (ADR 0012, PRD 0025 S2 and S4), behind the CodeLens
 * and the editor-title buttons: "Confirm Feature List", "Approve Claims" and the waivers. Each
 * action writes the file the attorney acted on through a WorkspaceEdit, saves it, then rewrites
 * `checklist.md` of the matter with the writer the drafting tools use, so the checklist shows the
 * new state at once (#785). The actions are editor commands and not tools: the model cannot write
 * a gate flag or a waiver.
 */
export class DraftingGateActions {

	constructor(
		private readonly workspaceService: IWorkspaceService,
		private readonly fileSystemService: IFileSystemService,
		private readonly instantiationService: IInstantiationService,
		private readonly window: DraftingGateWindow,
		private readonly editors: DraftingEditors,
	) { }

	/**
	 * Sets the gate flag of the Feature List (`confirmed`) or the claims (`approved`). `uri` is the
	 * file the attorney clicked; without a file of the matter (a click in the markdown preview,
	 * whose editor carries no file), the file is found in the workspace, with a pick when more
	 * than one matter has it.
	 */
	async setGateFlag(flag: DraftingGateFlag, uri: vscode.Uri | undefined): Promise<void> {
		const file = flag === 'confirmed' ? DRAFTING_FILE_NAMES.featureList : DRAFTING_FILE_NAMES.claims;
		const target = await this.resolve(file, uri);
		if (!target) {
			return;
		}
		const document = await this.window.openDocument(target.uri);
		const edit = draftingGateEdit(document);
		if (!edit) {
			const set = readGateFlag(parseDraftingFrontmatter(document.getText()).fields, flag) === 'set';
			this.window.inform(set
				? (flag === 'confirmed' ? l10n.t('The Feature List is confirmed already.') : l10n.t('The claims are approved already.'))
				: l10n.t('The block between the `---` lines at the top of {0} is not valid. Correct it by hand, then click again.', target.path));
			return;
		}
		await this.applyAndRefresh(document, edit, target);
	}

	/** Asks the reason and writes the waivers under the items at the 1-based `fileLines` of `findings.md` at `uri` (the CodeLens path). */
	async waive(uri: vscode.Uri, fileLines: readonly number[]): Promise<void> {
		const target = await this.resolve(DRAFTING_FILE_NAMES.findings, uri);
		if (target) {
			await this.waiveLines(target, fileLines);
		}
	}

	/**
	 * The "Waive Errors…" button: offers all open Errors of `findings.md`, or all open Errors of
	 * one rule, then asks one reason and writes it under each item of the choice.
	 */
	async waiveOpenErrors(uri: vscode.Uri | undefined): Promise<void> {
		const target = await this.resolve(DRAFTING_FILE_NAMES.findings, uri);
		if (!target) {
			return;
		}
		const choices = findingsWaiveChoices((await this.window.openDocument(target.uri)).getText());
		if (!choices.length) {
			this.window.inform(l10n.t('No open Error in {0}.', target.path));
			return;
		}
		const choice = await this.window.pick<DraftingWaiveChoice>(choices, l10n.t('Waive which Errors of {0}?', target.path));
		if (choice) {
			await this.waiveLines(target, choice.fileLines);
		}
	}

	private async waiveLines(target: DraftingFileTarget, fileLines: readonly number[]): Promise<void> {
		const document = await this.window.openDocument(target.uri);
		const edit = await draftingWaiverEdit(document, fileLines, this.window.askReason);
		if (edit) {
			await this.applyAndRefresh(document, edit, target);
		}
	}

	/** Applies the edit, saves the file, then rewrites `checklist.md` of the matter (#785). */
	private async applyAndRefresh(document: DraftingGateTextDocument, edit: WorkspaceEdit, target: DraftingFileTarget): Promise<void> {
		if (!await this.window.applyEdit(edit)) {
			return;
		}
		await document.save();
		await new DraftingWorkspace(target.root, target.folder, this.fileSystemService, this.instantiationService, this.editors).writeChecklist();
	}

	/**
	 * The drafting file the action writes: `uri` when it is that file of a matter, else the one
	 * such file of the workspace, else the attorney's pick among them. `undefined` when the
	 * workspace has none or the attorney cancels.
	 */
	private async resolve(file: DraftingActionFile, uri: vscode.Uri | undefined): Promise<DraftingFileTarget | undefined> {
		const clicked = uri && this.target(file, uri);
		if (clicked) {
			return clicked;
		}
		const candidates = (await this.window.findFiles(`**/drafting/*/${file}`))
			.map(found => this.target(file, found))
			.filter((target): target is DraftingFileTarget => target !== undefined)
			.sort((a, b) => a.path.localeCompare(b.path));
		if (candidates.length === 1) {
			return candidates[0];
		}
		if (!candidates.length) {
			this.window.inform(l10n.t('No workspace folder has drafting/<matter>/{0}.', file));
			return undefined;
		}
		const picked = await this.window.pick<DraftingFilePick>(candidates.map(target => ({ label: target.path, uri: target.uri })), l10n.t('Which matter?'));
		return picked && candidates.find(target => target.uri === picked.uri);
	}

	/** The matter of `uri` when it is the drafting file `file` of a matter in a workspace folder. */
	private target(file: DraftingActionFile, uri: vscode.Uri): DraftingFileTarget | undefined {
		const resource = URI.from(uri);
		const root = this.workspaceService.getWorkspaceFolder(resource);
		const path = root ? extUriBiasedIgnorePathCase.relativePath(root, resource) : undefined;
		const matter = root && path !== undefined ? matchDraftingPath(path, file) : undefined;
		const folder = matter !== undefined ? resolveDraftingFolder(matter) : undefined;
		return root && folder && path !== undefined ? { uri, root, folder, path } : undefined;
	}
}

/** A drafting file of a matter in a workspace folder: the file, its folder, and its path in the folder. */
interface DraftingFileTarget {
	readonly uri: vscode.Uri;
	readonly root: URI;
	readonly folder: DraftingFolder;
	/** The workspace-relative path, e.g. `drafting/hinge/findings.md`. */
	readonly path: string;
}

/**
 * Registers the gate actions in the window: the CodeLens providers at the top of the gate files
 * and on the Error lines of `findings.md`, the commands behind them and behind the editor-title
 * buttons (#784), and the context key that lets the buttons show on the markdown preview, whose
 * editor carries no file.
 */
export class DraftingGateContribution extends Disposable implements IExtensionContribution {
	readonly id = 'draftingGates';

	constructor(
		@IWorkspaceService workspaceService: IWorkspaceService,
		@IFileSystemService fileSystemService: IFileSystemService,
		@IInstantiationService instantiationService: IInstantiationService,
	) {
		super();
		const actions = new DraftingGateActions(workspaceService, fileSystemService, instantiationService, vscodeGateWindow, vscodeEditors);
		this._register(vscode.languages.registerCodeLensProvider(DRAFTING_GATE_SELECTOR, new DraftingGateLensProvider()));
		this._register(vscode.languages.registerCodeLensProvider(DRAFTING_FINDINGS_SELECTOR, new DraftingWaiverLensProvider()));
		this._register(vscode.commands.registerCommand(DRAFTING_GATE_COMMAND_ID, (uri: vscode.Uri) => actions.setGateFlag(gateFlagOfFile(uri), uri)));
		this._register(vscode.commands.registerCommand(DRAFTING_WAIVE_COMMAND_ID, (uri: vscode.Uri, fileLines: number[]) => actions.waive(uri, fileLines)));
		this._register(vscode.commands.registerCommand(DRAFTING_GATE_BUTTON_COMMAND_IDS.confirmed, (uri?: vscode.Uri) => actions.setGateFlag('confirmed', uri)));
		this._register(vscode.commands.registerCommand(DRAFTING_GATE_BUTTON_COMMAND_IDS.approved, (uri?: vscode.Uri) => actions.setGateFlag('approved', uri)));
		this._register(vscode.commands.registerCommand(DRAFTING_WAIVE_ERRORS_COMMAND_ID, (uri?: vscode.Uri) => actions.waiveOpenErrors(uri)));
		this._register(vscode.window.tabGroups.onDidChangeTabs(() => this.updatePreviewContext()));
		this._register(vscode.window.tabGroups.onDidChangeTabGroups(() => this.updatePreviewContext()));
		this.updatePreviewContext();
	}

	/**
	 * Sets {@link PREVIEW_FILE_CONTEXT_KEY} to the drafting file the active markdown preview
	 * shows, read from its tab label, or clears it. The preview is a webview: its editor carries
	 * no file, so a `resourcePath` clause cannot match it.
	 */
	private updatePreviewContext(): void {
		const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
		const preview = tab?.input instanceof vscode.TabInputWebview && tab.input.viewType.endsWith('markdown.preview');
		vscode.commands.executeCommand('setContext', PREVIEW_FILE_CONTEXT_KEY, preview ? draftingPreviewFile(tab.label) : undefined);
	}
}

/** The gate flag of a gate file, from its name: `confirmed` for the Feature List, else `approved`. */
function gateFlagOfFile(uri: vscode.Uri): DraftingGateFlag {
	return uri.path.endsWith(`/${DRAFTING_FILE_NAMES.featureList}`) ? 'confirmed' : 'approved';
}
