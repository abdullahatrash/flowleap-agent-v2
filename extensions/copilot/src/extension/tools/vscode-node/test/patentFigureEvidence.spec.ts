/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import type * as vscode from 'vscode';
import { describe, expect, it, vi } from 'vitest';
import { PatentExecutionSnapshot } from '../../../patentai/vscode-node/patentExecutionLedger';
import { PatentCandidateReview, renderCandidateReview, renderWorkingRecord, validateCandidateReview } from '../patentCandidateReview';
import { SecondReadOutcome } from '../../common/patentSecondRead';

vi.mock('vscode', async importOriginal => ({ ...await importOriginal<typeof vscode>(), env: { uriScheme: 'flowleap' } }));

const claim = '1. A quick-release assembly comprising a skewer, a lever and a stem.';
const claimAnchor = 'EP1000000A1:claims:1:en';
const figure = 'EP1000000A1:figure:7';
const reading = 'Figure 7 shows a lobed cam carried on the stem and bearing on the lever.';

/** One search, one text retrieval, the cited drawing page, and a second document retrieved only as drawings. */
const snapshot: PatentExecutionSnapshot = {
	limitation: 'Recorded outcomes only.',
	executions: [
		{ id: 'search', recordedAt: '2026-09-20T01:00:00Z', kind: 'search', status: 'succeeded', query: 'ti=skewer', effectiveQuery: 'ti=skewer', total: 4, returned: 4 },
		{
			id: 'details', recordedAt: '2026-09-20T02:00:00Z', kind: 'details', status: 'succeeded', publicationIds: ['EP1000000A1'], publicationDate: '2001-02-03', publicationTitle: 'Quick release', sources: [
				{ anchor: claimAnchor, reference: { publicationNumber: 'EP1000000A1', section: 'claims', claimNumber: '1' }, language: 'en', text: claim, retrieval: 'returned', review: 'unknown', completeness: 'unknown' },
			],
		},
		{
			id: 'cited-figure', recordedAt: '2026-09-20T03:00:00Z', kind: 'figures', status: 'succeeded', publicationIds: ['EP1000000A1'], sources: [
				{ anchor: figure, reference: { publicationNumber: 'EP1000000A1', section: 'bibliography' }, figure: { page: 7 }, retrieval: 'returned', review: 'unknown', completeness: 'unknown' },
			],
		},
		{
			id: 'drawings-only', recordedAt: '2026-09-20T04:00:00Z', kind: 'figures', status: 'succeeded', publicationIds: ['EP2000000A1'], sources: [3, 4, 5].map(page => (
				{ anchor: `EP2000000A1:figure:${page}`, reference: { publicationNumber: 'EP2000000A1', section: 'bibliography' as const }, figure: { page }, retrieval: 'returned' as const, review: 'unknown' as const, completeness: 'unknown' as const }
			)),
		},
	],
};

const combination = { feature: 'Essential combination', kind: 'combination' as const, importance: 'essential' as const, status: 'unresolved' as const, sourceAnchors: [], gap: 'The combination remains unresolved.' };

/** A row whose cam element rests on the recorded drawing while its first element rests on claim text. */
const mixed = {
	feature: 'Cam-actuated clamping', kind: 'feature' as const, importance: 'essential' as const, status: 'partial' as const,
	sourceAnchors: [claimAnchor, figure], gap: 'The claim recites no cam profile.',
	evidence: [{ anchor: claimAnchor, quote: claim, scope: 'Independent claim 1.', qualifiers: 'Assembly claim only.', quantityBasis: 'No quantity recited.' }],
	elements: [
		{ element: 'a lever', anchor: claimAnchor, disclosedBy: 'a lever and a stem' },
		{ element: 'cam profile carried on the stem', anchor: figure, basis: 'figure' as const, reading },
		{ element: 'stated cam hardness' },
	],
};

const review: PatentCandidateReview = { coverage: [mixed, combination], limitations: ['Bounded candidate review.'], stopReason: 'Requested interim report.' };

const FIGURE_LIMITATION = '- Findings marked "rests on a drawing reading" rest on the model\'s reading of a retrieved figure, not on quoted text; a drawing discloses arrangement, never dimensions unless stated to scale.';

