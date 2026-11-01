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
import { GetSearchSyntaxTool } from '../getSearchSyntaxTool';

function makeLogService(): ILogService {
	return { trace: () => { }, debug: () => { }, info: () => { }, warn: () => { }, error: () => { } } as unknown as ILogService;
}

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

describe('GetSearchSyntaxTool', () => {

	it('renders the backend grammar as a field table, the rules it lists, and the worked examples', async () => {
		// The shape the backend serves today (fields + examples) plus the keys the enriched grammar adds;
		// unknown keys render too, so a backend addition reaches the model without an app release.
		const { client, calls } = makeBackendClient({
			success: true, tool: 'get_search_syntax', data: {
				provider: 'epo_ops',
				language: 'EPO OPS CQL',
				summary: 'CQL query language. Combine field=value terms with and/or/not. Quote multi-word values.',
				fields: { ta: 'title or abstract', pa: 'applicant, e.g. pa=siemens' },
				rules: ['A * wildcard needs at least 3 characters before it.', 'Parentheses group whole field=value clauses.'],
				examples: ['ti="solid state battery" and pa=toyota'],
			}, executionTimeMs: 1,
		});
		const result = await new GetSearchSyntaxTool(makeLogService(), client).invoke(makeOptions({ provider: 'epo_ops' as const }), makeToken());
		expect(calls).toEqual([{ path: '/tools/get_search_syntax', body: { provider: 'epo_ops' } }]);
		expect(textOf(result)).toMatchInlineSnapshot(`
			"# EPO OPS CQL grammar

			CQL query language. Combine field=value terms with and/or/not. Quote multi-word values.

			## Fields

			| Field | Meaning |
			| --- | --- |
			| \`ta\` | title or abstract |
			| \`pa\` | applicant, e.g. pa=siemens |

			## Rules

			- A * wildcard needs at least 3 characters before it.
			- Parentheses group whole field=value clauses.

			## Examples

			- \`ti="solid state battery" and pa=toyota\`"
		`);
	});

	it('defaults to the EPO OPS grammar when no provider is named', async () => {
		const { client, calls } = makeBackendClient({ success: true, tool: 'get_search_syntax', data: { provider: 'epo_ops', language: 'EPO OPS CQL', fields: {}, examples: [] }, executionTimeMs: 1 });
		await new GetSearchSyntaxTool(makeLogService(), client).invoke(makeOptions({}), makeToken());
		expect(calls).toEqual([{ path: '/tools/get_search_syntax', body: { provider: 'epo_ops' } }]);
	});
});
