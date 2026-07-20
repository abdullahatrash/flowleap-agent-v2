/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { formatJsonForModel, IMarkdownColumn, renderMarkdownTable, ToolResponseBudgets, truncatePreview } from '../patentResponseFormatter';

// `patentResponseFormatter` is the shared, budget-aware formatter the patent tools route their results
// through. It is pure (no service dependencies), so it is tested in isolation here.

describe('formatJsonForModel', () => {
	it('returns pretty-printed JSON unchanged when under budget', () => {
		const value = { results: [{ id: 'EP1' }, { id: 'EP2' }], total: 2 };
		const result = formatJsonForModel(value, 50_000);
		expect(result).toEqual({
			content: JSON.stringify(value, null, 2),
			truncated: false,
			omittedItems: 0,
		});
	});

	it('drops whole array items from a top-level array and appends a marker element', () => {
		// 200 fat items far exceed a tiny budget; truncation must keep the array parseable.
		const value = Array.from({ length: 200 }, (_, i) => ({ id: `EP${i}`, abstract: 'x'.repeat(200) }));
		const result = formatJsonForModel(value, 2_000);

		const parsed = JSON.parse(result.content) as Array<Record<string, unknown>>;
		const marker = parsed[parsed.length - 1];
		const keptItems = parsed.length - 1;

		expect({
			truncated: result.truncated,
			isValidJson: true,
			contentUnderBudget: result.content.length <= 2_000,
			keptItems,
			omittedItems: result.omittedItems,
			itemsAccountedFor: keptItems + result.omittedItems === 200,
			marker,
		}).toEqual({
			truncated: true,
			isValidJson: true,
			contentUnderBudget: true,
			keptItems,
			omittedItems: 200 - keptItems,
			itemsAccountedFor: true,
			marker: {
				_truncation: {
					truncated: true,
					omittedItems: 200 - keptItems,
					note: `Response exceeded this tool's 2000-character budget. ${200 - keptItems} result item(s) were omitted to keep the output valid JSON. ` +
						`Refine your query — add filters, narrow the date range, or request fewer results — to retrieve the omitted items.`,
				},
			},
		});
	});

	it('drops items from an array field and adds a _truncation key to a top-level object', () => {
		const value = { total: 300, results: Array.from({ length: 300 }, (_, i) => ({ id: `US${i}`, blob: 'y'.repeat(200) })) };
		const result = formatJsonForModel(value, 3_000);

		const parsed = JSON.parse(result.content) as { total: number; results: unknown[]; _truncation: { truncated: boolean; omittedItems: number; note: string } };
		expect({
			truncated: result.truncated,
			contentUnderBudget: result.content.length <= 3_000,
			totalPreserved: parsed.total,
			resultsShortened: parsed.results.length < 300,
			itemsAccountedFor: parsed.results.length + result.omittedItems === 300,
			noticeTruncated: parsed._truncation.truncated,
			noticeMentionsRefine: parsed._truncation.note.includes('Refine your query'),
			noticeOmittedMatches: parsed._truncation.omittedItems === result.omittedItems,
		}).toEqual({
			truncated: true,
			contentUnderBudget: true,
			totalPreserved: 300,
			resultsShortened: true,
			itemsAccountedFor: true,
			noticeTruncated: true,
			noticeMentionsRefine: true,
			noticeOmittedMatches: true,
		});
	});

	it('never emits unparseable JSON even at an aggressive budget', () => {
		const value = { results: Array.from({ length: 500 }, (_, i) => ({ id: i, text: 'z'.repeat(50) })) };
		const result = formatJsonForModel(value, 500);
		// The invariant is parseability, not the (best-effort) budget.
		expect(() => JSON.parse(result.content)).not.toThrow();
	});

	it('uses the named PatentApiRequest budget constant', () => {
		expect(ToolResponseBudgets.PatentApiRequest).toBe(50_000);
	});
});

describe('renderMarkdownTable', () => {
	interface IRow {
		readonly patent: string;
		readonly relevance: number;
	}
	const columns: IMarkdownColumn<IRow>[] = [
		{ header: 'Patent', cell: r => r.patent },
		{ header: 'Relevance', cell: r => String(r.relevance), align: 'right' },
	];

	it('renders rows as a GitHub-flavored markdown table', () => {
		const rows: IRow[] = [{ patent: 'EP1', relevance: 92 }, { patent: 'US2', relevance: 71 }];
		expect(renderMarkdownTable(rows, columns)).toEqual(
			[
				'| Patent | Relevance |',
				'| --- | ---: |',
				'| EP1 | 92 |',
				'| US2 | 71 |',
			].join('\n')
		);
	});

	it('renders a header-only table when there are no rows', () => {
		expect(renderMarkdownTable([], columns)).toEqual(
			[
				'| Patent | Relevance |',
				'| --- | ---: |',
			].join('\n')
		);
	});

	it('escapes pipes and newlines so a cell value cannot break the table', () => {
		const rows = [{ text: 'a | b\nc' }];
		const cols: IMarkdownColumn<{ text: string }>[] = [{ header: 'Text', cell: r => r.text }];
		expect(renderMarkdownTable(rows, cols)).toEqual(
			[
				'| Text |',
				'| --- |',
				'| a \\| b c |',
			].join('\n')
		);
	});
});

describe('truncatePreview', () => {
	it('returns short text unchanged and appends an ellipsis only when text exceeds the limit', () => {
		expect({
			short: truncatePreview('solar cell', ToolResponseBudgets.SearchPatentsAbstract),
			exact: truncatePreview('abcde', 5),
			long: truncatePreview('abcdefghij', 5),
		}).toEqual({
			short: 'solar cell',
			exact: 'abcde',
			long: 'abcde...',
		});
	});
});
