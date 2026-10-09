/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'mocha';
import * as assert from 'assert';
import { buildPreviewHtml, previewContentSecurityPolicy } from '../htmlPreview/htmlPreviewDocument';

/**
 * Unit tests for the HTML file preview document (issues #520, #589). They import no `vscode`
 * API, so they run under plain mocha on the compiled output:
 *
 *   npx tsc -p extensions/flowleap
 *   npx mocha extensions/flowleap/out/test/htmlPreviewDocument.test.js --ui tdd
 */
suite('htmlPreviewDocument', () => {

	const csp = 'https://*.vscode-cdn.net';
	const base = 'https://file+.vscode-resource.vscode-cdn.net/root/outputs/dash/';
	const injected = `<meta http-equiv="Content-Security-Policy" content="${previewContentSecurityPolicy(csp)}"><base href="${base}">`;

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

	test('policy allows the common CDNs for code and assets, but no network requests and no frames', () => {
		const cdn = 'https://cdn.jsdelivr.net https://unpkg.com https://cdnjs.cloudflare.com https://fonts.googleapis.com https://fonts.gstatic.com';
		const directives = previewContentSecurityPolicy(csp).split('; ');
		assert.deepStrictEqual(directives, [
			`default-src 'none'`,
			`script-src 'unsafe-inline' ${cdn}`,
			`style-src 'unsafe-inline' ${csp} ${cdn}`,
			`img-src ${csp} ${cdn} data: blob:`,
			`font-src ${csp} ${cdn} data:`,
			`media-src ${csp} data: blob:`,
			`connect-src 'none'`,
		]);
		assert.deepStrictEqual(directives.filter(d => /^(connect|frame|child)-src\b/.test(d)), [`connect-src 'none'`]);
	});
});
