/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import type * as vscode from 'vscode';
import MarkdownIt from 'markdown-it';
import { describe, expect, it, vi } from 'vitest';
import { PatentExecutionSnapshot } from '../../../patentai/vscode-node/patentExecutionLedger';
import { lookupPatentEvidence } from '../patentEvidenceLookup';
import { materializeCandidateReview, PatentCandidateReview, renderCandidateReview, renderWorkingRecord, validateCandidateReview } from '../patentCandidateReview';

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

// One keyword search with an unreviewed tail, one cited English document and one uncited Japanese one.
const retrieval: PatentExecutionSnapshot = { limitation: 'Recorded outcomes only.', executions: [
	{ id: 'search', recordedAt: '2026-09-10T01:00:00Z', kind: 'search', status: 'succeeded', query: 'ta=dental AND ta=filler', total: 33, returned: 10 },
	{ id: 'english', recordedAt: '2026-09-10T02:00:00Z', kind: 'details', status: 'succeeded', publicationIds: ['WO9951190A1'], publicationDate: '1999-10-14', publicationTitle: 'Dental composition', sources: [
		{ anchor: 'WO9951190A1:claims:10:en', reference: { publicationNumber: 'WO9951190A1', section: 'claims', claimNumber: '10' }, language: 'en', text: claim10, retrieval: 'returned', review: 'unknown', completeness: 'unknown' },
		{ anchor: 'WO9951190A1:description:en', reference: { publicationNumber: 'WO9951190A1', section: 'description' }, language: 'en', text: 'The powder was passed through a sieve.', retrieval: 'returned', review: 'unknown', completeness: 'unknown' },
	] },
	{ id: 'japanese', recordedAt: '2026-09-10T03:00:00Z', kind: 'details', status: 'succeeded', publicationIds: ['JP2001010910A'], publicationDate: '2001-01-16', publicationTitle: 'Japanese filler', sources: [
		{ anchor: 'JP2001010910A:claims:1:ja', reference: { publicationNumber: 'JP2001010910A', section: 'claims', claimNumber: '1' }, language: 'ja', text: '1. 歯科用組成物。', retrieval: 'returned', review: 'unknown', completeness: 'unknown' },
	] },
] };
const claimsOnly: PatentCandidateReview = { ...review, coverage: [{ ...combination, sourceAnchors: ['WO9951190A1:claims:10:en'] }] };

// Two EP/WO-scoped searches plus a US document reached through an examiner citation, not the search.
const usClaim = '1. A dental filling apparatus comprising a sensor housing and a composite filler reservoir.';
const scoped: PatentExecutionSnapshot = { limitation: 'Recorded outcomes only.', executions: [
	{ id: 'filtered', recordedAt: '2026-09-10T01:00:00Z', kind: 'search', status: 'succeeded', query: 'ta=dental', countryFilter: ['EP', 'WO'], total: 5, returned: 5 },
	{ id: 'requested', recordedAt: '2026-09-10T01:30:00Z', kind: 'search', status: 'succeeded', query: 'ta=filler', requestedCountries: 'EP,WO', total: 4, returned: 4 },
	retrieval.executions[1],
	{ id: 'american', recordedAt: '2026-09-10T04:00:00Z', kind: 'details', status: 'succeeded', publicationIds: ['US5356951A'], publicationDate: '1994-10-18', publicationTitle: 'Examiner X reference', sources: [
		{ anchor: 'US5356951A:claims:1:en', reference: { publicationNumber: 'US5356951A', section: 'claims', claimNumber: '1' }, language: 'en', text: usClaim, retrieval: 'returned', review: 'unknown', completeness: 'unknown' },
	] },
] };

