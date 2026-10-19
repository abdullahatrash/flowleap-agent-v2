/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import type * as vscode from 'vscode';
import { describe, expect, it, vi } from 'vitest';
import { URI } from '../../../../util/vs/base/common/uri';
import { PatentEvidenceSource, PatentExecution, PatentExecutionSnapshot } from '../../../patentai/vscode-node/patentExecutionLedger';
import { priorArtReportReceipt } from '../../node/priorArtReportCompletion';
import { chartOpenPoints, PatentCandidateReview, renderCandidateReview, validateCandidateReview } from '../patentCandidateReview';
import { roundAnswerErrors } from '../patentFallbackLadder';

vi.mock('vscode', async importOriginal => ({ ...await importOriginal<typeof vscode>(), env: { uriScheme: 'flowleap' } }));

/**
 * The EP1809422 and Cuozzo shape (#750): the tools hold the bibliography of a cited document but
 * none of its text, and its Google Patents page was fetched. The page text is recorded under the
 * publication anchor as web text; the writer checks a quotation against it as against official
 * text, labels the row, counts it as covered, and lists one open point for the document.
 */
const challenged = 'EP3000001B1';
const gb = 'GB2155808A';
const wo = 'WO2000000A1';
const googlePage = `https://patents.google.com/patent/${gb}/en`;
const woClaim = `${wo}:claims:1:en`;
const webAnchor = `${gb}:description`;
const webText = 'The two drums rotate in the same direction.\nA frame carries the drums.';

function claimSource(publication: string, claimNumber: string, text: string): PatentEvidenceSource {
	return { anchor: `${publication}:claims:${claimNumber}:en`, text, reference: { publicationNumber: publication, section: 'claims', claimNumber }, language: 'en', retrieval: 'returned', review: 'unknown', completeness: 'unknown' };
}

const webSource: PatentEvidenceSource = { anchor: webAnchor, reference: { publicationNumber: gb, section: 'description' }, text: webText, textSource: 'web', url: googlePage, retrieval: 'returned', review: 'unknown', completeness: 'unknown' };

const executions: PatentExecution[] = [
	{ id: 'search', recordedAt: '2026-10-19T00:00:00Z', kind: 'search', status: 'succeeded', query: 'ti=drum', effectiveQuery: 'ti=drum', countryFilter: ['EP', 'GB', 'WO'], total: 3, returned: 3 },
	{ id: 'challenged', recordedAt: '2026-10-19T01:00:00Z', kind: 'details', status: 'succeeded', publicationIds: [challenged], publicationDate: '2008-01-01', publicationTitle: 'Feed arrangement', sources: [claimSource(challenged, '1', '1. A feed arrangement comprising two drums and a frame.'), claimSource(challenged, '2', '2. The arrangement according to claim 1, wherein the drums rotate in the same direction.')] },
	{ id: 'wo', recordedAt: '2026-10-19T02:00:00Z', kind: 'details', status: 'succeeded', publicationIds: [wo], publicationDate: '2000-06-01', publicationTitle: 'Harvester feed', sources: [claimSource(wo, '1', '1. A feed arrangement comprising two drums and a frame.')] },
	// The tools hold the bibliography of GB2155808A and no text: the abstract is on the bibliography anchor only.
	{ id: 'gb-biblio', recordedAt: '2026-10-19T03:00:00Z', kind: 'details', status: 'succeeded', publicationIds: [gb], publicationDate: '1985-09-25', publicationTitle: 'Feed drum arrangement', unavailableSections: ['claims', 'description'], sources: [{ anchor: `${gb}:bibliography`, reference: { publicationNumber: gb, section: 'bibliography' }, text: 'A feed drum arrangement.', retrieval: 'returned', review: 'unknown', completeness: 'unknown' }] },
	{ id: 'gb-web', recordedAt: '2026-10-19T04:00:00Z', kind: 'details', status: 'succeeded', publicationIds: [gb], sources: [webSource] },
];

