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
import { GetPatentSummaryTool } from '../getPatentSummaryTool';

function makeLogService(): ILogService {
	return { trace: () => { }, debug: () => { }, info: () => { }, warn: () => { }, error: () => { } } as unknown as ILogService;
}

function makeBackendClient(postPayload?: unknown, postError?: unknown) {
	const calls: { path: string; body?: unknown }[] = [];
	const client: IPatentBackendClient = {
		_serviceBrand: undefined,
		async getCustomerPortalUrl(): Promise<string> { return ''; },
		getTrialModelKey(): never { throw new Error('getTrialModelKey not exercised in this test fake'); },
		async post<T>(path: string, body: unknown, _token: CancellationToken, _options?: IPatentBackendRequestOptions): Promise<T> {
			calls.push({ path, body });
			if (postError) {
				throw postError;
			}
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
	return { isCancellationRequested: false, onCancellationRequested() { return { dispose: () => { } }; } };
}

function makeOptions<T>(input: T): vscode.LanguageModelToolInvocationOptions<T> {
	return { input } as vscode.LanguageModelToolInvocationOptions<T>;
}

function textOf(result: vscode.LanguageModelToolResult): string {
	return (result.content[0] as LanguageModelTextPart).value;
}

describe('GetPatentSummaryTool', () => {

	it('formats the compound overview (biblio + abstract + latest status + family + term)', async () => {
		const { client, calls } = makeBackendClient({
			success: true,
			data: {
				patentNumber: 'EP1000000',
				bibliography: {
					docId: 'EP1000000.A1',
					title: 'Apparatus for manufacturing green bricks',
					abstract: 'The invention relates to an apparatus for manufacturing green bricks from clay.',
					applicants: ['DE BOER BEHEER NIJMEGEN BV [NL]'],
					inventors: ['KOSMAN WILHELMUS'],
					ipc: ['B28B 1/29', 'B28B 5/02'],
					cpc: ['B28B 1/29'],
					dates: { filing: '1998-11-13', publication: '2000-05-17', priority: ['1997-11-14'] },
				},
				legalStatus: {
					docId: 'EP1000000',
					events: [
						{ code: 'PLBE', country: 'EP', date: '2003-12-19', text: 'NO OPPOSITION FILED WITHIN TIME LIMIT' },
						{ code: 'GRAA', country: 'EP', date: '2002-12-28', text: '(EXPECTED) GRANT' },
					],
				},
				family: { docId: 'EP1000000', familyMembers: [{}, {}, {}], totalCount: 3 },
				term: {
					patentNumber: 'EP1000000',
					filingDate: '1998-11-13',
					baseExpiryDate: '2018-11-13',
					basis: '20 years from filing date',
					disclaimer: 'Estimated term only: does not account for annuity lapses, SPCs, or PTA.',
				},
			},
		});
		const tool = new GetPatentSummaryTool(makeLogService(), client);

		const result = await tool.invoke(makeOptions({ patentNumber: 'EP1000000' }), makeToken());

		expect(calls).toEqual([{ path: '/tools/get_patent_summary', body: { patent_number: 'EP1000000' } }]);
		expect(textOf(result)).toMatchInlineSnapshot(`
			"# Patent Summary: EP1000000

			**Title:** Apparatus for manufacturing green bricks
			**Applicants:** DE BOER BEHEER NIJMEGEN BV [NL]
			**Inventors:** KOSMAN WILHELMUS
			**Filing Date:** 1998-11-13
			**Publication Date:** 2000-05-17
			**Priority Date(s):** 1997-11-14
			**IPC:** B28B 1/29, B28B 5/02
			**CPC:** B28B 1/29

			## Abstract
			The invention relates to an apparatus for manufacturing green bricks from clay.

			## Legal Status
			- 2003-12-19 — PLBE (EP): NO OPPOSITION FILED WITHIN TIME LIMIT
			- 2002-12-28 — GRAA (EP): (EXPECTED) GRANT

			## Patent Family
			3 family member(s) on record. Use patent_api_request with GET /ops/family?doc=EP1000000 for the full list.

			## Estimated Term
			**Estimated Expiry (base):** 2018-11-13 (20 years from filing date)
			> Estimated term only: does not account for annuity lapses, SPCs, or PTA.
			For a dedicated term estimate use get_patent_term.

			---
			This is an OVERVIEW (biblio, abstract, latest status, family, estimated term). For the FULL claims and description text, use get_patent_details; for the drawings, use get_patent_figures."
		`);
	});

	it('carries the designated states into the legal-status section', async () => {
		// The one-call overview is where "tell me about EP X" lands, so the designation has to be
		// here too — family reports one "EP" member and cannot answer which countries it covers.
		const { client } = makeBackendClient({
			success: true,
			data: {
				patentNumber: 'EP3804704',
				bibliography: null,
				legalStatus: {
					docId: 'EP3804704',
					events: [{ code: 'AK', country: 'EP', date: '2021-04-14', text: 'DESIGNATED CONTRACTING STATES' }],
					designatedStates: ['AL', 'AT', 'BE', 'DE', 'FR', 'GB'],
					extensionStates: ['BA', 'ME'],
				},
				family: null,
				term: null,
			},
		});
		const tool = new GetPatentSummaryTool(makeLogService(), client);

		const text = textOf(await tool.invoke(makeOptions({ patentNumber: 'EP3804704' }), makeToken()));

		expect(text).toContain('**Designated contracting states (6):** AL, AT, BE, DE, FR, GB');
		expect(text).toContain('**Extension/validation states (2):** BA, ME');
		expect(text).toContain('Designated, not necessarily still in force');
	});

	it('renders no designated states when the payload carries none', async () => {
		const { client } = makeBackendClient({
			success: true,
			data: {
				patentNumber: 'US10000000',
				bibliography: null,
				legalStatus: {
					docId: 'US10000000',
					events: [{ code: 'PGFP', country: 'US', date: '2021-06-01', text: 'FEE PAID' }],
					designatedStates: [],
					extensionStates: [],
				},
				family: null,
				term: null,
			},
		});
		const tool = new GetPatentSummaryTool(makeLogService(), client);

		expect(textOf(await tool.invoke(makeOptions({ patentNumber: 'US10000000' }), makeToken()))).not.toContain('Designated');
	});

	it('surfaces a backend error through the shared handler', async () => {
		const { client } = makeBackendClient(undefined, new PatentBackendError(404, 'Patent not found: EP9999999'));
		const tool = new GetPatentSummaryTool(makeLogService(), client);

		const result = await tool.invoke(makeOptions({ patentNumber: 'EP9999999' }), makeToken());

		expect(textOf(result)).toMatchInlineSnapshot(`"Error fetching summary for EP9999999: 404 - Patent not found: EP9999999"`);
	});
});
