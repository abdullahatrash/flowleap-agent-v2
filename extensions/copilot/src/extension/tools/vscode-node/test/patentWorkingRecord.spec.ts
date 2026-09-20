/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import type * as vscode from 'vscode';
import { describe, expect, it, vi } from 'vitest';
import { PatentExecutionSnapshot } from '../../../patentai/vscode-node/patentExecutionLedger';
import { PatentCandidateReview, renderCandidateReview, renderWorkingRecord } from '../patentCandidateReview';
import { SecondReadOutcome } from '../../common/patentSecondRead';

vi.mock('vscode', async importOriginal => ({ ...await importOriginal<typeof vscode>(), env: { uriScheme: 'flowleap' } }));

const claim = '1. A dental composition comprising 100 parts monomer and 40 parts composite filler.';
const anchor = 'WO9951190A1:claims:1:en';

/**
 * Two searches that succeeded, one that failed and was retried under the same query (and then
 * succeeded), and one that was cancelled and never retried — covering both non-succeeded statuses.
 */
const snapshot: PatentExecutionSnapshot = {
	limitation: 'Recorded outcomes only.',
	executions: [
		{ id: 'one', recordedAt: '2026-09-18T01:00:00Z', kind: 'search', status: 'succeeded', query: 'ta=dental', effectiveQuery: 'ta=dental', purpose: 'F1 dental composition base', countryFilter: ['EP', 'WO'], total: 33, returned: 10, range: { begin: 1, end: 10 } },
		{ id: 'two', recordedAt: '2026-09-18T01:10:00Z', kind: 'search', status: 'cancelled', query: 'ic=A61K6 and ab="classifying"', requestedRange: '1-25' },
		{ id: 'three', recordedAt: '2026-09-18T01:20:00Z', kind: 'search', status: 'failed', query: 'ta=filler', requestedRange: '1-25' },
		{ id: 'four', recordedAt: '2026-09-18T01:30:00Z', kind: 'search', status: 'succeeded', query: 'ta=filler', effectiveQuery: 'ta=filler', total: 4, returned: 4, range: { begin: 1, end: 4 } },
		{
			id: 'five', recordedAt: '2026-09-18T02:00:00Z', kind: 'details', status: 'succeeded', publicationIds: ['WO9951190A1'], publicationDate: '1999-10-14', publicationTitle: 'Dental composition', sources: [
				{ anchor, reference: { publicationNumber: 'WO9951190A1', section: 'claims', claimNumber: '1' }, language: 'en', text: claim, retrieval: 'returned', review: 'unknown', completeness: 'unknown' },
			],
		},
		{
			id: 'six', recordedAt: '2026-09-18T02:10:00Z', kind: 'details', status: 'succeeded', publicationIds: ['EP0983762A1'], publicationDate: '1999-03-08', publicationTitle: 'Uncited filler', sources: [
				{ anchor: 'EP0983762A1:claims:1:en', reference: { publicationNumber: 'EP0983762A1', section: 'claims', claimNumber: '1' }, language: 'en', text: '1. A filler.', retrieval: 'returned', review: 'unknown', completeness: 'unknown' },
			],
		},
	],
};

const review: PatentCandidateReview = {
	subject: 'Dental filler compositions',
	coverage: [{
		feature: 'Essential combination', kind: 'combination', importance: 'essential', status: 'partial',
		sourceAnchors: [anchor],
		evidence: [{ anchor, quote: claim, scope: 'Independent claim 1 as quoted.', qualifiers: 'Parts by weight as recited.', quantityBasis: 'Original parts retained.' }],
		elements: [{ element: 'composite filler', anchor, disclosedBy: 'composite filler' }, { element: 'a photoinitiator' }],
		gap: 'No cited passage recites a photoinitiator.',
	}],
	limitations: ['Bounded candidate review.'],
	stopReason: 'Requested interim report.',
};

const secondRead: SecondReadOutcome = {
	kind: 'judged', model: 'judge-model',
	rows: [{ feature: 'Essential combination', status: 'partial', verdicts: [{ element: 'composite filler', verdict: 'agree', reason: 'The claim recites a composite filler.' }, { element: 'a photoinitiator', verdict: 'disagree', reason: 'The quoted claim recites no initiator.' }] }],
	summary: { elements: 2, agree: 1, disagree: 1, unclear: 0, unparsed: 0 },
};

/** The client report, split into its second-level sections keyed by heading. */
function sections(rendered: string): Record<string, string[]> {
	const found: Record<string, string[]> = {};
	let current = '';
	for (const line of rendered.split('\n')) {
		if (line.startsWith('## ')) { current = line.slice(3); found[current] = []; continue; }
		if (current) { found[current].push(line); }
	}
	return found;
}

