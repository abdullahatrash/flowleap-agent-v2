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

describe('GetPatentFamilyTool', () => {

	it('renders INPADOC family members as a jurisdiction table', async () => {
		const { client, calls } = makeBackendClient({
			success: true,
			data: {
				docId: 'EP1000000',
				familyMembers: [
					{ docId: 'EP1000000', country: 'EP', docNumber: '1000000', kind: 'A1' },
					{ docId: 'US6000000', country: 'US', docNumber: '6000000', kind: 'B1' },
					{ docId: 'JP2000000', country: 'JP', docNumber: '2000000' },
				],
				totalCount: 3,
			},
		});
		const tool = new GetPatentFamilyTool(makeLogService(), client);

		const result = await tool.invoke(makeOptions({ publicationNumber: 'EP 1000000' }), makeToken());

		expect(calls).toEqual([{ path: '/tools/get_patent_family', body: { patent_number: 'EP1000000' } }]);
		expect(textOf(result)).toMatchInlineSnapshot(`
			"# Patent Family: EP1000000

			INPADOC family: 3 member(s) across jurisdictions.

			| Country | Publication | Kind |
			| --- | --- | --- |
			| EP | EP1000000 | A1 |
			| US | US6000000 | B1 |
			| JP | JP2000000 | — |

			The INPADOC family groups documents sharing a priority (equivalents/counterparts across jurisdictions). For the legal status of an individual member use get_legal_status on that member; for its EP prosecution history use get_register_events."
		`);
	});

	it('reports no family members when the backend returns an empty list', async () => {
		const { client } = makeBackendClient({ success: true, data: { docId: 'EP1000000', familyMembers: [], totalCount: 0 } });
		const tool = new GetPatentFamilyTool(makeLogService(), client);

		const result = await tool.invoke(makeOptions({ publicationNumber: 'EP1000000' }), makeToken());

		expect(textOf(result)).toMatchInlineSnapshot(`
			"# Patent Family: EP1000000

			No INPADOC family members found for this publication number.

			EPO OPS may not hold family data for this document. Verify the number with get_patent_details, or the patent may have no foreign equivalents."
		`);
	});

	it('surfaces a backend not-found error via the shared error handler', async () => {
		const { client } = makeBackendClient(() => { throw new PatentBackendError(404, 'OPS error 404: No results found'); });
		const tool = new GetPatentFamilyTool(makeLogService(), client);

		const result = await tool.invoke(makeOptions({ publicationNumber: 'EP0000000' }), makeToken());

		expect(textOf(result)).toMatchInlineSnapshot(`"Error fetching patent family for EP0000000: 404 - OPS error 404: No results found"`);
	});
});
