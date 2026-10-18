/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { Disposable } from '../../../util/vs/base/common/lifecycle';
import { IExtensionContribution } from '../../common/contributions';
import { DRAFTING_GATE_COMMAND_ID } from '../common/drafting/frontmatter';
import { DRAFTING_GATE_SELECTOR, draftingGateEdit, DraftingGateLensProvider } from './draftingGateLens';

/**
 * The gate actions of Application Drafting (ADR 0012, PRD 0025 S2). A click on the CodeLens at
 * the top of `feature-list.md` or `claims.md` writes the gate flag into the file and saves it,
 * so the drafting tools read the flag from the file. The command is an editor command and not a
 * tool: the model cannot write a gate flag.
 */
export class DraftingGateContribution extends Disposable implements IExtensionContribution {
	readonly id = 'draftingGates';

	constructor() {
		super();
		this._register(vscode.languages.registerCodeLensProvider(DRAFTING_GATE_SELECTOR, new DraftingGateLensProvider()));
		this._register(vscode.commands.registerCommand(DRAFTING_GATE_COMMAND_ID, (uri: vscode.Uri) => setGateFlag(uri)));
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
