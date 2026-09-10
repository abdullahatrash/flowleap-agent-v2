/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import type * as vscode from 'vscode';
import { describe, expect, it, vi } from 'vitest';
import { MockFileSystemService } from '../../../../platform/filesystem/node/test/mockFileSystemService';
import { ILogService } from '../../../../platform/log/common/logService';
import { PromptPathRepresentationService } from '../../../../platform/prompts/common/promptPathRepresentationService';
import { TestWorkspaceService } from '../../../../platform/test/node/testWorkspaceService';
import { mock } from '../../../../util/common/test/simpleMock';
import { CancellationToken } from '../../../../util/vs/base/common/cancellation';
import { URI } from '../../../../util/vs/base/common/uri';
import { IInstantiationService } from '../../../../util/vs/platform/instantiation/common/instantiation';
import { LanguageModelTextPart } from '../../../../vscodeTypes';
import { WritePatentResultsTool } from '../writePatentResultsTool';
import { GetPatentDetailsTool } from '../getPatentDetailsTool';
import { SearchPatentsTool } from '../searchPatentsTool';
import { IPatentBackendClient } from '../../../patentai/vscode-node/patentBackendClient';
import { PatentExecution, IPatentExecutionLedger } from '../../../patentai/vscode-node/patentExecutionLedger';
import { checkPriorArtReportCompletion, ReportCompletionTurn } from '../../node/priorArtReportCompletion';
import { ToolName } from '../../common/toolNames';
import { unrecordedPatentLedger } from './patentLedgerTestUtils';

vi.mock('../../../../vscodeTypes', async () => import('../../../../util/common/test/shims/vscodeTypesShim'));
vi.mock('vscode', async importOriginal => ({ ...await importOriginal<typeof vscode>(), env: { uriScheme: 'flowleap' } }));

function setup(ledger: IPatentExecutionLedger = unrecordedPatentLedger) {
	const files = new MockFileSystemService();
	const log = new class extends mock<ILogService>() { override trace() { } override info() { } override warn() { } override error() { } }();
	const workspace = new class extends TestWorkspaceService { override getWorkspaceFolders() { return [URI.file('/workspace')]; } }();
	const paths = new PromptPathRepresentationService(workspace);
	const checked: string[] = [];
	// The workspace confinement helper is tested independently; this seam records that validation is requested.
	const instantiation = new class extends mock<IInstantiationService>() { override invokeFunction<R>(): R { checked.push('checked'); return undefined as R; } }();
	return { files, checked, log, tool: new WritePatentResultsTool(log, files, paths, instantiation, ledger, workspace) };
}

