/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../base/test/common/utils.js';
import { ChatWidget } from '../../../browser/widget/chatWidget.js';

suite('ChatWidget ViewState', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('captures and restores transcript scroll state', () => {
		const listWidget = {
			scrollTop: 200,
			scrollHeight: 1000,
			renderHeight: 300,
			get isScrolledToBottom() {
				return this.scrollTop + this.renderHeight >= this.scrollHeight - 2;
			},
			scrollToEnd() {
				this.scrollTop = this.scrollHeight - this.renderHeight;
			},
		};
		const widget: ChatWidget = Object.assign(Object.create(ChatWidget.prototype), { listWidget });

		const scrolledUp = widget.getViewState();
		widget.restoreViewState({ scrollTop: 350 });
		const legacyScrollTop = listWidget.scrollTop;
		widget.restoreViewState({ scrollTop: 200, isAtBottom: true });

		assert.deepStrictEqual({
			scrolledUp,
			legacyScrollTop,
			bottomScrollTop: listWidget.scrollTop,
		}, {
			scrolledUp: { scrollTop: 200, isAtBottom: false },
			legacyScrollTop: 350,
			bottomScrollTop: 700,
		});
	});
});
