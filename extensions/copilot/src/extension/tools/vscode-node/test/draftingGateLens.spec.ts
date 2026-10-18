/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { describe, expect, it, vi } from 'vitest';
import { URI } from '../../../../util/vs/base/common/uri';
import { Range, WorkspaceEdit } from '../../../../vscodeTypes';
import { DraftFinding } from '../../common/drafting/finding';
import { renderFindingsFile } from '../../common/drafting/findingsFile';
import { DraftingGateDocument, draftingGateEdit, DraftingGateLensProvider, draftingWaiverEdit, DraftingWaiverLensProvider } from '../draftingGateLens';

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

/** Ten `antecedent-basis` Errors of one rule (the shape of #747), one other Error, one waived Error, an Inventor Question and a Note. */
const findingsText = renderFindingsFile([
	...Array.from({ length: 10 }, (_, index): DraftFinding => ({ severity: 'Error', rule: 'antecedent-basis', file: 'claims.md', line: index + 3, claim: index + 2, message: `Claim ${index + 2}: "the clamp body" has no antecedent basis ("a clamp body") earlier in claim ${index + 2} or in the claims it depends on.` })),
	{ severity: 'Error', rule: 'defined-term', file: 'draft-application.md', line: 12, message: 'Line 12 writes "clamp-body"; the defined term is "clamp body".' },
	{ severity: 'Error', rule: 'source-marker', file: 'draft-application.md', line: 20, message: 'The paragraph at line 20 has no source marker.', waived: { reason: 'Boilerplate.' } },
	{ severity: 'Error', rule: 'inventor-question', file: 'draft-application.md', line: 40, message: 'Inventor Question IQ-1 is open: What is the clamp made of?' },
	{ severity: 'Note', rule: 'claim-count', file: 'claims.md', message: '11 claims in total.' },
])
	// An item with sub-lines: an attorney note and a waiver line without a reason (it waives nothing).
	.replace(/(- `defined-term`[^\n]*)/, '$1\n  - Note: client spelling?\n  - Waived:');

describe('Drafting waiver CodeLens', () => {
	it('shows "Waive…" on each unwaived Error and "Waive all" on the first of a rule with more than two; writes the reason under each item, nothing on cancel or an empty reason', async () => {
		const document = documentOf('findings.md', findingsText);
		const lenses = new DraftingWaiverLensProvider().provideCodeLenses(document).map(lens => ({ line: lens.range.start.line + 1, title: lens.command?.title, command: lens.command?.command, fileLines: lens.command?.arguments?.[1] }));
		const bulk = lenses.find(lens => lens.title?.startsWith('Waive all'))!.fileLines;
		const defined = lenses.at(-1)!.fileLines;
		const prompts: string[] = [];
		const answer = (reason: string | undefined) => async (prompt: string) => { prompts.push(prompt); return reason; };
		expect({
			lenses,
			bulk: applied(findingsText, await draftingWaiverEdit(document, bulk, answer('False positive of #747: "a clamp body" is in claim 1.'))),
			single: applied(findingsText, await draftingWaiverEdit(document, defined, answer('Client spelling.'))),
			cancelled: await draftingWaiverEdit(document, defined, answer(undefined)),
			empty: await draftingWaiverEdit(document, defined, answer('  ')),
			waivedItem: await draftingWaiverEdit(document, [findingsText.split('\n').findIndex(line => line.includes('`source-marker`')) + 1], answer('Again.')),
			prompts,
			gateLensesOnFindings: new DraftingGateLensProvider().provideCodeLenses(document),
		}).toMatchSnapshot();
	});
});
