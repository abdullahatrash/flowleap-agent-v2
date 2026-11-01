/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import { describe, expect, it } from 'vitest';
import { PatentExecution } from '../../../patentai/vscode-node/patentExecutionLedger';
import { unrecordedPatentLedger } from './patentLedgerTestUtils';
import type { ILogService } from '../../../../platform/log/common/logService';
import type { CancellationToken } from '../../../../util/vs/base/common/cancellation';
import { LanguageModelTextPart } from '../../../../vscodeTypes';
import { type IPatentBackendClient, type IPatentBackendRequestOptions, PatentBackendError } from '../../../patentai/vscode-node/patentBackendClient';
import { SearchPatentsTool } from '../searchPatentsTool';

// ── Fakes ──────────────────────────────────────────────────────────────────────

function makeLogService(): ILogService {
	return { trace: () => { }, debug: () => { }, info: () => { }, warn: () => { }, error: () => { } } as unknown as ILogService;
}

/** Wrap a tool payload in the `/v1/tools` facade envelope the seam actually returns. */
function facadeEnvelope(data: unknown) {
	return { success: true, tool: 'search_patents', data, executionTimeMs: 5 };
}

/**
 * A {@link IPatentBackendClient} whose `post` returns a scripted payload, capturing the paths and
 * bodies it was called with so the test can assert the tool routes through the shared client seam.
 */
function makeBackendClient(postPayload?: unknown) {
	const calls: { path: string; body?: unknown }[] = [];
	const client: IPatentBackendClient = {
		_serviceBrand: undefined,
		async getCustomerPortalUrl(): Promise<string> { return ''; },
		getTrialModelKey(): never { throw new Error('getTrialModelKey not exercised in this test fake'); },
		async post<T>(path: string, body: unknown, _token: CancellationToken, _options?: IPatentBackendRequestOptions): Promise<T> {
			calls.push({ path, body });
			return postPayload as T;
		},
		async get<T>(pathWithQuery: string, _token: CancellationToken, _options?: IPatentBackendRequestOptions): Promise<T> {
			calls.push({ path: pathWithQuery });
			return undefined as T;
		},
	};
	return { client, calls };
}

/** Stub CancellationToken that is never cancelled. */
function makeToken(): CancellationToken {
	return {
		isCancellationRequested: false,
		onCancellationRequested() {
			return { dispose: () => { /* noop */ } };
		},
	};
}

/** Minimal invocation options — the tools only read `options.input`. */
function makeOptions<T>(input: T): vscode.LanguageModelToolInvocationOptions<T> {
	return { input } as vscode.LanguageModelToolInvocationOptions<T>;
}