describe('prior-art evidence recovery and review contract', () => {
	it('renders source claim numbers literally without continuing a Markdown list', () => {
		const row = { ...combination, sourceAnchors: snapshot.executions[0].sources!.slice(0, 2).map(source => source.anchor), evidence: snapshot.executions[0].sources!.slice(0, 2).map(source => ({ anchor: source.anchor, quote: source.text!, scope: 'Quoted claim only.', qualifiers: 'Unresolved.', quantityBasis: 'Original units.' })) };
		const html = new MarkdownIt({ html: true }).render(renderCandidateReview({ ...review, coverage: [row] }, snapshot, 'review.working-record.md'));
		expect({ orderedList: html.includes('<ol'), literalClaim10: html.includes('10. A dental'), literalClaim8: html.includes('8. A composition'), reviewOutsideQuote: /<\/blockquote>\s*<p>Source review/.test(html) }).toEqual({ orderedList: false, literalClaim10: true, literalClaim8: true, reviewOutsideQuote: true });
	});
	it('discloses missing formula images and treats source markup as literal text', () => {
		const source = snapshot.executions[0].sources![0];
		const row = { ...combination, sourceAnchors: [source.anchor], evidence: [{ anchor: source.anchor, quote: '10. A sensor with <img class="EMIRef" id="formula" /> and <script>text</script>, **optional** feedback.', scope: 'Claim.', qualifiers: 'Missing formula.', quantityBasis: 'None.' }] };
		const html = new MarkdownIt({ html: true }).render(renderCandidateReview({ ...review, coverage: [row] }, snapshot, 'review.working-record.md'));
		expect({ image: html.includes('<img'), script: html.includes('<script>'), notice: html.includes('Formula/image unavailable'), literal: html.includes('**optional**'), original: html.includes('Consult the original document') }).toEqual({ image: false, script: false, notice: true, literal: true, original: true });
	});
	it('preserves indented subparagraphs without displaying Markdown escapes', () => {
		const source = snapshot.executions[0].sources![0];
		const row = { ...combination, sourceAnchors: [source.anchor], evidence: [{ anchor: source.anchor, quote: '    7. A-B < 5\n\n\t(a) **optional** feedback.', scope: 'Claim.', qualifiers: 'Optional.', quantityBasis: 'Original.' }] };
		const html = new MarkdownIt({ html: true }).render(renderCandidateReview({ ...review, coverage: [row] }, snapshot, 'review.working-record.md'));
		expect({ escapedNumber: html.includes('7\\.'), literal: html.includes('7. A-B &lt; 5'), code: html.includes('<code>'), optional: html.includes('**optional**') }).toEqual({ escapedNumber: false, literal: true, code: false, optional: true });
	});
	it('copies a missing numbered-claim quote from its source but never substitutes a whole description', () => {
		const sources = snapshot.executions[0].sources!;
		const evidence = sources.map(source => ({ anchor: source.anchor, scope: 'Quoted source.', qualifiers: 'Unknown.', quantityBasis: 'Original.' }));
		const input: PatentCandidateReview = { ...review, coverage: [{ ...combination, sourceAnchors: sources.map(source => source.anchor), evidence }] };
		const materialized = materializeCandidateReview(input, snapshot);
		expect(materialized.coverage![0].evidence!.map(item => item.quote)).toEqual([claim10, claim8, undefined]);
		expect(validateCandidateReview(materialized, snapshot).some(error => error.includes('needs a verbatim quote'))).toBe(true);
	});
	it('recovers a sieve passage beyond line 100 and pages directly to its source with the same anchor', () => {
		const match = lookupPatentEvidence(snapshot, 'WO9951190A1', { query: 'sieve' });
		const page = lookupPatentEvidence(snapshot, 'WO9951190A1', { anchor: 'WO9951190A1:description:en', start: 180 });
		expect({ index: lookupPatentEvidence(snapshot, 'WO9951190A1', {}).includes('WO9951190A1:claims:10:en'), match: match.includes('[WO9951190A1:description:en; line 182] [0057]'), page: page.includes('[0057] The powder was passed through a sieve.'), missing: lookupPatentEvidence(snapshot, 'WO9951190A1', { query: 'unmatched' }).includes('no match does not establish absence') }).toEqual({ index: true, match: true, page: true, missing: true });
	});
	it.each([
		['WO9951190A1:claims:10:en', claim10, '40 to 400 parts by weight composite filler'],
		['EP0983762A1:claims:8:en', claim8, '1 to 20 wt%'],
	])('expands a partial numbered-claim quotation in %s to the whole claim, and preserves the complete original basis', (anchor, quote, fragment) => {
		const evidence = { anchor, quote, scope: anchor.startsWith('EP') ? 'Dependent Claim 8; Claim 1 does not inherit this restriction.' : 'Claim 10 composition.', qualifiers: 'Exact IDF range not established.', quantityBasis: anchor.startsWith('WO') ? '100 monomer + 0.01–10 initiator + 40–400 filler, all parts by weight; no conversion.' : '1–20 wt% only in the dependent claim.' };
		const elements = [{ element: 'Filler present in a recited amount', anchor, disclosedBy: fragment }, { element: 'Exact IDF loading window' }];
		const row = { feature: 'Loading', kind: 'feature' as const, importance: 'essential' as const, status: 'partial' as const, sourceAnchors: [anchor], gap: 'Range overlap only.', evidence: [evidence], elements };
		const complete = { ...review, coverage: [row, combination] };
		const incomplete = { ...review, coverage: [{ ...row, evidence: [{ ...evidence, quote: fragment }] }, combination] };
		const expanded = materializeCandidateReview(incomplete, snapshot);
		expect({ rejected: (expanded.coverage![0] as typeof row).evidence![0].quote === quote && validateCandidateReview(expanded, snapshot).length === 0, errors: validateCandidateReview(complete, snapshot), retains: new MarkdownIt({ html: true }).render(renderCandidateReview(complete, snapshot, 'review.working-record.md')).includes(quote) }).toEqual({ rejected: true, errors: [], retains: true });
	});
	it.each([
		['a sentence-final period', 'Scope checked against [claim 10](URL).'],
		['surrounding parentheses', 'Scope checked (see [claim 10](URL)) before drafting.'],
		['a trailing comma and semicolon', 'Scope: URL, and URL; both were read.'],
	])('accepts a recorded citation followed by %s', (_case, template) => {
		const url = 'flowleap://flowleap.patent-ai/patent?publication=WO9951190A1&section=claims&claim=10';
		const errors = validateCandidateReview(review, snapshot, template.replace(/URL/g, url));
		expect(errors).toEqual([]);
	});

	it('still rejects an unrecorded claim when prose punctuation follows the citation', () => {
		const url = 'flowleap://flowleap.patent-ai/patent?publication=WO9951190A1&section=claims&claim=6';
		expect(validateCandidateReview(review, snapshot, `See [claim 6](${url}).`).some(error => error.includes('Unresolved patent reader citation'))).toBe(true);
	});

	it('validates and renders an unresolved row that arrives without sourceAnchors', () => {
		const row: PatentCandidateReview['coverage'] = [{ feature: 'Essential combination', kind: 'combination', importance: 'essential', status: 'unresolved', gap: 'No source recorded.' }];
		const draft = { ...review, coverage: row };
		expect(validateCandidateReview(draft, snapshot)).toEqual([]);
		expect(renderCandidateReview(draft, snapshot, 'review.working-record.md')).toContain('No supported conclusion is established');
	});

	it('rejects bibliography-only feature support even when its quotation matches', () => {
		const source = { ...snapshot.executions[0].sources![0], anchor: 'WO9951190A1:bibliography', reference: { publicationNumber: 'WO9951190A1', section: 'bibliography' as const } };
		const state = { ...snapshot, executions: [{ ...snapshot.executions[0], sources: [source] }] };
		const row = { ...combination, status: 'partial' as const, sourceAnchors: [source.anchor], evidence: [{ anchor: source.anchor, quote: claim10, scope: 'Abstract', qualifiers: 'Unknown', quantityBasis: 'Original' }], elements: [{ element: 'Dental composition', anchor: source.anchor, disclosedBy: 'A dental composition' }, { element: 'Composite filler loading' }] };
		expect(validateCandidateReview({ ...review, coverage: [row] }, state).some(error => error.includes('claim or description passage'))).toBe(true);
	});
	it('requires an explicit combination and refuses invented quotation text', () => {
		const row = { ...combination, kind: 'feature' as const, sourceAnchors: ['WO9951190A1:claims:10:en'], evidence: [{ anchor: 'WO9951190A1:claims:10:en', quote: 'The filler is 28.5–80 wt%.', scope: 'Claim 10', qualifiers: 'None', quantityBasis: 'Percent of paste' }] };
		const errors = validateCandidateReview({ ...review, coverage: [row] }, snapshot);
		expect({ combination: errors.some(error => error.includes('explicit essential combination')), quote: errors.some(error => error.includes('is not found in its recorded text')) }).toEqual({ combination: true, quote: true });
	});

	it('discloses the uncited Japanese document, the claims-only basis, the unreviewed tail and the missing classification query', () => {
		const rendered = renderCandidateReview(claimsOnly, retrieval, 'review.working-record.md');
		expect({
			table: rendered.includes('| WO9951190A1 | 1999-10-14 | Dental composition | en |'),
			uncited: rendered.includes('| JP2001010910A | 2001-01-16 | Japanese filler | claims | ja (not in English; any reading of it in this report is the model\'s own translation) |'),
			count: rendered.includes('- 1 of 2 retrieved documents are not cited in any coverage row; their text was available locally and was not reviewed for this report.'),
			language: rendered.includes('- Retrieved text is not in English for JP2001010910A (ja); any quotation or reading of those documents in this report is the model\'s own translation'),
			claimsOnly: rendered.includes('- No description passage is cited; every finding rests on claim text only. Descriptions were retrieved for: WO9951190A1.'),
			tail: rendered.includes('- Search set 1 returned 10 of 33 matches; the remaining 23 were not retrieved.'),
			classification: rendered.includes('- No classification-code (CPC/IPC) query was recorded; the search relied on keywords only.'),
		}).toEqual({ table: true, uncited: true, count: true, language: true, claimsOnly: true, tail: true, classification: true });
	});

	it('stays silent when every document is cited, a description is quoted, the tail is exhausted and a class was searched', () => {
		const searched = { ...retrieval.executions[0], query: 'ta=dental AND ic=A61K', total: 10, returned: 10 };
		const cited = { ...combination, sourceAnchors: ['WO9951190A1:claims:10:en', 'WO9951190A1:description:en', 'JP2001010910A:claims:1:ja'] };
		const rendered = renderCandidateReview({ ...review, coverage: [cited] }, { ...retrieval, executions: [searched, ...retrieval.executions.slice(1)] }, 'review.working-record.md');
		expect({
			cited: rendered.includes('Every retrieved document is cited in at least one coverage row.'),
			count: rendered.includes('retrieved documents are not cited'),
			claimsOnly: rendered.includes('No description passage is cited'),
			tail: rendered.includes('were not retrieved.'),
			classification: rendered.includes('No classification-code'),
			language: rendered.includes('Retrieved text is not in English for JP2001010910A (ja)'),
		}).toEqual({ cited: true, count: false, claimsOnly: false, tail: false, classification: false, language: true });
	});

	it('still reports a missing classification query when the only class search failed', () => {
		// A classification query that never ran covered nothing; suppressing the warning would tell the
		// reader a class was searched on the strength of an attempt.
		const failedClassSearch: PatentExecutionSnapshot = { ...retrieval, executions: [
			{ id: 'class', recordedAt: '2026-09-10T00:30:00Z', kind: 'search', status: 'failed', query: 'ta=dental AND ic=A61K' },
			...retrieval.executions,
		] };
		const rendered = renderCandidateReview(claimsOnly, failedClassSearch, 'review.working-record.md');
		expect({
			classification: rendered.includes('- No classification-code (CPC/IPC) query was recorded; the search relied on keywords only.'),
			unrun: rendered.includes('- 1 search(es) could not be run and were not retried: ta=dental AND ic=A61K.'),
		}).toEqual({ classification: true, unrun: true });
	});

	it('merges the backend dotted id and the source publication number into one inventory row', () => {
		const dotted = { ...retrieval, executions: [retrieval.executions[0], { ...retrieval.executions[1], publicationIds: ['WO9951190.A1'] }, ...retrieval.executions.slice(2)] };
		const rendered = renderCandidateReview(claimsOnly, dotted, 'review.working-record.md');
		expect({
			rows: (rendered.match(/^\| WO9951190/gm) ?? []).length,
			merged: rendered.includes('| WO9951190A1 | 1999-10-14 | Dental composition | en |'),
			count: rendered.includes('- 1 of 2 retrieved documents are not cited'),
		}).toEqual({ rows: 1, merged: true, count: true });
	});

	it('marks a document outside the searched jurisdictions in the inventory, the limitations and the row that cites it', () => {
		const row = { ...combination, status: 'partial' as const, sourceAnchors: ['US5356951A:claims:1:en'], gap: 'Reached through a cited reference only.',
			evidence: [{ anchor: 'US5356951A:claims:1:en', quote: usClaim, scope: 'Independent claim 1.', qualifiers: 'Apparatus claim only.', quantityBasis: 'No quantity recited.' }],
			elements: [{ element: 'composite filler reservoir', anchor: 'US5356951A:claims:1:en', disclosedBy: 'composite filler reservoir' }, { element: 'photocurable monomer' }] };
		const rendered = renderCandidateReview({ ...review, coverage: [row] }, scoped, 'review.working-record.md');
		expect({
			header: rendered.includes('| Publication | Publication date | Title | Text language | Scope |'),
			outside: rendered.includes('| US5356951A | 1994-10-18 | Examiner X reference | en | outside searched jurisdictions (US) |'),
			inside: rendered.includes('| WO9951190A1 | 1999-10-14 | Dental composition | en | in scope |'),
			limitation: rendered.includes('- Outside the searched jurisdictions (EP, WO): US5356951A. These were reached through cited references or direct retrieval, not through the scoped search; findings that rest on them are outside the confirmed scope unless the scope is widened.'),
			note: rendered.includes('Scope note (generated): US5356951A is outside the searched jurisdictions (EP, WO).'),
			beforeGap: rendered.indexOf('Scope note (generated)') < rendered.indexOf('Remaining gap (model judgment)'),
		}).toEqual({ header: true, outside: true, inside: true, limitation: true, note: true, beforeGap: true });
	});

	it('discloses no scope at all when no recorded search applied a jurisdiction filter', () => {
		const rendered = renderCandidateReview(claimsOnly, retrieval, 'review.working-record.md');
		expect({
			column: rendered.includes('| Text language | Scope |'),
			limitation: rendered.includes('Outside the searched jurisdictions'),
			note: rendered.includes('Scope note (generated)'),
		}).toEqual({ column: false, limitation: false, note: false });
	});

	it('renders the framing and obviousness phrases as a wording review instead of failing the save', () => {
		const framed = { ...review, objective: 'Prior-art search and patentability evaluation.', stopReason: 'No single reference or obvious combination discloses it.' };
		const rendered = renderWorkingRecord(framed, snapshot, 'review.md', 'evidence.json', undefined);
		expect({
			errors: validateCandidateReview(framed, snapshot),
			heading: rendered.includes('## Wording review'),
			inReport: renderCandidateReview(framed, snapshot, 'review.working-record.md').includes('Wording review'),
			phrases: rendered.split('\n').filter(line => line.startsWith('- "')),
		}).toEqual({
			errors: [],
			heading: true,
			inReport: false,
			phrases: ['- "patentability evaluation" in objective', '- "obvious combination" in stopReason'],
		});
	});

	it('flags legal conclusions in model prose while staying silent for an explicit non-establishment disclaimer', () => {
		const conclusions = { ...review, stopReason: 'The reference teaches away from the combination.', limitations: ['Claim 1 is novel over the retrieved art.'] };
		const disclaimer = { ...review, limitations: ['Retrieval does not establish that any claim is novel.', 'This review does not assess patentability, anticipation or obviousness.', 'No novelty determination is made here.', 'Patentability is a legal question for counsel; this review does not constitute a patentability opinion.', 'This report is prior-art research support, not a legal patentability or freedom-to-operate opinion; conclusions on novelty or inventive step should be confirmed by qualified patent counsel.'] };
		expect({
			errors: validateCandidateReview(conclusions, snapshot),
			flagged: renderWorkingRecord(conclusions, snapshot, 'review.md', 'evidence.json', undefined).split('\n').filter(line => line.startsWith('- "')),
			exempt: renderWorkingRecord(disclaimer, snapshot, 'review.md', 'evidence.json', undefined).includes('No phrases flagged.'),
		}).toEqual({
			errors: [],
			flagged: ['- "is novel" in limitations[0]', '- "teaches away" in stopReason'],
			exempt: true,
		});
	});

	const feature = 'F1: Photocurable composition intended for a dental filling material';
	const supported = {
		feature, kind: 'feature' as const, importance: 'essential' as const, status: 'supported' as const,
		sourceAnchors: ['WO9951190A1:claims:10:en'], gap: '',
		evidence: [{ anchor: 'WO9951190A1:claims:10:en', quote: claim10, scope: 'Independent claim 10.', qualifiers: 'Composition claim only.', quantityBasis: 'Parts by weight exactly as recited.' }],
		elements: [
			{ element: 'dental composition', anchor: 'WO9951190A1:claims:10:en', disclosedBy: 'A dental composition' },
			{ element: 'polymerization initiator', anchor: 'WO9951190A1:claims:10:en', disclosedBy: 'parts by weight initiator' },
		],
	};

	it('refuses a supported row whose element no cited passage discloses', () => {
		const elements = [supported.elements[0], { element: 'polymerization initiator' }];
		expect(validateCandidateReview({ ...review, coverage: [{ ...supported, elements }, combination] }, snapshot)).toEqual([
			`Element "polymerization initiator" of "${feature}" is not disclosed by any cited text, so the row cannot be supported. Either cite the passage that discloses it (anchor + literal fragment) or mark the row partial and name the missing element in the gap.`,
		]);
	});

	it('refuses an element fragment that is absent from the recorded text of its anchor', () => {
		const elements = [supported.elements[0], { ...supported.elements[1], disclosedBy: 'light-curing initiator' }];
		expect(validateCandidateReview({ ...review, coverage: [{ ...supported, elements }, combination] }, snapshot)).toEqual([
			'disclosedBy "light-curing initiator" for element "polymerization initiator" is not found in the recorded text of WO9951190A1:claims:10:en; copy a literal fragment from evidenceLookup output.',
		]);
	});

	it('accepts a partial row that discloses one element and leaves another undisclosed, and refuses one that discloses all', () => {
		const partial = { ...supported, status: 'partial' as const, gap: 'The initiator is not recited as photocurable.' };
		const honest = { ...partial, elements: [supported.elements[0], { element: 'photocurable / light-curing initiator' }] };
		const bare = { ...partial, elements: undefined };
		expect({
			honest: validateCandidateReview({ ...review, coverage: [honest, combination] }, snapshot),
			complete: validateCandidateReview({ ...review, coverage: [partial, combination] }, snapshot),
			bare: validateCandidateReview({ ...review, coverage: [bare, combination] }, snapshot),
		}).toEqual({
			honest: [],
			complete: [`Every element of "${feature}" is disclosed. Either mark the row supported, or keep it partial and ADD one element naming what the cited text does not disclose (the missing part of a range, an unmet qualifier, a constituent) with no anchor and no disclosedBy; do not remove the disclosed elements.`],
			bare: [`Coverage for "${feature}" is marked partial but lists no elements. List each constituent the feature requires with the literal fragment of cited text that discloses it; an element without a fragment makes the row partial at most.`],
		});
	});

	it('refuses a supported combination whose elements are disclosed by separate publications', () => {
		const row = {
			feature: 'Combination of composition and filler content', kind: 'combination' as const, importance: 'essential' as const, status: 'supported' as const,
			sourceAnchors: ['WO9951190A1:claims:10:en', 'EP0983762A1:claims:8:en'], gap: '',
			evidence: [
				{ anchor: 'WO9951190A1:claims:10:en', quote: claim10, scope: 'Independent claim 10.', qualifiers: 'Composition claim only.', quantityBasis: 'Parts by weight as recited.' },
				{ anchor: 'EP0983762A1:claims:8:en', quote: claim8, scope: 'Dependent claim 8.', qualifiers: 'Restriction inherited from claim 1.', quantityBasis: 'Weight percent as recited.' },
			],
			elements: [
				{ element: 'dental composition', anchor: 'WO9951190A1:claims:10:en', disclosedBy: 'A dental composition' },
				{ element: 'inorganic filler content', anchor: 'EP0983762A1:claims:8:en', disclosedBy: 'the inorganic filler is present' },
			],
		};
		expect(validateCandidateReview({ ...review, coverage: [row] }, snapshot)).toEqual([
			'Elements of "Combination of composition and filler content" are disclosed by WO9951190A1 and EP0983762A1: separate documents do not establish the combination; mark partial and say which document lacks which element.',
		]);
	});

	it('renders the element map with the literal fragment and marks an undisclosed element', () => {
		const row = { ...supported, status: 'partial' as const, gap: 'The initiator is not recited as photocurable.', elements: [supported.elements[1], { element: 'photocurable / light-curing initiator' }] };
		const rendered = renderCandidateReview({ ...review, coverage: [row, combination] }, snapshot, 'review.working-record.md');
		expect({
			header: rendered.includes('| Element | Disclosed by | Source |'),
			disclosed: rendered.includes('| polymerization initiator | `parts by weight initiator` | [WO9951190A1:claims:10:en](flowleap://flowleap.patent-ai/patent?publication=WO9951190A1&section=claims&claim=10) |'),
			undisclosed: rendered.includes('| photocurable / light-curing initiator | not disclosed in cited text | \u2014 |'),
			beforeGap: rendered.indexOf('| Element | Disclosed by |') < rendered.indexOf('Remaining gap (model judgment)'),
			weak: rendered.includes('Element fragments under 12 characters'),
		}).toEqual({ header: true, disclosed: true, undisclosed: true, beforeGap: true, weak: false });
	});

	// One retrieved drawing page beside the recorded claim text, so a coverage element can rest on it.
	const figurePage = { anchor: 'WO9951190A1:figure:3', reference: { publicationNumber: 'WO9951190A1', section: 'bibliography' as const }, figure: { page: 3 }, retrieval: 'returned' as const, review: 'unknown' as const, completeness: 'unknown' as const };
	const drawn: PatentExecutionSnapshot = { ...snapshot, executions: [...snapshot.executions, { id: 'figures', recordedAt: '2026-09-20', kind: 'figures', status: 'succeeded', publicationIds: ['WO9951190A1'], sources: [figurePage] }] };
	const reading = 'Figure 3 shows a lobed cam carried on the stem and bearing on the lever.';
	const figureRow = {
		...supported, status: 'partial' as const, gap: 'The claim recites no cam profile.',
		sourceAnchors: ['WO9951190A1:claims:10:en', figurePage.anchor],
		elements: [
			supported.elements[0],
			{ element: 'cam profile carried on the stem', anchor: figurePage.anchor, basis: 'figure' as const, reading },
			{ element: 'stated hardness of the cam' },
		],
	};
	const withReading = (value: string) => ({ ...review, coverage: [{ ...figureRow, elements: [figureRow.elements[0], { ...figureRow.elements[1], reading: value }, figureRow.elements[2]] }, combination] });

	it('accepts an element that rests on a recorded drawing, and refuses one that states no reading', () => {
		const silent = { ...review, coverage: [{ ...figureRow, elements: [figureRow.elements[0], { element: 'cam profile carried on the stem', anchor: figurePage.anchor, basis: 'figure' as const }, figureRow.elements[2]] }, combination] };
		expect({ accepted: validateCandidateReview({ ...review, coverage: [figureRow, combination] }, drawn), silent: validateCandidateReview(silent, drawn) }).toEqual({
			accepted: [],
			silent: ['Element "cam profile carried on the stem" of "' + feature + '" rests on a drawing but states no reading. Give the PUB:figure:N anchor printed by get_patent_figures and a reading of what the drawing clearly shows, or drop basis: figure and cite a literal fragment of recorded text.'],
		});
	});

	it('refuses a drawing reading that states a proportion unless the drawing is stated to be to scale', () => {
		const measured = 'Figure 3 shows the cam lobe and the stem in a ratio 2:1.';
		expect({ measured: validateCandidateReview(withReading(measured), drawn), toScale: validateCandidateReview(withReading(measured + ' The drawing is stated to be to scale.'), drawn) }).toEqual({
			measured: [`Reading "${measured}" for element "cam profile carried on the stem" states a measurement or proportion. A drawing does not disclose dimensions, proportions or ratios unless it is stated to be to scale (MPEP 2125); state only what the figure clearly shows.`],
			toScale: [],
		});
	});

	it('refuses a recorded drawing page cited as quoted text, and a drawing reading carrying a text fragment', () => {
		const asText = { ...review, coverage: [{ ...figureRow, elements: [figureRow.elements[0], { element: 'cam profile carried on the stem', anchor: figurePage.anchor, disclosedBy: 'a lobed cam' }, figureRow.elements[2]] }, combination] };
		const both = { ...review, coverage: [{ ...figureRow, elements: [figureRow.elements[0], { ...figureRow.elements[1], disclosedBy: 'a lobed cam' }, figureRow.elements[2]] }, combination] };
		expect({ asText: validateCandidateReview(asText, drawn), both: validateCandidateReview(both, drawn) }).toEqual({
			asText: [`Element "cam profile carried on the stem" of "${feature}" cites WO9951190A1:figure:3, a recorded drawing page, as text. A drawing has no quotable text: cite it with basis: figure and a reading of what the figure clearly shows, and no disclosedBy.`],
			both: [`Element "cam profile carried on the stem" of "${feature}" rests on a drawing, so it carries no disclosedBy: a figure has no quotable text. Keep the reading and remove disclosedBy.`],
		});
	});

	it('refuses an evidence entry that quotes a recorded drawing page', () => {
		const quoted = { ...review, coverage: [{ ...figureRow, evidence: [...figureRow.evidence, { anchor: figurePage.anchor, quote: reading, scope: 'Drawing.', qualifiers: 'None.', quantityBasis: 'None.' }] }, combination] };
		expect(validateCandidateReview(quoted, drawn)).toEqual([
			`Evidence entry for ${figurePage.anchor} quotes a recorded drawing page, which holds no text. Remove it and cite the drawing through an element with basis: figure and a reading of what it clearly shows.`,
		]);
	});

	it('refuses a drawing reading whose anchor is not one of the row\'s sourceAnchors', () => {
		const unlisted = { ...review, coverage: [{ ...figureRow, sourceAnchors: ['WO9951190A1:claims:10:en'] }, combination] };
		expect(validateCandidateReview(unlisted, drawn)).toEqual([
			`Element "cam profile carried on the stem" of "${feature}" cites ${figurePage.anchor}, which is not one of that row's sourceAnchors. Cite one of: WO9951190A1:claims:10:en.`,
		]);
	});

	it('passes basis and reading through materialization untouched', () => {
		const materialized: PatentCandidateReview = materializeCandidateReview({ ...review, coverage: [figureRow, combination] }, drawn);
		expect(materialized.coverage![0].elements).toEqual(figureRow.elements);
	});
});
