/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { humanisePromptName, parsePromptFile, slugifyPromptTitle, uniquePromptSlug } from '../../common/promptFile';

describe('parsePromptFile', () => {

	it('reads name, description and body out of the front matter and ignores unknown keys', () => {
		const text = [
			'---',
			'name: flowleap-prior-art-search',
			'description: "Prior-art search on an attached IDF"',
			'agent: Plan',
			'---',
			'Perform a prior-art search for the invention described in the attached IDF.',
			'',
		].join('\n');

		expect(parsePromptFile(text, 'prior-art-search')).toEqual({
			name: 'flowleap-prior-art-search',
			description: 'Prior-art search on an attached IDF',
			body: 'Perform a prior-art search for the invention described in the attached IDF.',
		});
	});

	it('treats a file without front matter as an all-body prompt named after its file stem', () => {
		expect(parsePromptFile('\n  Summarise this patent.\n\n', 'my-notes')).toEqual({
			name: 'my-notes',
			description: '',
			body: 'Summarise this patent.',
		});
	});

	it('falls back to the file stem when the front matter omits name, and keeps CRLF bodies clean', () => {
		const text = '---\r\ndescription: Just a description\r\n---\r\nLine one\r\nLine two\r\n';

		expect(parsePromptFile(text, 'untitled')).toEqual({
			name: 'untitled',
			description: 'Just a description',
			body: 'Line one\nLine two',
		});
	});
});

describe('humanisePromptName', () => {

	it('spells the bundled prompts out and opens hyphens up for everything else', () => {
		const names = ['flowleap-prior-art-search', 'flowleap-office-action-response', 'flowleap-opposition-rate', 'flowleap-something-new', 'my_own-prompt'];

		expect(names.map(humanisePromptName)).toEqual([
			'Prior-art search',
			'Office-action response',
			'Opposition rate',
			'Something new',
			'My own prompt',
		]);
	});
});

describe('slugifyPromptTitle and uniquePromptSlug', () => {

	it('slugifies titles and appends a counter until the slug is free', () => {
		const base = slugifyPromptTitle('  Prior-art search: EU batteries!  ');

		expect({
			base,
			empty: slugifyPromptTitle('!!!'),
			free: uniquePromptSlug(base, ['other']),
			second: uniquePromptSlug(base, [base]),
			third: uniquePromptSlug(base, [base, `${base}-2`]),
		}).toEqual({
			base: 'prior-art-search-eu-batteries',
			empty: 'prompt',
			free: 'prior-art-search-eu-batteries',
			second: 'prior-art-search-eu-batteries-2',
			third: 'prior-art-search-eu-batteries-3',
		});
	});
});
