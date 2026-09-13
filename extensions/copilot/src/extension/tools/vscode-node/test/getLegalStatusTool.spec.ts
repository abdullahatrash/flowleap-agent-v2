/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import { describe, expect, it } from 'vitest';
import type { ILogService } from '../../../../platform/log/common/logService';
import type { CancellationToken } from '../../../../util/vs/base/common/cancellation';
import { LanguageModelTextPart } from '../../../../vscodeTypes';
import { AuthRequiredError, type IPatentBackendClient, type IPatentBackendRequestOptions } from '../../../patentai/vscode-node/patentBackendClient';
import { GetLegalStatusTool } from '../getLegalStatusTool';
import { recordingPatentLedger, unrecordedPatentLedger } from './patentLedgerTestUtils';

// ── Fakes ──────────────────────────────────────────────────────────────────────

function makeLogService(): ILogService {
	return { trace: () => { }, debug: () => { }, info: () => { }, warn: () => { }, error: () => { } } as unknown as ILogService;
}

/**
 * A {@link IPatentBackendClient} whose `post` returns a scripted facade envelope (or throws a scripted
 * error), capturing the paths and bodies it was called with so the test can assert the tool routes
 * through the shared client seam with the normalized publication number.
 */
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

describe('GetLegalStatusTool', () => {

	it('renders a stateless payload as a chronological jurisdiction table with no per-state summary', async () => {
		const { client, calls } = makeBackendClient({
			success: true,
			data: {
				docId: 'EP1000000',
				events: [
					{ code: 'PLBE', country: 'EP', date: '2022-02-02', text: 'NO OPPOSITION FILED WITHIN TIME LIMIT', gazette: { number: null, date: '2003-12-19' } },
					{ code: 'MM4A', country: 'FR', date: '2019-10-31', text: 'LAPSE BECAUSE OF NON-PAYMENT OF DUE FEES', gazette: null },
				],
			},
		});
		const tool = new GetLegalStatusTool(makeLogService(), client, unrecordedPatentLedger);

		const result = await tool.invoke(makeOptions({ publicationNumber: 'EP-1000000-A1' }), makeToken());

		expect(calls).toEqual([{ path: '/tools/get_legal_status', body: { patent_number: 'EP1000000A1' } }]);
		expect(textOf(result)).toMatchInlineSnapshot(`
			"# Legal Status: EP1000000

			2 legal-status event(s) from EPO OPS (INPADOC), newest first.

			| Date | Country | Code | Event | Gazette |
			| --- | --- | --- | --- | --- |
			| 2022-02-02 | EP | PLBE | NO OPPOSITION FILED WITHIN TIME LIMIT | 2003-12-19 |
			| 2019-10-31 | FR | MM4A | LAPSE BECAUSE OF NON-PAYMENT OF DUE FEES | — |

			These are raw INPADOC legal-status events. Read in-force vs. lapsed/expired from the event history (grant, lapse/withdrawal, renewal-fee and opposition codes). For family-wide status across jurisdictions use get_patent_family; for the EP register prosecution timeline use get_register_events."
		`);
	});

	it('summarizes the latest post-grant event per contracting state above the event list', async () => {
		const { client } = makeBackendClient({
			success: true,
			data: {
				docId: 'EP2110298',
				events: [
					{ code: 'PG25', country: 'EP', date: '2024-10-31', text: 'LAPSED IN A CONTRACTING STATE', state: 'DE', effectiveDate: '2024-08-01', detail: 'LAPSE BECAUSE OF NON-PAYMENT OF DUE FEES', gazette: { number: null, date: '2024-10-31' } },
					{ code: 'PG25', country: 'EP', date: '2024-09-30', text: 'LAPSED IN A CONTRACTING STATE', state: 'FR', effectiveDate: '2024-01-31', gazette: null },
					{ code: 'PG25', country: 'EP', date: '2024-09-30', text: 'LAPSED IN A CONTRACTING STATE', state: 'GB', effectiveDate: '2024-01-19', gazette: null },
					{ code: 'PG25', country: 'EP', date: '2024-09-30', text: 'LAPSED IN A CONTRACTING STATE', state: 'NL', effectiveDate: '2024-02-01', gazette: null },
					{ code: 'PGFP', country: 'EP', date: '2023-01-20', text: 'ANNUAL FEE PAID TO NATIONAL OFFICE', state: 'FR', effectiveDate: '2022-12-08', paymentDate: '2022-12-08', feeYear: 15, gazette: null },
					{ code: 'PG25', country: 'EP', date: '2016-05-31', text: 'LAPSED IN A CONTRACTING STATE', state: 'IT', effectiveDate: '2015-11-30', gazette: null },
				],
			},
		});
		const tool = new GetLegalStatusTool(makeLogService(), client, unrecordedPatentLedger);

		const result = await tool.invoke(makeOptions({ publicationNumber: 'EP2110298B1' }), makeToken());

		expect(textOf(result)).toMatchInlineSnapshot(`
			"# Legal Status: EP2110298

			6 legal-status event(s) from EPO OPS (INPADOC), newest first.

			## Per-state summary

			| State | Latest event | Effective | Reading |
			| --- | --- | --- | --- |
			| DE | PG25 (2024-10-31) | 2024-08-01 | lapsed |
			| FR | PG25 (2024-09-30) | 2024-01-31 | lapsed |
			| GB | PG25 (2024-09-30) | 2024-01-19 | lapsed |
			| IT | PG25 (2016-05-31) | 2015-11-30 | lapsed |
			| NL | PG25 (2024-09-30) | 2024-02-01 | lapsed |

			Per-state reading is derived from the latest recorded event per state; a state with no event listed has no post-grant event in this feed, which is not evidence it was validated there.

			| Date | Country | State | Code | Event | Effective | Gazette |
			| --- | --- | --- | --- | --- | --- | --- |
			| 2024-10-31 | EP | DE | PG25 | LAPSED IN A CONTRACTING STATE — LAPSE BECAUSE OF NON-PAYMENT OF DUE FEES | 2024-08-01 | 2024-10-31 |
			| 2024-09-30 | EP | FR | PG25 | LAPSED IN A CONTRACTING STATE | 2024-01-31 | — |
			| 2024-09-30 | EP | GB | PG25 | LAPSED IN A CONTRACTING STATE | 2024-01-19 | — |
			| 2024-09-30 | EP | NL | PG25 | LAPSED IN A CONTRACTING STATE | 2024-02-01 | — |
			| 2023-01-20 | EP | FR | PGFP | ANNUAL FEE PAID TO NATIONAL OFFICE — fee year 15 — paid 2022-12-08 | 2022-12-08 | — |
			| 2016-05-31 | EP | IT | PG25 | LAPSED IN A CONTRACTING STATE | 2015-11-30 | — |

			These are raw INPADOC legal-status events. Read in-force vs. lapsed/expired from the event history (grant, lapse/withdrawal, renewal-fee and opposition codes). For family-wide status across jurisdictions use get_patent_family; for the EP register prosecution timeline use get_register_events."
		`);
	});

	it('reads a state whose latest event is a renewal-fee payment as still paid', async () => {
		const { client } = makeBackendClient({
			success: true,
			data: {
				docId: 'EP2110298',
				events: [
					{ code: 'PGFP', country: 'EP', date: '2023-01-20', text: 'ANNUAL FEE PAID TO NATIONAL OFFICE', state: 'FR', effectiveDate: '2022-12-08', paymentDate: '2022-12-08', feeYear: 15, gazette: null },
					{ code: 'PG25', country: 'EP', date: '2016-05-31', text: 'LAPSED IN A CONTRACTING STATE', state: 'FR', effectiveDate: '2015-11-30', gazette: null },
					{ code: 'PLFP', country: 'EP', date: '2021-01-20', text: 'FEE PAYMENT', state: 'BE', gazette: null },
				],
			},
		});
		const tool = new GetLegalStatusTool(makeLogService(), client, unrecordedPatentLedger);

		const result = await tool.invoke(makeOptions({ publicationNumber: 'EP2110298B1' }), makeToken());

		expect(textOf(result).split('\n\n')[3]).toMatchInlineSnapshot(`
			"| State | Latest event | Effective | Reading |
			| --- | --- | --- | --- |
			| BE | PLFP (2021-01-20) | — | unknown |
			| FR | PGFP (2023-01-20) | 2022-12-08 | fee paid (year 15) |"
		`);
	});

	it('reports no events when the backend returns an empty list', async () => {
		const { client } = makeBackendClient({ success: true, data: { docId: 'US9999999', events: [] } });
		const tool = new GetLegalStatusTool(makeLogService(), client, unrecordedPatentLedger);

		const result = await tool.invoke(makeOptions({ publicationNumber: 'US9999999B2' }), makeToken());

		expect(textOf(result)).toMatchInlineSnapshot(`
			"# Legal Status: US9999999

			No INPADOC legal-status events found for this publication number.

			EPO OPS may not hold legal-status data for this document. Verify the number with get_patent_details, or for EP prosecution history try get_register_events."
		`);
	});

	it('surfaces a backend auth error via the shared error handler with a recovery hint', async () => {
		const { client } = makeBackendClient(() => { throw new AuthRequiredError('Your FlowLeap session has expired. Please sign in again.'); });
		const tool = new GetLegalStatusTool(makeLogService(), client, unrecordedPatentLedger);

		const result = await tool.invoke(makeOptions({ publicationNumber: 'EP1000000' }), makeToken());

		expect(textOf(result)).toContain('Error fetching legal status for EP1000000: 401 - Your FlowLeap session has expired.');
		expect(textOf(result)).toContain('FlowLeap: Sign In');
	});

	it('records the requested publication, the event count and the exact text the model read', async () => {
		const { client } = makeBackendClient({ success: true, data: { docId: 'EP1000000', events: [{ code: 'MM4A', country: 'FR', date: '2024-01-10', text: 'LAPSE', gazette: null }] } });
		const { ledger, executions } = recordingPatentLedger();

		const result = await new GetLegalStatusTool(makeLogService(), client, ledger).invoke(makeOptions({ publicationNumber: 'EP-1000000-A1' }), makeToken());

		expect(executions).toEqual([{
			kind: 'status', status: 'succeeded', tool: 'get_legal_status', request: 'EP1000000A1',
			rowCount: 1, publicationIds: ['EP1000000A1'], resultText: textOf(result),
		}]);
	});

	it('records a failed lookup with the publication and no status text', async () => {
		const { client } = makeBackendClient(() => { throw new AuthRequiredError('Session expired.'); });
		const { ledger, executions } = recordingPatentLedger();

		await new GetLegalStatusTool(makeLogService(), client, ledger).invoke(makeOptions({ publicationNumber: 'EP1000000' }), makeToken());

		expect(executions).toEqual([{ kind: 'status', status: 'failed', tool: 'get_legal_status', request: 'EP1000000' }]);
	});
});
