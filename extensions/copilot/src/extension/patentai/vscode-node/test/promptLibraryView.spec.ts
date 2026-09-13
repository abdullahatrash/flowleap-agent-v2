/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { Uri } from '../../../../vscodeTypes';
import { buildPromptTree, PromptEntry, PromptSource, PromptTreeNode } from '../promptLibraryView';

function entry(name: string, source: PromptSource, body = 'Body text', description = 'A description'): PromptEntry {
	return { name, description, body, uri: Uri.file(`/prompts/${name}.prompt.md`), source };
}

/** Group labels with the labels of their children — enough to see ordering and the empty state. */
function shape(nodes: readonly PromptTreeNode[]): unknown {
	return nodes.map(node => node.kind === 'group'
		? { group: node.label, children: node.children.map(child => `${child.kind}:${child.label}`) }
		: { other: node.kind });
}

describe('buildPromptTree', () => {

	it('puts the bundled prompts in their shipped order and the user prompts alphabetically', () => {
		const bundled = [
			entry('flowleap-claim-analysis', 'bundled'),
			entry('flowleap-prior-art-search', 'bundled'),
			entry('flowleap-literature-review', 'bundled'),
		];
		const user = [entry('zebra-check', 'user'), entry('alpha-check', 'user')];

		expect(shape(buildPromptTree(bundled, user))).toEqual([
			{ group: 'FlowLeap', children: ['prompt:Prior-art search', 'prompt:Claim analysis', 'prompt:Literature review'] },
			{ group: 'My prompts', children: ['prompt:Alpha check', 'prompt:Zebra check'] },
		]);
	});

	it('shows a non-copyable placeholder when the user has written no prompts yet', () => {
		expect(shape(buildPromptTree([entry('flowleap-patent-dossier', 'bundled')], []))).toEqual([
			{ group: 'FlowLeap', children: ['prompt:Patent dossier'] },
			{ group: 'My prompts', children: ['placeholder:Add a prompt to reuse it later'] },
		]);
	});

	it('carries the body and a description-plus-excerpt tooltip on every leaf', () => {
		const long = 'x'.repeat(400);
		const [flowleapGroup] = buildPromptTree([entry('flowleap-patent-landscape', 'bundled', long, 'Map a technology area')], []);
		const leaf = flowleapGroup.kind === 'group' ? flowleapGroup.children[0] : undefined;

		expect(leaf?.kind === 'prompt' ? { body: leaf.entry.body.length, tooltip: leaf.tooltip.length, id: leaf.id } : undefined).toEqual({
			body: 400,
			tooltip: 'Map a technology area'.length + 2 + 300,
			id: 'bundled:flowleap-patent-landscape',
		});
	});
});
