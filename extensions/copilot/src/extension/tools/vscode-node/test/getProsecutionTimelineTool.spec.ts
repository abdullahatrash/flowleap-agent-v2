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
import { GetProsecutionTimelineTool } from '../getProsecutionTimelineTool';

function makeLogService(): ILogService {
	return { trace: () => { }, debug: () => { }, info: () => { }, warn: () => { }, error: () => { } } as unknown as ILogService;
}

/** A {@link IPatentBackendClient} whose `post` returns a scripted payload, capturing paths/bodies. */
function makeBackendClient(postPayload?: unknown) {
	const calls: { path: string; body?: unknown }[] = [];
	const client: IPatentBackendClient = {
		_serviceBrand: undefined,
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

function makeToken(): CancellationToken {
	return { isCancellationRequested: false, onCancellationRequested() { return { dispose: () => { /* noop */ } }; } };
}

function makeOptions<T>(input: T): vscode.LanguageModelToolInvocationOptions<T> {
	return { input } as vscode.LanguageModelToolInvocationOptions<T>;
}

function textOf(result: vscode.LanguageModelToolResult): string {
	return (result.content[0] as LanguageModelTextPart).value;
}

describe('GetProsecutionTimelineTool', () => {

	it('sorts events chronologically, labels sources, and normalizes the publication number', async () => {
		const { client, calls } = makeBackendClient({
			success: true,
			tool: 'get_prosecution_timeline',
			data: {
				events: [
					{ code: 'AS', date: '2017-05-11', description: 'ASSIGNMENT', source: 'legal' },
					{ code: 'PG', date: '2015-01-01', description: 'FILING', source: 'register' },
				],
				patentNumber: 'US10123456',
				totalEvents: 2,
			},
		});
		const tool = new GetProsecutionTimelineTool(makeLogService(), client);

		const result = await tool.invoke(makeOptions({ publicationNumber: 'US-10123456' }), makeToken());

		expect(calls).toEqual([{ path: '/tools/get_prosecution_timeline', body: { patent_number: 'US10123456' } }]);
		expect(textOf(result)).toMatchInlineSnapshot(`
			"# Prosecution Timeline: US10123456

			2 event(s), earliest first:

			| # | Date | Event | Code | Source |
			| ---: | --- | --- | --- | --- |
			| 1 | 2015-01-01 | FILING | PG | EP Register |
			| 2 | 2017-05-11 | ASSIGNMENT | AS | INPADOC legal |

			Timeline merges EP Register and INPADOC legal-status events. For examiner-cited prior art use search_citations; for the parent/child application chain use get_continuity."
		`);
	});

	it('adds a coverage note when a source feed returned no data', async () => {
		const { client } = makeBackendClient({
			success: true,
			tool: 'get_prosecution_timeline',
			data: {
				events: [{ code: 'MAFP', date: '2022-04-28', description: 'MAINTENANCE FEE PAYMENT', source: 'legal' }],
				patentNumber: 'US10123456',
				sourceErrors: { register: 'OPS error 404: No results found' },
				totalEvents: 1,
			},
		});
		const tool = new GetProsecutionTimelineTool(makeLogService(), client);

		const result = await tool.invoke(makeOptions({ publicationNumber: 'US10123456' }), makeToken());

		expect(textOf(result)).toMatchInlineSnapshot(`
			"# Prosecution Timeline: US10123456

			1 event(s), earliest first:

			| # | Date | Event | Code | Source |
			| ---: | --- | --- | --- | --- |
			| 1 | 2022-04-28 | MAINTENANCE FEE PAYMENT | MAFP | INPADOC legal |

			Coverage note: no data from EP Register for this publication (this is normal outside that feed's jurisdiction).

			Timeline merges EP Register and INPADOC legal-status events. For examiner-cited prior art use search_citations; for the parent/child application chain use get_continuity."
		`);
	});

	it('surfaces a backend error with the recovery hint through the shared handler', async () => {
		const client: IPatentBackendClient = {
			_serviceBrand: undefined,
			async post<T>(): Promise<T> { throw new PatentBackendError(500, 'upstream failure'); },
			async get<T>(): Promise<T> { return undefined as T; },
		};
		const tool = new GetProsecutionTimelineTool(makeLogService(), client);

		const result = await tool.invoke(makeOptions({ publicationNumber: 'US10123456' }), makeToken());

		expect(textOf(result)).toMatchInlineSnapshot(`"Error building prosecution timeline for US10123456: 500 - upstream failure"`);
	});
});
