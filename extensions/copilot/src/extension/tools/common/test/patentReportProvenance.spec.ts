/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { dateProvenance, extractClaimQuotations, extractDates, extractFigures, figureProvenance, ProvenanceSnapshot, quotationProvenance, renderFtoAppendix, renderLandscapeAppendix, tablesWithoutBasis } from '../patentReportProvenance';

/** One analytics outcome whose returned text carries the trend figures, and one search outcome. */
const snapshot: ProvenanceSnapshot = {
	executions: [
		{ kind: 'analytics', status: 'succeeded', tool: 'patstat_portfolio', request: 'applicant=Acme; cpc=H01M', rowCount: 2, dataEdition: 'PATSTAT 2025 Autumn', resultText: '| 2019 | 1,240 |\n| 2024 | 1,860 |\nshare 91%' },
		{ kind: 'search', status: 'succeeded', total: 54, returned: 25 },
		{ kind: 'analytics', status: 'failed', tool: 'patstat_query', request: 'SELECT …', resultText: '4,500' },
	],
};

describe('landscape figure extraction', () => {
	it('reads the measurements and leaves years, identifiers and single digits out', () => {
		const content = [
			'| Year | Families |',
			'| --- | --- |',
			'| 2019 | 1,240 |',
			'| 2024 | 3 |',
			'',
			'The top filer holds 91% of the 12 granted families in A61K6/62; see [EP3477840](flowleap://flowleap.patent-ai/patent?publication=EP3477840). Growth averages 12.5 filings per year, and 1,240 families recur.',
		].join('\n');
		expect(extractFigures(content)).toEqual(['1,240', '91%', '12', '12.5']);
	});

	it('leaves citations of law, bracketed paragraph numbers and named patent numbers out', () => {
		const content = [
			'Claim 12 is rejected under 35 U.S.C. 112, first paragraph; see MPEP § 2163 and 37 CFR 1.136(a). The IDS cites U.S. Patent No. 5,576,020.',
			'Montague, paragraph [0180], shows disks 58 and 76; the objection to 5,576,020 stands (§4.2, Art. 56 EPC, Rule 137(3)). 1,240 families remain.',
		].join('\n');
		expect(extractFigures(content)).toEqual(['12', '58', '76', '1,240']);
	});

	it('drops section numbering and finds a claim reference numeral in the retrieved claim text', () => {
		const content = [
			'### 3.1 Blocking candidates',
			'3.2 Secondary art',
			'',
			'The skewer (93) engages the hub (108) across 47 screened families.',
		].join('\n');
		const claims: ProvenanceSnapshot = {
			executions: [{ kind: 'details', status: 'succeeded', sources: [{ text: '1. A rack comprising a skewer (93) mounted on a hub (108).', reference: { publicationNumber: 'EP2110298B1', section: 'claims' } }] }],
		};
		expect({ figures: extractFigures(content), provenance: figureProvenance(extractFigures(content), claims, content) }).toEqual({
			figures: ['93', '108', '47'],
			provenance: { matched: ['93', '108'], derived: [], unmatched: ['47'] },
		});
	});
});

describe('landscape figure provenance', () => {
	it('finds figures in recorded analytics text and search counts, and reports the rest as untraced', () => {
		expect(figureProvenance(['1,240', '91%', '54', '12.5', '4,500'], snapshot)).toEqual({
			matched: ['1,240', '91%', '54'],
			derived: [],
			unmatched: ['12.5', '4,500'],
		});
	});

	it('reports row totals, column sums and shares as computed from the figures that were found', () => {
		const content = [
			'| Office | 2015-2023 | 2024-2025 | Total |',
			'| --- | --- | --- | --- |',
			'| EP | 70 | 77 | 147 |',
			'| US | 66 | 66 | 132 |',
			'',
			'| Applicant | Families | Share |',
			'| --- | --- | --- |',
			'| Acme | 34 | 25% |',
			'| Globex | 103 | 75% |',
			'',
			'EP and US together hold 136 families across 3,000 publications.',
		].join('\n');
		expect(figureProvenance(['147', '132', '136', '25%', '3,000'], { executions: [] }, content)).toEqual({
			matched: [],
			derived: [
				{ figure: '147', basis: 'row total' },
				{ figure: '132', basis: 'row total' },
				{ figure: '136', basis: "column sum of '2015-2023'" },
				{ figure: '25%', basis: 'share' },
			],
			unmatched: ['3,000'],
		});
	});
});