function snapshotOf(...more: PatentExecution[]): PatentExecutionSnapshot {
	return { executions: [...executions, ...more], limitation: 'Synthetic fixture; no live search.' };
}

const snapshot = snapshotOf();
const woEvidence = { anchor: woClaim, quote: '1. A feed arrangement comprising two drums and a frame.', scope: 'Independent claim 1.', qualifiers: 'None.', quantityBasis: 'None.' };
const rung = {
	feature: 'Claim 2 (depends on 1) — added limitation: the drums rotate in the same direction', claimNumber: '2', fallbackOf: '1', kind: 'fallback' as const, importance: 'essential' as const, status: 'supported' as 'supported' | 'partial' | 'unresolved',
	sourceAnchors: [webAnchor],
	evidence: [{ anchor: webAnchor, quote: 'The two drums rotate in the same direction.', scope: 'Description passage.', qualifiers: 'None.', quantityBasis: 'None.' }],
	elements: [{ element: 'drums rotate in the same direction', anchor: webAnchor, disclosedBy: 'rotate in the same direction' }],
	gap: '',
};
const review: PatentCandidateReview = {
	challengedPublication: challenged,
	criticalDate: '2005-01-01',
	coverage: [
		{ feature: 'Claim 1 — element (a): two drums and a frame', claimNumber: '1', kind: 'feature', importance: 'essential', status: 'supported', sourceAnchors: [woClaim], evidence: [woEvidence], elements: [{ element: 'two drums and a frame', anchor: woClaim, disclosedBy: 'two drums and a frame' }], gap: '' },
		{ feature: 'Claim 1 as a whole', claimNumber: '1', kind: 'combination', importance: 'essential', status: 'supported', sourceAnchors: [woClaim], evidence: [woEvidence], elements: [{ element: 'two drums and a frame', anchor: woClaim, disclosedBy: 'two drums and a frame' }], gap: '' },
		rung,
	],
	limitations: ['Synthetic fixture.'],
	stopReason: 'Every rung charted.',
};

const withRung = (value: typeof rung): PatentCandidateReview => ({ ...review, coverage: [review.coverage![0], review.coverage![1], value] });
const LABEL = 'Source: web page (patents.google.com), not official full text. Confirm against the original before use.';

