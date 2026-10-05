/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import type * as vscode from 'vscode';
import { createHash } from 'crypto';
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
import { IActivationTelemetryService } from '../../../patentai/vscode-node/activationTelemetryService';
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
	readonly setting?: 'off' | 'log' | 'render';
	/** The value of `patent.secondReadModel`; unset means the request's own model is used. */
	readonly judgeModel?: string;
	/** What the provider actually resolves `judgeModel` to; a different id means it is unavailable. */
	readonly resolvedModel?: string;
	/** One reply, or one per judged row in order. */
	readonly reply?: string | readonly string[];
	readonly failure?: string;
}

/**
 * @param rejectInvokeFunctionCall When set, the eligibility check made by this ordinal call to
 * `invokeFunction` within one save (1 = the report path, 2 = the evidence path, 3 = the working
 * record path) throws, so a test can simulate that one path being ineligible without stubbing the
 * real `assertFileOkForTool` machinery.
 */
function setup(ledger: IPatentExecutionLedger = unrecordedPatentLedger, secondRead: SecondReadStub = {}, rejectInvokeFunctionCall?: number) {
	const files = new MockFileSystemService();
	const reportsSaved: string[] = [];
	const log = new class extends mock<ILogService>() { override trace() { } override info() { } override warn() { } override error() { } }();
	const workspace = new class extends TestWorkspaceService { override getWorkspaceFolders() { return [URI.file('/workspace')]; } }();
	const paths = new PromptPathRepresentationService(workspace);
	const checked: string[] = [];
	// The workspace confinement helper is tested independently; this seam records that validation is requested.
	const instantiation = new class extends mock<IInstantiationService>() {
		override invokeFunction<R>(): R {
			checked.push('checked');
			if (checked.length === rejectInvokeFunctionCall) { throw new Error(`File is outside of the workspace, and not open in an editor, and can't be read`); }
			return undefined as R;
		}
	}();
	const configuration = new class extends mock<IConfigurationService>() {
		override getNonExtensionConfig<T>(key: string): T | undefined {
			return (key === 'patent.secondReadModel' ? secondRead.judgeModel : secondRead.setting ?? 'off') as T | undefined;
		}
	}();
	let judged = 0;
	const endpointFor = (model: string) => new class extends mock<IChatEndpoint>() {
		override readonly model = model;
		override readonly family = model;
		override async makeChatRequest2(): Promise<ChatResponse> {
			if (secondRead.failure) { throw new Error(secondRead.failure); }
			const replies = secondRead.reply === undefined ? [''] : typeof secondRead.reply === 'string' ? [secondRead.reply] : secondRead.reply;
			const value = replies[Math.min(judged++, replies.length - 1)];
			return { type: ChatFetchResponseType.Success, value, requestId: 'request', serverRequestId: undefined, usage: undefined, resolvedModel: model };
		}
	}();
	const endpoints = new class extends mock<IEndpointProvider>() {
		override async getChatEndpoint(target?: unknown): Promise<IChatEndpoint> {
			return typeof target === 'string' ? endpointFor(secondRead.resolvedModel ?? target) : endpointFor('judge-model');
		}
	}();
	// A counter must never change what the tool does: the fake records the calls and nothing else.
	const activationCounters = new class extends mock<IActivationTelemetryService>() {
		override recordReportSaved(templateKind: string): void { reportsSaved.push(templateKind); }
	}();
	return { files, checked, log, reportsSaved, tool: new WritePatentResultsTool(log, files, paths, instantiation, ledger, workspace, configuration, endpoints, activationCounters) };
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
		const record = new TextDecoder().decode(await files.readFile(URI.file('/workspace/review.working-record.md')));
		expect({ text: report.includes(claim), exactClaim: report.includes(`publication=${publication}&section=claims&claim=2`), audit: report.includes('1 recorded search outcomes; 1 recorded detail outcomes'), recordAudit: record.includes('1 recorded search outcomes; 1 recorded detail outcomes'), semanticLimit: report.includes('not automatically verified'), recordSemanticLimit: record.includes('not automatically verified') }).toEqual({ text: true, exactClaim: true, audit: false, recordAudit: true, semanticLimit: false, recordSemanticLimit: true });
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
	it('counts a saved report by template kind only, and counts nothing when no file was written', async () => {
		const { tool, reportsSaved } = setup();
		await tool.invoke({ input: { filePath: '/workspace/notes.md', content: 'Saved notes' }, toolInvocationToken: undefined }, CancellationToken.None);
		await tool.invoke({ input: { filePath: '/workspace/memo.md', content: 'A memo body with enough substance to satisfy the template.', template: 'fto-memo' }, toolInvocationToken: undefined }, CancellationToken.None);
		await tool.invoke({ input: { filePath: '/workspace/rejected.md', content: 'A draft', template: 'prior-art-report' }, toolInvocationToken: undefined }, CancellationToken.None);

		expect(reportsSaved).toEqual(['free-form', 'fto-memo']);
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
		const names = (await files.readDirectory(URI.file('/workspace'))).map(([name]) => name);
		const companions = names.filter(name => name.endsWith('.evidence.json'));
		const record = new TextDecoder().decode(await files.readFile(URI.file('/workspace/report.working-record.md')));
		// The record carries no companion id, so a refinement replaces the one the run before it left.
		expect({ wrappers: report.match(/# Prior Art Candidate Review/g)?.length, corrected: report.includes('Corrected stopping rationale'), stale: report.includes('First candidate draft'), companions: companions.length, named: (revised.content[0] as LanguageModelTextPart).value.includes(companions[0]), checks: checked.length, records: names.filter(name => name.endsWith('.working-record.md')), recordNamesReport: record.includes('Companion to [report.md](report.md)') }).toEqual({ wrappers: 1, corrected: true, stale: false, companions: 1, named: true, checks: 6, records: ['report.working-record.md'], recordNamesReport: true });
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

	it('writes the working record beside the report and names it in both the report and the result', async () => {
		const { tool, files } = setup();
		const input = { filePath: 'outputs/prior-art-review.md', template: 'prior-art-report' as const, content: '', subject: 'Quick release skewers', coverage: [{ feature: 'Combination', kind: 'combination' as const, importance: 'essential' as const, status: 'unresolved' as const, sourceAnchors: [], gap: 'Sources unavailable.' }], limitations: ['Interim review.'], stopReason: 'Bounded interim result.' };
		const result = await tool.invoke({ input, toolInvocationToken: undefined }, CancellationToken.None);
		const report = new TextDecoder().decode(await files.readFile(URI.file('/workspace/outputs/prior-art-review.md')));
		const record = new TextDecoder().decode(await files.readFile(URI.file('/workspace/outputs/prior-art-review.working-record.md')));
		expect({
			resultLine: (result.content[0] as LanguageModelTextPart).value.split('\n').find(line => line.startsWith('Working record: ')),
			pointer: report.split('\n').find(line => line.startsWith('Working record: ')),
			title: record.split('\n')[0],
			sections: record.split('\n').filter(line => line.startsWith('## ')),
		}).toEqual({
			resultLine: 'Working record: outputs/prior-art-review.working-record.md',
			pointer: 'Working record: [prior-art-review.working-record.md](prior-art-review.working-record.md) — full search log including queries that could not run, retrieved-but-unread list, wording review, provenance and second read.',
			title: '# Working record — Quick release skewers',
			sections: ['## Search log', '## Retrieved but not read', '## Second read', '## Wording review', '## Provenance'],
		});
	});

	it('still saves the report and evidence when the working record path is ineligible, and states no working record', async () => {
		// The third eligibility check of a structured save is the working record's own path; making it
		// throw must not cost the deliverable, which the report and evidence checks (1st and 2nd) already
		// passed and whose files are written before the working record is attempted.
		const { tool, files } = setup(unrecordedPatentLedger, {}, 3);
		const input = { filePath: 'outputs/prior-art-review.md', template: 'prior-art-report' as const, content: '', subject: 'Quick release skewers', coverage: [{ feature: 'Combination', kind: 'combination' as const, importance: 'essential' as const, status: 'unresolved' as const, sourceAnchors: [], gap: 'Sources unavailable.' }], limitations: ['Interim review.'], stopReason: 'Bounded interim result.' };
		const result = await tool.invoke({ input, toolInvocationToken: undefined }, CancellationToken.None);
		const message = (result.content[0] as LanguageModelTextPart).value;
		const report = new TextDecoder().decode(await files.readFile(URI.file('/workspace/outputs/prior-art-review.md')));
		const names = (await files.readDirectory(URI.file('/workspace/outputs'))).map(([name]) => name);
		expect({
			saved: message.startsWith('Successfully wrote patent results to outputs/prior-art-review.md'),
			resultLine: message.split('\n').find(line => line.startsWith('Working record: ')),
			pointer: report.split('\n').find(line => line.startsWith('Working record: ')),
			evidenceWritten: names.some(name => name.endsWith('.evidence.json')),
			recordWritten: names.some(name => name.endsWith('.working-record.md')),
		}).toEqual({
			saved: true,
			resultLine: undefined,
			pointer: 'Working record: [prior-art-review.working-record.md](prior-art-review.working-record.md) — full search log including queries that could not run, retrieved-but-unread list, wording review, provenance and second read.',
			evidenceWritten: true,
			recordWritten: false,
		});
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
			wording: 'Wording review: 2 phrase(s) flagged in the working record; reword them in a follow-up save if they are conclusions rather than disclaimers.',
			contract: true,
			receipts: 1,
		});
	});

	describe('second read diagnostic', () => {
		const claim = 'A quick release comprising a skewer rod and a cam surface formed in the first head portion.';
		const anchor = 'EP1000000A1:claims:1:en';
		const judgedLedger: IPatentExecutionLedger = { ...unrecordedPatentLedger, read: async () => ({ executions: [{ id: 'one', recordedAt: '2026-09-10', kind: 'details', status: 'succeeded', publicationIds: ['EP1000000A1'], sources: [{ anchor, text: claim, reference: { publicationNumber: 'EP1000000A1', section: 'claims', claimNumber: '1' }, language: 'en', retrieval: 'returned', review: 'unknown', completeness: 'unknown' }] }], limitation: 'Synthetic fixture; no live search.' }) };
		const evidence = [{ anchor, quote: claim, scope: 'Independent claim 1 as quoted.', qualifiers: 'Cam surface recited as formed in the head portion.', quantityBasis: 'Structural claim language; no numeric range.' }];
		const input = {
			filePath: '/workspace/review.md', template: 'prior-art-report' as const, content: '',
			coverage: [
				{ feature: 'Quick release combination', kind: 'combination' as const, importance: 'essential' as const, status: 'partial' as const, sourceAnchors: [anchor], evidence, elements: [{ element: 'a skewer rod', anchor, disclosedBy: 'a skewer rod' }, { element: 'a cam profile carried on the handle stem' }], gap: 'The handle-borne cam profile is not disclosed by the cited text.' },
				{ feature: 'Skewer heads', kind: 'feature' as const, importance: 'essential' as const, status: 'supported' as const, sourceAnchors: [anchor], evidence, elements: [{ element: 'a skewer rod', anchor, disclosedBy: 'a skewer rod' }, { element: 'a head portion', anchor, disclosedBy: 'the first head portion' }], gap: '' },
			],
			limitations: ['Synthetic fixture; semantics require review.'], stopReason: 'Bounded interim result.',
		};
		const combinationVerdicts = '```json\n{"verdicts":[{"element":"a skewer rod","verdict":"agree","reason":"The claim recites a skewer rod."},{"element":"a cam profile carried on the handle stem","verdict":"disagree","reason":"The quoted claim puts the cam surface in the head portion."}]}\n```';
		const headVerdicts = '{"verdicts":[{"element":"a skewer rod","verdict":"agree","reason":"The claim recites a skewer rod."},{"element":"a head portion","verdict":"agree","reason":"The claim recites a first head portion."}]}';

		/** Give the tool the request context the tool-calling loop supplies before an invocation. */
		async function withRequest(tool: WritePatentResultsTool): Promise<void> {
			const promptContext = new class extends mock<IBuildPromptContext>() { override readonly request = new class extends mock<vscode.ChatRequest>() { }(); }();
			await tool.resolveInput(input, promptContext, CopilotToolMode.FullContext);
		}

		/** The uuid of the evidence companion differs per save; nothing else in a report may. */
		function withoutCompanionId(report: string): string {
			return report.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, 'COMPANION');
		}

		async function save(secondRead: SecondReadStub): Promise<{ files: MockFileSystemService; report: string; record: string; lines: string[]; turn: ReportCompletionTurn }> {
			const { tool, files } = setup(judgedLedger, secondRead);
			await withRequest(tool);
			const result = await tool.invoke({ input, toolInvocationToken: undefined }, CancellationToken.None);
			const turn: ReportCompletionTurn = { message: 'Search for prior art and save /workspace/review.md', rounds: [{ id: 'round', response: '', toolInputRetry: 0, toolCalls: [{ id: 'write', name: ToolName.WritePatentResults, arguments: JSON.stringify(input) }] }], results: { write: result } };
			return {
				files,
				report: new TextDecoder().decode(await files.readFile(URI.file(input.filePath))),
				record: new TextDecoder().decode(await files.readFile(URI.file('/workspace/review.working-record.md'))),
				lines: (result.content[0] as LanguageModelTextPart).value.split('\n'),
				turn,
			};
		}

		it('judges each element of a saved row and records the verdicts beside the evidence companion', async () => {
			const { files, report, record, lines } = await save({ setting: 'log', reply: [combinationVerdicts, headVerdicts] });
			const names = (await files.readDirectory(URI.file('/workspace'))).map(([name]) => name);
			const verdictName = names.find(name => name.endsWith('.second-read.json'))!;
			const evidenceName = names.find(name => name.endsWith('.evidence.json'))!;
			const recorded = JSON.parse(new TextDecoder().decode(await files.readFile(URI.file('/workspace/' + verdictName))));
			expect({
				line: lines[1],
				contract: lines[2].startsWith('Chat summary contract: '),
				sharesCompanionId: verdictName.replace('.second-read.json', '') === evidenceName.replace('.evidence.json', ''),
				model: recorded.model,
				features: recorded.rows.map((row: { feature: string }) => row.feature),
				firstRowVerdicts: recorded.rows[0].verdicts,
				summary: recorded.summary,
				inReport: report.includes('Second read'),
				inRecord: record.includes('Second read by judge-model: 4 elements judged, 1 not confirmed, 0 unclear, 0 unparsed.'),
			}).toEqual({
				line: `Second read (diagnostic): 4 elements judged, 1 disagree, 0 unclear, 0 unparsed; verdicts in ${verdictName}.`,
				contract: true,
				sharesCompanionId: true,
				model: 'judge-model',
				features: ['Quick release combination', 'Skewer heads'],
				firstRowVerdicts: [{ element: 'a skewer rod', verdict: 'agree', reason: 'The claim recites a skewer rod.' }, { element: 'a cam profile carried on the handle stem', verdict: 'disagree', reason: 'The quoted claim puts the cam surface in the head portion.' }],
				summary: { elements: 4, agree: 3, disagree: 1, unclear: 0, unparsed: 0 },
				inReport: false,
				inRecord: true,
			});
		});

		it('leaves the saved report byte-identical to a report saved without a second read', async () => {
			const [logged, disabled] = await Promise.all([
				save({ setting: 'log', reply: [combinationVerdicts, headVerdicts] }),
				save({ setting: 'off' }),
			]);
			expect({ identical: withoutCompanionId(logged.report) === withoutCompanionId(disabled.report), line: disabled.lines[1].startsWith('Chat summary contract: ') }).toEqual({ identical: true, line: true });
		});

		it('states what was not confirmed in the working record, keeps it out of the report, and receipts the final bytes', async () => {
			const { files, report, record, lines, turn } = await save({ setting: 'render', reply: [combinationVerdicts, headVerdicts] });
			const [, combination] = record.split('### ');
			const receipt = JSON.parse(lines.find(line => line.startsWith('Prior-art artifact receipt: '))!.slice('Prior-art artifact receipt: '.length));
			const written = await files.readFile(URI.file(input.filePath));
			expect({
				heading: combination.split('\n')[0],
				block: combination.includes("Second read (generated, judge-model): the following elements were not confirmed by an independent read of the cited text; the row's status is the author's judgment."),
				verdict: combination.includes('- a cam profile carried on the handle stem: disagree — The quoted claim puts the cam surface in the head portion.'),
				inReport: report.includes('Second read'),
				confirmedRow: record.includes('### Skewer heads'),
				limitation: record.split('\n').filter(line => line.startsWith('Second read by ')),
				line: lines[1],
				guidance: lines[2],
				receiptDigest: receipt.reportDigest === createHash('sha256').update(written).digest('hex'),
				completion: await checkPriorArtReportCompletion([], turn, files),
			}).toEqual({
				heading: 'Quick release combination',
				block: true,
				verdict: true,
				inReport: false,
				confirmedRow: false,
				limitation: ['Second read by judge-model: 4 elements judged, 1 not confirmed, 0 unclear, 0 unparsed.'],
				line: 'Second read (judge-model): 4 elements judged, 1 not confirmed. Not confirmed: Quick release combination / a cam profile carried on the handle stem — The quoted claim puts the cam surface in the head portion.',
				guidance: 'If a disagreement is right, downgrade or reword that row and re-save; if the second read is wrong, leave the row and say why in its gap.',
				receiptDigest: true,
				completion: undefined,
			});
		});

		it('judges with the configured model, and falls back to the request model when it is unavailable', async () => {
			const recordedModel = async (stub: SecondReadStub) => {
				const { files } = await save(stub);
				const name = (await files.readDirectory(URI.file('/workspace'))).map(([name]) => name).find(name => name.endsWith('.second-read.json'))!;
				return JSON.parse(new TextDecoder().decode(await files.readFile(URI.file('/workspace/' + name)))).model;
			};
			expect(await Promise.all([
				recordedModel({ setting: 'log', judgeModel: 'anthropic/claude-sonnet-5', reply: headVerdicts }),
				recordedModel({ setting: 'log', judgeModel: 'anthropic/claude-sonnet-5', resolvedModel: 'some-other-model', reply: headVerdicts }),
			])).toEqual(['anthropic/claude-sonnet-5', 'judge-model']);
		});

		it('reads the judge model from the patent.secondReadModel setting', async () => {
			const { files } = await save({ setting: 'log', judgeModel: 'anthropic/claude-sonnet-5', reply: headVerdicts });
			const name = (await files.readDirectory(URI.file('/workspace'))).map(([name]) => name).find(name => name.endsWith('.second-read.json'))!;
			const recorded = JSON.parse(new TextDecoder().decode(await files.readFile(URI.file('/workspace/' + name))));
			expect(recorded.model).toBe('anthropic/claude-sonnet-5');
		});

		it('saves the report and reports a skip when the judge request fails', async () => {
			const { files, record, lines } = await save({ setting: 'render', failure: 'judge unavailable' });
			const names = (await files.readDirectory(URI.file('/workspace'))).map(([name]) => name);
			expect({
				saved: lines[0],
				line: lines[1],
				contract: lines[2].startsWith('Chat summary contract: '),
				receipts: lines.filter(line => line.startsWith('Prior-art artifact receipt: ')).length,
				verdictFiles: names.filter(name => name.endsWith('.second-read.json')).length,
				limitation: record.includes('Second read: skipped (judge unavailable).'),
			}).toEqual({
				saved: 'Successfully wrote patent results to /workspace/review.md',
				line: 'Second read (diagnostic): skipped (judge unavailable).',
				contract: true,
				receipts: 1,
				verdictFiles: 0,
				limitation: true,
			});
		});
	});

	describe('landscape report save path', () => {
		/** One recorded analytics outcome whose returned text carries the trend figures, and one search. */
		const ledger: IPatentExecutionLedger = {
			...unrecordedPatentLedger,
			read: async () => ({
				executions: [
					{ id: 'one', recordedAt: '2026-09-12T00:00:00.000Z', kind: 'analytics', status: 'succeeded', tool: 'patstat_portfolio', request: 'applicant=Acme; cpc=H01M', rowCount: 2, dataEdition: 'PATSTAT 2025 Autumn', resultText: '| 2019 | 1,240 |\n| 2024 | 1,860 |' },
					{ id: 'two', recordedAt: '2026-09-12T00:00:01.000Z', kind: 'search', status: 'succeeded', query: 'ta=electrolyte', effectiveQuery: 'ta=electrolyte', total: 54, returned: 25 },
				],
				limitation: 'Synthetic fixture; no live search.',
			}),
		};
		const content = [
			'| Year | Families |',
			'| --- | --- |',
			'| 2019 | 1,240 |',
			'| 2024 | 1,860 |',
			'',
			'| Applicant | Share |',
			'| --- | --- |',
			'| Acme | 37% |',
			'',
			'The live search returned 54 hits.',
		].join('\n');

		it('appends figure and data provenance to the saved report and names the untraced figure', async () => {
			const { tool, files } = setup(ledger);
			const result = await tool.invoke({ input: { filePath: '/workspace/landscape.md', content, template: 'landscape-report' as const, subject: 'Solid electrolytes' }, toolInvocationToken: undefined }, CancellationToken.None);
			const report = new TextDecoder().decode(await files.readFile(URI.file('/workspace/landscape.md')));
			const lines = (result.content[0] as LanguageModelTextPart).value.split('\n');
			expect({
				body: report.includes('| Acme | 37% |'),
				figures: report.split('\n').find(line => line.startsWith('4 figures checked')),
				basis: report.split('\n').find(line => line.startsWith('Tables without a stated counting basis')),
				data: report.split('\n').find(line => line.startsWith('- patstat_portfolio')),
				beforeDisclaimer: report.indexOf('## Figure provenance (generated)') < report.indexOf('*This document was generated with AI assistance'),
				afterLimitations: report.indexOf('## 5. Issues & Limitations') < report.indexOf('## Figure provenance (generated)'),
				result: lines[1],
			}).toEqual({
				body: true,
				figures: '4 figures checked against recorded tool outputs; 3 found, 0 computed from figures that were found, 1 not found: 37%.',
				basis: 'Tables without a stated counting basis: Applicant | Share. Families, applications and publications are different units; state which one each table counts.',
				data: '- patstat_portfolio — applicant=Acme; cpc=H01M — 2 rows — PATSTAT 2025 Autumn',
				beforeDisclaimer: true,
				afterLimitations: true,
				result: 'Figure provenance: 4 figures checked against recorded tool outputs; 3 found, 0 computed from figures that were found, 1 not found: 37%. Give each figure that was not found its counting basis and source in a follow-up save, or replace it with a figure a recorded output supports. The report lists them in its generated provenance appendix.',
			});
		});

		it('refuses an empty or placeholder body for a content template and writes no file', async () => {
			const { tool, files, checked } = setup(ledger);
			const empty = await tool.invoke({ input: { filePath: '/workspace/landscape.md', content: '', template: 'landscape-report' as const }, toolInvocationToken: undefined }, CancellationToken.None);
			const placeholder = await tool.invoke({ input: { filePath: '/workspace/landscape.md', content: '## 3. Filing Trends\n_(to be completed)_', template: 'landscape-report' as const }, toolInvocationToken: undefined }, CancellationToken.None);
			expect({
				empty: (empty.content[0] as LanguageModelTextPart).value,
				placeholder: (placeholder.content[0] as LanguageModelTextPart).value.endsWith('A placeholder such as "to be completed" is not content. Retry with the report body in content.'),
				written: await files.readFile(URI.file('/workspace/landscape.md')).then(() => true, () => false),
				checks: checked.length,
			}).toEqual({
				empty: 'Report was not saved. landscape-report needs content: the filing-trend table, the top-filers table, the jurisdiction split and the white-space observations, each figure with its counting basis (families / applications / publications / live search hits) and its source (PATSTAT edition, analytics corpus, or the query). Only prior-art-report and find-better-report use empty content with structured fields. Retry with the report body in content.',
				placeholder: true,
				written: false,
				checks: 0,
			});
		});
	});

	describe('FTO memo save path', () => {
		/** One retrieved claim the memo quotes, and one legal-status outcome carrying its lapse date. */
		const claim = 'A charging circuit comprising a resonant converter and a controller arranged to sweep the switching frequency.';
		const ledger: IPatentExecutionLedger = {
			...unrecordedPatentLedger,
			read: async () => ({
				executions: [
					{ id: 'one', recordedAt: '2026-09-13T00:00:00.000Z', kind: 'details', status: 'succeeded', publicationIds: ['EP1000000A1'], sources: [{ anchor: 'EP1000000A1:claims:1:en', text: claim, reference: { publicationNumber: 'EP1000000A1', section: 'claims', claimNumber: '1' }, language: 'en', retrieval: 'returned', review: 'unknown', completeness: 'unknown' }] },
					{ id: 'two', recordedAt: '2026-09-13T00:00:01.000Z', kind: 'status', status: 'succeeded', tool: 'get_legal_status', request: 'EP1000000A1', rowCount: 2, publicationIds: ['EP1000000A1'], resultText: '| 2024-01-10 | FR | MM4A | LAPSE |' },
				],
				limitation: 'Synthetic fixture; no live search.',
			}),
		};
		const citation = 'flowleap://flowleap.patent-ai/patent?publication=EP1000000A1&section=claims&claim=1';
		const content = [
			'## 1. Product Cleared',
			'The wireless charger module.',
			'',
			'## 2. Blocking Candidates',
			`Claim 1 of [EP1000000A1](${citation}) reads: "${claim}" It lapsed in France on 2024-01-10 and expires on 2031-08-02.`,
			'',
			'## 3. Risk',
			'Medium risk on 14 of the screened families.',
		].join('\n');

		it('gives an invalidity chart the same provenance appendix as an FTO memo', async () => {
			const { tool, files } = setup(ledger);
			await tool.invoke({ input: { filePath: '/workspace/chart.md', content, template: 'invalidity-claim-chart' as const, subject: 'EP1000000A1' }, toolInvocationToken: undefined }, CancellationToken.None);
			const chart = new TextDecoder().decode(await files.readFile(URI.file('/workspace/chart.md')));
			expect({
				figures: chart.includes('## Figure and date provenance (generated)'),
				quotations: chart.includes('## Quotation provenance (generated)'),
				data: chart.includes('## Data provenance (generated)'),
				scaffoldKept: chart.includes('## 2. Blocking Candidates'),
			}).toEqual({ figures: true, quotations: true, data: true, scaffoldKept: true });
		});

		it('appends figure, date, quotation and data provenance to the memo and names what was not traced', async () => {
			const { tool, files } = setup(ledger);
			const result = await tool.invoke({ input: { filePath: '/workspace/fto.md', content, template: 'fto-memo' as const, subject: 'Charger module' }, toolInvocationToken: undefined }, CancellationToken.None);
			const memo = new TextDecoder().decode(await files.readFile(URI.file('/workspace/fto.md')));
			const line = (text: string) => memo.split('\n').find(row => row.startsWith(text));
			expect({
				authoredBody: memo.includes('## 2. Blocking Candidates') && !memo.includes('## 3. Blocking References & Risk'),
				figures: line('1 figures checked'),
				dates: line('2 dates checked'),
				quotations: line('1 claim quotations checked'),
				data: memo.split('\n').filter(row => row.startsWith('- get_')),
				beforeDisclaimer: memo.indexOf('## Quotation provenance (generated)') < memo.indexOf('*This document was generated with AI assistance'),
				result: (result.content[0] as LanguageModelTextPart).value.split('\n')[1],
			}).toEqual({
				authoredBody: true,
				figures: '1 figures checked against recorded tool outputs; 0 found, 0 computed from figures that were found, 1 not found: 14.',
				dates: '2 dates checked against recorded tool outputs; 1 found, 1 not found: 2031-08-02.',
				quotations: '1 claim quotations checked against recorded claim text; 1 found verbatim, 0 found with elisions, 0 not found.',
				data: ['- get_patent_details — EP1000000A1 — count not recorded — succeeded', '- get_legal_status — EP1000000A1 — 2 rows — succeeded'],
				beforeDisclaimer: true,
				result: 'FTO provenance: 1 figures checked against recorded tool outputs; 0 found, 0 computed from figures that were found, 1 not found: 14. 2 dates checked against recorded tool outputs; 1 found, 1 not found: 2031-08-02. 1 claim quotations checked against recorded claim text; 1 found verbatim, 0 found with elisions, 0 not found. Source each figure, date and quotation that was not found in a follow-up save, or replace it with one a recorded output supports. The memo lists them in its generated provenance sections.',
			});
		});
	});

	describe('structured invalidity chart save path', () => {
		// Two prior-art documents: one that a disclosed row cites by itself, one that only ever appears
		// beside it. The challenged patent is EP2000000A1 and is never a source.
		const rodClaim = '1. A quick release comprising a skewer rod and a first head portion.';
		const camClaim = '1. A fastener comprising a cam surface and a lever arm.';
		const rod = 'EP1000000A1:claims:1:en';
		const cam = 'US5000000A:claims:1:en';
		const ledger: IPatentExecutionLedger = {
			...unrecordedPatentLedger,
			read: async () => ({
				executions: [{
					id: 'one', recordedAt: '2026-09-13', kind: 'details', status: 'succeeded', publicationIds: ['EP1000000A1', 'US5000000A'], sources: [
						{ anchor: rod, text: rodClaim, reference: { publicationNumber: 'EP1000000A1', section: 'claims', claimNumber: '1' }, language: 'en', retrieval: 'returned', review: 'unknown', completeness: 'unknown' },
						{ anchor: cam, text: camClaim, reference: { publicationNumber: 'US5000000A', section: 'claims', claimNumber: '1' }, language: 'en', retrieval: 'returned', review: 'unknown', completeness: 'unknown' },
					],
				}],
				limitation: 'Synthetic fixture; no live search.',
			}),
		};
		const review = (anchor: string) => ({ anchor, scope: 'Independent claim 1 as quoted.', qualifiers: 'Structural recitation only.', quantityBasis: 'Structural claim language; no numeric range.' });
		const input = {
			filePath: '/workspace/invalidity.md', template: 'invalidity-claim-chart' as const, content: '',
			challengedPublication: 'EP2000000A1', subject: 'Quick release skewer', objective: 'Art is measured against the 2004-03-01 earliest priority date.',
			coverage: [
				{ feature: 'Claim 1 — element (a): a skewer rod', claimNumber: '1', kind: 'feature' as const, importance: 'essential' as const, status: 'supported' as const, sourceAnchors: [rod], evidence: [review(rod)], elements: [{ element: 'a skewer rod', anchor: rod, disclosedBy: 'a skewer rod' }], gap: '' },
				{ feature: 'Claim 1 — element (b): a cam surface on the head', claimNumber: '1', kind: 'feature' as const, importance: 'essential' as const, status: 'partial' as const, sourceAnchors: [cam], evidence: [review(cam)], elements: [{ element: 'a cam surface', anchor: cam, disclosedBy: 'a cam surface' }, { element: 'carried on the head portion' }], gap: 'No cited passage puts the cam surface on the head portion.' },
				{ feature: 'Claim 1 as a whole', claimNumber: '1', kind: 'combination' as const, importance: 'essential' as const, status: 'partial' as const, sourceAnchors: [rod, cam], evidence: [review(rod), review(cam)], elements: [{ element: 'a skewer rod', anchor: rod, disclosedBy: 'a skewer rod' }, { element: 'a cam surface on that rod’s head portion' }], gap: 'Neither document arranges the elements as claimed.' },
			],
			limitations: ['Synthetic fixture; eligibility of each reference requires review.'], stopReason: 'Bounded interim chart.',
		};

		it('renders the chart from coverage, relabels the statuses and receipts it for the completion check', async () => {
			const { tool, files } = setup(ledger);
			const result = await tool.invoke({ input, toolInvocationToken: undefined }, CancellationToken.None);
			const chart = new TextDecoder().decode(await files.readFile(URI.file(input.filePath)));
			const lines = chart.split('\n');
			const message = (result.content[0] as LanguageModelTextPart).value;
			const turn: ReportCompletionTurn = { message: 'Build the invalidity chart for EP2000000A1 and save /workspace/invalidity.md', rounds: [{ id: 'round', response: '', toolInputRetry: 0, toolCalls: [{ id: 'write', name: ToolName.WritePatentResults, arguments: JSON.stringify(input) }] }], results: { write: result } };
			expect({
				header: lines.slice(0, 9),
				statuses: lines.filter(line => line.startsWith('**')),
				quoted: chart.includes(rodClaim) && chart.includes(camClaim),
				elementTable: chart.includes('| Element | Disclosed by | Source |'),
				scaffold: chart.includes('## 3. Element-by-Element Invalidity Chart'),
				companions: (await files.readDirectory(URI.file('/workspace'))).filter(([name]) => name.endsWith('.evidence.json')).length,
				receipts: message.split('\n').filter(line => line.startsWith('Prior-art artifact receipt: ')).length,
				completion: await checkPriorArtReportCompletion([], turn, files),
			}).toEqual({
				header: [
					'# Invalidity Claim Chart',
					'',
					'| Field | Details |',
					'| --- | --- |',
					'| Challenged patent | EP2000000A1 |',
					'| Claim(s) at issue | 1 |',
					'| Critical date basis | Art is measured against the 2004-03-01 earliest priority date. |',
					`| Date | ${new Date().toISOString().slice(0, 10)} |`,
					'| Prepared by | FlowLeap Patent AI (AI-assisted draft) |',
				],
				statuses: ['**feature · essential · disclosed in the cited art**', '**feature · essential · partially disclosed**', '**combination · essential · partially disclosed**'],
				quoted: true,
				elementTable: true,
				scaffold: false,
				companions: 1,
				receipts: 1,
				completion: undefined,
			});
		});

		it('derives the reference roles from the statuses without tagging them X/Y/A', async () => {
			const { tool, files } = setup(ledger);
			await tool.invoke({ input, toolInvocationToken: undefined }, CancellationToken.None);
			const chart = new TextDecoder().decode(await files.readFile(URI.file(input.filePath))).split('\n');
			const start = chart.indexOf('## Reference roles (generated)');
			expect(chart.slice(start, start + 6)).toEqual([
				'## Reference roles (generated)',
				'Derived from the statuses in this chart, not a legal category: a reference is listed as disclosing on its own where a row marked disclosed cites it and no other document, and as contributing in combination otherwise. This is not an X/Y/A tag and asserts nothing about anticipation, obviousness or inventive step.',
				'| Reference | Cited in | Role (generated) |',
				'| --- | --- | --- |',
				'| EP1000000A1 | Claim 1 — element (a): a skewer rod; Claim 1 as a whole | discloses element(s) on its own |',
				'| US5000000A | Claim 1 — element (b): a cam surface on the head; Claim 1 as a whole | contributes in combination |',
			]);
		});

		it('rejects content beside coverage, and keeps the written-content chart when no coverage is supplied', async () => {
			const { tool, files } = setup(ledger);
			const withBoth = await tool.invoke({ input: { ...input, content: '| Claim Element | EP1000000A1 |' }, toolInvocationToken: undefined }, CancellationToken.None);
			const written = await tool.invoke({ input: { filePath: '/workspace/written.md', content: '| Claim Element | EP1000000A1 |\n| --- | --- |\n| Preamble | Disclosed |', template: 'invalidity-claim-chart' as const, matter: 'EP2000000A1', subject: 'EP1000000A1' }, toolInvocationToken: undefined }, CancellationToken.None);
			const chart = new TextDecoder().decode(await files.readFile(URI.file('/workspace/written.md')));
			expect({
				rejected: (withBoth.content[0] as LanguageModelTextPart).value.includes('For invalidity-claim-chart with coverage, content must be empty'),
				unwritten: await files.readFile(URI.file(input.filePath)).then(() => true, () => false),
				saved: (written.content[0] as LanguageModelTextPart).value.split('\n')[0],
				scaffold: chart.includes('## 3. Element-by-Element Invalidity Chart'),
				practitionerFields: chart.includes('| Patent No. / Claim(s) at Issue | EP2000000A1 |'),
				structuredFields: chart.includes('| Challenged patent |'),
				receipts: (written.content[0] as LanguageModelTextPart).value.includes('Prior-art artifact receipt: '),
			}).toEqual({
				rejected: true,
				unwritten: false,
				saved: 'Successfully wrote patent results to /workspace/written.md',
				scaffold: true,
				practitionerFields: true,
				structuredFields: false,
				receipts: false,
			});
		});
	});

	describe('find-better report save path', () => {
		// The target is EP2000000B1, claim 1: a skewer rod (a) and a cam surface on the head (b). The
		// examiner's best art is US5135330A (X in both offices); the tracks found DE1000000A and DE2000000A.
		const examinerClaim = '1. A fastener comprising a skewer rod and a lever arm.';
		const betterClaim = '1. A quick release comprising a skewer rod and a cam surface formed on the head portion.';
		const weakerClaim = '1. A clamp comprising a skewer rod and a cam surface.';
		const examinerArt = 'US5135330A:claims:1:en';
		const better = 'DE1000000A:claims:1:en';
		const weaker = 'DE2000000A:claims:1:en';
		const source = (anchor: string, publicationNumber: string, text: string) => ({ anchor, text, reference: { publicationNumber, section: 'claims' as const, claimNumber: '1' }, language: 'en', retrieval: 'returned' as const, review: 'unknown' as const, completeness: 'unknown' as const });
		const ledger: IPatentExecutionLedger = {
			...unrecordedPatentLedger,
			read: async () => ({
				executions: [
					{ id: 'one', recordedAt: '2026-10-05', kind: 'search', status: 'succeeded', query: 'cpc=F16B2/18 and ta=skewer', effectiveQuery: 'cpc=F16B2/18 and ta=skewer', total: 14, returned: 14, countryFilter: [] },
					{ id: 'two', recordedAt: '2026-10-05', kind: 'details', status: 'succeeded', publicationIds: ['US5135330A', 'DE1000000A', 'DE2000000A'], sources: [source(examinerArt, 'US5135330A', examinerClaim), source(better, 'DE1000000A', betterClaim), source(weaker, 'DE2000000A', weakerClaim)] },
					{ id: 'three', recordedAt: '2026-10-05', kind: 'figures', status: 'failed', publicationIds: ['DE1000000A'] },
				],
				limitation: 'Synthetic fixture; no live search.',
			}),
		};
		const review = (anchor: string) => ({ anchor, scope: 'Independent claim 1 as quoted.', qualifiers: 'Structural recitation only.', quantityBasis: 'Structural claim language; no numeric range.' });
		const baseline = {
			publication: 'EP2000000B1',
			offices: ['EP', 'US'],
			membersWalked: [
				{ office: 'EP', representativePublication: 'EP2000000B1', docdbApplication: null, publications: [{ publication: 'EP2000000A3', status: 'read', citedCount: 2, examinerCount: 2, applicantCount: 0 }] },
				{ office: 'US', representativePublication: 'US7000000B2', docdbApplication: null, publications: [{ publication: 'US7000000B2', status: 'read', citedCount: 2, examinerCount: 1, applicantCount: 1 }] },
			],
			documents: [
				{ document: 'US5135330', kinds: ['A'], familyId: null, cells: { EP: { text: 'X,A cl. 1-5', citations: [{ source: 'ops_biblio', citing: 'EP2000000A3', citedBy: 'examiner', category: 'X,A', relevantClaims: '1-5' }] }, US: { text: 'X cl. 1-4 (US OA 2009-08-18)', citations: [{ source: 'uspto_enriched', citing: '12103744', citedBy: 'examiner', category: 'X', relevantClaims: '1-4' }] } } },
				{ document: 'US4000000', kinds: ['A'], familyId: null, cells: { US: { text: 'applicant', citations: [{ source: 'ops_biblio', citing: 'US7000000B2', citedBy: 'applicant' }] } } },
			],
			gaps: [],
			dedupe: 'docdb-number',
		};
		const unresolved = (gap: string) => ({ status: 'unresolved' as const, sourceAnchors: [], gap });
		const supported = (anchor: string, element: string, fragment: string) => ({ status: 'supported' as const, sourceAnchors: [anchor], evidence: [review(anchor)], elements: [{ element, anchor, disclosedBy: fragment }], gap: '' });
		const unused = { status: 'unresolved' as const, sourceAnchors: [], gap: '' };
		/** A Find Better save of claim 1 whose found side is `found` on element (b) and on the combination. */
		const input = (foundB: object, foundWhole: object, extra: object = {}) => ({
			filePath: '/workspace/find-better.md', template: 'find-better-report' as const, content: '',
			challengedPublication: 'EP2000000B1', subject: 'Quick release skewer', objective: 'Earliest priority date 2004-03-01 (EP2000000 priority claim).',
			baseline,
			examinerBestArt: [{ claimNumber: '1', publications: ['US5135330A'] }],
			tracks: [
				{ name: 'Backward citations, two hops from X/Y', queries: [{ query: 'citations of US5135330', tool: 'search_citations', count: 0 }] },
				{ name: 'Classification co-occurrence', queries: [{ query: 'cpc=F16B2/18 and ta=skewer', tool: 'search_patents', count: 99 }] },
				{ name: 'Inventor and NPL-author network', queries: [] },
			],
			coverage: [
				{ feature: 'Claim 1 — element (a): a skewer rod', claimNumber: '1', kind: 'feature' as const, importance: 'essential' as const, ...unused, examiner: supported(examinerArt, 'a skewer rod', 'a skewer rod'), found: supported(better, 'a skewer rod', 'a skewer rod') },
				{ feature: 'Claim 1 — element (b): a cam surface on the head', claimNumber: '1', kind: 'feature' as const, importance: 'essential' as const, ...unused, examiner: unresolved('The examiner\'s art has a lever arm and no cam surface.'), found: foundB },
				{ feature: 'Claim 1 as a whole', claimNumber: '1', kind: 'combination' as const, importance: 'essential' as const, ...unused, examiner: unresolved('No cam surface on the head in the examiner\'s art.'), found: foundWhole },
			],
			limitations: ['Synthetic fixture; eligibility of each reference requires review.'], stopReason: 'All three tracks run.',
			...extra,
		});
		const betterInput = input(
			{ status: 'supported' as const, sourceAnchors: [better], evidence: [review(better)], elements: [{ element: 'a cam surface', anchor: better, disclosedBy: 'a cam surface' }, { element: 'formed on the head portion', anchor: better, disclosedBy: 'formed on the head portion' }], gap: '' },
			{ status: 'supported' as const, sourceAnchors: [better], evidence: [review(better)], elements: [{ element: 'a skewer rod', anchor: better, disclosedBy: 'a skewer rod' }, { element: 'a cam surface on the head portion', anchor: better, disclosedBy: 'a cam surface formed on the head portion' }], gap: '' },
		);
		const weakerInput = {
			...input(
				{ status: 'partial' as const, sourceAnchors: [weaker], evidence: [review(weaker)], elements: [{ element: 'a cam surface', anchor: weaker, disclosedBy: 'a cam surface' }, { element: 'formed on the head portion' }], gap: 'DE2000000A does not place the cam surface on the head.' },
				{ status: 'partial' as const, sourceAnchors: [weaker], evidence: [review(weaker)], elements: [{ element: 'a skewer rod', anchor: weaker, disclosedBy: 'a skewer rod' }, { element: 'a cam surface on the head portion' }], gap: 'The cam surface is not on the head.' },
			),
		};
		// Element (a)'s found side cites the weaker document in the nothing-better case.
		weakerInput.coverage[0] = { ...weakerInput.coverage[0], found: supported(weaker, 'a skewer rod', 'a skewer rod') };

		/** The lines of `report` from the heading `from` up to, not including, the next heading at that level or above. */
		function section(report: string, from: string): string[] {
			const lines = report.split('\n');
			const start = lines.indexOf(from);
			const level = from.match(/^#+/)![0].length;
			const end = lines.findIndex((line, index) => index > start && /^#+ /.test(line) && line.match(/^#+/)![0].length <= level);
			return lines.slice(start, end < 0 ? undefined : end).filter(line => line.trim());
		}

		async function save(value: object): Promise<{ report: string; message: string; files: MockFileSystemService }> {
			const { tool, files } = setup(ledger);
			const result = await tool.invoke({ input: value as Parameters<typeof tool.invoke>[0]['input'], toolInvocationToken: undefined }, CancellationToken.None);
			const message = (result.content[0] as LanguageModelTextPart).value;
			const report = await files.readFile(URI.file('/workspace/find-better.md')).then(bytes => new TextDecoder().decode(bytes), () => '');
			return { report, message, files };
		}

		it('(a) renders the examiner\'s best art beside better art found on claim 1, counted from validated rows', async () => {
			const { report, message, files } = await save(betterInput);
			const turn: ReportCompletionTurn = { message: 'Run Find Better on EP2000000B1 and save /workspace/find-better.md', rounds: [{ id: 'round', response: '', toolInputRetry: 0, toolCalls: [{ id: 'write', name: ToolName.WritePatentResults, arguments: JSON.stringify(betterInput) }] }], results: { write: { content: [new LanguageModelTextPart(message)] } as vscode.LanguageModelToolResult } };
			expect({
				header: report.split('\n').slice(0, 9),
				claim: section(report, '### Claim 1').slice(0, 9),
				tracks: section(report, '## Tracks log'),
				contract: message.split('\n').find(line => line.startsWith('Chat summary contract: ')),
				completion: await checkPriorArtReportCompletion([], turn, files),
			}).toEqual({
				header: [
					'# Find Better Report',
					'',
					'| Field | Details |',
					'| --- | --- |',
					'| Target patent | EP2000000B1 |',
					'| Independent claim(s) compared | 1 |',
					'| Earliest priority date basis | Earliest priority date 2004-03-01 (EP2000000 priority claim). |',
					`| Date | ${new Date().toISOString().slice(0, 10)} |`,
					'| Prepared by | FlowLeap Patent AI (AI-assisted draft) |',
				],
				claim: [
					'### Claim 1',
					'| Element | Examiner\'s best art (US5135330A) | Best art found (DE1000000A) |',
					'| --- | --- | --- |',
					'| Claim 1 — element (a): a skewer rod | disclosed | disclosed |',
					'| Claim 1 — element (b): a cam surface on the head | not found | disclosed |',
					'| Claim 1 as a whole (combination, not counted) | not found | disclosed |',
					'examiner\'s best art: disclosed 1 of 2 · best art found: disclosed 2 of 2',
					'For claim 1, the best art found (DE1000000A) discloses 2 of 2 elements; the examiner\'s best art US5135330A discloses 1 of 2.',
					'#### Claim 1 — element (a): a skewer rod — examiner\'s best art',
				],
				tracks: [
					'## Tracks log',
					'Every expansion track of this run with each query it ran and its hit count, including queries that returned nothing. A track with no query was not searched.',
					'| Track | Query | Tool | Hits | Count basis |',
					'| --- | --- | --- | --- | --- |',
					'| Backward citations, two hops from X/Y | citations of US5135330 | search_citations | 0 | as reported by the agent; not in the execution record |',
					'| Classification co-occurrence | cpc=F16B2/18 and ta=skewer | search_patents | 14 | execution record |',
					'| Inventor and NPL-author network | no query run | — | — | — |',
				],
				contract: 'Chat summary contract: repeat each cell\'s status word exactly (disclosed / partially disclosed / not found); state each claim\'s counts exactly as the saved report counts them (claim 1 — examiner\'s best art: disclosed 1 of 2 · best art found: disclosed 2 of 2); state that the Baseline has 0 gaps in the offices\' records and that a gap is not "nothing cited"; where no better art was found, say so as a complete result. Do not add invalidity, anticipation or obviousness conclusions. The summary must not be more certain than the saved report.',
				completion: undefined,
			});
		});

		it('(b) renders "no better art found" as a complete result with the full Baseline', async () => {
			const { report, message } = await save(weakerInput);
			expect({
				saved: message.split('\n')[0],
				claim: section(report, '### Claim 1').slice(0, 9),
				baseline: section(report, '## Examiner Baseline').filter(line => !line.startsWith('Every document the examining offices cited')),
			}).toEqual({
				saved: 'Successfully wrote patent results to /workspace/find-better.md',
				claim: [
					'### Claim 1',
					'| Element | Examiner\'s best art (US5135330A) | Best art found (DE2000000A) |',
					'| --- | --- | --- |',
					'| Claim 1 — element (a): a skewer rod | disclosed | disclosed |',
					'| Claim 1 — element (b): a cam surface on the head | not found | partially disclosed |',
					'| Claim 1 as a whole (combination, not counted) | not found | partially disclosed |',
					'examiner\'s best art: disclosed 1 of 2 · best art found: disclosed 1 of 2',
					'No better art found for claim 1; the examiner\'s best art remains US5135330A (disclosed 1 of 2).',
					'#### Claim 1 — element (a): a skewer rod — examiner\'s best art',
				],
				baseline: [
					'## Examiner Baseline',
					'Family members walked: 2. Offices: EP, US.',
					'| Office | Member | Read | Cited (examiner / applicant) |',
					'| --- | --- | --- | --- |',
					'| EP | EP2000000B1 | EP2000000A3: read | 2 (2 / 0) |',
					'| US | US7000000B2 | US7000000B2: read | 2 (1 / 1) |',
					'Cited documents: 2.',
					'| Document | EP | US |',
					'| --- | --- | --- |',
					'| US5135330 A (examiner\'s best art, claim 1) | X,A cl. 1-5 (claims of EP2000000A3) | X cl. 1-4 (US OA 2009-08-18) (claims of 12103744) |',
					'| US4000000 A | - | applicant |',
					'### Gaps in the offices\' records',
					'A gap is a member or source that returned no citation record. It is not "nothing cited": that office\'s citations for that member are unknown.',
					'- The Baseline reports no gaps.',
				],
			});
		});

		it('(c) renders an office with no citation record as a gap, never as "nothing cited"', async () => {
			const withGap = input(betterInput.coverage[1].found, betterInput.coverage[2].found, { baseline: { ...baseline, offices: ['EP', 'US', 'KR'], gaps: [{ office: 'KR', member: 'KR20150058102A', source: 'ops_biblio', reason: 'no_citation_record', message: 'no citation record from KR (KR20150058102A)' }] } });
			const { report, message } = await save(withGap);
			expect({
				matrixHeader: report.split('\n').find(line => line.startsWith('| Document |')),
				gaps: section(report, '### Gaps in the offices\' records'),
				contract: message.includes('the Baseline has 1 gap in the offices\' records'),
			}).toEqual({
				matrixHeader: '| Document | EP | US | KR |',
				gaps: [
					'### Gaps in the offices\' records',
					'A gap is a member or source that returned no citation record. It is not "nothing cited": that office\'s citations for that member are unknown.',
					'- Gap: no citation record from KR (KR20150058102A) (no_citation_record)',
				],
				contract: true,
			});
		});

		it('(d) refuses examinerBestArt that names a document absent from the Baseline, or one with no X or Y category', async () => {
			const absent = await save(input(betterInput.coverage[1].found, betterInput.coverage[2].found, { examinerBestArt: [{ claimNumber: '1', publications: ['EP9999999A1'] }] }));
			const applicantOnly = await save(input(betterInput.coverage[1].found, betterInput.coverage[2].found, { examinerBestArt: [{ claimNumber: '1', publications: ['US4000000A'] }] }));
			const missing = await save({ filePath: '/workspace/find-better.md', template: 'find-better-report', content: '' });
			expect({
				absent: absent.message.split('\n').filter(line => line.includes('examinerBestArt')),
				applicantOnly: applicantOnly.message.split('\n').filter(line => line.includes('examinerBestArt')),
				missing: missing.message,
				written: absent.report || applicantOnly.report || missing.report,
			}).toEqual({
				absent: [
					'- examinerBestArt for claim 1 names EP9999999A1, which is not in baseline.documents[]. The examiner\'s best art must be a document the Baseline lists; pick one of its X or Y citations.',
					'- Row "Claim 1 — element (a): a skewer rod" cites US5135330A:claims:1:en (US5135330A) on the examiner side, but the examiner\'s best art for claim 1 is EP9999999A1. Cite that art on the examiner side, or name US5135330A in examinerBestArt if the Baseline supports it.',
				],
				applicantOnly: [
					'- examinerBestArt for claim 1 names US4000000A, which carries no X or Y category in any office of the Baseline (no category). The examiner\'s best art must be an X or Y citation.',
					'- Row "Claim 1 — element (a): a skewer rod" cites US5135330A:claims:1:en (US5135330A) on the examiner side, but the examiner\'s best art for claim 1 is US4000000A. Cite that art on the examiner side, or name US5135330A in examinerBestArt if the Baseline supports it.',
				],
				missing: 'Report was not saved. find-better-report is a structured save and needs coverage (element rows, each with an examiner side and a found side); baseline (the Examiner Baseline JSON: the --json output of flowleap patent examiner-baseline, or the same shape built from the typed citation tools); examinerBestArt (per independent claim, the X or Y citation of the Baseline picked as the examiner\'s best art); tracks (every expansion track with its queries and hit counts, empty ones included). Leave content empty.',
				written: '',
			});
		});

		it('(e) ignores a model-supplied score, names it in the result, keeps it off the page, and flags invalidity wording', async () => {
			const scored = input(betterInput.coverage[1].found, betterInput.coverage[2].found, { stopReason: 'DE1000000A anticipates claim 1, which is invalid and obvious.' });
			const withScore = { ...scored, coverage: scored.coverage.map(row => ({ ...row, found: { ...row.found, score: 0.92 } })), findBetterScore: 87 };
			const { report, message } = await save(withScore);
			expect({
				ignored: message.split('\n').find(line => line.startsWith('Ignored model-supplied numeric field(s): ')),
				onPage: /0\.92|87/.test(report),
				counted: report.includes('examiner\'s best art: disclosed 1 of 2 · best art found: disclosed 2 of 2'),
				wording: message.split('\n').find(line => line.startsWith('Wording review: ')),
			}).toEqual({
				ignored: 'Ignored model-supplied numeric field(s): coverage[0].found.score, coverage[1].found.score, coverage[2].found.score, findBetterScore. A Find Better report counts disclosed elements from the validated rows only; no model-supplied number reaches the report.',
				onPage: false,
				counted: true,
				wording: 'Wording review: 3 phrase(s) flagged in the working record; reword them in a follow-up save if they are conclusions rather than disclaimers.',
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
