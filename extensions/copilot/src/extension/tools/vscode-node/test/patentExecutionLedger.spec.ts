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
import { renderWorkingRecord, validateCandidateReview, PatentCandidateReview } from '../patentCandidateReview';

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
	coverage: [{ feature: 'Essential combination', kind: 'combination', importance: 'essential', status: 'unresolved', sourceAnchors: [], gap: 'Combination evidence remains unavailable.' }],
	limitations: ['Claims unavailable for one candidate.'], stopReason: 'User requested an interim candidate review.',
};

describe('durable patent execution audit', () => {
	it('retains nine actual outcomes across reconstruction, including zero/failure, without inventing a tenth skipped query', async () => {
		const { ledger, session, files, context } = setup();
		await Promise.all(Array.from({ length: 9 }, (_, i) => ledger.record(session, { kind: 'search', status: i === 8 ? 'failed' : 'succeeded', query: `sanitized query ${i + 1}`, ...(i === 7 ? { total: 0, returned: 0, publicationIds: [] } : {}) })));
		const snapshot = await new PatentExecutionLedger(context, files).read(session);
		expect({ outcomes: snapshot.executions.length, failed: snapshot.executions.filter(row => row.status === 'failed').length, zero: snapshot.executions.filter(row => row.total === 0).length }).toEqual({ outcomes: 9, failed: 1, zero: 1 });
		expect(renderWorkingRecord(review, snapshot, 'review.md', 'evidence.json', undefined)).toContain('9 recorded search outcomes');
		expect((await ledger.read(URI.parse('vscode-chat-session://two'))).executions).toEqual([]);
	});

	it('discloses unavailable and corrupted storage while preserving readable records', async () => {
		const { ledger, session, files } = setup();
		await ledger.record(session, { kind: 'search', status: 'succeeded', query: 'brake' });
		await ledger.record(session, { kind: 'search', status: 'succeeded', query: 'software' });
		files.mockFile(files.committed[0], JSON.stringify({ id: 'bad', recordedAt: 'now', status: 'succeeded', publicationIds: [] }));
		const snapshot = await ledger.read(session);
		expect(snapshot.executions.map(row => row.query)).toEqual(['software']);
		expect(snapshot.limitation).toContain('unreadable or incomplete');
		expect((await ledger.read(undefined)).limitation).toContain('unavailable');
	});

	it('keeps a recorded outcome whose individual fields are unreadable, and says which are unknown', async () => {
		const { ledger, session, files } = setup();
		await ledger.record(session, { kind: 'search', status: 'succeeded', query: 'brake' });
		files.mockFile(files.committed[0], JSON.stringify({
			id: 'partial', recordedAt: '2026-09-10', kind: 'search', status: 'succeeded', query: 'brake',
			total: null, returned: 4, publicationIds: ['EP1000000A1', { docId: undefined }, 7], range: 'not-a-range',
		}));
		const snapshot = await ledger.read(session);
		expect(snapshot.executions).toEqual([{
			id: 'partial', recordedAt: '2026-09-10', kind: 'search', status: 'succeeded', query: 'brake',
			total: undefined, returned: 4, publicationIds: ['EP1000000A1'], range: undefined,
			requestedRange: undefined, requestedCountries: undefined, effectiveQuery: undefined, countryFilter: undefined,
			totalClaims: undefined, returnedClaims: undefined, publicationTitle: undefined, publicationDate: undefined,
			sources: undefined, unavailableSections: undefined,
			tool: undefined, request: undefined, rowCount: undefined, dataEdition: undefined, resultText: undefined, summary: undefined,
		}]);
		expect(snapshot.limitation).toContain('recovered with unreadable fields dropped');
		expect(snapshot.limitation).not.toContain('unreadable or incomplete');
	});

	it('preserves publication kind, language and claim identity while review remains unknown', async () => {
		const { ledger, session } = setup();
		const reference = { publicationNumber: 'WO2020123456A1', section: 'claims' as const, claimNumber: '1' };
		const source = { text: '1. Recorded claim text.', anchor: evidenceAnchor(reference, 'de'), reference, language: 'de', retrieval: 'returned' as const, review: 'unknown' as const, completeness: 'unknown' as const };
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

	it('rejects invented coverage anchors with a recovery instruction', () => {
		expect(validateCandidateReview({ ...review, coverage: [{ ...review.coverage![0], sourceAnchors: ['invented:claims:6'] }] }, { executions: [], limitation: '' })).toHaveLength(1);
	});

	it('round-trips an analytics outcome with its request, counts, edition and returned text', async () => {
		const { ledger, session } = setup();
		const analytics = {
			kind: 'analytics' as const, status: 'succeeded' as const, tool: 'patstat_query' as const,
			request: 'SELECT office, COUNT(*) FROM flowleap.applications GROUP BY office',
			rowCount: 2, dataEdition: 'PATSTAT 2026 Spring',
			resultText: '| office | c |\n| EP | 4210 |', summary: 'EP leads with 4,210 applications.',
		};
		await ledger.record(session, analytics);
		const snapshot = await ledger.read(session);
		expect(snapshot.executions).toEqual([{
			...analytics, id: snapshot.executions[0].id, recordedAt: snapshot.executions[0].recordedAt,
			query: undefined, requestedRange: undefined, requestedCountries: undefined, effectiveQuery: undefined,
			countryFilter: undefined, total: undefined, returned: undefined, totalClaims: undefined, returnedClaims: undefined,
			range: undefined, publicationTitle: undefined, publicationDate: undefined, publicationIds: undefined,
			sources: undefined, unavailableSections: undefined,
		}]);
	});

	it('keeps an analytics outcome whose rowCount and tool are unreadable, leaving both unknown', async () => {
		const { ledger, session, files } = setup();
		await ledger.record(session, { kind: 'analytics', status: 'succeeded', tool: 'patstat_portfolio', request: '{"applicant":"Kia"}' });
		files.mockFile(files.committed[0], JSON.stringify({
			id: 'partial', recordedAt: '2026-09-13', kind: 'analytics', status: 'succeeded',
			tool: 'patstat_unknown', request: '{"applicant":"Kia"}', rowCount: 'many', dataEdition: 'PATSTAT 2026 Spring',
			resultText: 'Applications: 1200', summary: null,
		}));
		const snapshot = await ledger.read(session);
		expect(snapshot.executions.map(row => ({ kind: row.kind, tool: row.tool, rowCount: row.rowCount, request: row.request, dataEdition: row.dataEdition, resultText: row.resultText })))
			.toEqual([{ kind: 'analytics', tool: undefined, rowCount: undefined, request: '{"applicant":"Kia"}', dataEdition: 'PATSTAT 2026 Spring', resultText: 'Applications: 1200' }]);
		expect(snapshot.limitation).toContain('recovered with unreadable fields dropped');
	});

	it('caps a recorded request and result text so one oversized outcome cannot swamp the audit', async () => {
		const { ledger, session } = setup();
		await ledger.record(session, { kind: 'analytics', status: 'succeeded', tool: 'patstat_graph', request: 'x'.repeat(3000), resultText: 'y'.repeat(130000) });
		const [recorded] = (await ledger.read(session)).executions;
		expect({ request: recorded.request?.length, result: recorded.resultText?.length, marked: recorded.resultText?.endsWith('… [truncated for the audit record]') })
			.toEqual({ request: 2000 + 35, result: 120000 + 35, marked: true });
	});

	it('round-trips a legal-status outcome and keeps one whose tool is unreadable, leaving it unknown', async () => {
		const { ledger, session, files } = setup();
		const status = {
			kind: 'status' as const, status: 'succeeded' as const, tool: 'get_legal_status' as const,
			request: 'EP1000000A1', rowCount: 2, publicationIds: ['EP1000000A1'],
			resultText: '| 2024-01-10 | FR | MM4A | LAPSE |',
		};
		await ledger.record(session, status);
		await ledger.record(session, { kind: 'status', status: 'succeeded', tool: 'get_patent_term', request: 'EP2000000' });
		files.mockFile(files.committed[1], JSON.stringify({
			id: 'partial', recordedAt: '2999-01-01T00:00:00.000Z', kind: 'status', status: 'succeeded',
			tool: 'get_unknown_status', request: 'EP2000000', rowCount: 1, resultText: 'Base expiry 2028-04-16',
		}));
		const snapshot = await ledger.read(session);
		expect(snapshot.executions.map(row => ({ kind: row.kind, tool: row.tool, request: row.request, rowCount: row.rowCount, publicationIds: row.publicationIds, resultText: row.resultText }))).toEqual([
			{ kind: 'status', tool: 'get_legal_status', request: 'EP1000000A1', rowCount: 2, publicationIds: ['EP1000000A1'], resultText: '| 2024-01-10 | FR | MM4A | LAPSE |' },
			{ kind: 'status', tool: undefined, request: 'EP2000000', rowCount: 1, publicationIds: undefined, resultText: 'Base expiry 2028-04-16' },
		]);
	});
});
