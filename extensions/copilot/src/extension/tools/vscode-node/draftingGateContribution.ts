/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { Disposable } from '../../../util/vs/base/common/lifecycle';
import { IExtensionContribution } from '../../common/contributions';
import { DRAFTING_WAIVE_COMMAND_ID } from '../common/drafting/findingsFile';
import { DRAFTING_GATE_COMMAND_ID } from '../common/drafting/frontmatter';
import { AskWaiverReason, DRAFTING_FINDINGS_SELECTOR, DRAFTING_GATE_SELECTOR, draftingGateEdit, DraftingGateLensProvider, draftingWaiverEdit, DraftingWaiverLensProvider } from './draftingGateLens';

/**
 * The gate actions of Application Drafting (ADR 0012, PRD 0025 S2 and S4). A click on the
 * CodeLens at the top of `feature-list.md` or `claims.md` writes the gate flag into the file and
 * saves it, so the drafting tools read the flag from the file. A click on "Waive…" in
 * `findings.md` asks the reason and writes the waiver under the item. The commands are editor
 * commands and not tools: the model cannot write a gate flag or a waiver.
 */
export class DraftingGateContribution extends Disposable implements IExtensionContribution {
	readonly id = 'draftingGates';

	constructor(askReason: AskWaiverReason = prompt => vscode.window.showInputBox({ prompt, ignoreFocusOut: true })) {
		super();
		this._register(vscode.languages.registerCodeLensProvider(DRAFTING_GATE_SELECTOR, new DraftingGateLensProvider()));
		this._register(vscode.commands.registerCommand(DRAFTING_GATE_COMMAND_ID, (uri: vscode.Uri) => setGateFlag(uri)));
		this._register(vscode.languages.registerCodeLensProvider(DRAFTING_FINDINGS_SELECTOR, new DraftingWaiverLensProvider()));
		this._register(vscode.commands.registerCommand(DRAFTING_WAIVE_COMMAND_ID, (uri: vscode.Uri, fileLines: number[]) => writeWaivers(uri, fileLines, askReason)));
	}
}

/** Asks the reason, writes the waivers under the items at `fileLines` through a WorkspaceEdit, then saves the file. */
async function writeWaivers(uri: vscode.Uri, fileLines: number[], askReason: AskWaiverReason): Promise<void> {
	const document = await vscode.workspace.openTextDocument(uri);
	const edit = await draftingWaiverEdit(document, fileLines, askReason);
	if (edit && await vscode.workspace.applyEdit(edit)) {
		await document.save();
	}
}

/** Writes the gate flag of the file at `uri` through a WorkspaceEdit, then saves the file. */
async function setGateFlag(uri: vscode.Uri): Promise<void> {
	const document = await vscode.workspace.openTextDocument(uri);
	const edit = draftingGateEdit(document);
	if (edit && await vscode.workspace.applyEdit(edit)) {
		await document.save();
	}
}