describe('the client report and its working record', () => {
	it('presents only the searches that ran, and names the queries that never ran in limitations', () => {
		const rendered = sections(renderCandidateReview(review, snapshot, 'review.working-record.md'));
		expect({ searchSets: rendered['Search sets'], limitations: rendered['Limitations'] }).toEqual({
			searchSets: [
				'| Source | Query | Scope | Hits | Tests |',
				'| --- | --- | --- | --- | --- |',
				'| search_patents | ta=dental | EP, WO | 33 | F1 dental composition base |',
				'| search_patents | ta=filler | not filtered | 4 | — |',
				'',
				'2 search sets run; 2 documents retrieved.',
				'',
			],
			limitations: [
				'- Bounded candidate review.',
				'',
				'Generated from the execution record, not supplied by the model:',
				'- 1 of 2 retrieved documents are not cited in any coverage row; their text was available locally and was not reviewed for this report.',
				'- No description passage is cited; every finding rests on claim text only. Descriptions were retrieved for: none.',
				'- Search set 1 returned 10 of 33 matches; the remaining 23 were not retrieved.',
				'- 1 search(es) could not be run and were not retried: ic=A61K6 and ab="classifying". Coverage those queries would have tested is missing from this report.',
				// The one classification query was cancelled, so no class was actually searched.
				'- No classification-code (CPC/IPC) query was recorded; the search relied on keywords only.',
				'',
				'Working record: [review.working-record.md](review.working-record.md) — full search log including queries that could not run, retrieved-but-unread list, wording review, provenance and second read.',
			],
		});
	});

	it('numbers the tail sentence over the search-sets table, not over every recorded attempt', () => {
		// A failed search precedes the one succeeded search with a tail. The table lists only the
		// succeeded search, as its sole row; the sentence must name that row "Search set 1", not
		// "Search set 2" from counting the failed attempt that never reaches the table.
		const failedThenTail: PatentExecutionSnapshot = {
			limitation: 'Recorded outcomes only.',
			executions: [
				{ id: 'failed', recordedAt: '2026-09-19T01:00:00Z', kind: 'search', status: 'failed', query: 'ta=dental' },
				{ id: 'succeeded', recordedAt: '2026-09-19T01:10:00Z', kind: 'search', status: 'succeeded', query: 'ta=filler', effectiveQuery: 'ta=filler', total: 12, returned: 5 },
			],
		};
		const rendered = sections(renderCandidateReview(review, failedThenTail, 'review.working-record.md'));
		expect({ searchSets: rendered['Search sets'], tail: rendered['Limitations']?.find(line => line.includes('returned')) }).toEqual({
			searchSets: ['| Source | Query | Scope | Hits | Tests |', '| --- | --- | --- | --- | --- |', '| search_patents | ta=filler | not filtered | 12 | — |', '', '1 search sets run; 0 documents retrieved.', ''],
			tail: '- Search set 1 returned 5 of 12 matches; the remaining 7 were not retrieved.',
		});
	});

	it('names a failed search by the feature it tested, and falls back to the raw query without one', () => {
		// Two searches that ran and two that never did, each pair with and without a stated purpose.
		const named: PatentExecutionSnapshot = {
			limitation: 'Recorded outcomes only.',
			executions: [
				{ id: 'ran', recordedAt: '2026-09-19T01:00:00Z', kind: 'search', status: 'succeeded', query: 'ab="dental" and ab="filler"', effectiveQuery: 'ab="dental" and ab="filler"', purpose: 'F1 dental filler base', total: 6, returned: 6 },
				{ id: 'plain', recordedAt: '2026-09-19T01:10:00Z', kind: 'search', status: 'succeeded', query: 'ab="dental" and ab="monomer"', effectiveQuery: 'ab="dental" and ab="monomer"', total: 3, returned: 3 },
				{ id: 'named', recordedAt: '2026-09-19T01:20:00Z', kind: 'search', status: 'failed', query: 'ab="dental" and ab="fine fraction"', purpose: 'F4 fine-fraction cap' },
				{ id: 'unnamed', recordedAt: '2026-09-19T01:30:00Z', kind: 'search', status: 'failed', query: 'ab="dental" and ab="composite granules"' },
			],
		};
		const report = sections(renderCandidateReview(review, named, 'review.working-record.md'));
		const record = sections(renderWorkingRecord(review, named, 'review.md', 'evidence.json', undefined, undefined));
		expect({ searchSets: report['Search sets'], unrun: report['Limitations']?.find(line => line.includes('could not be run')), searchLog: record['Search log'] }).toEqual({
			searchSets: [
				'| Source | Query | Scope | Hits | Tests |',
				'| --- | --- | --- | --- | --- |',
				'| search_patents | ab="dental" and ab="filler" | not filtered | 6 | F1 dental filler base |',
				'| search_patents | ab="dental" and ab="monomer" | not filtered | 3 | — |',
				'',
				'2 search sets run; 0 documents retrieved.',
				'',
			],
			unrun: '- 2 search(es) could not be run and were not retried: F4 fine-fraction cap (ab="dental" and ab="fine fraction"); ab="dental" and ab="composite granules". Coverage those queries would have tested is missing from this report.',
			searchLog: [
				'4 recorded search outcomes; 0 recorded detail outcomes. These are tool invocations, not counts of documents reviewed.',
				'| Outcome | Query actually sent (requested if unknown) | Countries | Total | Returned | Range | Purpose |',
				'| --- | --- | --- | --- | --- | --- | --- |',
				'| succeeded | ab="dental" and ab="filler" | unknown | 6 | 6 | unknown | F1 dental filler base |',
				'| succeeded | ab="dental" and ab="monomer" | unknown | 3 | 3 | unknown | — |',
				'| failed | ab="dental" and ab="fine fraction" (effective query unknown) | unknown | unknown | unknown | unknown | F4 fine-fraction cap |',
				'| failed | ab="dental" and ab="composite granules" (effective query unknown) | unknown | unknown | unknown | unknown | — |',
				'',
			],
		});
	});

	it('renders the concept and classification tables only when they are supplied', () => {
		const supplied = { ...review, concepts: [{ concept: 'dental filler', synonyms: ['composite filler', 'inorganic filler'] }], classifications: [{ code: 'A61K 6/00', meaning: 'Dental preparations' }] };
		const rendered = sections(renderCandidateReview(supplied, snapshot, 'review.working-record.md'));
		expect({
			concepts: rendered['Concepts searched'],
			classifications: rendered['Classifications searched'],
			withoutThem: Object.keys(sections(renderCandidateReview(review, snapshot, 'review.working-record.md'))).slice(0, 2),
		}).toEqual({
			concepts: ['| Concept | Synonyms and variations |', '| --- | --- |', '| dental filler | composite filler, inorganic filler |', ''],
			classifications: ['| Code | Meaning |', '| --- | --- |', '| A61K 6/00 | Dental preparations |', ''],
			withoutThem: ['Search sets', 'Retrieved documents'],
		});
	});

	it('keeps every internal section out of the client report', () => {
		const rendered = renderCandidateReview(review, snapshot, 'review.working-record.md');
		expect({
			headings: rendered.split('\n').filter(line => line.startsWith('## ')),
			secondRead: rendered.includes('Second read'),
			provenance: rendered.includes('Anchor identity'),
			audit: rendered.includes('recorded search outcomes'),
		}).toEqual({
			headings: ['## Search sets', '## Retrieved documents', '## Coverage and remaining search tracks', '## Retrieved but not cited in coverage', '## Search stopping rationale', '## Limitations'],
			secondRead: false,
			provenance: false,
			audit: false,
		});
	});

	it('carries the full log, the unread list, the second read, the wording review and the provenance', () => {
		const flagged = { ...review, stopReason: 'The reference teaches away from the combination.' };
		const record = renderWorkingRecord(flagged, snapshot, 'review.md', 'review.md.evidence.json', 'review.md.second-read.json', secondRead);
		expect(record.split('\n')).toEqual([
			'# Working record — Dental filler compositions',
			'',
			'Companion to [review.md](review.md) — internal search log for a later session picking up the same matter. Not part of the client deliverable.',
			'',
			'## Search log',
			'4 recorded search outcomes; 2 recorded detail outcomes. These are tool invocations, not counts of documents reviewed.',
			'| Outcome | Query actually sent (requested if unknown) | Countries | Total | Returned | Range | Purpose |',
			'| --- | --- | --- | --- | --- | --- | --- |',
			'| succeeded | ta=dental | EP, WO | 33 | 10 | 1-10 | F1 dental composition base |',
			'| cancelled | ic=A61K6 and ab="classifying" (effective query unknown) | unknown | unknown | unknown | 1-25 (requested) | — |',
			'| failed | ta=filler (effective query unknown) | unknown | unknown | unknown | 1-25 (requested) | — |',
			'| succeeded | ta=filler | unknown | 4 | 4 | 1-4 | — |',
			'',
			'## Retrieved but not read',
			'| Publication | Publication date | Title | Sections with text | Text language |',
			'| --- | --- | --- | --- | --- |',
			'| EP0983762A1 | 1999-03-08 | Uncited filler | claims | en |',
			'',
			'## Second read',
			'Second read by judge-model: 2 elements judged, 1 not confirmed, 0 unclear, 0 unparsed.',
			'',
			'### Essential combination',
			'',
			'Second read (generated, judge-model): the following elements were not confirmed by an independent read of the cited text; the row\'s status is the author\'s judgment.',
			'- a photoinitiator: disagree — The quoted claim recites no initiator.',
			'',
			'[Second-read verdicts](review.md.second-read.json)',
			'',
			'## Wording review',
			'The following phrases read as legal conclusions; a candidate review states what each passage discloses and leaves novelty, anticipation, obviousness and teaching-away to counsel. Reword or confirm:',
			'- "teaches away" in stopReason',
			'',
			'## Provenance',
			'Recorded outcomes only.',
			'',
			'Anchor identity, quotation identity and required fields were checked mechanically. Source review notes are model judgments, not verified facts. Semantic entailment, completeness of invention features, and correctness of conclusions were not automatically verified.',
			'',
			'[Detailed execution and source metadata](review.md.evidence.json)',
			'',
		]);
	});

	it('states a second read that did not run', () => {
		const record = renderWorkingRecord(review, snapshot, 'review.md', 'evidence.json', undefined, undefined);
		expect(record.split('\n').slice(record.split('\n').indexOf('## Second read'), record.split('\n').indexOf('## Wording review'))).toEqual(['## Second read', 'Second read: not run.', '']);
	});
});
