/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { IListRenderer, IListVirtualDelegate } from '../../../../browser/ui/list/list.js';
import { ListView } from '../../../../browser/ui/list/listView.js';
import { range } from '../../../../common/arrays.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../common/utils.js';

suite('ListView', function () {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('all rows get disposed', function () {
		const element = document.createElement('div');
		element.style.height = '200px';
		element.style.width = '200px';

		const delegate: IListVirtualDelegate<number> = {
			getHeight() { return 20; },
			getTemplateId() { return 'template'; }
		};

		let templatesCount = 0;

		const renderer: IListRenderer<number, void> = {
			templateId: 'template',
			renderTemplate() { templatesCount++; },
			renderElement() { },
			disposeTemplate() { templatesCount--; }
		};

		const listView = new ListView<number>(element, delegate, [renderer]);
		listView.layout(200);

		assert.strictEqual(templatesCount, 0, 'no templates have been allocated');
		listView.splice(0, 0, range(100));
		assert.strictEqual(templatesCount, 10, 'some templates have been allocated');
		listView.dispose();
		assert.strictEqual(templatesCount, 0, 'all templates have been disposed');
	});

	test('batches horizontal width measurements', function () {
		const element = document.createElement('div');
		element.style.height = '100px';
		element.style.width = '200px';
		document.body.appendChild(element);

		const delegate: IListVirtualDelegate<number> = {
			getHeight() { return 20; },
			getTemplateId() { return 'template'; }
		};

		const rows: HTMLElement[] = [];
		const widthReads: { renderedRows: number; fitContentRows: number }[] = [];
		const renderer: IListRenderer<number, void> = {
			templateId: 'template',
			renderTemplate(container) {
				const rowIndex = rows.length;
				const paddingLeft = rowIndex;
				const paddingRight = rowIndex * 2;
				rows.push(container);
				container.style.paddingLeft = `${paddingLeft}px`;
				container.style.paddingRight = `${paddingRight}px`;
				container.style.borderLeft = '1px solid';
				container.style.borderRight = '2px solid';
				Object.defineProperty(container, 'offsetWidth', {
					configurable: true,
					get: () => {
						widthReads.push({
							renderedRows: rows.length,
							fitContentRows: rows.filter(row => row.style.width === 'fit-content').length
						});
						return 100 + rowIndex + paddingLeft + paddingRight + 3;
					}
				});
			},
			renderElement() { },
			disposeTemplate() { }
		};

		const listView = new ListView<number>(element, delegate, [renderer], { horizontalScrolling: true });
		try {
			const expectedBatch = range(5).map(() => ({ renderedRows: 5, fitContentRows: 5 }));
			const results: { phase: string; widthReads: typeof widthReads; contentWidth: number; rowWidths: string[] }[] = [];
			listView.layout(100, 200);
			listView.splice(0, 0, range(10));
			results.push({
				phase: 'splice',
				widthReads: widthReads.slice(),
				contentWidth: listView.contentWidth,
				rowWidths: rows.map(row => row.style.width)
			});

			widthReads.length = 0;
			listView.setScrollTop(100);
			results.push({
				phase: 'scroll',
				widthReads: widthReads.slice(),
				contentWidth: listView.contentWidth,
				rowWidths: rows.map(row => row.style.width)
			});

			widthReads.length = 0;
			listView.updateOptions({ horizontalScrolling: false });
			listView.updateOptions({ horizontalScrolling: true });
			results.push({
				phase: 'enable',
				widthReads: widthReads.slice(),
				contentWidth: listView.contentWidth,
				rowWidths: rows.map(row => row.style.width)
			});

			assert.deepStrictEqual(results, [
				{ phase: 'splice', widthReads: expectedBatch, contentWidth: 0, rowWidths: ['', '', '', '', ''] },
				{ phase: 'scroll', widthReads: expectedBatch, contentWidth: 0, rowWidths: ['', '', '', '', ''] },
				{ phase: 'enable', widthReads: expectedBatch, contentWidth: 116, rowWidths: ['', '', '', '', ''] }
			]);
		} finally {
			listView.dispose();
			element.remove();
		}
	});
});
