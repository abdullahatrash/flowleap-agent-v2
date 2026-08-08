/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { emptiedByTruncationNotice, formatJsonForModel, IMarkdownColumn, isSingleRecordDocumentLookup, renderMarkdownTable, ToolResponseBudgets, truncatePreview, truncationNotice } from '../patentResponseFormatter';

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
					retainedItems: keptItems,
					note: `Response exceeded this tool's 2000-character budget. ${200 - keptItems} result item(s) were omitted to keep the output valid JSON. ` +
						`Refine your query — add filters, narrow the date range, or request fewer results — to retrieve the omitted items.`,
				},
			},
		});
	});

	it('drops items from an array field and adds a _truncation key to a top-level object', () => {
		// Budget chosen so items actually survive: this is the PARTIAL-drop path, distinct from the
		// emptied path covered below.
		const value = { total: 300, results: Array.from({ length: 300 }, (_, i) => ({ id: `US${i}`, blob: 'y'.repeat(200) })) };
		const result = formatJsonForModel(value, 20_000);

		const parsed = JSON.parse(result.content) as { total: number; results: unknown[]; _truncation: { truncated: boolean; omittedItems: number; retainedItems: number; note: string } };
		expect({
			truncated: result.truncated,
			contentUnderBudget: result.content.length <= 20_000,
			totalPreserved: parsed.total,
			resultsShortened: parsed.results.length > 0 && parsed.results.length < 300,
			itemsAccountedFor: parsed.results.length + result.omittedItems === 300,
			noticeTruncated: parsed._truncation.truncated,
			noticeMentionsRefine: parsed._truncation.note.includes('Refine your query'),
			noticeOmittedMatches: parsed._truncation.omittedItems === result.omittedItems,
			noticeRetainedMatches: parsed._truncation.retainedItems === parsed.results.length,
		}).toEqual({
			truncated: true,
			contentUnderBudget: true,
			totalPreserved: 300,
			resultsShortened: true,
			itemsAccountedFor: true,
			noticeTruncated: true,
			noticeMentionsRefine: true,
			noticeOmittedMatches: true,
			noticeRetainedMatches: true,
		});
	});

	it('states the emptiness when every item is dropped, instead of reporting a size overrun', () => {
		// The shape behind the T1/T5 belief attractor (#201): a by-number lookup whose sole record is
		// oversized on a path the single-record classifier does not recognise. The record is dropped, the
		// server's `count` survives beside the emptied array, and a size-framed note would let a reader
		// conclude it holds the document and merely needs to save it. The notice must say the opposite.
		const value = { count: 1, patentFileWrapperDataBag: [{ applicationNumberText: '16473445', claims: 'C'.repeat(5_000) }], cached: true };
		const result = formatJsonForModel(value, 1_000);

		const parsed = JSON.parse(result.content) as {
			count: number;
			patentFileWrapperDataBag: unknown[];
			_truncation: { truncated: boolean; omittedItems: number; retainedItems: number; note: string };
		};
		expect({
			omittedItems: result.omittedItems,
			recordsPresent: parsed.patentFileWrapperDataBag.length,
			serverCountSurvives: parsed.count,
			note: parsed._truncation,
		}).toEqual({
			omittedItems: 1,
			recordsPresent: 0,
			serverCountSurvives: 1,
			note: {
				truncated: true,
				omittedItems: 1,
				retainedItems: 0,
				note: emptiedByTruncationNotice(1, 1_000),
			},
		});
	});

	it('leads the emptied notice with the emptiness and closes the "too large, so it was saved" reading', () => {
		// Pinned as text because this string is the whole fix: a reader forms its belief from what the
		// result SAYS, and the measured failure was "the content was too large to display, so I saved it".
		const notice = emptiedByTruncationNotice(1, 50_000);
		expect({
			leadsWithEmptiness: notice.startsWith('NO RECORDS WERE RETURNED'),
			deniesReading: notice.includes('you have not read this record'),
			disownsTheCount: notice.includes('reports what the SERVER matched, not what you received'),
			deniesOffload: notice.includes('nothing was saved and no file was written'),
			forbidsWritingItUp: notice.includes('Do not quote, summarize, describe or save'),
			offersRecovery: notice.includes('retrieve it by another route'),
			neverSaysRefineTheQuery: !notice.includes('Refine your query'),
		}).toEqual({
			leadsWithEmptiness: true,
			deniesReading: true,
			disownsTheCount: true,
			deniesOffload: true,
			forbidsWritingItUp: true,
			offersRecovery: true,
			neverSaysRefineTheQuery: true,
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

	it('keeps the sole oversized record intact for a single-record lookup and attaches a by-number note', () => {
		// One by-number record whose claims text alone blows past the budget. The multi-record path would
		// drop the record to `[]`; the single-record path must hand it back whole for the harness to offload.
		const value = { patentFileWrapperDataBag: [{ applicationNumberText: '16473445', claims: 'C'.repeat(5_000) }] };
		const result = formatJsonForModel(value, 2_000, { singleRecord: true });

		const parsed = JSON.parse(result.content) as {
			patentFileWrapperDataBag: Array<{ applicationNumberText: string; claims: string }>;
			_truncation: { truncated: boolean; omittedItems: number; note: string };
		};
		expect({
			truncated: result.truncated,
			omittedItems: result.omittedItems,
			recordKept: parsed.patentFileWrapperDataBag.length,
			fullClaimsPreserved: parsed.patentFileWrapperDataBag[0].claims.length,
			note: parsed._truncation,
		}).toEqual({
			truncated: true,
			omittedItems: 0,
			recordKept: 1,
			fullClaimsPreserved: 5_000,
			note: {
				truncated: true,
				omittedItems: 0,
				note: `This by-number document lookup returned a single record larger than this tool's 2000-character inline budget. ` +
					`No data was dropped: the full record — including the complete claims/description text — is returned intact and offloaded to a file, ` +
					`so read it with the read_file tool at the path this result reports. ` +
					`Do not refine the query or narrow the date range; a by-number lookup has exactly one matching record.`,
			},
		});
	});

	it('leaves a small single-record response untouched (never masks a missing-field response)', () => {
		// A record with no claims field at all fits the budget and must pass through unchanged — the
		// single-record branch only engages when the record itself is over budget.
		const value = { patentFileWrapperDataBag: [{ applicationNumberText: '16473445' }] };
		const result = formatJsonForModel(value, 50_000, { singleRecord: true });
		expect(result).toEqual({ content: JSON.stringify(value, null, 2), truncated: false, omittedItems: 0 });
	});
});

describe('isSingleRecordDocumentLookup', () => {
	/** The single oversized record a by-number lookup comes back with, in USPTO wrapper shape. */
	const oneRecord = { count: 1, patentFileWrapperDataBag: [{ applicationNumberText: '16473445', claims: 'C'.repeat(5_000) }] };
	/** A genuine multi-record search result. */
	const manyRecords = { count: 3, patentFileWrapperDataBag: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] };

	it('classifies routes that return one document by construction, without needing the payload', () => {
		expect({
			usptoGrant: isSingleRecordDocumentLookup({ path: '/patent-search-uspto/grants/6021533' }),
			usptoApplication: isSingleRecordDocumentLookup({ path: '/patent-search-uspto/applications/16473445' }),
			opsClaims: isSingleRecordDocumentLookup({ path: '/ops/fulltext/claims?doc=US7654321B2' }),
			opsDescription: isSingleRecordDocumentLookup({ path: '/ops/fulltext/description?doc=EP1234566' }),
			enrichForm: isSingleRecordDocumentLookup({ path: '/ops/biblio?doc=EP1234566&enrich=claims' }),
			// List sub-resources of a by-number route carry many records: they stay on the multi-record path.
			applicationDocuments: isSingleRecordDocumentLookup({ path: '/patent-search-uspto/applications/16473445/documents' }, manyRecords),
			usptoSearch: isSingleRecordDocumentLookup({ path: '/patent-search-uspto/search' }),
			cqlSearch: isSingleRecordDocumentLookup({ path: '/patent-search?q=solar' }),
			opsDocs: isSingleRecordDocumentLookup({ path: '/ops/docs' }),
		}).toEqual({
			usptoGrant: true,
			usptoApplication: true,
			opsClaims: true,
			opsDescription: true,
			enrichForm: true,
			applicationDocuments: false,
			usptoSearch: false,
			cqlSearch: false,
			opsDocs: false,
		});
	});

	it('classifies a by-number lookup routed through a search endpoint from its single record (#204)', () => {
		// The observed miss (#201/#202 deviation 4): the model reaches the document through the search route
		// that `get_patent_details` advertises one line after the grants route, so the path says "search" while
		// the request names one document and the answer is that one document.
		expect({
			luceneByNumber: isSingleRecordDocumentLookup({ path: '/patent-search-uspto/search', body: { q: 'patentNumber:10958080' } }, oneRecord),
			luceneByApplication: isSingleRecordDocumentLookup({ path: '/patent-search-uspto/search', body: { q: 'applicationNumberText:16473445', filters: [] } }, oneRecord),
			bodyIdentifier: isSingleRecordDocumentLookup({ path: '/patent-search-uspto/search', body: { patentNumber: '10958080' } }, oneRecord),
			nestedQuery: isSingleRecordDocumentLookup({ path: '/v1/tools/get_claims', body: { arguments: { publicationNumber: 'US10958080B2' } } }, oneRecord),
			cqlByNumber: isSingleRecordDocumentLookup({ path: '/patent-search?q=pn%3DUS10958080', body: undefined }, oneRecord),
			opsBiblioByDoc: isSingleRecordDocumentLookup({ path: '/ops/biblio?doc=EP1234566' }, { 'ops:world-patent-data': { 'exchange-document': { title: 'x' } } }),
			opsFamilyByDoc: isSingleRecordDocumentLookup({ path: '/ops/family?doc=EP1234566' }, { members: [{ id: 'EP1234566' }] }),
		}).toEqual({
			luceneByNumber: true,
			luceneByApplication: true,
			bodyIdentifier: true,
			nestedQuery: true,
			cqlByNumber: true,
			opsBiblioByDoc: true,
			opsFamilyByDoc: true,
		});
	});

	it('leaves searches that name no document on the multi-record path, whatever they matched', () => {
		// The false-positive guard. A topical search that happens to match one hit keeps the multi-record
		// treatment: "refine your query" is real advice there, and the single-record note would assert a
		// by-number provenance the request does not have. #202's emptied notice covers it when it empties.
		expect({
			topicalOneHit: isSingleRecordDocumentLookup({ path: '/patent-search-uspto/search', body: { q: 'solar cell inverter' } }, oneRecord),
			cqlTopicalOneHit: isSingleRecordDocumentLookup({ path: '/patent-search?q=ti%3Dsolar', body: undefined }, oneRecord),
			byNumberManyRecords: isSingleRecordDocumentLookup({ path: '/patent-search-uspto/search', body: { q: 'patentNumber:1095*' } }, manyRecords),
			byNumberNoRecords: isSingleRecordDocumentLookup({ path: '/patent-search-uspto/search', body: { q: 'patentNumber:10958080' } }, { count: 0, patentFileWrapperDataBag: [] }),
			emptyIdentifier: isSingleRecordDocumentLookup({ path: '/ops/biblio?doc=' }, oneRecord),
			noPayload: isSingleRecordDocumentLookup({ path: '/patent-search-uspto/search', body: { q: 'patentNumber:10958080' } }),
		}).toEqual({
			topicalOneHit: false,
			cqlTopicalOneHit: false,
			byNumberManyRecords: false,
			byNumberNoRecords: false,
			emptyIdentifier: false,
			noPayload: false,
		});
	});

	it('offloads the sole record of a by-number search instead of emptying it, and empties a topical one', () => {
		// End to end over the two halves, on the exact payload #202 regenerated its fixture from: the same
		// oversized single record now takes opposite paths depending on whether the request named a document.
		const byNumber = { path: '/patent-search-uspto/search', body: { q: 'patentNumber:10958080' } };
		const topical = { path: '/patent-search-uspto/search', body: { q: 'battery charging system' } };
		const format = (request: typeof byNumber) => {
			const formatted = formatJsonForModel(oneRecord, 1_000, { singleRecord: isSingleRecordDocumentLookup(request, oneRecord) });
			const parsed = JSON.parse(formatted.content) as { patentFileWrapperDataBag: unknown[]; _truncation: { note: string } };
			return { recordsPresent: parsed.patentFileWrapperDataBag.length, note: parsed._truncation.note };
		};
		expect({ byNumber: format(byNumber), topical: format(topical) }).toEqual({
			byNumber: { recordsPresent: 1, note: truncationNotice(0, 1_000, true) },
			topical: { recordsPresent: 0, note: emptiedByTruncationNotice(1, 1_000) },
		});
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