describe('a coverage element that rests on a recorded drawing', () => {
	it('labels the reading as a model reading rather than quoted text and states the limitation once', () => {
		const rendered = renderCandidateReview(review, snapshot, 'review.working-record.md');
		expect({
			errors: validateCandidateReview(review, snapshot),
			status: rendered.split('\n').find(line => line.startsWith('**feature')),
			element: rendered.split('\n').find(line => line.startsWith('| cam profile')),
			text: rendered.split('\n').find(line => line.startsWith('| a lever')),
			limitation: rendered.split('\n').filter(line => line === FIGURE_LIMITATION).length,
		}).toEqual({
			errors: [],
			status: '**feature · essential · partial · rests in part on a drawing reading**',
			element: `| cam profile carried on the stem | Figure page 7 — model reading of the drawing, not quoted text: "${reading}" | [${figure}](flowleap://flowleap.patent-ai/patent?publication=EP1000000A1&section=bibliography) |`,
			text: '| a lever | `a lever and a stem` | [EP1000000A1:claims:1:en](flowleap://flowleap.patent-ai/patent?publication=EP1000000A1&section=claims&claim=1) |',
			limitation: 1,
		});
	});

	it('says a row rests wholly on a drawing reading, and leaves a text-only row unmarked', () => {
		const drawingOnly = { ...mixed, elements: [mixed.elements[1], mixed.elements[2]] };
		const textOnly = { ...mixed, sourceAnchors: [claimAnchor], elements: [mixed.elements[0], mixed.elements[2]] };
		expect({
			drawingOnly: renderCandidateReview({ ...review, coverage: [drawingOnly, combination] }, snapshot, 'record.md').split('\n').find(line => line.startsWith('**feature')),
			textOnly: renderCandidateReview({ ...review, coverage: [textOnly, combination] }, snapshot, 'record.md').split('\n').filter(line => line.startsWith('**feature') || line === FIGURE_LIMITATION),
		}).toEqual({
			drawingOnly: '**feature · essential · partial · rests on a drawing reading**',
			textOnly: ['**feature · essential · partial**'],
		});
	});

	it('inventories a document retrieved only as drawings and counts the figure outcomes in the working record', () => {
		const rendered = renderCandidateReview(review, snapshot, 'review.working-record.md');
		const record = renderWorkingRecord(review, snapshot, 'review.md', 'evidence.json', undefined, undefined);
		expect({
			retrieved: rendered.split('\n').find(line => line.startsWith('| EP2000000A1')),
			uncited: rendered.split('\n').filter(line => line.startsWith('| EP2000000A1')).pop(),
			log: record.split('\n').find(line => line.endsWith('not counts of documents reviewed.')),
		}).toEqual({
			retrieved: '| EP2000000A1 | Unknown | Unknown | unrecorded |',
			uncited: '| EP2000000A1 | Unknown | Unknown | figures (pages 3-5) | unrecorded |',
			log: '1 recorded search outcomes; 1 recorded detail outcomes; 2 recorded figure outcomes. These are tool invocations, not counts of documents reviewed.',
		});
	});

	// The drawing element of `mixed`, re-read as the model wrote it; everything else in the row stands.
	const withReading = (value: string): PatentCandidateReview => ({
		...review,
		coverage: [{ ...mixed, elements: [mixed.elements[0], { ...mixed.elements[1], reading: value }, mixed.elements[2]] }, combination],
	});

	it('reads a reference numeral as prose and still refuses a dimension, a ratio and a proportion', () => {
		const readings = [
			'Figure 3 shows the cam 12 in engagement with the lever 14.',
			'The lever pivots about pin 14 as drawn.',
			'Figure 7 shows a cam lobe 12 mm across.',
			'Figure 7 shows the cam and the stem in a ratio 2:1.',
			'Figure 7 shows a cam lobe approximately 3 times the width of the stem.',
		];
		expect(readings.map(value => [value, validateCandidateReview(withReading(value), snapshot).length === 0])).toEqual([
			['Figure 3 shows the cam 12 in engagement with the lever 14.', true],
			['The lever pivots about pin 14 as drawn.', true],
			['Figure 7 shows a cam lobe 12 mm across.', false],
			['Figure 7 shows the cam and the stem in a ratio 2:1.', false],
			['Figure 7 shows a cam lobe approximately 3 times the width of the stem.', false],
		]);
	});

	it('leaves a figures outcome that returned no drawing out of the retrieved inventory and its uncited count', () => {
		const empty: PatentExecutionSnapshot = {
			...snapshot,
			executions: [...snapshot.executions, { id: 'no-images', recordedAt: '2026-09-20T05:00:00Z', kind: 'figures', status: 'succeeded', publicationIds: ['EP3000000A1'] }],
		};
		const rendered = renderCandidateReview(review, empty, 'review.working-record.md');
		expect({
			listed: rendered.includes('EP3000000A1'),
			count: rendered.split('\n').find(line => line.includes('retrieved documents are not cited')),
		}).toEqual({
			listed: false,
			count: '- 1 of 2 retrieved documents are not cited in any coverage row; their text was available locally and was not reviewed for this report.',
		});
	});

	it('leaves an unresolved row unmarked even when one of its elements rests on a drawing', () => {
		const unresolved = { ...mixed, status: 'unresolved' as const, gap: 'Nothing in the record resolves the cam profile.' };
		expect(renderCandidateReview({ ...review, coverage: [unresolved, combination] }, snapshot, 'record.md').split('\n').filter(line => line.startsWith('**feature')))
			.toEqual(['**feature · essential · unresolved**']);
	});

	it('names the unjudged drawing element under the row it belongs to in the working record', () => {
		const secondRead: SecondReadOutcome = {
			kind: 'judged', model: 'judge-model',
			rows: [{ feature: mixed.feature, status: 'partial', verdicts: [{ element: 'a lever', verdict: 'agree', reason: 'The claim recites a lever.' }] }],
			summary: { elements: 1, agree: 1, disagree: 0, unclear: 0, unparsed: 0, notJudged: 1 },
		};
		const record = renderWorkingRecord(review, snapshot, 'review.md', 'evidence.json', undefined, secondRead).split('\n');
		expect(record.slice(record.indexOf('## Second read'), record.indexOf('## Wording review'))).toEqual([
			'## Second read',
			'Second read by judge-model: 1 elements judged, 0 not confirmed, 0 unclear, 0 unparsed, 1 not judged (figure).',
			'',
			`### ${mixed.feature}`,
			'',
			'Second read (generated, judge-model): the following elements were not confirmed by an independent read of the cited text; the row\'s status is the author\'s judgment.',
			'- cam profile carried on the stem: not judged — rests on a drawing reading',
			'',
			'',
		]);
	});
});