describe('landscape counting basis', () => {
	it('names every table whose header and the lines above it never say what is counted', () => {
		const content = [
			'## Filings',
			'Counts below are DOCDB families.',
			'',
			'| Year | Count |',
			'| --- | --- |',
			'| 2019 | 12 |',
			'',
			'| Applicant | Share |',
			'| --- | --- |',
			'| Acme | 40% |',
		].join('\n');
		expect(tablesWithoutBasis(content)).toEqual(['Applicant | Share']);
	});
});

describe('landscape appendix', () => {
	it('states what was traced, what was not, and which recorded aggregate the report rests on', () => {
		const content = [
			'| Year | Families |',
			'| --- | --- |',
			'| 2019 | 1,240 |',
			'',
			'| Applicant | Share |',
			'| --- | --- |',
			'| Acme | 91% |',
			'',
			'Growth averages 12.5 per year.',
		].join('\n');
		expect(renderLandscapeAppendix(content, snapshot)).toEqual([
			'## Figure provenance (generated)',
			'Generated from this session\'s execution record, not supplied by the model. A figure is "found" when it appears in the text a tool returned; that is not a check of what it means, and a figure not found may still be a correct calculation from figures that were.',
			'3 figures checked against recorded tool outputs; 2 found, 0 computed from figures that were found, 1 not found: 12.5.',
			'Tables without a stated counting basis: Applicant | Share. Families, applications and publications are different units; state which one each table counts.',
			'',
			'## Data provenance (generated)',
			'- patstat_portfolio — applicant=Acme; cpc=H01M — 2 rows — PATSTAT 2025 Autumn',
		].join('\n'));
	});

	it('says plainly when no analytics outcome was recorded', () => {
		expect(renderLandscapeAppendix('No tables here.', { executions: [] })).toEqual([
			'## Figure provenance (generated)',
			'Generated from this session\'s execution record, not supplied by the model. A figure is "found" when it appears in the text a tool returned; that is not a check of what it means, and a figure not found may still be a correct calculation from figures that were.',
			'No figures were found in the report body; nothing was checked against recorded tool outputs.',
			'',
			'## Data provenance (generated)',
			'No analytics outcome was recorded for this session, so no figure in this report rests on a recorded aggregate.',
		].join('\n'));
	});
});


/** One status outcome carrying the dates an FTO memo reads off, and one document retrieval. */
const statusSnapshot: ProvenanceSnapshot = {
	executions: [
		{ kind: 'status', status: 'succeeded', tool: 'get_legal_status', request: 'EP1000000A1', rowCount: 2, publicationIds: ['EP1000000A1'], resultText: '| 2024-01-10 | FR | MM4A | LAPSE |\n| 2018-06-20 | EP | PGFP | GRANT |' },
		{ kind: 'status', status: 'succeeded', tool: 'get_patent_term', request: 'EP1000000A1', publicationIds: ['EP1000000A1'], resultText: '**Estimated Expiry (base):** 2028-04-16' },
		{ kind: 'details', status: 'succeeded', publicationIds: ['EP1000000A1'], sources: [{ text: 'CLAIM_TEXT', reference: { publicationNumber: 'EP1000000A1', section: 'claims' } }] },
		{ kind: 'status', status: 'failed', tool: 'get_register_events', request: 'EP2000000' },
	],
};

const CITATION = 'flowleap://flowleap.patent-ai/patent?publication=EP1000000A1&section=claims&claim=1';

describe('report date provenance', () => {
	it('reads ISO, dotted and slashed dates and finds each in the text a status tool returned', () => {
		const content = [
			'The patent lapsed in France on 2024-01-10 and was granted on 20.06.2018.',
			'Base expiry is 04/16/2028; the search cutoff was 2025-09-01.',
			'See [claim 1](flowleap://flowleap.patent-ai/patent?publication=EP1000000A1&section=claims&claim=1).',
		].join('\n');
		expect({ dates: extractDates(content), provenance: dateProvenance(extractDates(content), statusSnapshot) }).toEqual({
			dates: ['2024-01-10', '20.06.2018', '04/16/2028', '2025-09-01'],
			provenance: { matched: ['2024-01-10', '20.06.2018', '04/16/2028'], unmatched: ['2025-09-01'] },
		});
	});

	it('searches records that carry no row count and the passages a retrieval returned', () => {
		const snapshot: ProvenanceSnapshot = {
			executions: [
				{ kind: 'status', status: 'succeeded', tool: 'get_patent_term', request: 'EP2110298B1', resultText: '**Estimated Expiry (base):** 2029-01-19' },
				{ kind: 'details', status: 'succeeded', sources: [{ text: 'Published 2010-04-08; priority 2011-07-18.', reference: { publicationNumber: 'EP2110298B1', section: 'abstract' } }] },
			],
		};
		expect(dateProvenance(['2029-01-19', '2010-04-08', '2011-07-18', '2026-02-02'], snapshot)).toEqual({
			matched: ['2029-01-19', '2010-04-08', '2011-07-18'],
			unmatched: ['2026-02-02'],
		});
	});
});

