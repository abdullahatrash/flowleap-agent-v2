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
function backend(claims: object, citedReferences?: object[], docId = publication, searchReport?: object[] | 'unavailable'): IPatentBackendClient {
	const payloads: Record<string, object> = {
		get_bibliography: { documentReference: { publicationNumber: docId, section: 'bibliography' }, docId, title: 'Fixture', abstract: null, applicants: [], inventors: [], ipc: [], cpc: [], dates: { publication: '2000-01-01' }, citedReferences },
		get_claims: claims,
		get_description: { documentReference: { publicationNumber: publication, section: 'description' }, docId: publication, language: 'en', description: 'A description.' },
	};
	return new class extends mock<IPatentBackendClient>() {
		override async post<T>(path: string, body?: unknown): Promise<T> {
			const requested = (body as { patent_number?: string } | undefined)?.patent_number;
			// The A3 search-report record is a second bibliography read for a different publication.
			if (path.endsWith('get_bibliography') && requested?.endsWith('A3')) {
				if (searchReport === 'unavailable' || !searchReport) { throw new Error('not found'); }
				return { success: true, data: { docId: requested, title: 'Search report', abstract: null, applicants: [], inventors: [], ipc: [], cpc: [], dates: { publication: '2000-06-01' }, citedReferences: searchReport } } as T;
			}
			return { success: true, data: payloads[path.replace('/tools/', '')] } as T;
		}
	}();
}

function logService(): ILogService {
	return { trace: () => { }, debug: () => { }, info: () => { }, warn: () => { }, error: () => { } } as unknown as ILogService;
}

const noClaims = { documentReference: { publicationNumber: publication, section: 'claims' }, docId: publication, language: 'en', totalClaims: null, claims: [] };

async function detailsText(backendClient: IPatentBackendClient, requested = publication): Promise<string> {
	const result = await new GetPatentDetailsTool(logService(), backendClient, unrecordedPatentLedger).invoke({ input: { publicationNumber: requested }, toolInvocationToken: undefined } as vscode.LanguageModelToolInvocationOptions<{ publicationNumber: string }>, CancellationToken.None);
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
			'Examiner-cited X/Y entries are the closest art on record for this document. Retrieve only the in-scope, pre-cutoff ones, one at a time, and read each with evidenceLookup before retrieving the next; a retrieved document that is never cited is disclosed in the report as unreviewed.',
			'- US5356951 (A, 1994-10-18) — examiner, national-search-report, category X, claims 1-7,10-17; passages: column 2, lines 25-41; column 3, lines 44-67',
			'- US6274644 (B1, 2001-08-14) — applicant',
		].join('\n'));
	});

	it('fetches the A3 search-report citations itself when an EP A-publication carries none', async () => {
		const examiner = [{ docId: 'US5356951', kind: 'A', date: '19941018', citedBy: 'examiner', phase: 'national-search-report', category: 'X', relevantClaims: '1-7' }];
		const text = await detailsText(backend(noClaims, undefined, publication, examiner));
		expect(text).toContain([
			'## Cited references (from the EP1234567A3 search report)',
			'Examiner-cited X/Y entries are the closest art on record for this document. Retrieve only the in-scope, pre-cutoff ones, one at a time, and read each with evidenceLookup before retrieving the next; a retrieved document that is never cited is disclosed in the report as unreviewed.',
			'- US5356951 (A, 1994-10-18) — examiner, national-search-report, category X, claims 1-7',
		].join('\n'));
	});

	it('says so when neither the A-publication nor its A3 record carries citations', async () => {
		const text = await detailsText(backend(noClaims, undefined, publication, 'unavailable'));
		expect({
			section: text.includes('## Cited references'),
			note: text.includes('**Cited references:** none on this A1 publication, and the EP1234567A3 search-report record returned none or was unavailable.'),
		}).toEqual({ section: false, note: true });
	});

	it('fetches the A3 record for a B1 grant too', async () => {
		const applicant = [{ docId: 'US6274644', kind: 'B1', date: '20010814', citedBy: 'applicant' }];
		const text = await detailsText(backend(noClaims, undefined, 'EP1234567B1', applicant), 'EP1234567B1');
		expect(text).toContain('## Cited references (from the EP1234567A3 search report)\n');
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