/** Read the single text part produced by a tool invocation. */
function textOf(result: vscode.LanguageModelToolResult): string {
	const part = result.content[0];
	return (part as LanguageModelTextPart).value;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('SearchPatentsTool', () => {

	it('renders search results as a markdown table with abstract snippets below', async () => {
		const { client, calls } = makeBackendClient(facadeEnvelope({
			total: 2,
			range: { begin: 1, end: 2 },
			docs: [
				{ docId: 'EP1234567A1', title: 'Solar cell module', applicants: ['ACME Corp', 'Sun Inc'], publicationDate: '2020-01-15', abstract: 'A photovoltaic module with a light-absorbing layer.' },
				{ docId: 'US7654321B2', title: null, applicants: [], publicationDate: null, abstract: null },
			],
		}));
		const tool = new SearchPatentsTool(makeLogService(), client, unrecordedPatentLedger);

		const result = await tool.invoke(makeOptions({ query: 'ti=("solar cell")', range: '1-25', countries: 'ep, wo' }), makeToken());

		// The facade takes snake_case params, an explicit provider, and a countries ARRAY.
		expect(calls).toEqual([{
			path: '/tools/search_patents',
			body: { query: 'ti=("solar cell")', provider: 'epo_ops', range: '1-25', countries: ['EP', 'WO'] },
		}]);
		expect(textOf(result)).toMatchInlineSnapshot(`
			"Found 2 patents matching query: "ti=("solar cell")"
			Showing results 1-2:

			| Publication | Title | Assignee | Published |
			| --- | --- | --- | --- |
			| EP1234567A1 | Solar cell module | ACME Corp, Sun Inc | 2020-01-15 |
			| US7654321B2 | — | — | — |

			### Abstracts
			- **EP1234567A1**: A photovoltaic module with a light-absorbing layer.

			Note: Use these patent document IDs to fetch detailed information (full claims, descriptions, etc.) if needed.
			Next step: 2 hits. Read them before you widen; widen only for a feature that stays unresolved (OR a synonym with the field repeated, drop the classification, or use its parent class)."
		`);
	});

	it('shows the requested country filter and range before a search is approved', async () => {
		const { client } = makeBackendClient();
		const tool = new SearchPatentsTool(makeLogService(), client, unrecordedPatentLedger);
		const prepared = await tool.prepareInvocation(makeOptions({ query: 'ic=A61K6/083 and pd<20020221', countries: 'EP,WO', range: '1-10' }), makeToken());
		expect(prepared?.confirmationMessages?.message).toBe('Allow Patent AI to search for patents using query: ic=A61K6/083 and pd<20020221? Requested countries: EP,WO. Range: 1-10.');
	});

	it('rejects country entries that are not two-letter codes instead of searching worldwide', async () => {
		const { client, calls } = makeBackendClient(facadeEnvelope({ total: 0, docs: [] }));
		const tool = new SearchPatentsTool(makeLogService(), client, unrecordedPatentLedger);

		const result = await tool.invoke(makeOptions({ query: 'ti=helmet', countries: 'USA, EP, Germany' }), makeToken());

		expect({ message: textOf(result), calls: calls.length }).toEqual({
			message: 'Error: countries must be ISO 3166-1 alpha-2 codes, comma-separated (for example "EP,WO,US"). These entries are not codes: USA, Germany. No search was sent and none was recorded in the execution audit. Correct the codes and retry, or omit countries to search worldwide.',
			calls: 0,
		});
	});

	it('warns in the confirmation that an invalid country scope will be rejected', async () => {
		const { client } = makeBackendClient();
		const tool = new SearchPatentsTool(makeLogService(), client, unrecordedPatentLedger);
		const prepared = await tool.prepareInvocation(makeOptions({ query: 'ti=helmet', countries: 'USA' }), makeToken());
		expect(prepared?.confirmationMessages?.message).toBe('Allow Patent AI to search for patents using query: ti=helmet? The requested countries USA are not two-letter country codes, so this search will be rejected instead of run without a country scope. Range: 1-25.');
	});

	it('preserves the backend effective query when a scoped search has zero matches', async () => {
		const effectiveQuery = '(pa=Kuraray* and pd<20020221) and pn any "EP WO"';
		const { client } = makeBackendClient(facadeEnvelope({ total: 0, docs: [], countryFilter: ['EP', 'WO'], effectiveQuery }));
		const tool = new SearchPatentsTool(makeLogService(), client, unrecordedPatentLedger);
		const result = await tool.invoke(makeOptions({ query: 'pa=Kuraray* and pd<20020221', countries: 'EP,WO' }), makeToken());
		expect(textOf(result).split('\n')[0]).toBe(`No patents found for CQL: ${effectiveQuery}`);
	});

	it('reports no results when the backend returns an empty doc list', async () => {
		const { client } = makeBackendClient(facadeEnvelope({ total: 0, docs: [] }));
		const tool = new SearchPatentsTool(makeLogService(), client, unrecordedPatentLedger);

		const result = await tool.invoke(makeOptions({ query: 'ti=(nothing)' }), makeToken());

		expect(textOf(result).split('\n')[0]).toBe('No patents found for query: ti=(nothing)');
	});

	it('a page emptied by the country post-filter is reported as filtered, never as zero hits', async () => {
		// 2026-09-02 false negative: OPS matched 38 worldwide, the 1-1 count probe's only hit was
		// Canadian, and the tool told the agent "No patents found".
		const { client } = makeBackendClient(facadeEnvelope({ total: 38, returned: 0, countryFilter: ['EP', 'WO'], range: { begin: 1, end: 1 }, docs: [] }));
		const tool = new SearchPatentsTool(makeLogService(), client, unrecordedPatentLedger);

		const result = await tool.invoke(makeOptions({ query: 'ti=helmet and ti=brake', range: '1-1', countries: 'EP,WO' }), makeToken());

		expect(textOf(result)).toMatchInlineSnapshot(`
			"Found 38 patents matching query: "ti=helmet and ti=brake" worldwide, but none of the 1-1 on this page are in the country filter [EP,WO].
			This is NOT a zero-hit query. To count the [EP,WO] hits, either re-run with a wider range (e.g. "1-100") or put the filter into the CQL instead (e.g. append \`and pn any "EP WO"\`) so the total reflects it."
		`);
	});

	it('a backend that compiles the filter into the CQL reports the filtered total and the CQL sent', async () => {
		const { client } = makeBackendClient(facadeEnvelope({
			total: 2, returned: 1, countryFilter: ['EP', 'WO'], effectiveQuery: '(ti=helmet and ti=brake) and pn any "EP WO"', range: { begin: 1, end: 1 },
			docs: [{ docId: 'WO9836213A1', title: 'HELMET WITH BRAKE LIGHT', abstract: null, applicants: [], publicationDate: '1998-08-20' }],
		}));
		const tool = new SearchPatentsTool(makeLogService(), client, unrecordedPatentLedger);

		const result = await tool.invoke(makeOptions({ query: 'ti=helmet and ti=brake', range: '1-1', countries: 'EP,WO' }), makeToken());

		expect(textOf(result).split('\n')[0]).toBe('Found 2 patents matching CQL: "(ti=helmet and ti=brake) and pn any "EP WO"" (country filter [EP,WO] is part of the query, so this total counts only those offices)');
	});

	it('a filtered page with hits says the worldwide total is not the filtered count', async () => {
		const { client } = makeBackendClient(facadeEnvelope({
			total: 38, returned: 1, countryFilter: ['EP', 'WO'], range: { begin: 1, end: 5 },
			docs: [{ docId: 'EP0185922A2', title: 'Motorcycle safety helmet and brake lamp system', abstract: null, applicants: [], publicationDate: '1986-07-02' }],
		}));
		const tool = new SearchPatentsTool(makeLogService(), client, unrecordedPatentLedger);

		const result = await tool.invoke(makeOptions({ query: 'ti=helmet and ti=brake', range: '1-5', countries: 'EP,WO' }), makeToken());

		expect(textOf(result).split('\n')[0]).toBe('Found 38 patents matching query: "ti=helmet and ti=brake" worldwide; 1 of the 1-5 on this page are in the country filter [EP,WO]. The worldwide total is not a count of [EP,WO] hits.');
	});
	it('records actual effective query, returned IDs and the feature the query tests, without inferring total or reviewed counts', async () => {
		const executions: Omit<PatentExecution, 'id' | 'recordedAt'>[] = [];
		const ledger = { ...unrecordedPatentLedger, record: async (_session: vscode.Uri | undefined, execution: Omit<PatentExecution, 'id' | 'recordedAt'>) => { executions.push(execution); return 'Recorded.'; } };
		const { client } = makeBackendClient(facadeEnvelope({ effectiveQuery: 'ti=brake and pn=EP', countryFilter: ['EP'], docs: [{ docId: 'EP1234567A1', title: 'Brake', applicants: [] }] }));
		await new SearchPatentsTool(makeLogService(), client, ledger).invoke(makeOptions({ query: 'ti=brake', countries: 'EP', purpose: '  F4 helmet brake-light coupling  ' }), makeToken());
		expect(executions).toEqual([{ kind: 'search', status: 'succeeded', query: 'ti=brake', requestedRange: '1-25', requestedCountries: 'EP', purpose: 'F4 helmet brake-light coupling', effectiveQuery: 'ti=brake and pn=EP', countryFilter: ['EP'], total: undefined, returned: 1, range: undefined, publicationIds: ['EP1234567A1'] }]);
	});

	it('records the feature a failed search tested, so the report can name it instead of the raw query', async () => {
		const executions: Omit<PatentExecution, 'id' | 'recordedAt'>[] = [];
		const ledger = { ...unrecordedPatentLedger, record: async (_session: vscode.Uri | undefined, execution: Omit<PatentExecution, 'id' | 'recordedAt'>) => { executions.push(execution); return 'Recorded.'; } };
		const { client } = makeBackendClient({ success: false, tool: 'search_patents', error: { message: 'OPS is overloaded.' } });
		await new SearchPatentsTool(makeLogService(), client, ledger).invoke(makeOptions({ query: 'ic=A61K6 and ab="fine fraction"', purpose: 'F4 sub-10 µm fine-fraction cap' }), makeToken());
		expect(executions).toEqual([{ kind: 'search', status: 'failed', query: 'ic=A61K6 and ab="fine fraction"', requestedRange: '1-25', requestedCountries: undefined, purpose: 'F4 sub-10 µm fine-fraction cap' }]);
	});


	it('a count over 1,000 ends with the next step: add a discriminating term before reading any page', async () => {
		const { client } = makeBackendClient(facadeEnvelope({ total: 3549, effectiveQuery: 'ta="artificial intelligence"', range: { begin: 1, end: 1 }, docs: [{ docId: 'EP1234567A1', title: 'AI', applicants: [], publicationDate: null, abstract: null }] }));
		const result = await new SearchPatentsTool(makeLogService(), client, unrecordedPatentLedger).invoke(makeOptions({ query: 'ta="artificial intelligence"', range: '1-1' }), makeToken());
		expect(textOf(result).split('\n').at(-1)).toBe('Next step: 3549 hits is a technology area, not an invention. Add the next discriminating term from your extraction list and probe again; do not read pages of this set.');
	});


	it('a count under 10 ends with the next step: read the hits before widening', async () => {
		const { client } = makeBackendClient(facadeEnvelope({ total: 3, effectiveQuery: 'ta="foreign object" AND ta=charging', range: { begin: 1, end: 3 }, docs: [{ docId: 'EP1234567A1', title: 'Charger', applicants: [], publicationDate: null, abstract: null }] }));
		const result = await new SearchPatentsTool(makeLogService(), client, unrecordedPatentLedger).invoke(makeOptions({ query: 'ta="foreign object" AND ta=charging' }), makeToken());
		expect(textOf(result).split('\n').at(-1)).toBe('Next step: 3 hits. Read them before you widen; widen only for a feature that stays unresolved (OR a synonym with the field repeated, drop the classification, or use its parent class).');
	});


	it('a zero count ends with the next step: check the field and the vocabulary, then widen one feature', async () => {
		const { client } = makeBackendClient(facadeEnvelope({ total: 0, effectiveQuery: 'ta=lidar AND ta=drone AND ta=obstacle', range: { begin: 1, end: 0 }, docs: [] }));
		const result = await new SearchPatentsTool(makeLogService(), client, unrecordedPatentLedger).invoke(makeOptions({ query: 'ta=lidar AND ta=drone AND ta=obstacle', range: '1-5' }), makeToken());
		expect(textOf(result).split('\n').at(-1)).toBe('Next step: 0 hits. A zero count is usually the vocabulary or the field, not absence: check each field name against the query field list, then widen one feature at a time (OR a synonym with the field repeated, or drop the least certain term) and probe again.');
	});


	it('a single hit is counted in the singular', async () => {
		const { client } = makeBackendClient(facadeEnvelope({ total: 1, effectiveQuery: 'ta=lidar AND ta=drone AND ta=obstacle', range: { begin: 1, end: 1 }, docs: [{ docId: 'WO2026173556A2', title: 'Multi-functional spider drone', applicants: [], publicationDate: null, abstract: null }] }));
		const result = await new SearchPatentsTool(makeLogService(), client, unrecordedPatentLedger).invoke(makeOptions({ query: 'ta=lidar AND ta=drone AND ta=obstacle', range: '1-5' }), makeToken());
		expect(textOf(result).split('\n').at(-1)).toBe('Next step: 1 hit. Read it before you widen; widen only for a feature that stays unresolved (OR a synonym with the field repeated, drop the classification, or use its parent class).');
	});


	it('a readable set larger than the page ends with the order and paging facts the model cannot see', async () => {
		const { client } = makeBackendClient(facadeEnvelope({ total: 308, effectiveQuery: 'ta=drone AND ta="turbine blade"', range: { begin: 1, end: 25 }, docs: [{ docId: 'WO2026210250A1', title: 'Blade drone', applicants: [], publicationDate: null, abstract: null }] }));
		const result = await new SearchPatentsTool(makeLogService(), client, unrecordedPatentLedger).invoke(makeOptions({ query: 'ta=drone AND ta="turbine blade"', range: '1-25' }), makeToken());
		expect(textOf(result).split('\n').at(-1)).toBe('Next step: 308 hits, 1-25 shown. OPS orders by its default order (newest first), not by relevance, and lists one publication per family. To rely on this set, page range through 26-308 (100 per call), or narrow until one page holds it.');
	});


	it('an OPS throttle names the wait, so the model retries this one query later instead of firing more probes', async () => {
		const { client } = makeBackendClient();
		client.post = async () => { throw new PatentBackendError(503, 'EPO OPS asked us to wait 12 seconds and the shared EPO throttle is still backing off. Please retry the same query in 12 seconds.'); };
		const result = await new SearchPatentsTool(makeLogService(), client, unrecordedPatentLedger).invoke(makeOptions({ query: 'ta=lidar AND ta=UAV AND ta=obstacle' }), makeToken());
		expect(textOf(result)).toBe('Error: Patent search backend returned 503: EPO OPS asked us to wait 12 seconds and the shared EPO throttle is still backing off. Please retry the same query in 12 seconds. OPS is throttling, not rejecting the query: wait the seconds named, then rerun this one query; send no other probe until it answers.');
	});


	it('an OPS fault names the grammar fix, so the model edits the query instead of retrying it', async () => {
		const opsFault = 'OPS error 413: <?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<fault xmlns="http://ops.epo.org">\n    <code>CLIENT.MinimumCharsBeforeTruncation</code>\n    <message>Not enough characters before truncation character must be provided. At least 3 characters must be provided when using truncation \'*\' and at lea';
		const { client } = makeBackendClient({ success: false, tool: 'search_patents', error: { code: 'INTERNAL_ERROR', message: opsFault } });
		const result = await new SearchPatentsTool(makeLogService(), client, unrecordedPatentLedger).invoke(makeOptions({ query: 'ta=drone AND pn=EP*' }), makeToken());
		expect(textOf(result)).toBe(`Error: Patent search backend returned 422: ${opsFault} OPS fault CLIENT.MinimumCharsBeforeTruncation: a * wildcard needs at least 3 characters before it. This is a grammar error, not an empty result: fix the query and run it once; call get_search_syntax for the field list.`);
	});

});
