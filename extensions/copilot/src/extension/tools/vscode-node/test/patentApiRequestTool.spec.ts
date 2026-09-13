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
import { PatentApiRequestTool } from '../patentApiRequestTool';
import { recordingPatentLedger } from './patentLedgerTestUtils';

// ── Fakes (patstatQueryTool.spec.ts pattern) ───────────────────────────────────

function makeLogService(): ILogService {
	return { trace: () => { }, debug: () => { }, info: () => { }, warn: () => { }, error: () => { } } as unknown as ILogService;
}

function makeBackendClient(postResult?: unknown) {
	const calls: { path: string; body?: unknown }[] = [];
	const client: IPatentBackendClient = {
		_serviceBrand: undefined,
		async getCustomerPortalUrl(): Promise<string> { return ''; },
		getTrialModelKey(): never { throw new Error('getTrialModelKey not exercised in this test fake'); },
		async post<T>(path: string, body: unknown, _token: CancellationToken, _options?: IPatentBackendRequestOptions): Promise<T> {
			calls.push({ path, body });
			return postResult as T;
		},
		async get<T>(pathWithQuery: string, _token: CancellationToken, _options?: IPatentBackendRequestOptions): Promise<T> {
			calls.push({ path: pathWithQuery });
			return postResult as T;
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
	return (result.content[0] as LanguageModelTextPart).value;
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('PatentApiRequestTool', () => {

	it('records the method, path and body with the response count and the exact text returned to the model', async () => {
		const { client } = makeBackendClient({ success: true, tool: 'search_patents', data: { total: 38, docs: [{ docId: 'US7654321B2' }] } });
		const { ledger, executions } = recordingPatentLedger();

		const result = await new PatentApiRequestTool(makeLogService(), client, ledger).invoke(
			makeOptions({ path: '/v1/tools/search_patents', method: 'POST' as const, body: '{"query":"ti=brake","provider":"uspto"}' }),
			makeToken());

		expect(executions).toEqual([{
			kind: 'analytics', status: 'succeeded', tool: 'patent_api_request',
			request: 'POST /tools/search_patents {"query":"ti=brake","provider":"uspto"}',
			rowCount: 38, resultText: textOf(result),
		}]);
	});

	it('leaves rowCount unknown when the response states no count, and records nothing before a call that never happened', async () => {
		const { client, calls } = makeBackendClient({ success: true, data: { docs: [{ docId: 'US7654321B2' }] } });
		const { ledger, executions } = recordingPatentLedger();
		const tool = new PatentApiRequestTool(makeLogService(), client, ledger);

		await tool.invoke(makeOptions({ path: '/patstat/portfolio' }), makeToken());
		await tool.invoke(makeOptions({ path: '/tools/search_patents', method: 'POST' as const, body: 'not json' }), makeToken());

		expect({ recorded: executions.map(row => ({ request: row.request, rowCount: row.rowCount })), calls: calls.length })
			.toEqual({ recorded: [{ request: 'GET /patstat/portfolio', rowCount: undefined }], calls: 1 });
	});
});
