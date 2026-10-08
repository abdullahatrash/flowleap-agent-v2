/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { diffDraftParagraphs } from '../drafting/draftDiff';

const generated = [
	'---',
	'office: US',
	'version: 1',
	'---',
	'# Detailed Description',
	'',
	'<!-- src: feature:F1 -->',
	'The hinge 10 has a housing 12.',
	'',
	'<!-- src: model-proposed -->',
	'In some embodiments, the hinge is made of plastic.',
	'',
	'<!-- src: template -->',
	'The scope is defined by the claims.',
].join('\n');

describe('Application Drafting draft diff', () => {

	it('reports no change when only frontmatter and whitespace differ', () => {
		const edited = generated.replace('version: 1', 'version: 2').replace('has a housing', 'has  a\nhousing');
		expect(diffDraftParagraphs(generated, edited)).toEqual({ kept: 4, changes: [] });
	});

	it('lists changed, deleted and added paragraphs with the generated sources', () => {
		const edited = [
			'# Detailed Description',
			'',
			'<!-- src: feature:F1 -->',
			'The hinge 10 has a steel housing 12.',
			'',
			'<!-- src: template -->',
			'The scope is defined by the claims.',
			'',
			'The attorney adds this paragraph.',
		].join('\n');
		expect(diffDraftParagraphs(generated, edited)).toEqual({
			kept: 2,
			changes: [
				{ kind: 'changed', before: 'The hinge 10 has a housing 12.', after: 'The hinge 10 has a steel housing 12.', line: 4, sources: [{ kind: 'feature', ref: 'F1' }] },
				{ kind: 'deleted', before: 'In some embodiments, the hinge is made of plastic.', sources: [{ kind: 'model-proposed' }] },
				{ kind: 'added', after: 'The attorney adds this paragraph.', line: 9 },
			],
		});
	});
});
