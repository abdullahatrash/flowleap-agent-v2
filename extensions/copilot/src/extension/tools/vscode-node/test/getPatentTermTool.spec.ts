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
import { GetPatentTermTool } from '../getPatentTermTool';

function makeLogService(): ILogService {
	return { trace: () => { }, debug: () => { }, info: () => { }, warn: () => { }, error: () => { } } as unknown as ILogService;
}

/** A {@link IPatentBackendClient} whose `post` returns a scripted payload (or throws), capturing calls. */
function makeBackendClient(postPayload?: unknown, postError?: unknown) {
	const calls: { path: string; body?: unknown }[] = [];
	const client: IPatentBackendClient = {
		_serviceBrand: undefined,
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

describe('GetPatentTermTool', () => {

	it('formats the term estimate and surfaces the backend disclaimer', async () => {
		const { client, calls } = makeBackendClient({
			success: true,
			data: {
				patentNumber: 'EP1000000',
				filingDate: '2000-05-17',
				baseExpiryDate: '2020-05-17',
				basis: '20 years from filing date',
				disclaimer: 'Estimated term only: does not account for annuity lapses, terminal disclaimers, SPCs/extensions, or US patent term adjustment (PTA). Check get_legal_status for lapse/withdrawal events.',
			},
		});
		const tool = new GetPatentTermTool(makeLogService(), client);

		const result = await tool.invoke(makeOptions({ patentNumber: 'EP1000000' }), makeToken());

		expect(calls).toEqual([{ path: '/tools/get_patent_term', body: { patent_number: 'EP1000000' } }]);
		expect(textOf(result)).toMatchInlineSnapshot(`
			"# Patent Term Estimate: EP1000000

			**Filing Date:** 2000-05-17
			**Estimated Expiry (base):** 2020-05-17
			**Basis:** 20 years from filing date

			> Estimated term only: does not account for annuity lapses, terminal disclaimers, SPCs/extensions, or US patent term adjustment (PTA). Check get_legal_status for lapse/withdrawal events.

			---
			For lapse/withdrawal, terminal disclaimers, or adjustment (PTA/PTE/SPC) data, use get_patent_summary (legal-status events) or the OPS legal endpoint — this is a base estimate only, not the enforceable expiry date."
		`);
	});

	it('reports a clean message when the backend has no filing date (422)', async () => {
		const { client } = makeBackendClient(undefined, new PatentBackendError(422, 'No filing date available for EP1000000; cannot estimate term.'));
		const tool = new GetPatentTermTool(makeLogService(), client);

		const result = await tool.invoke(makeOptions({ patentNumber: 'EP1000000' }), makeToken());

		expect(textOf(result)).toMatchInlineSnapshot(`"Could not estimate the term for EP1000000: No filing date available for EP1000000; cannot estimate term. A filing date is required; use get_patent_summary or the legal-status events to check current status."`);
	});
});
