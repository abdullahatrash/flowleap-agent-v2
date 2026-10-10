/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import { describe, expect, it, vi } from 'vitest';
import type { IFileSystemService } from '../../../../platform/filesystem/common/fileSystemService';
import type { ILogService } from '../../../../platform/log/common/logService';
import type { IPromptPathRepresentationService } from '../../../../platform/prompts/common/promptPathRepresentationService';
import type { IWorkspaceService } from '../../../../platform/workspace/common/workspaceService';
import { mock } from '../../../../util/common/test/simpleMock';
import { CancellationToken } from '../../../../util/vs/base/common/cancellation';
import { URI } from '../../../../util/vs/base/common/uri';
import type { IInstantiationService } from '../../../../util/vs/platform/instantiation/common/instantiation';
import { LanguageModelTextPart } from '../../../../vscodeTypes';
import type { IPatentBackendClient } from '../../../patentai/vscode-node/patentBackendClient';
import { ExaminerBaselineTool } from '../examinerBaselineTool';
import { recordingPatentLedger } from './patentLedgerTestUtils';

vi.mock('../../../../vscodeTypes', async () => import('../../../../util/common/test/shims/vscodeTypesShim'));

/** A Baseline as the backend's examiner_baseline tool returns it: two members, three documents, one gap. */
const baseline = {
	publication: 'EP2110298B1',
	offices: ['EP', 'US'],
	membersWalked: [
		{ office: 'EP', representativePublication: 'EP2110298B1', docdbApplication: '08154575', publications: [{ publication: 'EP2110298A3', status: 'read', citedCount: 2, examinerCount: 2, applicantCount: 0 }, { publication: 'EP2110298B1', status: 'no_citation_record', citedCount: 0, examinerCount: 0, applicantCount: 0 }] },
		{ office: 'US', representativePublication: 'US7722129B2', docdbApplication: '12103744', publications: [{ publication: 'US7722129B2', status: 'read', citedCount: 1, examinerCount: 1, applicantCount: 0 }], usptoEnriched: { applicationNumber: '12103744', status: 'read', rows: 1, total: 1, unidentifiedRows: 0 } },
	],
	documents: [
		{ document: 'US5135330', kinds: ['A'], familyId: null, cells: { EP: { text: 'X,A cl. 1-5', citations: [{ source: 'ops_biblio', citing: 'EP2110298A3', citedBy: 'examiner', category: 'X,A', relevantClaims: '1-5' }] } } },
		{ document: 'EP1602570', kinds: ['A1'], familyId: null, cells: { EP: { text: 'X,A cl. 13', citations: [{ source: 'ops_biblio', citing: 'EP2110298A3', citedBy: 'applicant', category: 'X,A', relevantClaims: '13' }] } } },
		{ document: 'US4964287', kinds: ['A'], familyId: null, cells: { US: { text: 'examiner', citations: [{ source: 'ops_biblio', citing: 'US7722129B2', citedBy: 'examiner' }] } } },
	],
	gaps: [{ office: 'KR', member: 'KR20150058102A', source: 'ops_biblio', reason: 'no_citation_record', message: 'no citation record from KR (KR20150058102A)' }],
	dedupe: 'docdb-number',
};

function tool(written: Map<string, string>, requests: unknown[], data: object = baseline) {
	const { ledger, executions } = recordingPatentLedger();
	const client = new class extends mock<IPatentBackendClient>() {
		override async post<T>(path: string, body?: unknown): Promise<T> {
			requests.push({ path, body });
			return { success: true, data } as T;
		}
	}();
	const fileSystem = new class extends mock<IFileSystemService>() {
		override stat(): Promise<never> { return Promise.reject(new Error('No such directory.')); }
		override createDirectory(): Promise<void> { return Promise.resolve(); }
		override writeFile(uri: URI, content: Uint8Array): Promise<void> { written.set(uri.path, new TextDecoder().decode(content)); return Promise.resolve(); }
	}();
	const paths = new class extends mock<IPromptPathRepresentationService>() {
		override resolveFilePath(filePath: string): URI | undefined { return filePath.startsWith('/') ? URI.file(filePath) : undefined; }
	}();
	const workspace = new class extends mock<IWorkspaceService>() {
		override getWorkspaceFolders(): URI[] { return [URI.file('/work')]; }
	}();
	const instantiation = new class extends mock<IInstantiationService>() {
		override invokeFunction(): never { return undefined as never; }
	}();
	const log = { trace: () => { }, debug: () => { }, info: () => { }, warn: () => { }, error: () => { } } as unknown as ILogService;
	return { executions, tool: new ExaminerBaselineTool(log, client, fileSystem, paths, workspace, instantiation, ledger) };
}

