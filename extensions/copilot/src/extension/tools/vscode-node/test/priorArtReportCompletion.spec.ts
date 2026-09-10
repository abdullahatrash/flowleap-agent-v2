/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { MockFileSystemService } from '../../../../platform/filesystem/node/test/mockFileSystemService';
import { URI } from '../../../../util/vs/base/common/uri';
import { LanguageModelTextPart, LanguageModelToolResult } from '../../../../vscodeTypes';
import { ToolName } from '../../common/toolNames';
import { checkPriorArtReportCompletion, priorArtReportReceipt, ReportCompletionTurn, requestsPriorArtReport } from '../../node/priorArtReportCompletion';

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

	it('does not accept another output path, or an older receipt after new retrieval', async () => {
		const fs = files();
		expect(await checkPriorArtReportCompletion([], await saved(fs, URI.file('/workspace/wrong.md')), fs)).toContain('different path');
		const valid = await saved(fs);
		expect(await checkPriorArtReportCompletion([valid], turn([ToolName.GetPatentDetails]), fs)).toContain('no successful structured finalization');
		const afterSave = { ...valid, rounds: [...valid.rounds, ...turn([ToolName.GetPatentDetails]).rounds] };
		expect(await checkPriorArtReportCompletion([], afterSave, fs)).toContain('More patent evidence');
	});
});
