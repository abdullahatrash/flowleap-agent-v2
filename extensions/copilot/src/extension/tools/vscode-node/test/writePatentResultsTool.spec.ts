/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { describe, expect, it } from 'vitest';
import { MockFileSystemService } from '../../../../platform/filesystem/node/test/mockFileSystemService';
import { ILogService } from '../../../../platform/log/common/logService';
import { IPromptPathRepresentationService } from '../../../../platform/prompts/common/promptPathRepresentationService';
import { mock } from '../../../../util/common/test/simpleMock';
import { CancellationToken } from '../../../../util/vs/base/common/cancellation';
import { URI } from '../../../../util/vs/base/common/uri';
import { IInstantiationService } from '../../../../util/vs/platform/instantiation/common/instantiation';
import { LanguageModelTextPart } from '../../../../vscodeTypes';
import { WritePatentResultsTool } from '../writePatentResultsTool';
import { IPatentExecutionLedger } from '../../../patentai/vscode-node/patentExecutionLedger';
import { unrecordedPatentLedger } from './patentLedgerTestUtils';

function setup(ledger: IPatentExecutionLedger = unrecordedPatentLedger) {
	const files = new MockFileSystemService();
	const log = new class extends mock<ILogService>() { override trace() { } override info() { } override warn() { } override error() { } }();
	const paths = new class extends mock<IPromptPathRepresentationService>() { override resolveFilePath(path: string) { return URI.file(path); } }();
	const checked: string[] = [];
	// The workspace confinement helper is tested independently; this seam records that validation is requested.
	const instantiation = new class extends mock<IInstantiationService>() { override invokeFunction<R>(): R { checked.push('checked'); return undefined as R; } }();
	return { files, checked, tool: new WritePatentResultsTool(log, files, paths, instantiation, ledger) };
}

describe('candidate report save path', () => {
	it('rejects incomplete candidate reviews before creating a file, but retains free-form compatibility', async () => {
		const { tool, files } = setup();
		const filePath = '/workspace/report.md';
		const result = await tool.invoke({ input: { filePath, content: 'A draft', template: 'prior-art-report' }, toolInvocationToken: undefined }, CancellationToken.None);
		expect((result.content[0] as LanguageModelTextPart).value).toContain('Candidate draft was not saved');
		await expect(files.readFile(URI.file(filePath))).rejects.toThrow('ENOENT');
		await tool.invoke({ input: { filePath, content: 'Verbatim notes' }, toolInvocationToken: undefined }, CancellationToken.None);
		expect(new TextDecoder().decode(await files.readFile(URI.file(filePath)))).toBe('Verbatim notes');
	});

	it('replaces an existing candidate document without nesting wrappers, retaining each evidence revision', async () => {
		const { tool, files, checked } = setup();
		const input = { filePath: '/workspace/report.md', template: 'prior-art-report' as const, content: 'First candidate draft', coverage: [{ feature: 'Combination', importance: 'essential' as const, status: 'unresolved' as const, sourceAnchors: [], gap: 'Sources unavailable.' }], limitations: ['Interim review.'], semanticReview: { observations: ['No complete-combination conclusion is justified.'], unresolvedConcerns: ['No source text.'] }, stopReason: 'Requested interim report.' };
		await tool.invoke({ input, toolInvocationToken: undefined }, CancellationToken.None);
		await tool.invoke({ input: { ...input, content: 'Corrected candidate draft' }, toolInvocationToken: undefined }, CancellationToken.None);
		const report = new TextDecoder().decode(await files.readFile(URI.file(input.filePath)));
		expect({ wrappers: report.match(/# Prior Art Candidate Review/g)?.length, corrected: report.includes('Corrected candidate draft'), stale: report.includes('First candidate draft'), companions: (await files.readDirectory(URI.file('/workspace'))).filter(([name]) => name.endsWith('.evidence.json')).length, checks: checked.length }).toEqual({ wrappers: 1, corrected: true, stale: false, companions: 2, checks: 4 });
	});
	it('checks raw URLs in semantic observations and limitations without JSON punctuation', async () => {
		const ledger: IPatentExecutionLedger = { ...unrecordedPatentLedger, read: async () => ({ executions: [{ id: 'one', recordedAt: '2026-09-10', kind: 'details', status: 'succeeded', sources: [{ anchor: 'EP1234567A1:claims:1:en', reference: { publicationNumber: 'EP1234567A1', section: 'claims', claimNumber: '1' }, language: 'en', retrieval: 'returned', review: 'unknown', completeness: 'unknown' }] }], limitation: 'Partial.' }) };
		const { tool } = setup(ledger);
		const url = 'flowleap://flowleap.patent-ai/patent?publication=EP1234567A1&section=claims&claim=1';
		const input = { filePath: '/workspace/review.md', template: 'prior-art-report' as const, content: 'Candidate evidence.', coverage: [{ feature: 'Combination', importance: 'essential' as const, status: 'unresolved' as const, sourceAnchors: [], gap: 'Combination missing.' }], limitations: ['Partial evidence.'], semanticReview: { observations: [`Scope checked against [claim 1](${url}).`], unresolvedConcerns: [] }, stopReason: 'Interim review.' };
		const saved = await tool.invoke({ input, toolInvocationToken: undefined }, CancellationToken.None);
		expect((saved.content[0] as LanguageModelTextPart).value).toContain('Successfully wrote');
		const rejected = await tool.invoke({ input: { ...input, limitations: [`See [claim 6](${url.replace('claim=1', 'claim=6')}).`] }, toolInvocationToken: undefined }, CancellationToken.None);
		expect((rejected.content[0] as LanguageModelTextPart).value).toContain('Unresolved patent reader citation');
	});

});
