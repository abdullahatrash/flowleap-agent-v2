/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { Event } from '../../../../base/common/event.js';
import { URI } from '../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { ExtHostAgentEditorComments } from '../../common/extHostAgentEditorComments.js';
import { Range } from '../../common/extHostTypes.js';

suite('ExtHostAgentEditorComments', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('the null seam reports a resource that accepts no comments', () => {
		const provider = new ExtHostAgentEditorComments().createAgentEditorComments(URI.file('/report.md'));

		// Mutating calls must be no-ops rather than throw: the Markdown editor calls them from its
		// comment UI, which it only shows while `acceptsComments` is true.
		provider.addComment(new Range(0, 0, 0, 0), 'body');
		provider.deleteComment('1');
		provider.dispose();

		assert.deepStrictEqual({
			comments: provider.comments,
			acceptsComments: provider.acceptsComments,
			onDidChange: provider.onDidChange,
			onDidRevealComment: provider.onDidRevealComment,
		}, {
			comments: [],
			acceptsComments: false,
			onDidChange: Event.None,
			onDidRevealComment: Event.None,
		});
	});
});
