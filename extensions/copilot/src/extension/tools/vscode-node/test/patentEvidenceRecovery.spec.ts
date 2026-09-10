/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import type * as vscode from 'vscode';
import { describe, expect, it, vi } from 'vitest';
import { PatentExecutionSnapshot } from '../../../patentai/vscode-node/patentExecutionLedger';
import { lookupPatentEvidence } from '../patentEvidenceLookup';
import { PatentCandidateReview, renderCandidateReview, validateCandidateReview } from '../patentCandidateReview';

vi.mock('vscode', async importOriginal => ({ ...await importOriginal<typeof vscode>(), env: { uriScheme: 'flowleap' } }));

// Minimal English regression excerpts, not authoritative translations of the publications.
const claim10 = '10. A dental composition comprising 100 parts by weight monomer, 0.01 to 10 parts by weight initiator and 40 to 400 parts by weight composite filler.';
const claim8 = '8. A composition according to claim 1, wherein the inorganic filler is present in an amount of 1 to 20 wt%.';
const snapshot: PatentExecutionSnapshot = { limitation: 'Returned text only.', executions: [{ id: 'detail', recordedAt: '2026-09-10', kind: 'details', status: 'succeeded', sources: [
	{ anchor: 'WO9951190A1:claims:10:en', reference: { publicationNumber: 'WO9951190A1', section: 'claims', claimNumber: '10' }, language: 'en', text: claim10, retrieval: 'returned', review: 'unknown', completeness: 'unknown' },
	{ anchor: 'EP0983762A1:claims:8:en', reference: { publicationNumber: 'EP0983762A1', section: 'claims', claimNumber: '8' }, language: 'en', text: claim8, retrieval: 'returned', review: 'unknown', completeness: 'unknown' },
	{ anchor: 'WO9951190A1:description:en', reference: { publicationNumber: 'WO9951190A1', section: 'description' }, language: 'en', text: Array.from({ length: 200 }, (_, i) => i === 181 ? '[0057] The powder was passed through a sieve.' : `Description line ${i + 1}.`).join('\n'), retrieval: 'returned', review: 'unknown', completeness: 'unknown' },
] }] };
const combination = { feature: 'Essential combination', kind: 'combination' as const, importance: 'essential' as const, status: 'unresolved' as const, sourceAnchors: [], gap: 'Exact combination remains unresolved.' };
const review: PatentCandidateReview = { coverage: [combination], limitations: ['Bounded candidate review.'], stopReason: 'Requested interim report.' };

describe('prior-art evidence recovery and review contract', () => {
	it('recovers a sieve passage beyond line 100 and pages directly to its source with the same anchor', () => {
		const match = lookupPatentEvidence(snapshot, 'WO9951190A1', { query: 'sieve' });
		const page = lookupPatentEvidence(snapshot, 'WO9951190A1', { anchor: 'WO9951190A1:description:en', start: 180 });
		expect({ index: lookupPatentEvidence(snapshot, 'WO9951190A1', {}).includes('WO9951190A1:claims:10:en'), match: match.includes('[WO9951190A1:description:en; line 182] [0057]'), page: page.includes('[0057] The powder was passed through a sieve.'), missing: lookupPatentEvidence(snapshot, 'WO9951190A1', { query: 'unmatched' }).includes('no match does not establish absence') }).toEqual({ index: true, match: true, page: true, missing: true });
	});
	it.each([
		['WO9951190A1:claims:10:en', claim10, '40 to 400 parts by weight composite filler'],
		['EP0983762A1:claims:8:en', claim8, '1 to 20 wt%'],
	])('rejects a selected range that hides constituents or dependency in %s, and preserves the complete original basis', (anchor, quote, fragment) => {
		const evidence = { anchor, quote, scope: anchor.startsWith('EP') ? 'Dependent Claim 8; Claim 1 does not inherit this restriction.' : 'Claim 10 composition.', qualifiers: 'Exact IDF range not established.', quantityBasis: anchor.startsWith('WO') ? '100 monomer + 0.01–10 initiator + 40–400 filler, all parts by weight; no conversion.' : '1–20 wt% only in the dependent claim.' };
		const row = { feature: 'Loading', kind: 'feature' as const, importance: 'essential' as const, status: 'partial' as const, sourceAnchors: [anchor], gap: 'Range overlap only.', evidence: [evidence] };
		const complete = { ...review, coverage: [row, combination] };
		const incomplete = { ...review, coverage: [{ ...row, evidence: [{ ...evidence, quote: fragment }] }, combination] };
		expect({ rejected: validateCandidateReview(incomplete, snapshot).some(error => error.includes('Quote the complete claim')), errors: validateCandidateReview(complete, snapshot), retains: renderCandidateReview(complete, snapshot, 'evidence.json').includes(quote) }).toEqual({ rejected: true, errors: [], retains: true });
	});
	it('requires an explicit combination and refuses invented quotation text', () => {
		const row = { ...combination, kind: 'feature' as const, sourceAnchors: ['WO9951190A1:claims:10:en'], evidence: [{ anchor: 'WO9951190A1:claims:10:en', quote: 'The filler is 28.5–80 wt%.', scope: 'Claim 10', qualifiers: 'None', quantityBasis: 'Percent of paste' }] };
		const errors = validateCandidateReview({ ...review, coverage: [row] }, snapshot);
		expect({ combination: errors.some(error => error.includes('explicit essential combination')), quote: errors.some(error => error.includes('must match recorded text')) }).toEqual({ combination: true, quote: true });
	});
});
