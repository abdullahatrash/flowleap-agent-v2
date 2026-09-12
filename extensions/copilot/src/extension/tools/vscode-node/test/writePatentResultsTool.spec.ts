/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import type * as vscode from 'vscode';
import { describe, expect, it, vi } from 'vitest';
import { ChatFetchResponseType, ChatResponse } from '../../../../platform/chat/common/commonTypes';
import { IConfigurationService } from '../../../../platform/configuration/common/configurationService';
import { IEndpointProvider } from '../../../../platform/endpoint/common/endpointProvider';
import { MockFileSystemService } from '../../../../platform/filesystem/node/test/mockFileSystemService';
import { ILogService } from '../../../../platform/log/common/logService';
import { IChatEndpoint } from '../../../../platform/networking/common/networking';
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
import { CopilotToolMode } from '../../common/toolsRegistry';
import { IBuildPromptContext } from '../../../prompt/common/intents';
import { unrecordedPatentLedger } from './patentLedgerTestUtils';

vi.mock('../../../../vscodeTypes', async () => import('../../../../util/common/test/shims/vscodeTypesShim'));
vi.mock('vscode', async importOriginal => ({ ...await importOriginal<typeof vscode>(), env: { uriScheme: 'flowleap' } }));

/** How the second-read judge behaves for one test; it is off unless a test asks for it. */
interface SecondReadStub {
	readonly setting?: 'off' | 'log';
	readonly reply?: string;
	readonly failure?: string;
}

