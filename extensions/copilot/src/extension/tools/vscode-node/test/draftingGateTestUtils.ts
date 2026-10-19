/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { Range, WorkspaceEdit } from '../../../../vscodeTypes';

/** The text of a document after the edit, the way the editor applies it; `undefined` for no edit. */
export function applied(text: string, edit: WorkspaceEdit | undefined): string | undefined {
	if (!edit) {
		return undefined;
	}
	const offset = (lines: string[], line: number, character: number) => lines.slice(0, line).reduce((sum, content) => sum + content.length + 1, 0) + character;
	let result = text;
	for (const [, edits] of edit.entries()) {
		for (const { range, newText } of [...edits].reverse()) {
			const lines = result.split('\n');
			const { start, end }: Range = range;
			result = result.slice(0, offset(lines, start.line, start.character)) + newText + result.slice(offset(lines, end.line, end.character));
		}
	}
	return result;
}
