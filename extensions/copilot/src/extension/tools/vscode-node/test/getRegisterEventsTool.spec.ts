/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import { describe, expect, it } from 'vitest';
import type { ILogService } from '../../../../platform/log/common/logService';
import type { CancellationToken } from '../../../../util/vs/base/common/cancellation';
import { LanguageModelTextPart } from '../../../../vscodeTypes';
import { SubscriptionRequiredError, type IPatentBackendClient, type IPatentBackendRequestOptions } from '../../../patentai/vscode-node/patentBackendClient';
import { GetRegisterEventsTool } from '../getRegisterEventsTool';

// ── Fakes ──────────────────────────────────────────────────────────────────────

function makeLogService(): ILogService {
	return { trace: () => { }, debug: () => { }, info: () => { }, warn: () => { }, error: () => { } } as unknown as ILogService;
}

function makeBackendClient(postResult: unknown | (() => never)) {
	const calls: { path: string; body?: unknown }[] = [];
	const client: IPatentBackendClient = {
		_serviceBrand: undefined,
		async getCustomerPortalUrl(): Promise<string> { return ''; },
		getTrialModelKey(): never { throw new Error('getTrialModelKey not exercised in this test fake'); },
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

function makeToken(): CancellationToken {
	return {
		isCancellationRequested: false,
		onCancellationRequested() {
			return { dispose: () => { /* noop */ } };
		},
	};
}

function makeOptions<T>(input: T): vscode.LanguageModelToolInvocationOptions<T> {
	return { input } as vscode.LanguageModelToolInvocationOptions<T>;
}

function textOf(result: vscode.LanguageModelToolResult): string {
	const part = result.content[0];
	return (part as LanguageModelTextPart).value;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GetRegisterEventsTool', () => {

	it('renders EP Register events as a chronological table', async () => {
		const { client, calls } = makeBackendClient({
			success: true,
			data: {
				docId: 'EP1000000',
				events: [
					{ code: 'OPPO', date: '2004-03-15', description: 'Opposition filed', gazette: { number: '2004/12', date: '2004-03-24' } },
					{ code: 'RFEE', date: '2003-11-01', description: 'Renewal fee paid', gazette: null },
				],
			},
		});
		const tool = new GetRegisterEventsTool(makeLogService(), client);

		const result = await tool.invoke(makeOptions({ publicationNumber: 'EP-1000000-B1' }), makeToken());

		expect(calls).toEqual([{ path: '/tools/get_register_events', body: { patent_number: 'EP1000000B1' } }]);
		expect(textOf(result)).toMatchInlineSnapshot(`
			"# Register Events: EP1000000

			2 EP Register event(s) — prosecution history (oppositions, transfers, amendments, lapses), newest first.

			| Date | Code | Event | Gazette |
			| --- | --- | --- | --- |
			| 2004-03-15 | OPPO | Opposition filed | 2004/12 (2004-03-24) |
			| 2003-11-01 | RFEE | Renewal fee paid | — |

			EP Register events cover EP applications/patents only. For INPADOC legal-status events across all jurisdictions use get_legal_status; for the patent family use get_patent_family."
		`);
	});

	it('reports no events when the backend returns an empty list', async () => {
		const { client } = makeBackendClient({ success: true, data: { docId: 'EP1000000', events: [] } });
		const tool = new GetRegisterEventsTool(makeLogService(), client);

		const result = await tool.invoke(makeOptions({ publicationNumber: 'EP1000000' }), makeToken());

		expect(textOf(result)).toMatchInlineSnapshot(`
			"# Register Events: EP1000000

			No EP Register events found for this publication number.

			The EP Register covers EP applications/patents only. For a non-EP document, or for INPADOC legal-status events across jurisdictions, use get_legal_status."
		`);
	});

	it('surfaces a backend subscription error via the shared error handler with a recovery hint', async () => {
		const { client } = makeBackendClient(() => { throw new SubscriptionRequiredError('An active FlowLeap subscription is required.', 'https://flowleap.co/upgrade'); });
		const tool = new GetRegisterEventsTool(makeLogService(), client);

		const result = await tool.invoke(makeOptions({ publicationNumber: 'EP1000000' }), makeToken());

		expect(textOf(result)).toContain('Error fetching register events for EP1000000: 402 - An active FlowLeap subscription is required.');
		expect(textOf(result)).toContain('FlowLeap needs to be set up');
	});
});