describe('web page text as validated evidence (#750)', () => {
	it('validates the fragment and the quote against the web text, counts the rung as covered, labels the row, states the limitation, and lists the open point in the receipt', () => {
		const rendered = renderCandidateReview(review, snapshot, 'chart.working-record.md', 'invalidity').split('\n');
		const points = chartOpenPoints(review, snapshot);
		const receipt = priorArtReportReceipt(URI.file('/w/chart.md'), 'chart', URI.file('/w/chart.evidence.json'), 'evidence', { fallbacksNotCovered: 0, rounds: 0, notCovered: [], openPoints: points, criticalDate: '2005-01-01' }).split('\n');
		expect({
			errors: validateCandidateReview(review, snapshot, '', 'invalidity'),
			coverageLine: rendered.find(line => line.startsWith('Claim 1: ')),
			label: rendered.filter(line => line.startsWith('Source: web page')),
			labelUnderRung: rendered.indexOf(LABEL) > rendered.findIndex(line => line.startsWith('### Claim 2 (1 → 2)')),
			limitation: rendered.find(line => line.includes('rest') && line.includes('web page text')),
			retrieved: rendered.find(line => line.startsWith(`| ${gb}`)),
			points,
			receipt: receipt.slice(-2),
		}).toEqual({
			errors: [],
			coverageLine: 'Claim 1: 1 of 1 elements disclosed; fallbacks: 1 of 1 covered (0 partly); not covered: none.',
			label: [LABEL],
			labelUnderRung: true,
			limitation: '- 1 row rests on web page text, not official full text: GB2155808A. Confirm each against the official full text or a certified copy before use.',
			retrieved: '| GB2155808A | 1985-09-25 | Feed drum arrangement | unrecorded | web (patents.google.com) | in scope |',
			points: [{ id: 'source-GB2155808A', text: 'Row(s) 2 rest on web page text of GB2155808A (patents.google.com), not official full text' }],
			receipt: [
				'Open points: 1. Critical date: 2005-01-01. Write the Round Report now: this receipt, then one numbered question per open point in this order, each with its id and your recommended next step, then the line "Reply with the ids to run (for example rung-3, element-1.3), \'all\', or your own steer." Then end the turn; run a Search Round only on the expert\'s answer.',
				'Open point [source-GB2155808A]: Row(s) 2 rest on web page text of GB2155808A (patents.google.com), not official full text',
			],
		});
	});

	it('refuses a fragment or a quote that is not in the web text, exactly as for official text, and an unresolved row rests on nothing', () => {
		const wrongFragment = withRung({ ...rung, elements: [{ ...rung.elements[0], disclosedBy: 'rotate in opposite directions' }] });
		const wrongQuote = withRung({ ...rung, evidence: [{ ...rung.evidence[0], quote: 'The drums counter-rotate.' }] });
		const unresolved = withRung({ ...rung, status: 'unresolved', gap: 'Not found.' });
		const rendered = renderCandidateReview(unresolved, snapshot, 'chart.working-record.md', 'invalidity');
		expect({
			fragment: validateCandidateReview(wrongFragment, snapshot, '', 'invalidity'),
			quote: validateCandidateReview(wrongQuote, snapshot, '', 'invalidity'),
			unresolved: { label: rendered.includes('Source: web page'), limitation: rendered.includes('web page text, not official'), points: chartOpenPoints(unresolved, snapshot).map(point => point.id) },
		}).toEqual({
			fragment: ['disclosedBy "rotate in opposite directions" for element "drums rotate in the same direction" is not found in the recorded text of GB2155808A:description; copy a literal fragment from evidenceLookup output.'],
			quote: ['Quotation for GB2155808A:description is not found in its recorded text. Copy the passage verbatim from evidenceLookup.anchor output; do not paraphrase or merge lines.'],
			unresolved: { label: false, limitation: false, points: ['rung-2'] },
		});
	});

	it('lets official text win: the same anchor keeps the official text, and a web anchor beside an official section is refused with the official anchor', () => {
		const officialSame: PatentEvidenceSource = { ...webSource, text: 'The drums counter-rotate.', textSource: undefined, url: undefined };
		const sameAnchor = snapshotOf({ id: 'gb-official', recordedAt: '2026-10-19T03:30:00Z', kind: 'details', status: 'succeeded', publicationIds: [gb], sources: [officialSame] });
		const officialRung = withRung({ ...rung, evidence: [{ ...rung.evidence[0], quote: 'The drums counter-rotate.' }], elements: [{ ...rung.elements[0], disclosedBy: 'counter-rotate' }] });
		const officialOther: PatentEvidenceSource = { ...officialSame, anchor: `${gb}:description:en`, language: 'en' };
		const otherAnchor = snapshotOf({ id: 'gb-official-en', recordedAt: '2026-10-19T03:30:00Z', kind: 'details', status: 'succeeded', publicationIds: [gb], sources: [officialOther] });
		expect({
			webQuoteLoses: validateCandidateReview(review, sameAnchor, '', 'invalidity'),
			officialQuoteWins: validateCandidateReview(officialRung, sameAnchor, '', 'invalidity'),
			noLabel: renderCandidateReview(officialRung, sameAnchor, 'chart.working-record.md', 'invalidity').includes('Source: web page'),
			shadowed: validateCandidateReview(review, otherAnchor, '', 'invalidity'),
		}).toEqual({
			webQuoteLoses: [
				'Quotation for GB2155808A:description is not found in its recorded text. Copy the passage verbatim from evidenceLookup.anchor output; do not paraphrase or merge lines.',
				'disclosedBy "rotate in the same direction" for element "drums rotate in the same direction" is not found in the recorded text of GB2155808A:description; copy a literal fragment from evidenceLookup output.',
			],
			officialQuoteWins: [],
			noLabel: false,
			shadowed: ['GB2155808A:description is web page text of GB2155808A, but the official description text is recorded at GB2155808A:description:en. Cite GB2155808A:description:en (read it with evidenceLookup); web page text is used only where the tools hold no text for that publication and section.'],
		});
	});

	it('shadows a web anchor only by official text of the same publication: a kind-less web number by any publication of the document, a kind-coded one never by another kind (review of #777)', () => {
		const officialA: PatentEvidenceSource = { ...webSource, anchor: `${gb}:description:en`, language: 'en', text: 'The drums counter-rotate.', textSource: undefined, url: undefined };
		const webB: PatentEvidenceSource = { ...webSource, anchor: 'GB2155808B:description', reference: { publicationNumber: 'GB2155808B', section: 'description' }, url: 'https://patents.google.com/patent/GB2155808B/en' };
		const webKindless: PatentEvidenceSource = { ...webSource, anchor: 'GB2155808:description', reference: { publicationNumber: 'GB2155808', section: 'description' } };
		const recorded = snapshotOf(
			{ id: 'gb-official-en', recordedAt: '2026-10-19T03:30:00Z', kind: 'details', status: 'succeeded', publicationIds: [gb], sources: [officialA] },
			{ id: 'gb-web-b', recordedAt: '2026-10-19T04:30:00Z', kind: 'details', status: 'succeeded', publicationIds: ['GB2155808B'], sources: [webB] },
			{ id: 'gb-web-kindless', recordedAt: '2026-10-19T04:40:00Z', kind: 'details', status: 'succeeded', publicationIds: ['GB2155808'], sources: [webKindless] },
		);
		const citing = (anchor: string) => withRung({ ...rung, sourceAnchors: [anchor], evidence: [{ ...rung.evidence[0], anchor }], elements: [{ ...rung.elements[0], anchor }] });
		expect({
			otherKind: validateCandidateReview(citing(webB.anchor), recorded, '', 'invalidity'),
			kindless: validateCandidateReview(citing(webKindless.anchor), recorded, '', 'invalidity'),
		}).toEqual({
			otherKind: [],
			kindless: ['GB2155808:description is web page text of GB2155808, but the official description text is recorded at GB2155808A:description:en. Cite GB2155808A:description:en (read it with evidenceLookup); web page text is used only where the tools hold no text for that publication and section.'],
		});
	});

	it('accepts a Search Round that answers the source open point of the previous receipt', () => {
		const save: PatentExecution = { id: 'save', recordedAt: '2026-10-19T05:00:00Z', kind: 'save', status: 'succeeded', tool: 'write_patent_results', request: 'chart.md', rounds: 0, openPoints: ['source-GB2155808A'] };
		const answering = (answers: string[]): PatentCandidateReview => ({ ...review, rounds: [{ round: 1, targets: ['2'], answers, queries: [{ tool: 'search_patents', query: 'ti=drum' }], outcome: 'Confirmed against the official text.' }] });
		expect({
			accepted: roundAnswerErrors(answering(['source-GB2155808A']), snapshotOf(save), 'chart.md'),
			refused: roundAnswerErrors(answering(['rung-9']), snapshotOf(save), 'chart.md'),
		}).toEqual({
			accepted: [],
			refused: ['Round 1 answers no open point of the previous receipt (it names rung-9). A Search Round runs only on the expert\'s answer to the Round Report. In answers, give the ids of the open points the expert chose (the previous receipt listed source-GB2155808A). If the expert has not answered yet, save without the new round, write the Round Report and wait.'],
		});
	});
});
