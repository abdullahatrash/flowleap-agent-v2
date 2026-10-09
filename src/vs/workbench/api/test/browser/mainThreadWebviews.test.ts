/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { URI } from '../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { WebviewContentOptions } from '../../../contrib/webview/browser/webview.js';
import { getWebviewLinkRoute } from '../../browser/mainThreadWebviews.js';

suite('MainThreadWebviews', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	const links = [
		'https://patents.google.com/patent/US6265989B1/en',
		'mailto:someone@example.com',
		// A source anchor in a saved patent report: the FlowLeap patent reader's own link.
		'flowleap://flowleap.patent-ai/patent?publication=US6265989B1&section=claims&claim=1',
		'otherproduct://publisher.extension/path',
		'command:workbench.action.showCommands',
		'command:other.command',
		'file:///workspace/report.md',
	];

	function routes(contentOptions: WebviewContentOptions, web: boolean) {
		return Object.fromEntries(links.map(link => [link, getWebviewLinkRoute(URI.parse(link), contentOptions, 'flowleap', web)]));
	}

	test('opens product URL scheme links through the URL handler on web, and through the opener on desktop', () => {
		const contentOptions: WebviewContentOptions = { enableCommandUris: ['workbench.action.showCommands'] };
		assert.deepStrictEqual({ desktop: routes(contentOptions, false), web: routes(contentOptions, true) }, {
			desktop: {
				'https://patents.google.com/patent/US6265989B1/en': 'opener',
				'mailto:someone@example.com': 'opener',
				'flowleap://flowleap.patent-ai/patent?publication=US6265989B1&section=claims&claim=1': 'opener',
				'otherproduct://publisher.extension/path': undefined,
				'command:workbench.action.showCommands': 'opener',
				'command:other.command': undefined,
				'file:///workspace/report.md': undefined,
			},
			web: {
				'https://patents.google.com/patent/US6265989B1/en': 'opener',
				'mailto:someone@example.com': 'opener',
				'flowleap://flowleap.patent-ai/patent?publication=US6265989B1&section=claims&claim=1': 'urlHandler',
				'otherproduct://publisher.extension/path': undefined,
				'command:workbench.action.showCommands': 'opener',
				'command:other.command': undefined,
				'file:///workspace/report.md': undefined,
			},
		});
	});
});
