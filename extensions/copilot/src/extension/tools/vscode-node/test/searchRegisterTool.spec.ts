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
import { SearchRegisterTool } from '../searchRegisterTool';
import { recordingPatentLedger, unrecordedPatentLedger } from './patentLedgerTestUtils';

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

/** The `search_register` facade `data` payload, as the live backend returned it on 2026-10-14 for `re=Kreuels`. */
const KREUELS_PAGE = {
	query: 're=Kreuels',
	range: { begin: 1, end: 2 },
	returned: 2,
	total: 845,
	docs: [
		{
			docId: 'EP4671722',
			applicationNumber: 'EP25183540',
			applicants: ['Syntegon Technology GmbH'],
			representatives: [{ name: 'Kreuels, Justus', country: 'DE', address: ['Kreuels Henrichs Pannen', '40474 Düsseldorf'] }],
			opponents: [],
			status: 'Examination is in progress',
			title: 'DEVICE FOR THE VISUALISATION OF GAS FLOWS IN A ROOM, ESPECIALLY IN A CLEAN ROOM',
			dates: { filing: '20250618', publication: '20251231' },
		},
		{
			docId: null,
			applicationNumber: 'EP24758162',
			applicants: ['Syntegon Technology GmbH', 'Bosch GmbH'],
			representatives: [{ name: 'Kreuels, Justus', country: 'DE', address: [] }, { name: 'Pannen, Kai', country: 'DE', address: [] }],
			opponents: [{ name: 'Siemens AG' }],
			status: null,
			title: null,
			dates: { filing: '20240812', publication: null },
		},
	],
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('SearchRegisterTool', () => {

	it('sends the register CQL with the default range and renders one row per EP application', async () => {
		const { client, calls } = makeBackendClient({ success: true, data: KREUELS_PAGE });
		const tool = new SearchRegisterTool(makeLogService(), client, unrecordedPatentLedger);

		const result = await tool.invoke(makeOptions({ query: 're=Kreuels' }), makeToken());

		expect(calls).toEqual([{ path: '/tools/search_register', body: { query: 're=Kreuels', range: '1-25' } }]);
		expect(textOf(result)).toMatchInlineSnapshot(`
			"# EP Register Search: re=Kreuels

			845 EP application(s) match this register query (OPS total for the whole query, capped at 10000). Showing results 1-2 in register order.

			| Publication | Application | Representative | Status | Applicant | Title |
			| --- | --- | --- | --- | --- | --- |
			| EP4671722 | EP25183540 | Kreuels, Justus (DE) | Examination is in progress | Syntegon Technology GmbH | DEVICE FOR THE VISUALISATION OF GAS FLOWS IN A ROOM, ESPECIALLY IN A CLEAN ROOM |
			| — (not yet published) | EP24758162 | Kreuels, Justus (DE); Pannen, Kai (DE) | — | Syntegon Technology GmbH; Bosch GmbH | — |

			The EP Register covers EP applications only, so a representative or opponent count from here is EP-only: say so. Report the total as the count and the rows as examples. Rows arrive in register order, not by relevance. For the register record of one application use get_register_biblio (ops_api_guide); for its event chronology use get_register_events."
		`);
	});

	it('passes a requested range through unchanged', async () => {
		const { client, calls } = makeBackendClient({ success: true, data: { ...KREUELS_PAGE, range: { begin: 26, end: 27 } } });
		const tool = new SearchRegisterTool(makeLogService(), client, unrecordedPatentLedger);

		const result = await tool.invoke(makeOptions({ query: 'op=Siemens and pd>=20200101', range: '26-50' }), makeToken());

		expect(calls).toEqual([{ path: '/tools/search_register', body: { query: 'op=Siemens and pd>=20200101', range: '26-50' } }]);
		expect(textOf(result)).toContain('Showing results 26-27 in register order.');
	});

	it('reports no matches when the backend returns an empty page without a hint', async () => {
		const { client } = makeBackendClient({ success: true, data: { query: 're=zzzz', range: { begin: 1, end: 0 }, returned: 0, total: 0, docs: [] } });
		const tool = new SearchRegisterTool(makeLogService(), client, unrecordedPatentLedger);

		const result = await tool.invoke(makeOptions({ query: 're=zzzz' }), makeToken());

		expect(textOf(result)).toMatchInlineSnapshot(`
			"# EP Register Search: re=zzzz

			No EP Register records match this query.

			The EP Register covers EP applications only. Register indexes: re (representative), op (opponent), nm (a name in any role), ia (inventor or applicant), pa, in, ti, pn, ap, pr, pd, ic. Not register indexes: ag, rep, ab, cpc, st, ps, fd, ctr. A role index that returns 0 does not mean the name is absent: retry with nm=<surname> to find which role the person holds. Names are surname-first: nm="Surname, First", not nm="First Surname". Quote a multi-word value: re="Muster Patentanwälte". See get_search_syntax provider=epo_register."
		`);
	});

	it('renders the backend hint directly under the no-match line when a role-index query returns zero', async () => {
		// The backend (flowleap-backend#582) adds `hint` to a zero-result role-index query, as it did on 2026-10-15 for `re=Boniberger`.
		const { client } = makeBackendClient({ success: true, data: { query: 're=Boniberger', range: { begin: 1, end: 0 }, returned: 0, total: 0, docs: [], hint: 'No results for re=Boniberger. The name may appear in another role; retry with nm=Boniberger.' } });
		const tool = new SearchRegisterTool(makeLogService(), client, unrecordedPatentLedger);

		const result = await tool.invoke(makeOptions({ query: 're=Boniberger' }), makeToken());

		expect(textOf(result)).toMatchInlineSnapshot(`
			"# EP Register Search: re=Boniberger

			No EP Register records match this query.
			No results for re=Boniberger. The name may appear in another role; retry with nm=Boniberger.

			The EP Register covers EP applications only. Register indexes: re (representative), op (opponent), nm (a name in any role), ia (inventor or applicant), pa, in, ti, pn, ap, pr, pd, ic. Not register indexes: ag, rep, ab, cpc, st, ps, fd, ctr. A role index that returns 0 does not mean the name is absent: retry with nm=<surname> to find which role the person holds. Names are surname-first: nm="Surname, First", not nm="First Surname". Quote a multi-word value: re="Muster Patentanwälte". See get_search_syntax provider=epo_register."
		`);
	});

	it('surfaces a backend subscription error via the shared error handler with a recovery hint', async () => {
		const { client } = makeBackendClient(() => { throw new SubscriptionRequiredError('An active FlowLeap subscription is required.', 'https://flowleap.co/upgrade'); });
		const tool = new SearchRegisterTool(makeLogService(), client, unrecordedPatentLedger);

		const result = await tool.invoke(makeOptions({ query: 're=Kreuels' }), makeToken());

		expect(textOf(result)).toContain('Error: EP Register search backend returned 402 - An active FlowLeap subscription is required.');
		expect(textOf(result)).toContain('Ask the user to subscribe');
	});

	it('records the register search the memo cites, with its total and the page of applications', async () => {
		const { client } = makeBackendClient({ success: true, data: KREUELS_PAGE });
		const { ledger, executions } = recordingPatentLedger();

		const result = await new SearchRegisterTool(makeLogService(), client, ledger).invoke(makeOptions({ query: 're=Kreuels', range: '1-2' }), makeToken());

		expect(result.content).toHaveLength(2);
		expect((result.content[1] as LanguageModelTextPart).value).toBe('Recorded.');
		expect(executions).toEqual([{
			kind: 'search', status: 'succeeded', query: 're=Kreuels', requestedRange: '1-2',
			total: 845, returned: 2, range: { begin: 1, end: 2 }, publicationIds: ['EP4671722', 'EP24758162'],
		}]);
	});
});