describe('claim quotation extraction', () => {
	it('takes quoted, curly-quoted and blockquoted spans after a claims citation and leaves the rest', () => {
		const near = 'A battery cell comprising a sulfide glass-ceramic electrolyte layer between two electrodes.';
		const curly = 'wherein the electrolyte layer has a thickness of between ten and fifty micrometres';
		const blockquoted = 'the housing surrounds the stack and is sealed against ingress of moisture';
		const content = [
			`Claim 1 of [EP1000000A1](${CITATION}) reads: "${near}" The memo continues.`,
			'',
			`[EP1000000A1 claim 2](${CITATION}) states \u201c${curly}\u201d, which the product meets.`,
			'',
			`[EP1000000A1 claim 3](${CITATION})`,
			`> ${blockquoted}`,
			'',
			`"${near}" appears again here, far from any citation link.`,
			`[EP1000000A1](${CITATION}) ${'filler text '.repeat(30)}"a quotation beyond the window that is long enough to be judged"`,
		].join('\n');
		expect(extractClaimQuotations(content)).toEqual([
			{ publication: 'EP1000000A1', quote: near },
			{ publication: 'EP1000000A1', quote: curly },
			{ publication: 'EP1000000A1', quote: blockquoted },
		]);
	});
});

describe('claim quotation provenance', () => {
	it('matches a quotation against the recorded claim text and names the rest as not found', () => {
		const recorded = '1. A battery cell comprising a sulfide glass-ceramic electrolyte layer\n   between two electrodes.';
		const snapshot: ProvenanceSnapshot = { executions: [{ kind: 'details', status: 'succeeded', sources: [{ text: recorded, reference: { publicationNumber: 'EP1000000A1', section: 'claims' } }] }] };
		const quotations = [
			{ publication: 'EP1000000A1', quote: 'A battery cell comprising a SULFIDE glass-ceramic  electrolyte layer between two electrodes.' },
			{ publication: 'EP1000000A1', quote: 'a battery cell comprising a polymer electrolyte layer between two electrodes.' },
			{ publication: 'US7000000B2', quote: 'a housing that surrounds the stack and is sealed against ingress of moisture.' },
		];
		expect(quotationProvenance(quotations, snapshot)).toEqual({
			matched: [quotations[0]],
			elided: [],
			elsewhere: [],
			unmatched: [quotations[1], quotations[2]],
			unrecorded: ['US7000000B2'],
		});
	});

	it('finds a quotation that is not claim text in a fetched page or a file-wrapper document', () => {
		const page = 'US5135330A description. To release the preferred embodiment, the pull knob 50 is once more pulled away from the cover 10c and the lever is operated.';
		const snapshot: ProvenanceSnapshot = {
			executions: [
				{ kind: 'details', status: 'succeeded', sources: [{ text: '1. A quick release clamping device comprising a hollow clamping cap.', reference: { publicationNumber: 'US5135330A', section: 'claims' } }] },
				{ kind: 'analytics', status: 'succeeded', tool: 'fetch_webpage', request: 'https://patents.google.com/patent/US5135330A/en', resultText: page },
			],
		};
		const quotations = [
			{ publication: 'US5135330A', quote: 'the pull knob 50 is once more pulled away from the cover 10c and the lever is operated' },
			{ publication: 'US5135330A', quote: 'the pull knob 50 is once more pushed toward the cover 10c and the lever is operated' },
			{ publication: 'US9999999B1', quote: 'a quotation cited to a publication whose claims were never retrieved at all' },
		];
		expect(quotationProvenance(quotations, snapshot)).toEqual({
			matched: [],
			elided: [],
			elsewhere: [quotations[0]],
			unmatched: [quotations[1], quotations[2]],
			unrecorded: ['US9999999B1'],
		});
	});

	it('accepts a quotation cut with an ellipsis and still rejects one whose words differ', () => {
		const recorded = '1. A cap comprising a biasing means (140) received in the bore, wherein the biasing means is a spring that biases the shaft (146) to the first position.';
		const snapshot: ProvenanceSnapshot = { executions: [{ kind: 'details', status: 'succeeded', sources: [{ text: recorded, reference: { publicationNumber: 'EP2110298B1', section: 'claims' } }] }] };
		const quotations = [
			{ publication: 'EP2110298B1', quote: 'a biasing means (140) … is a spring that biases the shaft (146) to the first position' },
			{ publication: 'EP2110298B1', quote: 'a biasing means (140) [...] is a magnet that biases the shaft (146) to the first position' },
			{ publication: 'EP2110298B1', quote: 'to the first position … a biasing means (140) received in the bore' },
		];
		expect(quotationProvenance(quotations, snapshot)).toEqual({
			matched: [],
			elided: [quotations[0]],
			elsewhere: [],
			unmatched: [quotations[1], quotations[2]],
			unrecorded: [],
		});
	});
});

