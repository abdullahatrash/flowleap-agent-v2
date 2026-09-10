/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { describe, expect, it } from 'vitest';
import type * as vscode from 'vscode';
import { MockFileSystemService } from '../../../../platform/filesystem/node/test/mockFileSystemService';
import { mock } from '../../../../util/common/test/simpleMock';
import { URI } from '../../../../util/vs/base/common/uri';
import { evidenceAnchor, PatentExecutionLedger } from '../../../patentai/vscode-node/patentExecutionLedger';
import { renderCandidateReview, validateCandidateReview, PatentCandidateReview } from '../patentCandidateReview';

class LedgerFiles extends MockFileSystemService {
	readonly committed: URI[] = [];
	override async rename(from: URI, to: URI): Promise<void> {
		const bytes = await this.readFile(from);
		await this.delete(from);
		await this.writeFile(to, bytes);
		this.committed.push(to);
	}
}
function setup() {
	const files = new LedgerFiles();
	const context = new class extends mock<vscode.ExtensionContext>() { override storageUri = URI.file('/storage'); }();
	return { files, context, ledger: new PatentExecutionLedger(context, files), session: URI.parse('vscode-chat-session://one') };
}

const review: PatentCandidateReview = {
	coverage: [{ feature: 'Essential combination', importance: 'essential', status: 'unresolved', sourceAnchors: [], gap: 'Combination evidence remains unavailable.' }],
	limitations: ['Claims unavailable for one candidate.'], stopReason: 'User requested an interim candidate review.',
	semanticReview: { observations: ['No complete-combination or absence conclusion is supported by the available sources.'], unresolvedConcerns: ['Dependency chain remains unresolved.'] },
};

describe('durable patent execution audit', () => {
	it('retains nine actual outcomes across reconstruction, including zero/failure, without inventing a tenth skipped query', async () => {
		const { ledger, session, files, context } = setup();
		await Promise.all(Array.from({ length: 9 }, (_, i) => ledger.record(session, { kind: 'search', status: i === 8 ? 'failed' : 'succeeded', query: `sanitized query ${i + 1}`, ...(i === 7 ? { total: 0, returned: 0, publicationIds: [] } : {}) })));
		const snapshot = await new PatentExecutionLedger(context, files).read(session);
		expect({ outcomes: snapshot.executions.length, failed: snapshot.executions.filter(row => row.status === 'failed').length, zero: snapshot.executions.filter(row => row.total === 0).length }).toEqual({ outcomes: 9, failed: 1, zero: 1 });
		expect(renderCandidateReview(review, snapshot, 'evidence.json')).toContain('9 recorded search outcomes');
		expect((await ledger.read(URI.parse('vscode-chat-session://two'))).executions).toEqual([]);
	});

	it('discloses unavailable and corrupted storage while preserving readable records', async () => {
		const { ledger, session, files } = setup();
		await ledger.record(session, { kind: 'search', status: 'succeeded', query: 'brake' });
		await ledger.record(session, { kind: 'search', status: 'succeeded', query: 'software' });
		files.mockFile(files.committed[0], JSON.stringify({ id: 'bad', recordedAt: 'now', kind: 'search', status: 'succeeded', publicationIds: 'not-an-array' }));
		const snapshot = await ledger.read(session);
		expect(snapshot.executions.map(row => row.query)).toEqual(['software']);
		expect(snapshot.limitation).toContain('unreadable or incomplete');
		expect((await ledger.read(undefined)).limitation).toContain('unavailable');
	});

	it('preserves publication kind, language and claim identity while review remains unknown', async () => {
		const { ledger, session } = setup();
		const reference = { publicationNumber: 'WO2020123456A1', section: 'claims' as const, claimNumber: '1' };
		const source = { anchor: evidenceAnchor(reference, 'de'), reference, language: 'de', retrieval: 'returned' as const, review: 'unknown' as const, completeness: 'unknown' as const };
		await ledger.record(session, { kind: 'details', status: 'succeeded', sources: [source], unavailableSections: ['description'] });
		const snapshot = await ledger.read(session);
		expect(snapshot.executions[0].sources).toEqual([source]);
		expect(validateCandidateReview(review, snapshot, '[Claim 6](flowleap://flowleap.patent-ai/patent?publication=WO2020123456A1&section=claims&claim=6)')).toHaveLength(1);
		expect(validateCandidateReview(review, snapshot, '[Claim 1](flowleap://flowleap.patent-ai/patent?publication=WO2020123456A1&section=claims&claim=1)')).toEqual([]);
	});

	it.each(['Mechanical interlock and release combination', 'Software scheduling and fault recovery combination', 'Dental filler size and composition combination'])('allows honest unresolved interim coverage for %s without a rubber-stamp completion claim', feature => {
		const draft = { ...review, coverage: [{ ...review.coverage![0], feature }] };
		expect(validateCandidateReview(draft, { executions: [], limitation: 'Audit unavailable.' })).toEqual([]);
		expect(validateCandidateReview({ ...draft, coverage: [{ ...draft.coverage[0], status: 'supported' }] }, { executions: [], limitation: '' })).toContain(`Coverage for "${feature}" needs known source anchors or unresolved status.`);
	});

	it('rejects invented coverage anchors and missing semantic review while allowing declared concerns', () => {
		expect(validateCandidateReview({ ...review, semanticReview: undefined, coverage: [{ ...review.coverage![0], sourceAnchors: ['invented:claims:6'] }] }, { executions: [], limitation: '' })).toHaveLength(2);
	});
});
