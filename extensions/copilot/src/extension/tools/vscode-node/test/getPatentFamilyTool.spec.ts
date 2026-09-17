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
import { GetPatentFamilyTool } from '../getPatentFamilyTool';
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

/**
 * The EP2110298 extended family, as production served it on 2026-09-17 — the run that exposed the
 * defect this tool was fixed for. Both US applications have granted (US7722129B2, US8056987B2) and
 * the simple-family read this tool used to call names only their pre-grant publications. The fixture
 * is faithful in three ways that matter: the flat `members` list repeats one document across its
 * publication, application and priority rows; it carries `docdbApplication` values that read like
 * filing numbers and are not (#419), which must never reach the rendered table; and the EP B1 grant
 * is absent from it entirely, because publication rows deduplicate on country+number (backend #455)
 * — `representatives` is the block that still holds it.
 */
const EP2110298_EXTENDED_FAMILY = {
	docId: 'EP2110298',
	members: [
		{ country: 'EP', date: '20091021', docdbApplication: null, kind: 'A2', number: '2110298', publication: 'EP2110298A2', refType: 'publication' },
		{ country: 'EP', date: '20090119', docdbApplication: 'EP09250131 (A)', kind: 'A', number: '09250131', publication: 'EP2110298B1', refType: 'application' },
		{ country: 'US', date: '20080416', docdbApplication: 'US10374408 (A)', kind: 'A', number: '10374408', publication: 'US7722129B2', refType: 'priority' },
		{ country: 'US', date: '20091022', docdbApplication: null, kind: 'A1', number: '2009261648', publication: 'US2009261648A1', refType: 'publication' },
		{ country: 'US', date: '20080416', docdbApplication: 'US10374408 (A)', kind: 'A', number: '10374408', publication: 'US7722129B2', refType: 'application' },
		{ country: 'US', date: '20100525', docdbApplication: null, kind: 'B2', number: '7722129', publication: 'US7722129B2', refType: 'publication' },
		{ country: 'US', date: '20100805', docdbApplication: null, kind: 'A1', number: '2010194184', publication: 'US2010194184A1', refType: 'publication' },
		{ country: 'US', date: '20100408', docdbApplication: 'US75653110 (A)', kind: 'A', number: '75653110', publication: 'US8056987B2', refType: 'application' },
		{ country: 'US', date: '20100408', docdbApplication: 'US75653110 (A)', kind: 'A', number: '75653110', publication: 'US8056987B2', refType: 'priority' },
		{ country: 'US', date: '20111115', docdbApplication: null, kind: 'B2', number: '8056987', publication: 'US8056987B2', refType: 'publication' },
	],
	representatives: {
		members: [
			{ application: 'EP09250131 (A)', isGrant: true, publications: ['EP2110298A2', 'EP2110298A3', 'EP2110298B1'], representativePublication: 'EP2110298B1' },
			{ application: 'US10374408 (A)', isGrant: true, publications: ['US2009261648A1', 'US7722129B2'], representativePublication: 'US7722129B2' },
			{ application: 'US75653110 (A)', isGrant: true, publications: ['US2010194184A1', 'US8056987B2'], representativePublication: 'US8056987B2' },
		],
		rule: 'first-grant-else-earliest',
	},
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GetPatentFamilyTool', () => {

	it('reads the EXTENDED family and names a granted member by its grant, not by its pre-grant publication', async () => {
		const { client, calls } = makeBackendClient({ success: true, data: EP2110298_EXTENDED_FAMILY });
		const tool = new GetPatentFamilyTool(makeLogService(), client, unrecordedPatentLedger);

		const result = await tool.invoke(makeOptions({ publicationNumber: 'EP 2110298 B1' }), makeToken());

		// `get_family` is the extended INPADOC family. `get_patent_family` is the simple-family
		// /equivalents read, which holds neither US grant — calling it was the defect.
		expect(calls).toEqual([{ path: '/tools/get_family', body: { patent_number: 'EP2110298B1' } }]);
		expect(textOf(result)).toMatchInlineSnapshot(`
			"# Patent Family: EP2110298

			Extended INPADOC family: 3 member(s), from 10 family record(s).

			| Country | Cite | Kind | Grant | Published | Also published as |
			| --- | --- | --- | --- | --- | --- |
			| EP | EP2110298B1 | B1 | granted | — | EP2110298A2, EP2110298A3 |
			| US | US7722129B2 | B2 | granted | 2010-05-25 | US2009261648A1 |
			| US | US8056987B2 | B2 | granted | 2011-11-15 | US2010194184A1 |

			One row per family MEMBER (one application), not one row per publication: a member that published several times is listed once. \`Cite\` is that member's representative publication — its first grant where one exists, else its earliest publication — so a member that has granted is named by its grant, and its pre-grant publication appears under \`Also published as\`. Answer "where was this filed or granted" from the \`Cite\` column: a pre-grant publication and a granted patent are different legal objects. \`Grant\` reads "no grant on record" when this family record holds no grant publication for the member, which is not evidence the application was refused or is still pending — for that use get_legal_status on the member, and get_register_events for EP prosecution history. An empty \`Published\` cell means EPO OPS returned no publication row for that number in this family, not that it never published."
		`);
	});

	it('falls back to raw family records when the backend serves no member grouping', async () => {
		const { client } = makeBackendClient({ success: true, data: { docId: EP2110298_EXTENDED_FAMILY.docId, members: EP2110298_EXTENDED_FAMILY.members } });
		const tool = new GetPatentFamilyTool(makeLogService(), client, unrecordedPatentLedger);

		const result = await tool.invoke(makeOptions({ publicationNumber: 'EP2110298B1' }), makeToken());

		expect(textOf(result)).toMatchInlineSnapshot(`
			"# Patent Family: EP2110298

			INPADOC family records: 6 publication(s), from 10 row(s).

			| Country | Publication | Kind | Published |
			| --- | --- | --- | --- |
			| EP | EP2110298A2 | A2 | 2009-10-21 |
			| EP | EP2110298B1 | B1 | — |
			| US | US7722129B2 | B2 | 2010-05-25 |
			| US | US2009261648A1 | A1 | 2009-10-22 |
			| US | US2010194184A1 | A1 | 2010-08-05 |
			| US | US8056987B2 | B2 | 2011-11-15 |

			These are raw family records, NOT members: the backend returned no member grouping for this family, so a member that published several times appears several times, and a member that has granted may be listed only under its pre-grant publication. Treat the count as publications, not as members, and confirm any member you report with get_legal_status before calling it granted or pending."
		`);
	});

	it('reports no family members when the backend returns an empty family', async () => {
		const { client } = makeBackendClient({ success: true, data: { docId: 'EP1000000', members: [] } });
		const tool = new GetPatentFamilyTool(makeLogService(), client, unrecordedPatentLedger);

		const result = await tool.invoke(makeOptions({ publicationNumber: 'EP1000000' }), makeToken());

		expect(textOf(result)).toMatchInlineSnapshot(`
			"# Patent Family: EP1000000

			No INPADOC family members found for this publication number.

			EPO OPS may not hold family data for this document. Verify the number with get_patent_details, or the patent may have no family members beyond itself."
		`);
	});

	it('surfaces a backend not-found error via the shared error handler', async () => {
		const { client } = makeBackendClient(() => { throw new PatentBackendError(404, 'OPS error 404: No results found'); });
		const tool = new GetPatentFamilyTool(makeLogService(), client, unrecordedPatentLedger);

		const result = await tool.invoke(makeOptions({ publicationNumber: 'EP0000000' }), makeToken());

		expect(textOf(result)).toMatchInlineSnapshot(`"Error fetching patent family for EP0000000: 404 - OPS error 404: No results found"`);
	});

	it('records every family member by its citable publication number, not only the count', async () => {
		const { client } = makeBackendClient({ success: true, data: EP2110298_EXTENDED_FAMILY });
		const { ledger, executions } = recordingPatentLedger();

		const result = await new GetPatentFamilyTool(makeLogService(), client, ledger).invoke(makeOptions({ publicationNumber: 'EP 2110298 B1' }), makeToken());

		expect(executions).toEqual([{
			kind: 'status', status: 'succeeded', tool: 'get_patent_family', request: 'EP2110298B1',
			rowCount: 3,
			publicationIds: ['EP2110298B1', 'EP2110298A2', 'EP2110298A3', 'US7722129B2', 'US2009261648A1', 'US8056987B2', 'US2010194184A1'],
			resultText: textOf(result),
		}]);
	});
});
