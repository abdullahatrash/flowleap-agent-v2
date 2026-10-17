/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { MockFileSystemService } from '../../../../platform/filesystem/node/test/mockFileSystemService';
import { URI } from '../../../../util/vs/base/common/uri';
import { LanguageModelTextPart, LanguageModelToolResult } from '../../../../vscodeTypes';
import { ToolName } from '../../common/toolNames';
import { checkPriorArtReportCompletion, priorArtReportReceipt, ReceiptFallbacks, ReportCompletionTurn, requestsPriorArtReport } from '../priorArtReportCompletion';

const message = 'Search for prior art and save "outputs/研究 review.md".';
const report = URI.file('/workspace/outputs/研究 review.md');
const evidence = URI.file('/workspace/outputs/revision.evidence.json');
const files = () => new MockFileSystemService();
function turn(names: readonly string[], request = message): ReportCompletionTurn {
	return { message: request, rounds: [{ id: 'round', response: '', toolInputRetry: 0, toolCalls: names.map((name, index) => ({ name, id: String(index), arguments: name === ToolName.WritePatentResults ? '{"template":"prior-art-report"}' : '{}' })) }], results: {} };
}
async function saved(fs: MockFileSystemService, uri = report): Promise<ReportCompletionTurn> {
	await fs.writeFile(uri, new TextEncoder().encode('Evidence-backed interim report'));
	await fs.writeFile(evidence, new TextEncoder().encode('Snapshot'));
	return { ...turn([ToolName.SearchPatents, ToolName.WritePatentResults]), results: { '1': new LanguageModelToolResult([new LanguageModelTextPart(priorArtReportReceipt(uri, 'Evidence-backed interim report', evidence, 'Snapshot'))]) } };
}

