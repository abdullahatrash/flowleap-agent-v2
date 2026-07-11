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
import { ComparePatentsTool } from '../comparePatentsTool';

function makeLogService(): ILogService {
	return { trace: () => { }, debug: () => { }, info: () => { }, warn: () => { }, error: () => { } } as unknown as ILogService;
}

function makeBackendClient(postPayload?: unknown) {
	const calls: { path: string; body?: unknown }[] = [];
	const client: IPatentBackendClient = {
		_serviceBrand: undefined,
		async getCustomerPortalUrl(): Promise<string> { return ''; },
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
	return { isCancellationRequested: false, onCancellationRequested() { return { dispose: () => { } }; } };
}

function makeOptions<T>(input: T): vscode.LanguageModelToolInvocationOptions<T> {
	return { input } as vscode.LanguageModelToolInvocationOptions<T>;
}

function textOf(result: vscode.LanguageModelToolResult): string {
	return (result.content[0] as LanguageModelTextPart).value;
}

describe('ComparePatentsTool', () => {

	it('renders a side-by-side attribute table with bounded abstracts and the compare_claims distinction', async () => {
		const { client, calls } = makeBackendClient({
			success: true,
			data: {
				count: 2,
				patents: [
					{
						patentNumber: 'EP1000000',
						docId: 'EP1000000.A1',
						title: 'Apparatus for manufacturing green bricks',
						abstract: 'An apparatus for manufacturing green bricks from clay.',
						applicants: ['DE BOER BEHEER NIJMEGEN BV [NL]'],
						inventors: ['KOSMAN WILHELMUS'],
						ipc: ['B28B 1/29'],
						cpc: ['B28B 1/29'],
						dates: { filing: '1998-11-13', publication: '2000-05-17', priority: ['1997-11-14'] },
					},
					{
						patentNumber: 'US10123456',
						docId: 'US10123456.B2',
						title: 'Phase change material heat sink',
						abstract: 'A heat sink including a lower shell, an upper shell and an internal matrix.',
						applicants: ['RAYTHEON CO [US]'],
						inventors: ['EVANS JEREMY T'],
						ipc: ['B23P 15/26'],
						cpc: ['H05K 7/2029'],
						dates: { filing: '2015-10-28', publication: '2018-11-06', priority: [] },
					},
				],
			},
		});
		const tool = new ComparePatentsTool(makeLogService(), client);

		const result = await tool.invoke(makeOptions({ patentNumbers: ['EP1000000', 'US10123456'] }), makeToken());

		expect(calls).toEqual([{ path: '/tools/compare_patents', body: { patent_numbers: ['EP1000000', 'US10123456'] } }]);
		expect(textOf(result)).toMatchInlineSnapshot(`
			"## Patent Comparison (2 documents)

			| Attribute | EP1000000 | US10123456 |
			| --- | --- | --- |
			| Title | Apparatus for manufacturing green bricks | Phase change material heat sink |
			| Applicants | DE BOER BEHEER NIJMEGEN BV [NL] | RAYTHEON CO [US] |
			| Inventors | KOSMAN WILHELMUS | EVANS JEREMY T |
			| Filing Date | 1998-11-13 | 2015-10-28 |
			| Publication Date | 2000-05-17 | 2018-11-06 |
			| Priority Date(s) | 1997-11-14 | N/A |
			| IPC | B28B 1/29 | B23P 15/26 |
			| CPC | B28B 1/29 | H05K 7/2029 |

			### Abstracts

			#### EP1000000
			An apparatus for manufacturing green bricks from clay.

			#### US10123456
			A heat sink including a lower shell, an upper shell and an internal matrix.

			---
			### Analysis Instructions
			Compare these PUBLISHED documents against each other using ONLY the data above: shared vs distinct applicants/inventors, overlapping IPC/CPC classifications (shared technical space), relative filing/priority dates (which is earlier prior art), and the substantive differences in the abstracts. Summarize what each covers and how they relate.

			NOTE: This is a document-to-document comparison. To chart a USER's own DRAFTED claim text against references element-by-element (novelty / FTO / 102-103 risk), use compare_claims instead. For a single patent's full claims and description, use get_patent_details."
		`);
	});

	it('rejects a single-patent request and points at get_patent_summary', async () => {
		const { client, calls } = makeBackendClient();
		const tool = new ComparePatentsTool(makeLogService(), client);

		const result = await tool.invoke(makeOptions({ patentNumbers: ['EP1000000'] }), makeToken());

		expect(calls).toEqual([]);
		expect(textOf(result)).toMatchInlineSnapshot(`"Error: compare_patents needs at least 2 patent numbers (received 1). To analyze a single patent, use get_patent_summary."`);
	});
});
