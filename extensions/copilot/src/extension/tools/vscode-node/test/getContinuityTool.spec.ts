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
import { GetContinuityTool } from '../getContinuityTool';

function makeLogService(): ILogService {
	return { trace: () => { }, debug: () => { }, info: () => { }, warn: () => { }, error: () => { } } as unknown as ILogService;
}

/** A {@link IPatentBackendClient} whose `post` returns a scripted payload, capturing paths/bodies. */
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

function makeToken(): CancellationToken {
	return { isCancellationRequested: false, onCancellationRequested() { return { dispose: () => { /* noop */ } }; } };
}

function makeOptions<T>(input: T): vscode.LanguageModelToolInvocationOptions<T> {
	return { input } as vscode.LanguageModelToolInvocationOptions<T>;
}

function textOf(result: vscode.LanguageModelToolResult): string {
	return (result.content[0] as LanguageModelTextPart).value;
}

describe('GetContinuityTool', () => {

	it('renders parent and child continuity tables and normalizes the application number', async () => {
		const { client, calls } = makeBackendClient({
			success: true,
			tool: 'get_continuity',
			data: {
				count: 1,
				patentFileWrapperDataBag: [{
					applicationNumberText: '16123456',
					parentContinuityBag: [{
						parentApplicationNumberText: '15999999',
						parentApplicationFilingDate: '2016-01-01',
						parentApplicationStatusCode: 150,
						parentApplicationStatusDescriptionText: 'Patented Case',
						parentPatentNumber: '10111111',
						claimParentageTypeCode: 'CON',
						claimParentageTypeCodeDescriptionText: 'is a Continuation of',
					}],
					childContinuityBag: [{
						childApplicationNumberText: '17130468',
						childApplicationFilingDate: '2020-12-22',
						childApplicationStatusCode: 150,
						childApplicationStatusDescriptionText: 'Patented Case',
						childPatentNumber: '11797846',
						claimParentageTypeCode: 'DIV',
						claimParentageTypeCodeDescriptionText: 'is a Division of',
					}],
				}],
				requestIdentifier: 'test-id',
			},
		});
		const tool = new GetContinuityTool(makeLogService(), client);

		const result = await tool.invoke(makeOptions({ applicationNumber: '16/123,456' }), makeToken());

		expect(calls).toEqual([{ path: '/tools/get_continuity', body: { application_number: '16123456' } }]);
		expect(textOf(result)).toMatchInlineSnapshot(`
			"# Continuity Chain: Application 16123456

			## Parent applications (16123456 claims priority from these)

			| # | Parent Application | Patent | Filing Date | Relationship | Status |
			| ---: | --- | --- | --- | --- | --- |
			| 1 | 15999999 | 10111111 | 2016-01-01 | is a Continuation of | Patented Case (150) |

			## Child applications (later filings that claim priority from 16123456)

			| # | Child Application | Patent | Filing Date | Relationship | Status |
			| ---: | --- | --- | --- | --- | --- |
			| 1 | 17130468 | 11797846 | 2020-12-22 | is a Division of | Patented Case (150) |

			Relationship codes: CON = continuation, DIV = divisional, CIP = continuation-in-part, PRO = provisional. The earliest parent filing date sets the priority date for shared subject matter; a common-owner parent is where obviousness-type double patenting (terminal disclaimer) is assessed.
			These are the applicant's OWN related filings — for prior art cited against this application use search_citations; for a legal-event chronology use get_prosecution_timeline."
		`);
	});

	it('reports no relationships when both continuity bags are empty', async () => {
		const { client } = makeBackendClient({
			success: true,
			tool: 'get_continuity',
			data: { count: 1, patentFileWrapperDataBag: [{ applicationNumberText: '16999999' }] },
		});
		const tool = new GetContinuityTool(makeLogService(), client);

		const result = await tool.invoke(makeOptions({ applicationNumber: '16999999' }), makeToken());

		expect(textOf(result)).toMatchInlineSnapshot(`
			"# Continuity Chain: Application 16999999

			No continuity relationships found — this application has no parent or child applications on record (USPTO ODP)."
		`);
	});

	it('surfaces a backend error with the recovery hint through the shared handler', async () => {
		const calls: string[] = [];
		const client: IPatentBackendClient = {
			_serviceBrand: undefined,
			async getCustomerPortalUrl(): Promise<string> { return ''; },
			getTrialModelKey(): never { throw new Error('getTrialModelKey not exercised in this test fake'); },
			async post<T>(path: string): Promise<T> { calls.push(path); throw new PatentBackendError(404, 'not found'); },
			async get<T>(): Promise<T> { return undefined as T; },
		};
		const tool = new GetContinuityTool(makeLogService(), client);

		const result = await tool.invoke(makeOptions({ applicationNumber: '16123456' }), makeToken());

		expect(textOf(result)).toMatchInlineSnapshot(`"Error fetching continuity for application 16123456: 404 - not found"`);
	});
});
