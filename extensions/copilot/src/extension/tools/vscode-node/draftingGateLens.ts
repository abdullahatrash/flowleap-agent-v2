/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import type * as vscode from 'vscode';
import { Position, Range, WorkspaceEdit } from '../../../vscodeTypes';
import { fieldLine } from '../common/drafting/checklist';
import { DRAFTING_FILE_NAMES } from '../common/drafting/folderContract';
import { DRAFTING_GATE_COMMAND_ID, DraftingGateFlag, parseDraftingFrontmatter, readGateFlag } from '../common/drafting/frontmatter';

/** The files the gate CodeLens shows on: the Feature List and the claims of a matter. */
export const DRAFTING_GATE_SELECTOR: vscode.DocumentFilter = { language: 'markdown', pattern: '**/drafting/*/{feature-list,claims}.md' };

/** The part of a text document the gate CodeLens reads. */
export type DraftingGateDocument = Pick<vscode.TextDocument, 'uri' | 'getText'>;

/** The gate flag of a drafting file, from its file name. */
function gateFlagOf(uri: vscode.Uri): DraftingGateFlag | undefined {
	const name = uri.path.split('/').at(-1);
	return name === DRAFTING_FILE_NAMES.featureList ? 'confirmed' : name === DRAFTING_FILE_NAMES.claims ? 'approved' : undefined;
}

/**
 * The edit that sets the gate flag of `document` to `true`: it replaces the flag line, or adds
 * the line at the end of the frontmatter, or adds a frontmatter block when the file has none.
 * `undefined` when the flag is already `true`, when the file is not a gate file, or when its
 * frontmatter is not valid YAML (the attorney corrects it by hand).
 */
export function draftingGateEdit(document: DraftingGateDocument): WorkspaceEdit | undefined {
	const flag = gateFlagOf(document.uri);
	if (!flag) {
		return undefined;
	}
	const text = document.getText();
	const { fields, bodyStartLine } = parseDraftingFrontmatter(text);
	if (readGateFlag(fields, flag) === 'set') {
		return undefined;
	}
	const flagText = `${flag}: true`;
	const edit = new WorkspaceEdit();
	const line = fieldLine(text, flag);
	if (line !== undefined) {
		const content = text.split(/\r?\n/)[line - 1];
		edit.replace(document.uri, new Range(line - 1, 0, line - 1, content.length), flagText);
	} else if (bodyStartLine > 1) {
		edit.insert(document.uri, new Position(bodyStartLine - 2, 0), `${flagText}\n`);
	} else if (text.startsWith('---')) {
		return undefined;
	} else {
		edit.insert(document.uri, new Position(0, 0), `---\n${flagText}\n---\n`);
	}
	return edit;
}

/**
 * Shows the gate action at line 1 of `feature-list.md` ("Confirm Feature List") and
 * `claims.md` ("Approve Claims"). On a file whose flag is already `true` the lens is a
 * label with no command.
 */
export class DraftingGateLensProvider implements vscode.CodeLensProvider {

	provideCodeLenses(document: DraftingGateDocument): vscode.CodeLens[] {
		const flag = gateFlagOf(document.uri);
		if (!flag) {
			return [];
		}
		const range = new Range(0, 0, 0, 0);
		if (readGateFlag(parseDraftingFrontmatter(document.getText()).fields, flag) === 'set') {
			const title = flag === 'confirmed' ? l10n.t('Feature List confirmed') : l10n.t('Claims approved');
			return [{ range, isResolved: true, command: { title, command: '' } }];
		}
		if (!draftingGateEdit(document)) {
			return [];
		}
		const title = flag === 'confirmed' ? l10n.t('Confirm Feature List') : l10n.t('Approve Claims');
		return [{ range, isResolved: true, command: { title, command: DRAFTING_GATE_COMMAND_ID, arguments: [document.uri] } }];
	}
}
