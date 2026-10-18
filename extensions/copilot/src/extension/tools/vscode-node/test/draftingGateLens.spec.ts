/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { describe, expect, it, vi } from 'vitest';
import { URI } from '../../../../util/vs/base/common/uri';
import { Range, WorkspaceEdit } from '../../../../vscodeTypes';
import { DraftingGateDocument, draftingGateEdit, DraftingGateLensProvider } from '../draftingGateLens';

vi.mock('../../../../vscodeTypes', async () => import('../../../../util/common/test/shims/vscodeTypesShim'));

const help = '# Review, then change false to true below, or click the action at the top.';

/** An in-memory text document of a drafting file. */
function documentOf(path: string, text: string): DraftingGateDocument {
	return { uri: URI.file(`/workspace/drafting/hinge/${path}`), getText: () => text };
}

/** The text of the document after the edit, the way the editor applies it. */
function applied(text: string, edit: WorkspaceEdit | undefined): string | undefined {
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

describe('Drafting gate CodeLens', () => {
	it('names the action at line 1, is inert on a set flag, and writes only the flag line', () => {
		const cases: [string, string][] = [
			['feature-list.md', `---\noffice: US\n${help}\nconfirmed: false\n---\n| F1 | lever |\n`],
			['claims.md', `---\n${help}\napproved: false\n---\n1. A hinge.\n`],
			['claims.md', '---\noffice: US\n---\n1. A hinge.\n'],
			['claims.md', '1. A hinge.\n'],
			['claims.md', `---\n${help}\napproved: true\n---\n1. A hinge.\n`],
			['feature-list.md', '---\nconfirmed: true\n---\n| F1 | lever |\n'],
			['draft-application.md', '---\noffice: US\n---\nText.\n'],
		];
		const provider = new DraftingGateLensProvider();
		const results = cases.map(([path, text]) => {
			const document = documentOf(path, text);
			return {
				lenses: provider.provideCodeLenses(document).map(lens => ({ line: lens.range.start.line, title: lens.command?.title, command: lens.command?.command, arguments: lens.command?.arguments?.map(String) })),
				after: applied(text, draftingGateEdit(document)),
			};
		});
		expect(results).toMatchSnapshot();
	});
});