describe('candidate report save path', () => {
	it.each([
		['EP1000000A1', 'A sensor system according to claim 1, wherein feedback is sampled at an average interval of 10 ms.'],
		['WO2000000001A1', 'A composition comprising 100 parts resin, 0.01 to 10 parts initiator and 40 to 400 parts filler.'],
		['EP1000001A1', 'A battery according to claim 1, wherein the preferred electrode comprises 1 to 20 weight percent additive.'],
	])('retrieves, inspects and finalizes source text with exact claim citations for %s', async (publication, claim) => {
		const executions: PatentExecution[] = [];
		const ledger: IPatentExecutionLedger = { ...unrecordedPatentLedger, record: async (_session, value) => { executions.push({ ...value, id: String(executions.length), recordedAt: '2026-09-10' }); return 'Recorded'; }, read: async () => ({ executions, limitation: 'Frozen synthetic fixture; no live search.' }) };
		const { tool, files, log } = setup(ledger);
		const calls: string[] = [];
		const backend = new class extends mock<IPatentBackendClient>() {
			override async post<T>(path: string): Promise<T> {
				calls.push(path);
				const payloads: Record<string, object> = {
					search_patents: { total: 1, returned: 1, effectiveQuery: 'fixture', docs: [{ docId: publication, title: 'Fixture', applicants: [], publicationDate: '2000-01-01' }] },
					get_bibliography: { documentReference: { publicationNumber: publication, section: 'bibliography' }, docId: publication, title: 'Fixture', applicants: [], inventors: [], ipc: [], cpc: [], dates: { publication: '2000-01-01' } },
					get_claims: { documentReference: { publicationNumber: publication, section: 'claims' }, docId: publication, language: 'en', totalClaims: 1, claims: [{ number: '2', text: claim, documentReference: { publicationNumber: publication, section: 'claims', claimNumber: '2' } }] },
					get_description: { documentReference: { publicationNumber: publication, section: 'description' }, docId: publication, language: 'en', description: 'A synthetic source for regression coverage.' },
				};
				return { success: true, data: payloads[path.replace('/tools/', '')] } as T;
			}
		}();
		await new SearchPatentsTool(log, backend, ledger).invoke({ input: { query: 'fixture' }, toolInvocationToken: undefined }, CancellationToken.None);
		const details = new GetPatentDetailsTool(log, backend, ledger);
		await details.invoke({ input: { publicationNumber: publication }, toolInvocationToken: undefined }, CancellationToken.None);
		const source = executions.flatMap(execution => execution.sources ?? []).find(source => source.reference.claimNumber === '2')!;
		const callsBefore = calls.length;
		const lookup = await details.invoke({ input: { publicationNumber: publication, evidenceLookup: { anchor: source.anchor } }, toolInvocationToken: undefined }, CancellationToken.None);
		expect({ storedText: (lookup.content[0] as LanguageModelTextPart).value.includes(claim), calls: calls.length }).toEqual({ storedText: true, calls: callsBefore });
		const input = { filePath: '/workspace/review.md', content: '', template: 'prior-art-report' as const, coverage: [{ feature: 'Essential combination', kind: 'combination' as const, importance: 'essential' as const, status: 'partial' as const, sourceAnchors: [source.anchor], evidence: [{ anchor: source.anchor, scope: 'Only the quoted claim; referenced parent scope remains unresolved.', qualifiers: 'Preserve preferred and average qualifiers as written; no distribution inferred.', quantityBasis: 'Original units and every constituent retained in the quote; no converted percentage asserted.' }], gap: 'Complete combination and dependencies unresolved.' }], limitations: ['Synthetic fixture; eligibility and semantics require review.'], stopReason: 'Bounded interim result.' };
		const result = await tool.invoke({ input, toolInvocationToken: undefined }, CancellationToken.None);
		expect((result.content[0] as LanguageModelTextPart).value).toContain('Successfully wrote');
		const report = new TextDecoder().decode(await files.readFile(URI.file(input.filePath)));
		expect({ text: report.includes(claim), exactClaim: report.includes(`publication=${publication}&section=claims&claim=2`), audit: report.includes('1 recorded search outcomes; 1 recorded detail outcomes'), semanticLimit: report.includes('not automatically verified') }).toEqual({ text: true, exactClaim: true, audit: true, semanticLimit: true });
		const turn: ReportCompletionTurn = { message: 'Search for prior art and save /workspace/review.md', rounds: [{ id: 'round', response: '', toolInputRetry: 0, toolCalls: [{ id: 'write', name: ToolName.WritePatentResults, arguments: JSON.stringify(input) }] }], results: { write: result } };
		expect(await checkPriorArtReportCompletion([], turn, files)).toBeUndefined();
	});

	it('finalizes an honest unresolved draft with a receipt, invalidates a generic replacement, and recovers', async () => {
		const { tool, files } = setup();
		const input = { filePath: '/workspace/review.md', content: '', template: 'prior-art-report' as const, coverage: [{ feature: 'Essential combination', kind: 'combination' as const, importance: 'essential' as const, status: 'unresolved' as const, sourceAnchors: [], gap: 'No recorded source supports the combination.' }], limitations: ['Source retrieval unavailable.'], stopReason: 'Bounded interim result.' };
		const result = await tool.invoke({ input, toolInvocationToken: undefined }, CancellationToken.None);
		const turn: ReportCompletionTurn = { message: 'Search for prior art and save /workspace/review.md', rounds: [{ id: 'round', response: '', toolInputRetry: 0, toolCalls: [{ id: 'write', name: ToolName.WritePatentResults, arguments: JSON.stringify(input) }] }], results: { write: result } };
		expect(await checkPriorArtReportCompletion([], turn, files)).toBeUndefined();
		await files.writeFile(URI.file(input.filePath), new TextEncoder().encode('Generic replacement with unchecked conclusions'));
		expect(await checkPriorArtReportCompletion([], turn, files)).toContain('changed after validation');
		const revised = await tool.invoke({ input: { ...input, stopReason: 'Reconciled interim report.' }, toolInvocationToken: undefined }, CancellationToken.None);
		expect(await checkPriorArtReportCompletion([], { ...turn, results: { write: revised } }, files)).toBeUndefined();
	});

	it('rejects downgraded unresolved coverage with a retained firm narrative and creates no report', async () => {
		const { tool, files } = setup();
		const input = { filePath: '/workspace/review.md', content: '| Filler loading | Disclosed |', template: 'prior-art-report' as const, coverage: [{ feature: 'Combination', kind: 'combination' as const, importance: 'essential' as const, status: 'unresolved' as const, sourceAnchors: [], gap: 'Evidence unavailable.' }], limitations: ['Interim.'], stopReason: 'Bounded stop.' };
		const result = await tool.invoke({ input, toolInvocationToken: undefined }, CancellationToken.None);
		expect((result.content[0] as LanguageModelTextPart).value).toContain('For prior-art-report, content must be empty');
		await expect(files.readFile(URI.file(input.filePath))).rejects.toThrow('ENOENT');
		await tool.invoke({ input: { ...input, content: '' }, toolInvocationToken: undefined }, CancellationToken.None);
		const report = new TextDecoder().decode(await files.readFile(URI.file(input.filePath)));
		expect({ firm: report.includes('Disclosed'), unresolved: report.includes('No supported conclusion is established'), duplicate: report.includes('Review-Limited Assessment') }).toEqual({ firm: false, unresolved: true, duplicate: false });
	});
	it.each(['../outside.md', '/outside.md', 'outputs/../../outside.md'])('rejects workspace escape %s before writing', async filePath => {
		const { tool, checked } = setup();
		const result = await tool.invoke({ input: { filePath, content: 'notes' }, toolInvocationToken: undefined }, CancellationToken.None);
		expect({ message: (result.content[0] as LanguageModelTextPart).value, checks: checked.length }).toEqual({ message: 'Error: Patent result writes must stay within a workspace folder.', checks: 0 });
	});
	it('resolves a workspace-relative output using the real prompt path service', async () => {
		const { tool, files } = setup();
		await tool.invoke({ input: { filePath: 'outputs/claim review.md', content: 'Saved notes' }, toolInvocationToken: undefined }, CancellationToken.None);
		expect(new TextDecoder().decode(await files.readFile(URI.file('/workspace/outputs/claim review.md')))).toBe('Saved notes');
	});
	it('rejects incomplete candidate reviews before creating a file, but retains free-form compatibility', async () => {
		const { tool, files } = setup();
		const filePath = '/workspace/report.md';
		const result = await tool.invoke({ input: { filePath, content: 'A draft', template: 'prior-art-report' }, toolInvocationToken: undefined }, CancellationToken.None);
		expect((result.content[0] as LanguageModelTextPart).value).toContain('Candidate draft was not saved');
		await expect(files.readFile(URI.file(filePath))).rejects.toThrow('ENOENT');
		await tool.invoke({ input: { filePath, content: 'Verbatim notes' }, toolInvocationToken: undefined }, CancellationToken.None);
		expect(new TextDecoder().decode(await files.readFile(URI.file(filePath)))).toBe('Verbatim notes');
	});

	it('replaces an existing candidate document without nesting wrappers, keeping only the companion the receipt names', async () => {
		const { tool, files, checked } = setup();
		const input = { filePath: '/workspace/report.md', template: 'prior-art-report' as const, content: '', coverage: [{ feature: 'Combination', kind: 'combination' as const, importance: 'essential' as const, status: 'unresolved' as const, sourceAnchors: [], gap: 'Sources unavailable.' }], limitations: ['Interim review.'], stopReason: 'Requested interim report.' };
		await tool.invoke({ input, toolInvocationToken: undefined }, CancellationToken.None);
		const revised = await tool.invoke({ input: { ...input, stopReason: 'Corrected stopping rationale' }, toolInvocationToken: undefined }, CancellationToken.None);
		const report = new TextDecoder().decode(await files.readFile(URI.file(input.filePath)));
		const companions = (await files.readDirectory(URI.file('/workspace'))).filter(([name]) => name.endsWith('.evidence.json')).map(([name]) => name);
		expect({ wrappers: report.match(/# Prior Art Candidate Review/g)?.length, corrected: report.includes('Corrected stopping rationale'), stale: report.includes('First candidate draft'), companions: companions.length, named: (revised.content[0] as LanguageModelTextPart).value.includes(companions[0]), checks: checked.length }).toEqual({ wrappers: 1, corrected: true, stale: false, companions: 1, named: true, checks: 4 });
	});
	it('checks raw source URLs in report notes without JSON punctuation', async () => {
		const ledger: IPatentExecutionLedger = { ...unrecordedPatentLedger, read: async () => ({ executions: [{ id: 'one', recordedAt: '2026-09-10', kind: 'details', status: 'succeeded', sources: [{ anchor: 'EP1234567A1:claims:1:en', reference: { publicationNumber: 'EP1234567A1', section: 'claims', claimNumber: '1' }, language: 'en', retrieval: 'returned', review: 'unknown', completeness: 'unknown' }] }], limitation: 'Partial.' }) };
		const { tool } = setup(ledger);
		const url = 'flowleap://flowleap.patent-ai/patent?publication=EP1234567A1&section=claims&claim=1';
		const input = { filePath: '/workspace/review.md', template: 'prior-art-report' as const, content: '', coverage: [{ feature: 'Combination', kind: 'combination' as const, importance: 'essential' as const, status: 'unresolved' as const, sourceAnchors: [], gap: 'Combination missing.' }], limitations: [`Scope checked against [claim 1](${url}).`], stopReason: 'Interim review.' };
		const saved = await tool.invoke({ input, toolInvocationToken: undefined }, CancellationToken.None);
		expect((saved.content[0] as LanguageModelTextPart).value).toContain('Successfully wrote');
		const rejected = await tool.invoke({ input: { ...input, limitations: [`See [claim 6](${url.replace('claim=1', 'claim=6')}).`] }, toolInvocationToken: undefined }, CancellationToken.None);
		expect((rejected.content[0] as LanguageModelTextPart).value).toContain('Unresolved patent reader citation');
	});

});
