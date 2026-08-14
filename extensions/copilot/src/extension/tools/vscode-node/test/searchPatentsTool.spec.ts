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
		const tool = new SearchPatentsTool(makeLogService(), client);

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

			Note: Use these patent document IDs to fetch detailed information (full claims, descriptions, etc.) if needed."
		`);
	});

	it('reports no results when the backend returns an empty doc list', async () => {
		const { client } = makeBackendClient(facadeEnvelope({ total: 0, docs: [] }));
		const tool = new SearchPatentsTool(makeLogService(), client);

		const result = await tool.invoke(makeOptions({ query: 'ti=(nothing)' }), makeToken());

		expect(textOf(result)).toBe('No patents found for query: ti=(nothing)');
	});
});