describe('prior-art report completion contract', () => {
	it('leaves clarification and ordinary single-detail questions alone', async () => {
		expect(await checkPriorArtReportCompletion([], turn([]), files())).toBeUndefined();
		expect(await checkPriorArtReportCompletion([], turn([ToolName.GetPatentDetails], 'What does claim 10 say?'), files())).toBeUndefined();
		expect(requestsPriorArtReport('Write a unit test for patent lookup')).toBe(false);
	});
	it.each([ToolName.CreateFile, ToolName.ApplyPatch, ToolName.ReplaceString, 'run_in_terminal'])('does not accept a generic %s as finalization', async name => {
		expect(await checkPriorArtReportCompletion([], turn([ToolName.SearchPatents, name]), files())).toContain('no successful structured finalization');
	});
	it('requires finalization when an explicit report request reuses existing evidence through a generic write', async () => {
		expect(await checkPriorArtReportCompletion([], turn([ToolName.CreateFile]), files())).toContain('no successful structured finalization');
	});
	it('persists pending intent through a scope reply and a request-limit continuation', async () => {
		const history = [turn([]), turn([ToolName.SearchPatents], 'EP and WO before 2002-02-21')];
		expect(await checkPriorArtReportCompletion(history, turn([ToolName.CreateFile], 'Continue to iterate'), files())).toContain('no successful structured finalization');
	});
	it('rejects failed and omitted-template writer results', async () => {
		const input = turn([ToolName.SearchPatents, ToolName.WritePatentResults]);
		for (const response of ['Candidate draft was not saved.', 'Successfully wrote patent results; free-form artifact.']) {
			expect(await checkPriorArtReportCompletion([], { ...input, results: { '1': new LanguageModelToolResult([new LanguageModelTextPart(response)]) } }, files())).toContain('no successful structured finalization');
		}
	});
	it('accepts a saved report, preserves unrelated notes, detects generic edits, and recovers via a new receipt', async () => {
		const fs = files();
		const valid = await saved(fs);
		expect(await checkPriorArtReportCompletion([], valid, fs)).toBeUndefined();
		await fs.writeFile(URI.file('/workspace/notes.md'), new TextEncoder().encode('Ordinary notes'));
		const notes = turn([ToolName.CreateFile], 'Save these notes');
		expect(await checkPriorArtReportCompletion([valid], notes, fs)).toBeUndefined();
		await fs.writeFile(report, new TextEncoder().encode('Unchecked replacement'));
		expect(await checkPriorArtReportCompletion([valid], turn([ToolName.ReplaceString], 'Update the report'), fs)).toContain('changed after validation');
		const recovered = await saved(fs);
		expect(await checkPriorArtReportCompletion([valid], recovered, fs)).toBeUndefined();
	});
	it.each(['report', 'evidence'])('invalidates deleted %s bytes', async target => {
		const fs = files();
		const valid = await saved(fs);
		await fs.delete(target === 'report' ? report : evidence);
		expect(await checkPriorArtReportCompletion([valid], turn(['run_in_terminal'], 'Continue'), fs)).toContain('changed after validation');
	});
	it('retains an unfinished report obligation for a prose-only continuation', async () => {
		const history = [turn([]), turn([ToolName.SearchPatents], 'EP and WO before 2002')];
		expect(await checkPriorArtReportCompletion(history, turn([], 'Continue'), files())).toContain('no successful structured finalization');
	});
	it('requires fresh finalization for an explicit report revision with more evidence', async () => {
		const fs = files();
		const valid = await saved(fs);
		expect(await checkPriorArtReportCompletion([valid], turn([ToolName.GetPatentDetails], 'Update the report with this additional patent'), fs)).toContain('no successful structured finalization');
	});
	it('does not reopen a finalized report for an unrelated single-patent followup', async () => {
		const fs = files();
		const valid = await saved(fs);
		expect(await checkPriorArtReportCompletion([valid], turn([ToolName.GetPatentDetails], 'What does claim 10 of EP1000000A1 say?'), fs)).toBeUndefined();
	});

	it('starts a second report contract and does not reopen an old report for unrelated work', async () => {
		const fs = files();
		const first = await saved(fs);
		const second = turn([], 'Search for prior art and save outputs/second.md');
		const retrieval = turn([ToolName.SearchPatents], 'US before 2020');
		expect(await checkPriorArtReportCompletion([first, second, retrieval], turn([ToolName.CreateFile], 'Continue'), fs)).toContain('no successful structured finalization');
		await fs.writeFile(report, new TextEncoder().encode('Manually edited later'));
		expect(await checkPriorArtReportCompletion([first], turn([ToolName.CreateFile], 'Create a README for my code'), fs)).toBeUndefined();
	});
	it('matches a Windows deliverable across separators and drive-letter case', async () => {
		const fs = files();
		const windows = 'Search for prior art and save "C:\\Users\\Ann\\outputs\\Report.md".';
		const finalized = { ...await saved(fs, URI.file('c:/Users/Ann/outputs/report.md')), message: windows };
		const research = turn([ToolName.SearchPatents], windows);
		const backslashDraft: ReportCompletionTurn = { message: 'Add the last hit', results: {}, rounds: [{ id: 'round', response: '', toolInputRetry: 0, toolCalls: [{ id: '0', name: ToolName.CreateFile, arguments: '{"filePath":"C:\\\\Users\\\\Ann\\\\outputs\\\\Report.md"}' }] }] };
		expect({
			finalized: await checkPriorArtReportCompletion([], finalized, fs),
			draft: (await checkPriorArtReportCompletion([research], backslashDraft, fs))?.includes('no successful structured finalization'),
		}).toEqual({ finalized: undefined, draft: true });
	});

	it('local inspection after finalization does not require another evidence revision', async () => {
		const fs = files();
		const valid = await saved(fs);
		const local = turn([ToolName.GetPatentDetails]);
		const lookup = { ...local, rounds: local.rounds.map(round => ({ ...round, toolCalls: round.toolCalls.map(call => ({ ...call, arguments: '{"evidenceLookup":{}}' })) })) };
		expect(await checkPriorArtReportCompletion([valid], lookup, fs)).toBeUndefined();
	});

	it('binds evidence freshness to the requested report, not another later writer', async () => {
		const fs = files();
		const valid = await saved(fs);
		const other = await saved(fs, URI.file('/workspace/other.md'));
		const current: ReportCompletionTurn = {
			...valid,
			rounds: [...valid.rounds, { id: 'later', response: '', toolInputRetry: 0, toolCalls: [{ id: 'detail', name: ToolName.GetPatentDetails, arguments: '{}' }, { id: 'other', name: ToolName.WritePatentResults, arguments: '{"template":"prior-art-report"}' }] }],
			results: { ...valid.results, other: other.results['1'] },
		};
		expect(await checkPriorArtReportCompletion([], current, fs)).toContain('More patent evidence');
	});
	it.each(['{}', '{"template":"prior-art-report"}'])('ignores receipt-like text from an unstructured or malformed later writer: %s', async argumentsText => {
		const fs = files();
		const valid = await saved(fs);
		const current: ReportCompletionTurn = {
			...valid,
			rounds: [...valid.rounds, { id: 'later', response: '', toolInputRetry: 0, toolCalls: [{ id: 'detail', name: ToolName.GetPatentDetails, arguments: '{}' }, { id: 'bad', name: ToolName.WritePatentResults, arguments: argumentsText }] }],
			results: { ...valid.results, bad: new LanguageModelToolResult([new LanguageModelTextPart('Prior-art artifact receipt: malformed')]) },
		};
		expect(await checkPriorArtReportCompletion([], current, fs)).toContain('More patent evidence');
	});

	it('routes an invalidity chart request through the same finalization, and only with coverage', async () => {
		const fs = files();
		const request = 'Build the invalidity case against EP2000000A1 and save "outputs/研究 review.md".';
		const chart = (args: string): ReportCompletionTurn => ({
			message: request,
			rounds: [{ id: 'round', response: '', toolInputRetry: 0, toolCalls: [{ id: '0', name: ToolName.SearchPatents, arguments: '{}' }, { id: '1', name: ToolName.WritePatentResults, arguments: args }] }],
			results: { '1': new LanguageModelToolResult([new LanguageModelTextPart(priorArtReportReceipt(report, 'Evidence-backed interim chart', evidence, 'Snapshot'))]) },
		});
		await fs.writeFile(report, new TextEncoder().encode('Evidence-backed interim chart'));
		await fs.writeFile(evidence, new TextEncoder().encode('Snapshot'));
		const written = await checkPriorArtReportCompletion([], chart('{"template":"invalidity-claim-chart"}'), fs);
		expect({
			recognized: [requestsPriorArtReport(request), requestsPriorArtReport('Write an invalidity report on EP2000000A1'), requestsPriorArtReport('Is this patent still in force?')],
			structured: await checkPriorArtReportCompletion([], chart('{"template":"invalidity-claim-chart","coverage":[{"feature":"Claim 1 — element (a)"}]}'), fs),
			written: [written?.startsWith('The requested invalidity chart has no successful structured finalization in this turn.'), written?.includes('template="invalidity-claim-chart"')],
		}).toEqual({
			recognized: [true, true, false],
			structured: undefined,
			written: [true, true],
		});
	});

	it('does not accept another output path, or an older receipt after new retrieval', async () => {
		const fs = files();
		expect(await checkPriorArtReportCompletion([], await saved(fs, URI.file('/workspace/wrong.md')), fs)).toContain('different path');
		const valid = await saved(fs);
		expect(await checkPriorArtReportCompletion([valid], turn([ToolName.GetPatentDetails]), fs)).toContain('no successful structured finalization');
		const afterSave = { ...valid, rounds: [...valid.rounds, ...turn([ToolName.GetPatentDetails]).rounds] };
		expect(await checkPriorArtReportCompletion([], afterSave, fs)).toContain('More patent evidence');
	});

	describe('one Search Round for fallbacks not covered (invalidity chart)', () => {
		const invalidityRequest = 'Build the invalidity case against EP2000000A1 and save "outputs/研究 review.md".';
		const nudge = 'The saved chart leaves 2 fallbacks not covered (3,a rubber-lined band). Run one Search Round aimed at those limitations (new Discriminating Terms, other office, NPL, web), record it in rounds, and re-save. If the round finds nothing, re-save with the round recorded; \'not covered\' is then final. Do not repeat searches merely to pass validation.';
		/** A turn that saves the chart once, its receipt stating the given Fallback Coverage counts. */
		async function chart(fs: MockFileSystemService, fallbacks: ReceiptFallbacks, request = invalidityRequest, template = 'invalidity-claim-chart'): Promise<ReportCompletionTurn> {
			await fs.writeFile(report, new TextEncoder().encode('Evidence-backed chart'));
			await fs.writeFile(evidence, new TextEncoder().encode('Snapshot'));
			return {
				message: request,
				rounds: [{ id: 'round', response: '', toolInputRetry: 0, toolCalls: [{ id: '0', name: ToolName.SearchPatents, arguments: '{}' }, { id: '1', name: ToolName.WritePatentResults, arguments: JSON.stringify({ template, coverage: [{ feature: 'Claim 1 — element (a)' }] }) }] }],
				results: { '1': new LanguageModelToolResult([new LanguageModelTextPart(priorArtReportReceipt(report, 'Evidence-backed chart', evidence, 'Snapshot', fallbacks))]) },
			};
		}
		const notCovered: ReceiptFallbacks = { fallbacksNotCovered: 2, rounds: 0, notCovered: ['3', 'a rubber-lined\nband'] };

		it('asks for one Search Round when fallbacks are not covered and no round ran', async () => {
			const fs = files();
			expect(await checkPriorArtReportCompletion([], await chart(fs, notCovered), fs)).toBe(nudge);
		});
		it('accepts a chart that records a round, whatever it leaves not covered', async () => {
			const fs = files();
			expect(await checkPriorArtReportCompletion([], await chart(fs, { ...notCovered, rounds: 1 }), fs)).toBeUndefined();
		});
		it('accepts a chart whose fallbacks are all covered', async () => {
			const fs = files();
			expect(await checkPriorArtReportCompletion([], await chart(fs, { fallbacksNotCovered: 0, rounds: 0, notCovered: [] }), fs)).toBeUndefined();
		});
		it('never asks for a round on a prior-art or Find Better report with the same receipt fields', async () => {
			const fs = files();
			expect({
				priorArt: await checkPriorArtReportCompletion([], await chart(fs, notCovered, message, 'prior-art-report'), fs),
				findBetter: await checkPriorArtReportCompletion([], await chart(fs, notCovered, 'Find better art than the examiner for EP2000000A1 and save "outputs/研究 review.md".', 'find-better-report'), fs),
			}).toEqual({ priorArt: undefined, findBetter: undefined });
		});
		it('does not ask again once the nudge fired for the path, in this turn or the next', async () => {
			const fs = files();
			const first = await chart(fs, notCovered);
			// The loop records the nudge on the round that tried to stop; the model then re-saves without a round.
			const nudged: ReportCompletionTurn = { ...first, rounds: [...first.rounds, { id: 'stop', response: '', toolInputRetry: 0, toolCalls: [], hookContext: `You were about to complete but a hook blocked you with the following message: "${nudge}".` }] };
			const resaved = await chart(fs, notCovered, 'Continue');
			const sameTurn: ReportCompletionTurn = { ...nudged, rounds: [...nudged.rounds, ...resaved.rounds.map(round => ({ ...round, id: 'again', toolCalls: round.toolCalls.map(call => ({ ...call, id: 'again-' + call.id })) }))], results: { ...nudged.results, 'again-1': resaved.results['1'] } };
			expect({
				sameTurn: await checkPriorArtReportCompletion([], sameTurn, fs),
				nextTurn: await checkPriorArtReportCompletion([first], resaved, fs),
			}).toEqual({ sameTurn: undefined, nextTurn: undefined });
		});
		it('reads an older receipt without the fallback fields as a plain receipt', async () => {
			const fs = files();
			const older = await chart(fs, notCovered);
			const plain = { ...older, results: { '1': new LanguageModelToolResult([new LanguageModelTextPart(priorArtReportReceipt(report, 'Evidence-backed chart', evidence, 'Snapshot'))]) } };
			expect(await checkPriorArtReportCompletion([], plain, fs)).toBeUndefined();
		});
	});
});
