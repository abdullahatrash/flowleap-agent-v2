/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'mocha';
import * as assert from 'assert';
import { addUserLink, escapeHtml, readUserLinks, removeUserLink, UserLink } from '../browserLauncher/browserLauncherViewProvider';

suite('Browser launcher user links', () => {

	test('adds a link with its label', () => {
		assert.deepStrictEqual(addUserLink([], 'Lens', 'https://www.lens.org/'), [{ label: 'Lens', url: 'https://www.lens.org/' }]);
	});

	test('gives a bare host https and falls back to the host as the label', () => {
		assert.deepStrictEqual(addUserLink([], '  ', 'lens.org/search'), [{ label: 'lens.org', url: 'https://lens.org/search' }]);
	});

	test('refuses an empty, non-web or duplicate URL', () => {
		const links: UserLink[] = [{ label: 'Lens', url: 'https://www.lens.org/' }];
		assert.strictEqual(typeof addUserLink(links, 'x', ''), 'string');
		assert.strictEqual(typeof addUserLink(links, 'x', 'javascript:alert(1)'), 'string');
		assert.strictEqual(typeof addUserLink(links, 'x', 'https://www.lens.org'), 'string');
	});

	test('removes a link by URL', () => {
		const links: UserLink[] = [{ label: 'A', url: 'https://a.example/' }, { label: 'B', url: 'https://b.example/' }];
		assert.deepStrictEqual(removeUserLink(links, 'https://a.example/'), [{ label: 'B', url: 'https://b.example/' }]);
	});

	test('reads only well-formed stored links', () => {
		assert.deepStrictEqual(readUserLinks(undefined), []);
		assert.deepStrictEqual(readUserLinks([
			{ label: 'A', url: 'https://a.example/' },
			{ label: 'B', url: 'file:///etc/passwd' },
			{ label: 3, url: 'https://c.example/' },
			null
		]), [{ label: 'A', url: 'https://a.example/' }]);
	});

	test('escapes HTML in user text', () => {
		assert.strictEqual(escapeHtml('<b>"x" & \'y\'</b>'), '&lt;b&gt;&quot;x&quot; &amp; &#39;y&#39;&lt;/b&gt;');
	});
});
