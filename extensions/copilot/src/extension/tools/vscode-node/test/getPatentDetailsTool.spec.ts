/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import { describe, expect, it, vi } from 'vitest';
import type { ILogService } from '../../../../platform/log/common/logService';
import { mock } from '../../../../util/common/test/simpleMock';
import { CancellationToken } from '../../../../util/vs/base/common/cancellation';
import { LanguageModelTextPart } from '../../../../vscodeTypes';
import type { IPatentBackendClient } from '../../../patentai/vscode-node/patentBackendClient';
import { PatentExecution, IPatentExecutionLedger } from '../../../patentai/vscode-node/patentExecutionLedger';
import { GetPatentDetailsTool } from '../getPatentDetailsTool';
import { unrecordedPatentLedger } from './patentLedgerTestUtils';

vi.mock('../../../../vscodeTypes', async () => import('../../../../util/common/test/shims/vscodeTypesShim'));
vi.mock('vscode', async importOriginal => ({ ...await importOriginal<typeof vscode>(), env: { uriScheme: 'flowleap' } }));

const publication = 'EP1234567A1';
const unsegmented = 'Whole claims block with uncertain numbering.';

/** Both segmented claims and an unsegmented block, the case where a document publishes both forms. */
function backend(claims: object, citedReferences?: object[]): IPatentBackendClient {
	const payloads: Record<string, object> = {
		get_bibliography: { documentReference: { publicationNumber: publication, section: 'bibliography' }, docId: publication, title: 'Fixture', abstract: null, applicants: [], inventors: [], ipc: [], cpc: [], dates: { publication: '2000-01-01' }, citedReferences },
		get_claims: claims,
		get_description: { documentReference: { publicationNumber: publication, section: 'description' }, docId: publication, language: 'en', description: 'A description.' },
	};
	return new class extends mock<IPatentBackendClient>() {
		override async post<T>(path: string): Promise<T> { return { success: true, data: payloads[path.replace('/tools/', '')] } as T; }
	}();
}

function logService(): ILogService {
	return { trace: () => { }, debug: () => { }, info: () => { }, warn: () => { }, error: () => { } } as unknown as ILogService;
}

const noClaims = { documentReference: { publicationNumber: publication, section: 'claims' }, docId: publication, language: 'en', totalClaims: null, claims: [] };

async function detailsText(backendClient: IPatentBackendClient): Promise<string> {
	const result = await new GetPatentDetailsTool(logService(), backendClient, unrecordedPatentLedger).invoke({ input: { publicationNumber: publication }, toolInvocationToken: undefined } as vscode.LanguageModelToolInvocationOptions<{ publicationNumber: string }>, CancellationToken.None);
	return (result.content[0] as LanguageModelTextPart).value;
}

describe('GetPatentDetailsTool cited references', () => {
	it('renders the search-report citations with category, claims and passages', async () => {
		const cited = [
			{ docId: 'US5356951', kind: 'A', date: '19941018', citedBy: 'examiner', phase: 'national-search-report', category: 'X', relevantClaims: '1-7,10-17', relevantPassages: ['* column 2, lines 25-41 *', '* column 3, lines 44-67 *'] },
			{ docId: 'US6274644', kind: 'B1', date: '20010814', citedBy: 'applicant' },
		];
		const text = await detailsText(backend(noClaims, cited));
		expect(text).toContain([
			`## Cited references (from this publication's bibliography)`,
			'Examiner-cited X/Y entries are the closest art on record for this document. Retrieve them with get_patent_details before widening the search.',
			'- US5356951 (A, 1994-10-18) — examiner, national-search-report, category X, claims 1-7,10-17; passages: column 2, lines 25-41; column 3, lines 44-67',
			'- US6274644 (B1, 2001-08-14) — applicant',
		].join('\n'));
	});

	it('points an EP A-publication without citations at the A3 search-report record', async () => {
		const text = await detailsText(backend(noClaims));
		expect({
			section: text.includes('## Cited references'),
			hint: text.includes('**Cited references:** none on this A1 publication. The EPO search-report citations are attached to EP1234567A3 (or the B1 grant); retrieve that kind to see the closest art on record.'),
		}).toEqual({ section: false, hint: true });
	});
});

describe('GetPatentDetailsTool claims selection', () => {
	it('prefers citable numbered claims over an unsegmented block when the backend returns both', async () => {
		const executions: Omit<PatentExecution, 'id' | 'recordedAt'>[] = [];
		const ledger: IPatentExecutionLedger = { ...unrecordedPatentLedger, record: async (_session, execution) => { executions.push(execution); return 'Recorded.'; } };
		const claims = { documentReference: { publicationNumber: publication, section: 'claims' }, docId: publication, language: 'en', totalClaims: 1, unsegmentedText: unsegmented, claims: [{ number: '1', text: 'A sensor.', documentReference: { publicationNumber: publication, section: 'claims', claimNumber: '1' } }] };
		const result = await new GetPatentDetailsTool(logService(), backend(claims), ledger).invoke({ input: { publicationNumber: publication }, toolInvocationToken: undefined } as vscode.LanguageModelToolInvocationOptions<{ publicationNumber: string }>, CancellationToken.None);
		const text = (result.content[0] as LanguageModelTextPart).value;
		const section = executions[0].sources?.find(source => source.reference.section === 'claims' && !source.reference.claimNumber);
		expect({ numbered: text.includes('A sensor.'), fallback: text.includes(unsegmented), retrieval: section?.retrieval, storedText: section?.text })
			.toEqual({ numbered: true, fallback: false, retrieval: 'returned', storedText: 'A sensor.' });
	});

	it('falls back to the unsegmented block when no claim numbers were established', async () => {
		const claims = { documentReference: { publicationNumber: publication, section: 'claims' }, docId: publication, language: 'en', totalClaims: null, unsegmentedText: unsegmented, claims: [] };
		const result = await new GetPatentDetailsTool(logService(), backend(claims), unrecordedPatentLedger).invoke({ input: { publicationNumber: publication }, toolInvocationToken: undefined } as vscode.LanguageModelToolInvocationOptions<{ publicationNumber: string }>, CancellationToken.None);
		const text = (result.content[0] as LanguageModelTextPart).value;
		expect({ fallback: text.includes(unsegmented), notice: text.includes('Individual claim numbers could not be established') }).toEqual({ fallback: true, notice: true });
	});
});
