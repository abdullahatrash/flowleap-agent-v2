/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import { describe, expect, it } from 'vitest';
import type { ILogService } from '../../../../platform/log/common/logService';
import type { CancellationToken } from '../../../../util/vs/base/common/cancellation';
import { LanguageModelTextPart } from '../../../../vscodeTypes';
import { PatentBackendError, type IPatentBackendClient, type IPatentBackendRequestOptions } from '../../../patentai/vscode-node/patentBackendClient';
import { PatentAnalyticsVizTool } from '../patentAnalyticsVizTool';

// ── Fakes ──────────────────────────────────────────────────────────────────────

function makeLogService(): ILogService {
	return { trace: () => { }, debug: () => { }, info: () => { }, warn: () => { }, error: () => { } } as unknown as ILogService;
}

/**
 * A {@link IPatentBackendClient} whose `post` returns a scripted payload (or throws a scripted error),
 * capturing the paths and bodies it was called with so the test can assert the tool routes the
 * structured contract through the shared client seam.
 */
function makeBackendClient(postResult?: unknown | (() => never)) {
	const calls: { path: string; body?: unknown }[] = [];
	const client: IPatentBackendClient = {
		_serviceBrand: undefined,
		async getCustomerPortalUrl(): Promise<string> { return ''; },
		async post<T>(path: string, body: unknown, _token: CancellationToken, _options?: IPatentBackendRequestOptions): Promise<T> {
			calls.push({ path, body });
			if (typeof postResult === 'function') {
				return (postResult as () => never)();
			}
			return postResult as T;
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

/** Minimal invocation options — the tool only reads `options.input`. */
function makeOptions<T>(input: T): vscode.LanguageModelToolInvocationOptions<T> {
	return { input } as vscode.LanguageModelToolInvocationOptions<T>;
}

/** Read the single text part produced by a tool invocation. */
function textOf(result: vscode.LanguageModelToolResult): string {
	const part = result.content[0];
	return (part as LanguageModelTextPart).value;
}

const fixtureAnalytics = {
	success: true,
	searchDescription: 'patents mentioning "machine learning" assigned to Tesla',
	analytics: {
		byYear: [
			{ year: 2022, count: 40 },
			{ year: 2020, count: 12 },
			{ year: 2021, count: 25 },
		],
		byCountry: [
			{ country: 'US', count: 60 },
			{ country: 'CN', count: 17 },
		],
		topAssignees: [
			{ assignee: 'TESLA INC', count: 55 },
			{ assignee: 'PANASONIC', count: 22 },
		],
		topCPC: [
			{ cpc: 'G06N', count: 48 },
			{ cpc: 'H01M', count: 19 },
		],
	},
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('PatentAnalyticsVizTool', () => {

	it('posts the structured contract and renders each aggregate as a markdown table', async () => {
		const { client, calls } = makeBackendClient(fixtureAnalytics);
		const tool = new PatentAnalyticsVizTool(makeLogService(), client);

		const result = await tool.invoke(makeOptions({
			phrases: ['machine learning'],
			assignee: 'Tesla',
			cpc: ['G06N'],
			countryCode: 'us',
			dateFrom: '2020-01-01',
		}), makeToken());

		expect(calls).toEqual([{
			path: '/patent-analytics',
			body: { phrases: ['machine learning'], assignee: 'Tesla', cpc: ['G06N'], countryCode: 'US', dateFrom: '2020-01-01' },
		}]);
		expect(textOf(result)).toMatchInlineSnapshot(`
			"## Patent Analytics Results

			**Search**: patents mentioning "machine learning" assigned to Tesla

			Coverage: full-corpus counts over the backend patent corpus (a quarterly-refreshed slice of the Google Patents corpus). Each list below is capped at its top 20.

			### Filing Trend (by publication year)
			| Year | Patents |
			| --- | ---: |
			| 2020 | 12 |
			| 2021 | 25 |
			| 2022 | 40 |

			### Top Assignees
			| Assignee | Patents |
			| --- | ---: |
			| TESLA INC | 55 |
			| PANASONIC | 22 |

			### By Country
			| Country | Patents |
			| --- | ---: |
			| US | 60 |
			| CN | 17 |

			### Top CPC Sections
			| CPC | Patents |
			| --- | ---: |
			| G06N | 48 |
			| H01M | 19 |

			Highlight for the user: the peak filing years, the leading assignees, the geographic concentration, and the dominant CPC sections. The tables above are the deliverable — present them directly rather than re-deriving the numbers."
		`);
	});

	it('returns a criterion error without calling the backend when no criteria are given', async () => {
		const { client, calls } = makeBackendClient(fixtureAnalytics);
		const tool = new PatentAnalyticsVizTool(makeLogService(), client);

		const result = await tool.invoke(makeOptions({}), makeToken());

		expect(calls).toEqual([]);
		expect(textOf(result)).toBe('Error: Provide at least one search criterion: keywords, phrases, assignee, cpc, ipc, countryCode, dateFrom, or dateTo.');
	});

	it('reports no matches when the backend returns empty aggregates', async () => {
		const { client } = makeBackendClient({ success: true, searchDescription: 'patents about unobtanium', analytics: { byYear: [], byCountry: [], topAssignees: [], topCPC: [] } });
		const tool = new PatentAnalyticsVizTool(makeLogService(), client);

		const result = await tool.invoke(makeOptions({ keywords: ['unobtanium'] }), makeToken());

		expect(textOf(result)).toBe('No patents matched patents about unobtanium. Try broader keywords or fewer filters.');
	});

	it('surfaces a backend error with its recovery hint', async () => {
		const { client } = makeBackendClient(() => { throw new PatentBackendError(400, 'deprecated_parameter: query is no longer supported'); });
		const tool = new PatentAnalyticsVizTool(makeLogService(), client);

		const result = await tool.invoke(makeOptions({ keywords: ['ai'] }), makeToken());

		expect(textOf(result)).toBe('Error: Patent analytics returned 400: deprecated_parameter: query is no longer supported');
	});
});