describe('fto appendix', () => {
	it('states the figures, dates, quotations and calls behind the memo', () => {
		const content = [
			`Claim 1 of [EP1000000A1](${CITATION}) reads: "CLAIM_TEXT and more words to reach the judged length."`,
			'',
			'The patent lapsed in France on 2024-01-10; the base expiry is 2033-04-16. 42 candidate families were screened.',
		].join('\n');
		expect(renderFtoAppendix(content, statusSnapshot)).toEqual([
			'## Figure and date provenance (generated)',
			'Generated from this session\'s execution record, not supplied by the model. A figure or date is "found" when it appears in the text a tool returned; that is not a check of what it means, and one that was not found may still be correct.',
			'1 figures checked against recorded tool outputs; 0 found, 0 computed from figures that were found, 1 not found: 42.',
			'2 dates checked against recorded tool outputs; 1 found, 1 not found: 2033-04-16.',
			'',
			'## Quotation provenance (generated)',
			'Generated from this session\'s execution record, not supplied by the model. Every quoted span of 40 characters or more that follows a claims citation is compared, ignoring case and line breaks, with the claim text recorded for that publication, then with every other text a tool returned. A quotation cut with an ellipsis is found when each of its fragments stands, in order, in that text.',
			'1 claim quotations checked against recorded claim text; 0 found verbatim, 0 found with elisions, 1 not found: EP1000000A1: "CLAIM_TEXT and more words to reach the judged length.".',
			'',
			'## Data provenance (generated)',
			'- get_legal_status — EP1000000A1 — 2 rows — succeeded',
			'- get_patent_term — EP1000000A1 — count not recorded — succeeded',
			'- get_patent_details — EP1000000A1 — count not recorded — succeeded',
			'- get_register_events — EP2000000 — count not recorded — failed',
		].join('\n'));
	});
});

describe('fto data provenance', () => {
	it('lists a term lookup and a drawing retrieval that recorded no row count, with the document each asked about', () => {
		const snapshot: ProvenanceSnapshot = {
			executions: [
				{ kind: 'status', status: 'succeeded', tool: 'get_patent_term', request: 'EP2110298B1', resultText: 'expiry' },
				{ kind: 'status', status: 'succeeded', tool: 'get_patent_term', request: 'US7000000B2', resultText: 'expiry' },
				{ kind: 'figures', status: 'succeeded', publicationIds: ['EP2110298B1'] },
				{ kind: 'search', status: 'succeeded', query: 'ta=skewer', total: 54, returned: 25 },
			],
		};
		expect(renderFtoAppendix('Nothing to check in this body.', snapshot).split('\n').filter(line => line.startsWith('- '))).toEqual([
			'- get_patent_term — EP2110298B1 — count not recorded — succeeded',
			'- get_patent_term — US7000000B2 — count not recorded — succeeded',
			'- get_patent_figures — EP2110298B1 — count not recorded — succeeded',
			'- search_patents — ta=skewer — 54 total, 25 returned — succeeded',
		]);
	});

	it('names the first sixty recorded calls and counts the rest', () => {
		const snapshot: ProvenanceSnapshot = {
			executions: Array.from({ length: 62 }, (_, index) => ({ kind: 'status', status: 'succeeded', tool: 'get_patent_term', request: `EP${index}` })),
		};
		const lines = renderFtoAppendix('Nothing to check in this body.', snapshot).split('\n').filter(line => line.startsWith('- '));
		expect({ lines: lines.length, last: lines[lines.length - 1] }).toEqual({ lines: 61, last: '- and 2 more recorded calls.' });
	});
});
