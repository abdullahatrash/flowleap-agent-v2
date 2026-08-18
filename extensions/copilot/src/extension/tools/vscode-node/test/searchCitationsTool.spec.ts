/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import { describe, expect, it } from 'vitest';
import type { ILogService } from '../../../../platform/log/common/logService';
import type { CancellationToken } from '../../../../util/vs/base/common/cancellation';
import { LanguageModelTextPart } from '../../../../vscodeTypes';
import type { IPatentBackendClient, IPatentBackendRequestOptions } from '../../../patentai/vscode-node/patentBackendClient';
import { SearchCitationsTool } from '../searchCitationsTool';
import { SearchForwardCitationsTool } from '../searchForwardCitationsTool';

// ── Fakes ──────────────────────────────────────────────────────────────────────

function makeLogService(): ILogService {
	return { trace: () => { }, debug: () => { }, info: () => { }, warn: () => { }, error: () => { } } as unknown as ILogService;
}

/** Wrap a tool payload in the `/v1/tools` facade envelope the seam actually returns. */
function facadeEnvelope(tool: string, data: unknown) {
	return { success: true, tool, data, executionTimeMs: 4 };
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

describe('SearchCitationsTool', () => {

	it('renders backward citations as a markdown table with X/Y/A categories and cited-passage snippets', async () => {
		const { client, calls } = makeBackendClient(facadeEnvelope('search_office_action_citations', {
			total: 2,
			citations: [
				{ citedDocument: 'US5555555A', country: 'US', category: 'X', rejectedClaims: '1, 3-5', examinerCited: true, officeActionDate: '2019-06-01', officeActionType: 'Non-Final', inventor: 'Smith', citedPassages: ['col 3, lines 10-20', 'col 5, lines 1-8'] },
				{ citedDocument: 'Doe et al., Solar Review', category: 'A', isNPL: true, applicantCited: true },
			],
		}));
		const tool = new SearchCitationsTool(makeLogService(), client);

		const result = await tool.invoke(makeOptions({ applicationNumber: '16/123,456', category: 'X', dateFrom: '2019-01-01' }), makeToken());

		// snake_case facade params, and the date window as a date_range object (backend #276).
		expect(calls).toEqual([{
			path: '/tools/search_office_action_citations',
			body: { application_number: '16123456', size: 100, examiner_cited_only: false, category: 'X', date_range: { from: '2019-01-01' } },
		}]);
		expect(textOf(result)).toMatchInlineSnapshot(`
			"Found 2 citations for application 16123456
			Category filter: X (novelty-destroying, 35 USC 102)
			Office-action date range: 2019-01-01 to latest

			| # | Cited Document | Category | Rejected Claims | Cited By | OA Date | OA Type | Inventor |
			| ---: | --- | --- | --- | --- | --- | --- | --- |
			| 1 | US5555555A [US] | X | 1, 3-5 | examiner | 2019-06-01 | Non-Final | Smith |
			| 2 | Doe et al., Solar Review (non-patent literature) | A | — | applicant | — | — | — |

			Categories: X (novelty-destroying, 35 USC 102); Y (obviousness, 35 USC 103); A (background reference).

			### Cited Passages
			- **US5555555A** (#1): col 3, lines 10-20 | col 5, lines 1-8

			For forward citations or citation statistics, use citation_api_guide."
		`);
	});

	it('reports no citations when the backend returns an empty data list', async () => {
		const { client } = makeBackendClient(facadeEnvelope('search_office_action_citations', { total: 0, citations: [] }));
		const tool = new SearchCitationsTool(makeLogService(), client);

		const result = await tool.invoke(makeOptions({ applicationNumber: '16/123,456' }), makeToken());

		expect(textOf(result)).toMatchInlineSnapshot(`
			"Found 0 citations for application 16123456

			No citations found matching the filters.

			Backward citations key on the US application number, not the publication number — if you passed a publication number, resolve the application number via get_patent_family (find the US member) then get_continuity (read its application number) and retry. To instead find patents that cite this document forward, use search_forward_citations with the publication number.

			For forward citations or citation statistics, use citation_api_guide."
		`);
	});
});

describe('SearchForwardCitationsTool', () => {

	it('renders forward citations as a symmetric table and now includes cited-passage snippets', async () => {
		const { client, calls } = makeBackendClient(facadeEnvelope('search_enriched_citations', {
			total: 1,
			citations: [
				{ applicationNumber: '17/987,654', category: 'Y', rejectedClaims: '2', examinerCited: true, officeActionDate: '2021-03-10', officeActionType: 'Final', inventor: 'Jones', citedPassages: ['para [0042]'] },
			],
		}));
		const tool = new SearchForwardCitationsTool(makeLogService(), client);

		const result = await tool.invoke(makeOptions({ citedDocument: 'US5555555A' }), makeToken());

		expect(calls).toEqual([{
			path: '/tools/search_enriched_citations',
			body: { cited_document: 'US5555555A', size: 100, examiner_cited_only: false },
		}]);
		expect(textOf(result)).toMatchInlineSnapshot(`
			"Found 1 patents citing US5555555A

			| # | Citing Application | Category | Rejected Claims | Cited By | OA Date | OA Type | Inventor |
			| ---: | --- | --- | --- | --- | --- | --- | --- |
			| 1 | 17/987,654 | Y | 2 | examiner | 2021-03-10 | Final | Jones |

			Categories: X (novelty-destroying, 35 USC 102); Y (obviousness, 35 USC 103); A (background reference).

			### Cited Passages
			- **17/987,654** (#1): para [0042]

			For citation statistics, use citation_api_guide."
		`);
	});
});
