/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import type * as vscode from 'vscode';
import MarkdownIt from 'markdown-it';
import { describe, expect, it, vi } from 'vitest';
import { PatentExecutionSnapshot } from '../../../patentai/vscode-node/patentExecutionLedger';
import { lookupPatentEvidence } from '../patentEvidenceLookup';
import { materializeCandidateReview, PatentCandidateReview, renderCandidateReview, validateCandidateReview } from '../patentCandidateReview';

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

describe('prior-art evidence recovery and review contract', () => {
	it('renders source claim numbers literally without continuing a Markdown list', () => {
		const row = { ...combination, sourceAnchors: snapshot.executions[0].sources!.slice(0, 2).map(source => source.anchor), evidence: snapshot.executions[0].sources!.slice(0, 2).map(source => ({ anchor: source.anchor, quote: source.text!, scope: 'Quoted claim only.', qualifiers: 'Unresolved.', quantityBasis: 'Original units.' })) };
		const html = new MarkdownIt({ html: true }).render(renderCandidateReview({ ...review, coverage: [row] }, snapshot, 'evidence.json'));
		expect({ orderedList: html.includes('<ol'), literalClaim10: html.includes('10. A dental'), literalClaim8: html.includes('8. A composition'), reviewOutsideQuote: /<\/blockquote>\s*<p>Source review/.test(html) }).toEqual({ orderedList: false, literalClaim10: true, literalClaim8: true, reviewOutsideQuote: true });
	});
	it('discloses missing formula images and treats source markup as literal text', () => {
		const source = snapshot.executions[0].sources![0];
		const row = { ...combination, sourceAnchors: [source.anchor], evidence: [{ anchor: source.anchor, quote: '10. A sensor with <img class="EMIRef" id="formula" /> and <script>text</script>, **optional** feedback.', scope: 'Claim.', qualifiers: 'Missing formula.', quantityBasis: 'None.' }] };
		const html = new MarkdownIt({ html: true }).render(renderCandidateReview({ ...review, coverage: [row] }, snapshot, 'evidence.json'));
		expect({ image: html.includes('<img'), script: html.includes('<script>'), notice: html.includes('Formula/image unavailable'), literal: html.includes('**optional**'), original: html.includes('Consult the original document') }).toEqual({ image: false, script: false, notice: true, literal: true, original: true });
	});
	it('preserves indented subparagraphs without displaying Markdown escapes', () => {
		const source = snapshot.executions[0].sources![0];
		const row = { ...combination, sourceAnchors: [source.anchor], evidence: [{ anchor: source.anchor, quote: '    7. A-B < 5\n\n\t(a) **optional** feedback.', scope: 'Claim.', qualifiers: 'Optional.', quantityBasis: 'Original.' }] };
		const html = new MarkdownIt({ html: true }).render(renderCandidateReview({ ...review, coverage: [row] }, snapshot, 'evidence.json'));
		expect({ escapedNumber: html.includes('7\\.'), literal: html.includes('7. A-B &lt; 5'), code: html.includes('<code>'), optional: html.includes('**optional**') }).toEqual({ escapedNumber: false, literal: true, code: false, optional: true });
	});
	it('copies a missing numbered-claim quote from its source but never substitutes a whole description', () => {
		const sources = snapshot.executions[0].sources!;
		const evidence = sources.map(source => ({ anchor: source.anchor, scope: 'Quoted source.', qualifiers: 'Unknown.', quantityBasis: 'Original.' }));
		const input: PatentCandidateReview = { ...review, coverage: [{ ...combination, sourceAnchors: sources.map(source => source.anchor), evidence }] };
		const materialized = materializeCandidateReview(input, snapshot);
		expect(materialized.coverage![0].evidence!.map(item => item.quote)).toEqual([claim10, claim8, undefined]);
		expect(validateCandidateReview(materialized, snapshot).some(error => error.includes('must match recorded text'))).toBe(true);
	});
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
		const elements = [{ element: 'Filler present in a recited amount', anchor, disclosedBy: fragment }, { element: 'Exact IDF loading window' }];
		const row = { feature: 'Loading', kind: 'feature' as const, importance: 'essential' as const, status: 'partial' as const, sourceAnchors: [anchor], gap: 'Range overlap only.', evidence: [evidence], elements };
		const complete = { ...review, coverage: [row, combination] };
		const incomplete = { ...review, coverage: [{ ...row, evidence: [{ ...evidence, quote: fragment }] }, combination] };
		expect({ rejected: validateCandidateReview(incomplete, snapshot).some(error => error.includes('Quote the complete claim')), errors: validateCandidateReview(complete, snapshot), retains: new MarkdownIt({ html: true }).render(renderCandidateReview(complete, snapshot, 'evidence.json')).includes(quote) }).toEqual({ rejected: true, errors: [], retains: true });
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
		expect(renderCandidateReview(draft, snapshot, 'evidence.json')).toContain('No supported conclusion is established');
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
		expect({ combination: errors.some(error => error.includes('explicit essential combination')), quote: errors.some(error => error.includes('must match recorded text')) }).toEqual({ combination: true, quote: true });
	});

	it('discloses the uncited Japanese document, the claims-only basis, the unreviewed tail and the missing classification query', () => {
		const rendered = renderCandidateReview(claimsOnly, retrieval, 'evidence.json');
		expect({
			table: rendered.includes('| WO9951190A1 | 1999-10-14 | Dental composition | en |'),
			uncited: rendered.includes('| JP2001010910A | 2001-01-16 | Japanese filler | claims | ja (untranslated; not reviewable in this report without translation) |'),
			count: rendered.includes('- 1 of 2 retrieved documents are not cited in any coverage row; their text was available locally and was not reviewed for this report.'),
			language: rendered.includes('- Retrieved text is not in English for JP2001010910A (ja); those documents are untranslated'),
			claimsOnly: rendered.includes('- No description passage is cited; every finding rests on claim text only. Descriptions were retrieved for: WO9951190A1.'),
			tail: rendered.includes('- Query 1 returned 10 of 33 matches; the remaining 23 were not retrieved.'),
			classification: rendered.includes('- No classification-code (CPC/IPC) query was recorded; the search relied on keywords only.'),
		}).toEqual({ table: true, uncited: true, count: true, language: true, claimsOnly: true, tail: true, classification: true });
	});

	it('stays silent when every document is cited, a description is quoted, the tail is exhausted and a class was searched', () => {
		const searched = { ...retrieval.executions[0], query: 'ta=dental AND ic=A61K', total: 10, returned: 10 };
		const cited = { ...combination, sourceAnchors: ['WO9951190A1:claims:10:en', 'WO9951190A1:description:en', 'JP2001010910A:claims:1:ja'] };
		const rendered = renderCandidateReview({ ...review, coverage: [cited] }, { ...retrieval, executions: [searched, ...retrieval.executions.slice(1)] }, 'evidence.json');
		expect({
			cited: rendered.includes('Every retrieved document is cited in at least one coverage row.'),
			count: rendered.includes('retrieved documents are not cited'),
			claimsOnly: rendered.includes('No description passage is cited'),
			tail: rendered.includes('were not retrieved.'),
			classification: rendered.includes('No classification-code'),
			language: rendered.includes('Retrieved text is not in English for JP2001010910A (ja)'),
		}).toEqual({ cited: true, count: false, claimsOnly: false, tail: false, classification: false, language: true });
	});

	it('merges the backend dotted id and the source publication number into one inventory row', () => {
		const dotted = { ...retrieval, executions: [retrieval.executions[0], { ...retrieval.executions[1], publicationIds: ['WO9951190.A1'] }, ...retrieval.executions.slice(2)] };
		const rendered = renderCandidateReview(claimsOnly, dotted, 'evidence.json');
		expect({
			rows: (rendered.match(/^\| WO9951190/gm) ?? []).length,
			merged: rendered.includes('| WO9951190A1 | 1999-10-14 | Dental composition | en |'),
			count: rendered.includes('- 1 of 2 retrieved documents are not cited'),
		}).toEqual({ rows: 1, merged: true, count: true });
	});

	it('rejects the framing and obviousness phrases a candidate review must not use', () => {
		const errors = validateCandidateReview({ ...review, objective: 'Prior-art search and patentability evaluation.', stopReason: 'No single reference or obvious combination discloses it.' }, snapshot);
		expect(errors.filter(error => error.startsWith('Legal conclusions'))).toEqual([
			'Legal conclusions in a candidate review: "patentability" in objective; "obvious combination" in stopReason. A candidate review states what each passage discloses; it does not draw novelty, anticipation, obviousness or teaching-away conclusions. Replace the phrase with the factual finding.',
		]);
	});

	it('rejects legal conclusions in model prose while accepting an explicit non-establishment disclaimer', () => {
		const conclusions = validateCandidateReview({ ...review, stopReason: 'The reference teaches away from the combination.', limitations: ['Claim 1 is novel over the retrieved art.'] }, snapshot);
		const disclaimer = validateCandidateReview({ ...review, limitations: ['Retrieval does not establish that any claim is novel.'] }, snapshot);
		expect({
			flagged: conclusions.filter(error => error.startsWith('Legal conclusions')),
			exempt: disclaimer,
		}).toEqual({
			flagged: ['Legal conclusions in a candidate review: "is novel" in limitations[0]; "teaches away" in stopReason. A candidate review states what each passage discloses; it does not draw novelty, anticipation, obviousness or teaching-away conclusions. Replace the phrase with the factual finding.'],
			exempt: [],
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
			complete: [`Every element of "${feature}" is disclosed; mark the row supported or add the undisclosed element.`],
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
		const rendered = renderCandidateReview({ ...review, coverage: [row, combination] }, snapshot, 'evidence.json');
		expect({
			header: rendered.includes('| Element | Disclosed by | Source |'),
			disclosed: rendered.includes('| polymerization initiator | `parts by weight initiator` | [WO9951190A1:claims:10:en](flowleap://flowleap.patent-ai/patent?publication=WO9951190A1&section=claims&claim=10) |'),
			undisclosed: rendered.includes('| photocurable / light-curing initiator | not disclosed in cited text | \u2014 |'),
			beforeGap: rendered.indexOf('| Element | Disclosed by |') < rendered.indexOf('Remaining gap (model judgment)'),
			weak: rendered.includes('Element fragments under 12 characters'),
		}).toEqual({ header: true, disclosed: true, undisclosed: true, beforeGap: true, weak: false });
	});
});