function setup(ledger: IPatentExecutionLedger = unrecordedPatentLedger, secondRead: SecondReadStub = {}) {
	const files = new MockFileSystemService();
	const log = new class extends mock<ILogService>() { override trace() { } override info() { } override warn() { } override error() { } }();
	const workspace = new class extends TestWorkspaceService { override getWorkspaceFolders() { return [URI.file('/workspace')]; } }();
	const paths = new PromptPathRepresentationService(workspace);
	const checked: string[] = [];
	// The workspace confinement helper is tested independently; this seam records that validation is requested.
	const instantiation = new class extends mock<IInstantiationService>() { override invokeFunction<R>(): R { checked.push('checked'); return undefined as R; } }();
	const configuration = new class extends mock<IConfigurationService>() { override getNonExtensionConfig<T>(): T { return (secondRead.setting ?? 'off') as T; } }();
	const endpoint = new class extends mock<IChatEndpoint>() {
		override readonly model = 'judge-model';
		override async makeChatRequest2(): Promise<ChatResponse> {
			if (secondRead.failure) { throw new Error(secondRead.failure); }
			return { type: ChatFetchResponseType.Success, value: secondRead.reply ?? '', requestId: 'request', serverRequestId: undefined, usage: undefined, resolvedModel: 'judge-model' };
		}
	}();
	const endpoints = new class extends mock<IEndpointProvider>() { override async getChatEndpoint(): Promise<IChatEndpoint> { return endpoint; } }();
	return { files, checked, log, tool: new WritePatentResultsTool(log, files, paths, instantiation, ledger, workspace, configuration, endpoints) };
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
		const input = { filePath: '/workspace/review.md', content: '', template: 'prior-art-report' as const, coverage: [{ feature: 'Essential combination', kind: 'combination' as const, importance: 'essential' as const, status: 'partial' as const, sourceAnchors: [source.anchor], evidence: [{ anchor: source.anchor, scope: 'Only the quoted claim; referenced parent scope remains unresolved.', qualifiers: 'Preserve preferred and average qualifiers as written; no distribution inferred.', quantityBasis: 'Original units and every constituent retained in the quote; no converted percentage asserted.' }], elements: [{ element: 'Recited claim subject matter', anchor: source.anchor, disclosedBy: claim.slice(0, 24) }, { element: 'Complete recited combination' }], gap: 'Complete combination and dependencies unresolved.' }], limitations: ['Synthetic fixture; eligibility and semantics require review.'], stopReason: 'Bounded interim result.' };
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
	it('states the chat summary contract above a receipt the completion check still parses', async () => {
		const { tool, files } = setup();
		const input = { filePath: '/workspace/review.md', template: 'prior-art-report' as const, content: '', coverage: [{ feature: 'Combination', kind: 'combination' as const, importance: 'essential' as const, status: 'unresolved' as const, sourceAnchors: [], gap: 'Sources unavailable.' }], limitations: ['Interim review.'], stopReason: 'Bounded interim result.' };
		const result = await tool.invoke({ input, toolInvocationToken: undefined }, CancellationToken.None);
		const message = (result.content[0] as LanguageModelTextPart).value;
		const turn: ReportCompletionTurn = { message: 'Search for prior art and save /workspace/review.md', rounds: [{ id: 'round', response: '', toolInputRetry: 0, toolCalls: [{ id: 'write', name: ToolName.WritePatentResults, arguments: JSON.stringify(input) }] }], results: { write: result } };
		expect({
			contract: message.includes('Chat summary contract: repeat each coverage row\'s status word exactly (supported / partial / unresolved)'),
			certainty: message.includes('The summary must not be more certain than the saved report.'),
			receipts: message.split('\n').filter(line => line.startsWith('Prior-art artifact receipt: ')).length,
			completion: await checkPriorArtReportCompletion([], turn, files),
		}).toEqual({ contract: true, certainty: true, receipts: 1, completion: undefined });
	});

	it('reports flagged wording above the summary contract and leaves the receipt line alone', async () => {
		const { tool } = setup();
		const input = { filePath: '/workspace/review.md', template: 'prior-art-report' as const, content: '', coverage: [{ feature: 'Combination', kind: 'combination' as const, importance: 'essential' as const, status: 'unresolved' as const, sourceAnchors: [], gap: 'Sources unavailable.' }], limitations: ['Claim 1 is novel over the retrieved art.'], stopReason: 'The reference teaches away from the combination.' };
		const result = await tool.invoke({ input, toolInvocationToken: undefined }, CancellationToken.None);
		const lines = (result.content[0] as LanguageModelTextPart).value.split('\n');
		expect({
			wording: lines[1],
			contract: lines[2].startsWith('Chat summary contract: '),
			receipts: lines.filter(line => line.startsWith('Prior-art artifact receipt: ')).length,
		}).toEqual({
			wording: 'Wording review: 2 phrase(s) flagged in the report\'s generated section; reword them in a follow-up save if they are conclusions rather than disclaimers.',
			contract: true,
			receipts: 1,
		});
	});

	describe('second read diagnostic', () => {
		const claim = 'A quick release comprising a skewer rod and a cam surface formed in the first head portion.';
		const anchor = 'EP1000000A1:claims:1:en';
		const judgedLedger: IPatentExecutionLedger = { ...unrecordedPatentLedger, read: async () => ({ executions: [{ id: 'one', recordedAt: '2026-09-10', kind: 'details', status: 'succeeded', publicationIds: ['EP1000000A1'], sources: [{ anchor, text: claim, reference: { publicationNumber: 'EP1000000A1', section: 'claims', claimNumber: '1' }, language: 'en', retrieval: 'returned', review: 'unknown', completeness: 'unknown' }] }], limitation: 'Synthetic fixture; no live search.' }) };
		const input = { filePath: '/workspace/review.md', template: 'prior-art-report' as const, content: '', coverage: [{ feature: 'Quick release combination', kind: 'combination' as const, importance: 'essential' as const, status: 'partial' as const, sourceAnchors: [anchor], evidence: [{ anchor, quote: claim, scope: 'Independent claim 1 as quoted.', qualifiers: 'Cam surface recited as formed in the head portion.', quantityBasis: 'Structural claim language; no numeric range.' }], elements: [{ element: 'a skewer rod', anchor, disclosedBy: 'a skewer rod' }, { element: 'a cam profile carried on the handle stem' }], gap: 'The handle-borne cam profile is not disclosed by the cited text.' }], limitations: ['Synthetic fixture; semantics require review.'], stopReason: 'Bounded interim result.' };
		const verdicts = '```json\n{"verdicts":[{"element":"a skewer rod","verdict":"agree","reason":"The claim recites a skewer rod."},{"element":"a cam profile carried on the handle stem","verdict":"disagree","reason":"The quoted claim puts the cam surface in the head portion."}]}\n```';

		/** Give the tool the request context the tool-calling loop supplies before an invocation. */
		async function withRequest(tool: WritePatentResultsTool): Promise<void> {
			const promptContext = new class extends mock<IBuildPromptContext>() { override readonly request = new class extends mock<vscode.ChatRequest>() { }(); }();
			await tool.resolveInput(input, promptContext, CopilotToolMode.FullContext);
		}

		it('judges each element of a saved row and records the verdicts beside the evidence companion', async () => {
			const { tool, files } = setup(judgedLedger, { setting: 'log', reply: verdicts });
			await withRequest(tool);
			const result = await tool.invoke({ input, toolInvocationToken: undefined }, CancellationToken.None);
			const lines = (result.content[0] as LanguageModelTextPart).value.split('\n');
			const names = (await files.readDirectory(URI.file('/workspace'))).map(([name]) => name);
			const verdictName = names.find(name => name.endsWith('.second-read.json'))!;
			const evidenceName = names.find(name => name.endsWith('.evidence.json'))!;
			const recorded = JSON.parse(new TextDecoder().decode(await files.readFile(URI.file('/workspace/' + verdictName))));
			expect({
				line: lines[1],
				contract: lines[2].startsWith('Chat summary contract: '),
				sharesCompanionId: verdictName.replace('.second-read.json', '') === evidenceName.replace('.evidence.json', ''),
				model: recorded.model,
				rows: recorded.rows,
				summary: recorded.summary,
				inReport: new TextDecoder().decode(await files.readFile(URI.file(input.filePath))).includes('Second read'),
			}).toEqual({
				line: `Second read (diagnostic): 2 elements judged, 1 disagree, 0 unclear, 0 unparsed; verdicts in ${verdictName}.`,
				contract: true,
				sharesCompanionId: true,
				model: 'judge-model',
				rows: [{ feature: 'Quick release combination', status: 'partial', verdicts: [{ element: 'a skewer rod', verdict: 'agree', reason: 'The claim recites a skewer rod.' }, { element: 'a cam profile carried on the handle stem', verdict: 'disagree', reason: 'The quoted claim puts the cam surface in the head portion.' }] }],
				summary: { elements: 2, agree: 1, disagree: 1, unclear: 0, unparsed: 0 },
				inReport: false,
			});
		});

		it('saves the report and reports a skip when the judge request fails', async () => {
			const { tool, files } = setup(judgedLedger, { setting: 'log', failure: 'judge unavailable' });
			await withRequest(tool);
			const result = await tool.invoke({ input, toolInvocationToken: undefined }, CancellationToken.None);
			const lines = (result.content[0] as LanguageModelTextPart).value.split('\n');
			const names = (await files.readDirectory(URI.file('/workspace'))).map(([name]) => name);
			expect({
				saved: lines[0],
				line: lines[1],
				contract: lines[2].startsWith('Chat summary contract: '),
				receipts: lines.filter(line => line.startsWith('Prior-art artifact receipt: ')).length,
				verdictFiles: names.filter(name => name.endsWith('.second-read.json')).length,
			}).toEqual({
				saved: 'Successfully wrote patent results to /workspace/review.md',
				line: 'Second read (diagnostic): skipped (judge unavailable).',
				contract: true,
				receipts: 1,
				verdictFiles: 0,
			});
		});
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
