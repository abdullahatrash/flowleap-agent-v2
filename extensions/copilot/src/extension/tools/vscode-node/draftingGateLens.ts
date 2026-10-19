/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import type * as vscode from 'vscode';
import { Position, Range, WorkspaceEdit } from '../../../vscodeTypes';
import { fieldLine } from '../common/drafting/checklist';
import { DRAFTING_WAIVE_COMMAND_ID, findingsWaiverInsertions, isWaivableError, parseFindingsFileItems } from '../common/drafting/findingsFile';
import { DRAFTING_FILE_NAMES } from '../common/drafting/folderContract';
import { DRAFTING_GATE_COMMAND_ID, DraftingGateFlag, parseDraftingFrontmatter, readGateFlag } from '../common/drafting/frontmatter';

/** The drafting files with an attorney action: the two gate files and the findings. The editor-title buttons show on them. */
export type DraftingActionFile = typeof DRAFTING_FILE_NAMES.featureList | typeof DRAFTING_FILE_NAMES.claims | typeof DRAFTING_FILE_NAMES.findings;

/** The {@link DraftingActionFile} a markdown preview shows, from its tab label ("Preview findings.md", "[Preview] claims.md"); `undefined` for any other label. */
export function draftingPreviewFile(label: string): DraftingActionFile | undefined {
	const files: DraftingActionFile[] = [DRAFTING_FILE_NAMES.featureList, DRAFTING_FILE_NAMES.claims, DRAFTING_FILE_NAMES.findings];
	return files.find(file => label === file || label.endsWith(` ${file}`));
}

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

/** The file the waiver CodeLens shows on: the findings of a matter. */
export const DRAFTING_FINDINGS_SELECTOR: vscode.DocumentFilter = { language: 'markdown', pattern: '**/drafting/*/findings.md' };

/** Asks the attorney for the reason of a waiver; `undefined` when the attorney cancels. */
export type AskWaiverReason = (prompt: string) => Thenable<string | undefined>;

/**
 * Shows "Waive…" on each unwaived Error line of `findings.md`. When one rule has more than two
 * unwaived Errors, the first of them also shows "Waive all N Errors of this rule". Both run
 * {@link DRAFTING_WAIVE_COMMAND_ID} with the file and the 1-based lines of the items.
 */
export class DraftingWaiverLensProvider implements vscode.CodeLensProvider {

	provideCodeLenses(document: DraftingGateDocument): vscode.CodeLens[] {
		const errors = parseFindingsFileItems(document.getText()).filter(isWaivableError);
		const lens = (fileLine: number, title: string, fileLines: number[]): vscode.CodeLens => ({
			range: new Range(fileLine - 1, 0, fileLine - 1, 0),
			isResolved: true,
			command: { title, command: DRAFTING_WAIVE_COMMAND_ID, arguments: [document.uri, fileLines] },
		});
		return errors.flatMap((item, index) => {
			const lenses = [lens(item.fileLine, l10n.t('Waive…'), [item.fileLine])];
			const rule = errors.filter(other => other.finding.rule === item.finding.rule);
			if (rule.length > 2 && errors.findIndex(other => other.finding.rule === item.finding.rule) === index) {
				lenses.push(lens(item.fileLine, l10n.t('Waive all {0} Errors of this rule', rule.length), rule.map(other => other.fileLine)));
			}
			return lenses;
		});
	}
}

/**
 * Asks the reason, then returns the edit that writes `  - Waived: <reason>` under each item of
 * `findings.md` at the 1-based `fileLines`, after the sub-lines of the item. `undefined` when
 * the attorney cancels or gives an empty reason, or when no item there is an unwaived Error.
 */
export async function draftingWaiverEdit(document: DraftingGateDocument, fileLines: readonly number[], askReason: AskWaiverReason): Promise<WorkspaceEdit | undefined> {
	const items = parseFindingsFileItems(document.getText()).filter(item => isWaivableError(item) && fileLines.includes(item.fileLine));
	if (!items.length) {
		return undefined;
	}
	const prompt = items.length === 1
		? l10n.t('Reason to waive the "{0}" Error. The reason is written under the item in findings.md.', items[0].finding.rule)
		: l10n.t('Reason to waive {0} Errors. The same reason is written under each item in findings.md.', items.length);
	const reason = await askReason(prompt);
	const text = document.getText();
	const insertions = findingsWaiverInsertions(text, items.map(item => item.fileLine), reason ?? '');
	if (!insertions.length) {
		return undefined;
	}
	const lines = text.split(/\r?\n/);
	const edit = new WorkspaceEdit();
	for (const { afterLine, text: waiver } of insertions) {
		edit.insert(document.uri, new Position(afterLine - 1, lines[afterLine - 1].length), `\n${waiver}`);
	}
	return edit;
}

/** One choice of the "Waive Errors…" button of `findings.md`: a quick pick item with the 1-based lines of the items it waives. */
export interface DraftingWaiveChoice extends vscode.QuickPickItem {
	readonly fileLines: readonly number[];
}

/**
 * The choices of the "Waive Errors…" button over the text of `findings.md`: "Waive all N open
 * Errors…" first, then one choice per rule with its count, in the order of the file. Empty when
 * no Error is open. One reason is written under each item of the choice.
 */
export function findingsWaiveChoices(text: string): DraftingWaiveChoice[] {
	const errors = parseFindingsFileItems(text).filter(isWaivableError);
	if (!errors.length) {
		return [];
	}
	const rules = [...new Set(errors.map(item => item.finding.rule))];
	return [
		{
			label: errors.length === 1 ? l10n.t('Waive the 1 open Error…') : l10n.t('Waive all {0} open Errors…', errors.length),
			description: l10n.t('one reason, written under each item'),
			fileLines: errors.map(item => item.fileLine),
		},
		...rules.map(rule => {
			const ofRule = errors.filter(item => item.finding.rule === rule);
			return {
				label: ofRule.length === 1 ? l10n.t('Waive the 1 Error of {0}…', rule) : l10n.t('Waive the {0} Errors of {1}…', ofRule.length, rule),
				description: ofRule[0].finding.message,
				fileLines: ofRule.map(item => item.fileLine),
			};
		}),
	];
}
