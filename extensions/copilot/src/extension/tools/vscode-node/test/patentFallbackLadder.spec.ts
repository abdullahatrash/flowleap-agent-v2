/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import type * as vscode from 'vscode';
import { describe, expect, it, vi } from 'vitest';
import { PatentEvidenceSource, PatentExecution, PatentExecutionSnapshot } from '../../../patentai/vscode-node/patentExecutionLedger';
import { PatentCandidateReview, validateCandidateReview } from '../patentCandidateReview';
import { deriveFallbackLadder, FallbackLadderDerivation, fallbackCoverage, fallbackLadderErrors, fallbacksNotCovered, LADDER_UNAVAILABLE, parseClaimDependency } from '../patentFallbackLadder';

vi.mock('vscode', async importOriginal => ({ ...await importOriginal<typeof vscode>(), env: { uriScheme: 'flowleap' } }));

/** A per-claim source exactly as get_patent_details records it. */
function claimSource(publication: string, claimNumber: string, text: string, language = 'en'): PatentEvidenceSource {
	return { anchor: `${publication}:claims:${claimNumber}:${language}`, text, reference: { publicationNumber: publication, section: 'claims', claimNumber }, language, retrieval: 'returned', review: 'unknown', completeness: 'unknown' };
}

/** One get_patent_details record of the given claims, numbered from 1. */
function details(publication: string, claims: readonly string[], language = 'en', extra: readonly PatentEvidenceSource[] = []): PatentExecution {
	return { id: publication, recordedAt: '2026-10-17T01:00:00Z', kind: 'details', status: 'succeeded', publicationIds: [publication], sources: [...claims.map((text, index) => claimSource(publication, String(index + 1), text, language)), ...extra] };
}

function snapshotOf(...executions: PatentExecution[]): PatentExecutionSnapshot {
	return { executions, limitation: 'Synthetic fixture; no live search.' };
}

/** The ladder without the claim texts, so a fixture's tree reads at a glance. */
function tree(derivation: FallbackLadderDerivation) {
	return derivation.kind === 'ladder'
		? derivation.ladders.map(ladder => ({ claim: ladder.claimNumber, rungs: ladder.rungs.map(rung => ({ claim: rung.claimNumber, dependsOn: rung.dependsOn, chain: rung.chain })) }))
		: derivation;
}

describe('parseClaimDependency', () => {
	it('reads the dependency reference in English, German and French', () => {
		const cases: readonly (readonly [string, number])[] = [
			['1. A pipe clamp comprising a band and a screw.', 1],
			['2. The clamp according to claim 1, wherein the band is 2 mm thick.', 2],
			['3. The clamp as claimed in any one of claims 1 to 2, wherein the screw is captive.', 3],
			['4. The clamp of claim 2.', 4],
			['5. The clamp according to claim 1 or claim 3, further comprising a liner.', 5],
			['6. The clamp according to any one of the preceding claims, wherein 10 claims are listed.', 6],
			['7. The clamp of claims 2, 4 and 5.', 7],
			['2. Rohrschelle nach Anspruch 1, wobei das Band aus Stahl ist.', 2],
			['3. Rohrschelle nach einem der Ansprüche 1 bis 2.', 3],
			['4. Rohrschelle nach einem der vorhergehenden Ansprüche.', 4],
			['2. Collier selon la revendication 1, dans lequel la bande est en acier.', 2],
			['3. Collier selon l\'une des revendications 1 à 2.', 3],
			['4. Collier selon l\'une quelconque des revendications précédentes.', 4],
		];
		expect(cases.map(([text, claim]) => parseClaimDependency(text, claim))).toEqual([
			[],
			[1],
			[1, 2],
			[2],
			[1, 3],
			[1, 2, 3, 4, 5],
			[2, 4, 5],
			[1],
			[1, 2],
			[1, 2, 3],
			[1],
			[1, 2],
			[1, 2, 3],
		]);
	});
});

