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
	/** The value of `patent.secondRead.model`; unset means the request's own model is used. */
	readonly judgeModel?: string;
	/** What the provider actually resolves `judgeModel` to; a different id means it is unavailable. */
	readonly resolvedModel?: string;
	/** One reply, or one per judged row in order. */
	readonly reply?: string | readonly string[];
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
	const configuration = new class extends mock<IConfigurationService>() {
		override getNonExtensionConfig<T>(key: string): T | undefined {
			return (key === 'patent.secondRead.model' ? secondRead.judgeModel : secondRead.setting ?? 'off') as T | undefined;
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

		async function save(secondRead: SecondReadStub): Promise<{ files: MockFileSystemService; report: string; lines: string[]; turn: ReportCompletionTurn }> {
			const { tool, files } = setup(judgedLedger, secondRead);
			await withRequest(tool);
			const result = await tool.invoke({ input, toolInvocationToken: undefined }, CancellationToken.None);
			const turn: ReportCompletionTurn = { message: 'Search for prior art and save /workspace/review.md', rounds: [{ id: 'round', response: '', toolInputRetry: 0, toolCalls: [{ id: 'write', name: ToolName.WritePatentResults, arguments: JSON.stringify(input) }] }], results: { write: result } };
			return { files, report: new TextDecoder().decode(await files.readFile(URI.file(input.filePath))), lines: (result.content[0] as LanguageModelTextPart).value.split('\n'), turn };
		}

		it('judges each element of a saved row and records the verdicts beside the evidence companion', async () => {
			const { files, report, lines } = await save({ setting: 'log', reply: [combinationVerdicts, headVerdicts] });
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
			}).toEqual({
				line: `Second read (diagnostic): 4 elements judged, 1 disagree, 0 unclear, 0 unparsed; verdicts in ${verdictName}.`,
				contract: true,
				sharesCompanionId: true,
				model: 'judge-model',
				features: ['Quick release combination', 'Skewer heads'],
				firstRowVerdicts: [{ element: 'a skewer rod', verdict: 'agree', reason: 'The claim recites a skewer rod.' }, { element: 'a cam profile carried on the handle stem', verdict: 'disagree', reason: 'The quoted claim puts the cam surface in the head portion.' }],
				summary: { elements: 4, agree: 3, disagree: 1, unclear: 0, unparsed: 0 },
				inReport: false,
			});
		});

		it('leaves the saved report byte-identical to a report saved without a second read', async () => {
			const [logged, disabled] = await Promise.all([
				save({ setting: 'log', reply: [combinationVerdicts, headVerdicts] }),
				save({ setting: 'off' }),
			]);
			expect({ identical: withoutCompanionId(logged.report) === withoutCompanionId(disabled.report), line: disabled.lines[1].startsWith('Chat summary contract: ') }).toEqual({ identical: true, line: true });
		});

		it('states what was not confirmed under the affected row only, once in the limitations, and receipts the final bytes', async () => {
			const { files, report, lines, turn } = await save({ setting: 'render', reply: [combinationVerdicts, headVerdicts] });
			const [, combination, heads] = report.split('### ');
			const receipt = JSON.parse(lines.find(line => line.startsWith('Prior-art artifact receipt: '))!.slice('Prior-art artifact receipt: '.length));
			const written = await files.readFile(URI.file(input.filePath));
			expect({
				heading: combination.split('\n')[0],
				block: combination.includes("Second read (generated, judge-model): the following elements were not confirmed by an independent read of the cited text; the row's status is the author's judgment."),
				verdict: combination.includes('- a cam profile carried on the handle stem: disagree — The quoted claim puts the cam surface in the head portion.'),
				beforeGap: combination.indexOf('Second read (generated') < combination.indexOf('Remaining gap (model judgment)'),
				confirmedRow: heads.includes('Second read (generated'),
				limitation: report.split('\n').filter(line => line.startsWith('Second read by ')),
				line: lines[1],
				guidance: lines[2],
				receiptDigest: receipt.reportDigest === createHash('sha256').update(written).digest('hex'),
				completion: await checkPriorArtReportCompletion([], turn, files),
			}).toEqual({
				heading: 'Quick release combination',
				block: true,
				verdict: true,
				beforeGap: true,
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

		it('saves the report and reports a skip when the judge request fails', async () => {
			const { files, lines } = await save({ setting: 'render', failure: 'judge unavailable' });
			const names = (await files.readDirectory(URI.file('/workspace'))).map(([name]) => name);
			expect({
				saved: lines[0],
				line: lines[1],
				contract: lines[2].startsWith('Chat summary contract: '),
				receipts: lines.filter(line => line.startsWith('Prior-art artifact receipt: ')).length,
				verdictFiles: names.filter(name => name.endsWith('.second-read.json')).length,
				limitation: new TextDecoder().decode(await files.readFile(URI.file(input.filePath))).includes('Second read: skipped (judge unavailable).'),
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
				empty: 'Report was not saved. landscape-report needs content: the filing-trend table, the top-filers table, the jurisdiction split and the white-space observations, each figure with its counting basis (families / applications / publications / live search hits) and its source (PATSTAT edition, analytics corpus, or the query). Only prior-art-report uses empty content with structured fields. Retry with the report body in content.',
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
