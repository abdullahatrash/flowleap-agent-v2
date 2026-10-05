/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'mocha';
import * as assert from 'assert';
import { buildPreviewHtml } from '../htmlPreview/htmlPreviewDocument';

/**
 * Unit tests for the HTML file preview document (issue #520). They import no `vscode` API, so
 * they run under plain mocha on the compiled output:
 *
 *   npx tsc -p extensions/flowleap
 *   npx mocha extensions/flowleap/out/test/htmlPreviewDocument.test.js --ui tdd
 */
suite('htmlPreviewDocument', () => {

	const csp = 'https://*.vscode-cdn.net';
	const base = 'https://file+.vscode-resource.vscode-cdn.net/root/outputs/dash/';
	const injected = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline' ${csp}; img-src ${csp} data: blob:; font-src ${csp} data:; media-src ${csp} data: blob:"><base href="${base}">`;

	test('policy and base go first in <head>, or in front of a document without one', () => {
		assert.deepStrictEqual(
			{
				withHead: buildPreviewHtml('<!doctype html><html><head lang="en"><title>D</title></head><body><script>1</script></body></html>', csp, base),
				withoutHead: buildPreviewHtml('<svg></svg>', csp, base),
				quoteInBase: buildPreviewHtml('<head></head>', csp, 'https://x/a"b/').includes('<base href="https://x/a&quot;b/">'),
			},
			{
				withHead: `<!doctype html><html><head lang="en">${injected}<title>D</title></head><body><script>1</script></body></html>`,
				withoutHead: `${injected}<svg></svg>`,
				quoteInBase: true,
			}
		);
	});
});