describe('deriveFallbackLadder', () => {
	it('derives an English ladder with the claim text from the ledger', () => {
		const claims = [
			'1. A pipe clamp comprising a band and a screw.',
			'2. The clamp according to claim 1, wherein the band is steel.',
			'3. A method of fastening a pipe comprising tightening a band.',
			'4. The method of claim 3, wherein the band is lined.',
		];
		expect(deriveFallbackLadder(snapshotOf(details('EP3000001B1', claims)), 'EP 3000001 B1')).toEqual({
			kind: 'ladder', publication: 'EP3000001B1', ladders: [
				{ claimNumber: '1', text: claims[0], rungs: [{ claimNumber: '2', dependsOn: ['1'], chain: ['1', '2'], text: claims[1] }] },
				{ claimNumber: '3', text: claims[2], rungs: [{ claimNumber: '4', dependsOn: ['3'], chain: ['3', '4'], text: claims[3] }] },
			],
		});
	});

	it('derives a German ladder', () => {
		const claims = ['1. Rohrschelle mit einem Band und einer Schraube.', '2. Rohrschelle nach Anspruch 1, wobei das Band aus Stahl ist.', '3. Rohrschelle nach einem der Ansprüche 1 bis 2, wobei die Schraube unverlierbar ist.'];
		expect(tree(deriveFallbackLadder(snapshotOf(details('DE102000000001B4', claims, 'de')), 'DE102000000001B4'))).toEqual([
			{ claim: '1', rungs: [{ claim: '2', dependsOn: ['1'], chain: ['1', '2'] }, { claim: '3', dependsOn: ['1', '2'], chain: ['1', '3'] }] },
		]);
	});

	it('derives a French ladder', () => {
		const claims = ['1. Collier comprenant une bande et une vis.', '2. Collier selon la revendication 1, dans lequel la bande est en acier.', '3. Collier selon l\'une des revendications 1 à 2, dans lequel la vis est imperdable.'];
		expect(tree(deriveFallbackLadder(snapshotOf(details('FR3000001A1', claims, 'fr')), 'FR3000001A1'))).toEqual([
			{ claim: '1', rungs: [{ claim: '2', dependsOn: ['1'], chain: ['1', '2'] }, { claim: '3', dependsOn: ['1', '2'], chain: ['1', '3'] }] },
		]);
	});

	it('puts a multiply dependent claim under each independent claim it reaches', () => {
		const claims = ['1. A pipe clamp comprising a band.', '2. A hose clamp comprising a wire.', '3. The clamp according to claim 1 or 2, comprising a liner.', '4. The clamp according to any one of the preceding claims, comprising a seal.'];
		expect(tree(deriveFallbackLadder(snapshotOf(details('EP3000002B1', claims)), 'EP3000002B1'))).toEqual([
			{ claim: '1', rungs: [{ claim: '3', dependsOn: ['1', '2'], chain: ['1', '3'] }, { claim: '4', dependsOn: ['1', '2', '3'], chain: ['1', '4'] }] },
			{ claim: '2', rungs: [{ claim: '3', dependsOn: ['1', '2'], chain: ['2', '3'] }, { claim: '4', dependsOn: ['1', '2', '3'], chain: ['2', '4'] }] },
		]);
	});

	it('follows a chain of three dependent claims down to the independent claim', () => {
		const claims = ['1. A pipe clamp comprising a band.', '2. The clamp of claim 1, wherein the band is steel.', '3. The clamp of claim 2, wherein the steel is stainless.', '4. The clamp of claim 3, wherein the band is polished.'];
		expect(tree(deriveFallbackLadder(snapshotOf(details('EP3000003B1', claims)), 'EP3000003'))).toEqual([
			{ claim: '1', rungs: [{ claim: '2', dependsOn: ['1'], chain: ['1', '2'] }, { claim: '3', dependsOn: ['2'], chain: ['1', '2', '3'] }, { claim: '4', dependsOn: ['3'], chain: ['1', '2', '3', '4'] }] },
		]);
	});

	it('gives no ladder and a reason for unsegmented claims', () => {
		const unsegmented: PatentEvidenceSource = { anchor: 'EP3000004B1:claims:en', text: '1. A clamp. 2. The clamp of claim 1.', reference: { publicationNumber: 'EP3000004B1', section: 'claims' }, language: 'en', retrieval: 'unsegmented', review: 'unknown', completeness: 'unknown' };
		expect(deriveFallbackLadder(snapshotOf(details('EP3000004B1', [], 'en', [unsegmented])), 'EP3000004B1')).toEqual({ kind: 'unavailable', publication: 'EP3000004B1', ladderUnavailable: LADDER_UNAVAILABLE });
	});
});