async function run(input: { publication: string; saveDir?: string }, data: object = baseline) {
	const written = new Map<string, string>();
	const requests: unknown[] = [];
	const { tool: baselineTool, executions } = tool(written, requests, data);
	const result = await baselineTool.invoke({ input } as vscode.LanguageModelToolInvocationOptions<typeof input>, CancellationToken.None);
	const text = result.content.filter((part): part is LanguageModelTextPart => part instanceof LanguageModelTextPart).map(part => part.value).join('');
	return { text, written, requests, executions };
}

describe('ExaminerBaselineTool', () => {
	it('writes the full Baseline to references/ and returns only a short summary with the path', async () => {
		const { text, written, requests, executions } = await run({ publication: 'EP2110298B1' });
		expect({
			requests,
			files: [...written.keys()],
			fileIsUnedited: JSON.parse(written.get('/work/references/EP2110298B1.examiner-baseline.json') ?? 'null'),
			text: text.split('\n'),
			executions: executions.map(execution => ({ ...execution, resultText: execution.resultText === text })),
		}).toEqual({
			requests: [{ path: '/tools/examiner_baseline', body: { publication: 'EP2110298B1' } }],
			files: ['/work/references/EP2110298B1.examiner-baseline.json'],
			fileIsUnedited: baseline,
			text: [
				'Examiner Baseline of EP2110298B1 saved in full (unedited, untruncated) to references/EP2110298B1.examiner-baseline.json.',
				'Offices: EP, US.',
				'Members walked: 2.',
				'- EP EP2110298B1: EP2110298A3 read (citedCount 2, examinerCount 2); EP2110298B1 no_citation_record',
				'- US US7722129B2: US7722129B2 read (citedCount 1, examinerCount 1); USPTO enriched read (1 rows)',
				'Documents: 3. Gaps: 1.',
				'- Gap: no citation record from KR (KR20150058102A)',
				'Provenance: every category, claim list and count was copied from the offices\' records by code, never inferred by a model. A gap means that office returned no citation record or could not be read; it is not "nothing cited".',
				'Read documents[] and the categories from references/EP2110298B1.examiner-baseline.json with read_file. Pass "references/EP2110298B1.examiner-baseline.json" as baselinePath to write_patent_results; do not paste the matrix inline and do not edit the file.',
			],
			executions: [{ kind: 'analytics', status: 'succeeded', tool: 'examiner_baseline', request: 'EP2110298B1', purpose: 'Examiner Baseline of EP2110298B1 (Find Better Step 1)', rowCount: 3, resultText: true }],
		});
	});

	it('refuses a saveDir outside the workspace without calling the backend or writing a file', async () => {
		const { text, written, requests, executions } = await run({ publication: 'EP2110298B1', saveDir: '/tmp/elsewhere' });
		expect({ text, files: written.size, requests: requests.length, executions }).toEqual({
			text: 'Error: saveDir "/tmp/elsewhere" is not a folder inside the open workspace. The Examiner Baseline is saved in the workspace so write_patent_results can read it as baselinePath; omit saveDir to use "references".',
			files: 0,
			requests: 0,
			executions: [{ kind: 'analytics', status: 'failed', tool: 'examiner_baseline', request: 'EP2110298B1', purpose: 'Examiner Baseline of EP2110298B1 (Find Better Step 1)' }],
		});
	});
});

describe('ExaminerBaselineTool cited papers', () => {
	it('tells the model how many NPL rows were resolved and where to read them', async () => {
		const withNpl = {
			...baseline,
			documents: [...baseline.documents, { document: 'NPL: CONG L. ET AL', npl: 'CONG L. ET AL: "MULTIPLEX GENOME ENGINEERING"', cells: {}, nplWork: { status: 'matched', work: { title: 'Multiplex', doi: '10.1126/science.1231143' } } }],
			nplResolution: { references: 1, matched: 1, candidates: 0, notFound: 0, failed: 0, skipped: 0 },
		};
		const { text } = await run({ publication: 'EP2110298B1' }, withNpl);
		expect(text).toContain('Non-patent literature: 1 cited paper row(s). OpenAlex lookup: 1 matched, 0 with candidates only, 0 not found, 0 failed, 0 skipped. Each NPL row\'s nplWork in the file carries');
	});
});
