/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { parseDraftingFrontmatter, readGateFlag, readOffice, writeDraftingFrontmatter } from '../drafting/frontmatter';

describe('Application Drafting frontmatter', () => {

	it('parses the fields of a Draft Application and the line where the body starts', () => {
		const text = '---\noffice: EPO\nmodel: claude-sonnet-5\nprovider: OpenRouter\nversion: 2\n---\n# Description\n';
		const parsed = parseDraftingFrontmatter(text);
		expect({ parsed, office: readOffice(parsed.fields) }).toEqual({
			parsed: { fields: { office: 'EPO', model: 'claude-sonnet-5', provider: 'OpenRouter', version: 2 }, body: '# Description\n', bodyStartLine: 7 },
			office: 'EPO',
		});
	});

	it('reads a gate flag as set only when it is the literal boolean true', () => {
		const states = [
			'---\nconfirmed: true\n---\nx',
			'---\nconfirmed: "true"\n---\nx',
			'---\nconfirmed: false\n---\nx',
			'---\noffice: US\n---\nx',
			'no frontmatter',
		].map(text => readGateFlag(parseDraftingFrontmatter(text).fields, 'confirmed'));
		expect(states).toEqual(['set', 'not-true', 'not-true', 'missing', 'missing']);
	});

	it('reads an unknown office as undefined and handles CRLF and invalid YAML', () => {
		expect([
			readOffice(parseDraftingFrontmatter('---\r\noffice: JP\r\n---\r\nbody').fields),
			parseDraftingFrontmatter('---\r\noffice: us\r\n---\r\nbody'),
			parseDraftingFrontmatter('---\n: [unclosed\n---\nbody'),
		]).toEqual([
			undefined,
			{ fields: { office: 'us' }, body: 'body', bodyStartLine: 4 },
			{ fields: {}, body: '---\n: [unclosed\n---\nbody', bodyStartLine: 1 },
		]);
	});

	it('writes frontmatter in key order, replaces an existing block and round-trips', () => {
		const written = writeDraftingFrontmatter({ office: 'US', approved: true, version: 3 }, '---\nold: 1\n---\n1. A device.\n');
		expect({ written, reparsed: parseDraftingFrontmatter(written).fields }).toEqual({
			written: '---\noffice: US\napproved: true\nversion: 3\n---\n1. A device.\n',
			reparsed: { office: 'US', approved: true, version: 3 },
		});
	});
});