describe('fallback row checks (invalidity variant)', () => {
	const challenged = 'EP3000001B1';
	const challengedClaims = ['1. A pipe clamp comprising a band and a screw.', '2. The clamp according to claim 1, wherein the band is steel.', '3. The clamp according to claim 2, wherein the screw is captive.'];
	const description = `${challenged}:description:en`;
	const descriptionText = 'The band may be lined with rubber to protect the pipe.';
	const art = 'EP1000000A1:claims:1:en';
	const artClaim = '1. A pipe clamp comprising a steel band and a screw.';
	const snapshot = snapshotOf(
		{ id: 'search', recordedAt: '2026-10-17T00:30:00Z', kind: 'search', status: 'succeeded', query: 'ti=captive AND ti=screw', effectiveQuery: 'ti=captive AND ti=screw', total: 0, returned: 0 },
		details(challenged, challengedClaims, 'en', [{ anchor: description, text: descriptionText, reference: { publicationNumber: challenged, section: 'description' }, language: 'en', retrieval: 'returned', review: 'unknown', completeness: 'unknown' }]),
		details('EP1000000A1', [artClaim]),
		// A recorded drawing attempt lifts the figures gate, which these specs do not exercise.
		{ id: 'figures', recordedAt: '2026-10-17T02:00:00Z', kind: 'figures', status: 'failed', publicationIds: ['EP1000000A1'] },
	);
	const sources = new Map(snapshot.executions.flatMap(execution => execution.sources ?? []).map(source => [source.anchor, source]));
	const evidence = { anchor: art, quote: artClaim, scope: 'Independent claim 1 as quoted.', qualifiers: 'Structural recitation only.', quantityBasis: 'No numeric range.' };
	const review: PatentCandidateReview = {
		challengedPublication: challenged,
		coverage: [
			{ feature: 'Claim 1 — element (a): a band', claimNumber: '1', kind: 'feature', importance: 'essential', status: 'supported', sourceAnchors: [art], evidence: [evidence], elements: [{ element: 'a band', anchor: art, disclosedBy: 'a steel band' }], gap: '' },
			{ feature: 'Claim 1 as a whole', claimNumber: '1', kind: 'combination', importance: 'essential', status: 'supported', sourceAnchors: [art], evidence: [evidence], elements: [{ element: 'a band and a screw', anchor: art, disclosedBy: 'a steel band and a screw' }], gap: '' },
			{ feature: 'Claim 2 (depends on 1) — added limitation: the band is steel', claimNumber: '2', fallbackOf: '1', kind: 'fallback', importance: 'essential', status: 'supported', sourceAnchors: [art], evidence: [evidence], elements: [{ element: 'a steel band', anchor: art, disclosedBy: 'a steel band' }], gap: '' },
			{ feature: 'Claim 3 (depends on 2) — added limitation: the screw is captive', claimNumber: '3', fallbackOf: '1', kind: 'fallback', importance: 'essential', status: 'unresolved', sourceAnchors: [], gap: 'No cited passage makes the screw captive.' },
			{ feature: 'Description fallback — a rubber-lined band', fallbackOf: '1', basis: { anchor: description, quote: 'lined with   rubber' }, kind: 'fallback', importance: 'optional', status: 'unresolved', sourceAnchors: [], gap: 'No cited passage lines the band.' },
		],
		rounds: [{ round: 1, targets: ['3'], queries: [{ tool: 'search_patents', query: 'ti=captive  AND ti=screw', count: 0 }], outcome: 'Nothing new for claim 3.' }],
		limitations: ['Synthetic fixture.'],
		stopReason: 'One Search Round ran; claim 3 stays not covered.',
	};
	const coverage = review.coverage ?? [];
	const withRows = (...rows: typeof coverage) => ({ ...review, coverage: rows });

	it('accepts a complete chart and counts its Fallback Coverage', () => {
		const counts = fallbackCoverage(review, deriveFallbackLadder(snapshot, challenged));
		expect({ errors: validateCandidateReview(review, snapshot, '', 'invalidity'), counts, notCovered: fallbacksNotCovered(counts) }).toEqual({
			errors: [],
			counts: [{ claimNumber: '1', rungs: ['2', '3'], covered: ['2'], partly: [], notCovered: ['3', 'Description fallback — a rubber-lined band'], notCharted: [] }],
			notCovered: 2,
		});
	});

	it('leaves prior-art reviews without fallback rows', () => {
		expect(validateCandidateReview(review, snapshot, '', 'prior-art').filter(error => error.startsWith('Identify coverage kind'))).toEqual([
			'Identify coverage kind (feature or combination) for "Claim 2 (depends on 1) — added limitation: the band is steel".',
			'Identify coverage kind (feature or combination) for "Claim 3 (depends on 2) — added limitation: the screw is captive".',
			'Identify coverage kind (feature or combination) for "Description fallback — a rubber-lined band".',
		]);
	});

	it('refuses when the challenged patent\'s claims are not recorded', () => {
		expect(fallbackLadderErrors(review, snapshotOf(details('EP1000000A1', [artClaim])), sources)).toEqual([
			'No claims of the challenged patent EP3000001B1 are recorded this session: fetch the challenged patent\'s claims with get_patent_details first, and name it in challengedPublication. The writer builds the Fallback Ladder from that call.',
		]);
	});

	it('refuses a rung with no fallback row and no fallbacksNotCharted entry', () => {
		expect(fallbackLadderErrors(withRows(coverage[0], coverage[1], coverage[2]), snapshot, sources)).toEqual([
			'Claim 3 (chain 1 → 2 → 3) is a rung of claim 1\'s Fallback Ladder but has no fallback row and no fallbacksNotCharted entry. Chart the limitation it adds in one row (kind fallback, claimNumber 3, fallbackOf 1), or name it in fallbacksNotCharted with the reason.',
		]);
	});

	it('refuses a rung charted and also named as not charted', () => {
		expect(fallbackLadderErrors({ ...review, fallbacksNotCharted: [{ claimNumber: '3', reason: 'Outside the attack.' }] }, snapshot, sources)).toEqual([
			'Claim 3 is charted 1 time(s) under claim 1 and named 1 time(s) in fallbacksNotCharted. Give each rung exactly one fallback row or one fallbacksNotCharted entry.',
		]);
	});

	it('refuses a fallbacksNotCharted entry that names no rung', () => {
		expect(fallbackLadderErrors({ ...review, fallbacksNotCharted: [{ claimNumber: '9', reason: 'Use claim outside the attack.' }] }, snapshot, sources)).toEqual([
			'fallbacksNotCharted names claim 9, which is not a rung of any charted independent claim. Remove the entry, or chart the independent claim it depends on.',
		]);
	});

	it('refuses a fallback row whose claim is not a rung of its fallbackOf', () => {
		expect(fallbackLadderErrors(withRows(coverage[0], coverage[1], coverage[3], { ...coverage[2], claimNumber: '1' }), snapshot, sources)).toEqual([
			'Fallback row "Claim 2 (depends on 1) — added limitation: the band is steel" charts claim 1, which is not a rung of claim 1\'s Fallback Ladder (rungs: claims 2, 3). Name the independent claim claim 1 depends on in fallbackOf, or chart a rung of claim 1.',
			'Claim 2 (chain 1 → 2) is a rung of claim 1\'s Fallback Ladder but has no fallback row and no fallbacksNotCharted entry. Chart the limitation it adds in one row (kind fallback, claimNumber 2, fallbackOf 1), or name it in fallbacksNotCharted with the reason.',
		]);
	});

	it('refuses a fallback row with no fallbackOf', () => {
		expect(fallbackLadderErrors(withRows(coverage[0], coverage[1], coverage[2], { ...coverage[3], fallbackOf: undefined }, coverage[4]), snapshot, sources)).toEqual([
			'Fallback row "Claim 3 (depends on 2) — added limitation: the screw is captive" names no fallbackOf. Give the independent claim it falls back from.',
			'Claim 3 (chain 1 → 2 → 3) is a rung of claim 1\'s Fallback Ladder but has no fallback row and no fallbacksNotCharted entry. Chart the limitation it adds in one row (kind fallback, claimNumber 3, fallbackOf 1), or name it in fallbacksNotCharted with the reason.',
		]);
	});

	it('refuses a fallbackOf that names a claim without feature rows', () => {
		expect(fallbackLadderErrors(withRows(coverage[0], coverage[1], coverage[2], coverage[3], { ...coverage[4], fallbackOf: '2' }), snapshot, sources)).toEqual([
			'Fallback row "Description fallback — a rubber-lined band" falls back from claim 2, which has no feature rows. Chart the elements of claim 2 first, or name the charted independent claim in fallbackOf.',
		]);
	});

	it('refuses a description fallback whose basis quote is not in the recorded text', () => {
		expect(fallbackLadderErrors(withRows(coverage[0], coverage[1], coverage[2], coverage[3], { ...coverage[4], basis: { anchor: description, quote: 'lined with felt' } }), snapshot, sources)).toEqual([
			'basis.quote of description fallback "Description fallback — a rubber-lined band" is not found in the recorded text of EP3000001B1:description:en. Copy the passage verbatim; do not paraphrase or merge lines.',
		]);
	});

	it('refuses a description fallback whose basis is not the challenged patent\'s description', () => {
		expect(fallbackLadderErrors(withRows(coverage[0], coverage[1], coverage[2], coverage[3], { ...coverage[4], basis: { anchor: art, quote: 'a steel band' } }), snapshot, sources)).toEqual([
			'Description fallback "Description fallback — a rubber-lined band" cites basis.anchor EP1000000A1:claims:1:en, which is not a description passage of the challenged patent EP3000001B1. A fallback rests on the challenged patent\'s own description.',
		]);
	});

	it('refuses a Search Round query that matches no recorded execution', () => {
		expect(fallbackLadderErrors({ ...review, rounds: [{ round: 1, targets: ['3'], queries: [{ tool: 'search_patents', query: 'ti=captive AND ti=bolt' }, { tool: 'search_academic', query: 'ti=captive AND ti=screw' }], outcome: 'Nothing new.' }] }, snapshot, sources)).toEqual([
			'Search Round 1 lists search_patents query "ti=captive AND ti=bolt", which matches no tool execution recorded this session. Run the query, or copy it exactly as it ran (same tool, same text), or remove it from the round.',
			'Search Round 1 lists search_academic query "ti=captive AND ti=screw", which matches no tool execution recorded this session. Run the query, or copy it exactly as it ran (same tool, same text), or remove it from the round.',
		]);
	});

	it('gives unsegmented claims no ladder and no refusal', () => {
		const unsegmented: PatentEvidenceSource = { anchor: `${challenged}:claims:en`, text: challengedClaims.join(' '), reference: { publicationNumber: challenged, section: 'claims' }, language: 'en', retrieval: 'unsegmented', review: 'unknown', completeness: 'unknown' };
		const flat = snapshotOf(snapshot.executions[0], details(challenged, [], 'en', [unsegmented, snapshot.executions[1].sources![3]]), snapshot.executions[2]);
		expect(fallbackLadderErrors(review, flat, sources)).toEqual([]);
	});
});
