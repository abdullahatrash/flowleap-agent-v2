/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Offline, deterministic proof of the trajectory gate's STRUCTURAL layer (H4 §3, ticket
 * acceptance "structural layer fully runnable offline/deterministic — never fake a judge
 * result"). No model, no network, no judge: it drives the exact `cases.*` predicates the
 * promptfoo dataset calls, plus the mock-table resolver, over synthetic trajectories that
 * mirror the H1 repro-corpus failures and their post-fix good runs.
 *
 * This doubles as the design's "would it have caught this?" red-check (H4 §5): the pre-fix
 * give-up trajectories go RED on the structural predicate; the post-fix good trajectories go
 * GREEN — proven here without spending model budget.
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';
import * as H from '../trajectory-assertions.mjs';
import { createMockScriptState, resolveMock, type MockScript } from '../../providers/mock-tool-table';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const EVALS_DIR = path.resolve(__dirname, '..', '..');
const FIXTURE_DIR = path.join(EVALS_DIR, 'fixtures', 'trajectory');

type Tag = 'OK' | 'EMPTY' | 'HTTP_5XX' | 'TRUNCATED';
type CallSpec = [name: string, tag: Tag, args?: Record<string, unknown>];

/** Build a trajectory from a flat list of calls (one call per round) + a final message. */
function traj(calls: CallSpec[], finalText = '', stoppedReason: 'no_more_tools' | 'max_rounds' = 'no_more_tools') {
	return {
		rounds: calls.map(([name, tag, args]) => ({ toolCalls: [{ name, args: args ?? {}, mockTag: tag }] })),
		finalText,
		stoppedReason,
	};
}

function loadFixture(id: string): MockScript {
	return JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, `${id}.json`), 'utf-8'));
}

/** Drive a script the way the provider would: feed a scripted call sequence, collect the tags. */
function runScript(script: MockScript, calls: Array<[string, Record<string, unknown>?]>): Tag[] {
	const state = createMockScriptState(script);
	return calls.map(([name, args]) => resolveMock(script, state, name, args ?? {}).tag);
}

describe('trajectory helpers', () => {
	it('reachedTool matches by name and by lenient arg subset', () => {
		const t = traj([['search_forward_citations', 'EMPTY'], ['search_citations', 'OK', { applicationNumber: '16473445', category: 'X' }]]);
		expect(H.reachedTool(t, 'search_citations')).toBe(true);
		expect(H.reachedTool(t, ['fetch_webpage', 'web_search'])).toBe(false);
		expect(H.reachedTool(t, 'search_citations', { argMatch: { applicationNumber: '16473445' } })).toBe(true);
		expect(H.reachedTool(t, 'search_citations', { argMatch: { applicationNumber: '99999999' } })).toBe(false);
	});

	it('reactedAfter finds a later different-tool call after the tagged result', () => {
		const recovered = traj([['patent_api_request', 'TRUNCATED'], ['fetch_webpage', 'OK']]);
		const stopped = traj([['patent_api_request', 'TRUNCATED']]);
		expect(H.reactedAfter(recovered, 'TRUNCATED', { differentTool: true })).toBe(true);
		expect(H.reactedAfter(stopped, 'TRUNCATED', { differentTool: true })).toBe(false);
		// differentTool:false counts a same-tool retry.
		const retried = traj([['search_patents', 'HTTP_5XX'], ['search_patents', 'OK']]);
		expect(H.reactedAfter(retried, 'HTTP_5XX', { differentTool: true })).toBe(false);
		expect(H.reactedAfter(retried, 'HTTP_5XX', { differentTool: false })).toBe(true);
	});

	it('countTool and distinctToolCount count across rounds', () => {
		const t = traj([['search_patents', 'HTTP_5XX'], ['search_patents', 'HTTP_5XX'], ['search_patents', 'OK'], ['patent_analytics_viz', 'OK']]);
		expect(H.countTool(t, 'search_patents')).toBe(3);
		expect(H.distinctToolCount(t)).toBe(2);
	});
});

describe('mock-table resolver (deterministic sequences)', () => {
	it('T3a returns 5xx, 5xx, then OK for search_patents', () => {
		const tags = runScript(loadFixture('t3a-transient-5xx-recovers'), [['search_patents'], ['search_patents'], ['search_patents'], ['search_patents']]);
		expect(tags).toStrictEqual(['HTTP_5XX', 'HTTP_5XX', 'OK', 'OK']); // clamps to last (OK) past the sequence
	});

	it('T3b keeps returning 5xx (persistent)', () => {
		const tags = runScript(loadFixture('t3b-transient-5xx-persistent'), Array.from({ length: 6 }, () => ['search_patents'] as [string]));
		expect(tags).toStrictEqual(['HTTP_5XX', 'HTTP_5XX', 'HTTP_5XX', 'HTTP_5XX', 'HTTP_5XX', 'HTTP_5XX']);
	});

	it('T2 routes forward citations to EMPTY and the app-number backward citation to OK', () => {
		const script = loadFixture('t2-empty-citation-sibling');
		const state = createMockScriptState(script);
		expect(resolveMock(script, state, 'search_forward_citations', { citedDocument: 'EP3564557A1', category: 'X' }).tag).toBe('EMPTY');
		expect(resolveMock(script, state, 'search_citations', { applicationNumber: '16473445', category: 'X' }).tag).toBe('OK');
		// A search_citations without the app number does NOT get the X-citations.
		expect(resolveMock(script, state, 'search_citations', { publicationNumber: 'EP3564557A1' }).tag).toBe('EMPTY');
	});

	it('T1 drops the single-record claims route (TRUNCATED) and serves web fallback OK', () => {
		const script = loadFixture('t1-us-claims-exhausted');
		const state = createMockScriptState(script);
		expect(resolveMock(script, state, 'patent_api_request', { path: '/patent-search-uspto/search' }).tag).toBe('TRUNCATED');
		expect(resolveMock(script, state, 'fetch_webpage', { url: 'https://patents.google.com/patent/US10958080B2' }).tag).toBe('OK');
	});

	it('the TRUNCATED body is the verbatim empty-bag + refine note from the R1 transcript', () => {
		const script = loadFixture('t1-us-claims-exhausted');
		const state = createMockScriptState(script);
		const body = resolveMock(script, state, 'patent_api_request', {}).body;
		expect(body).toContain('"patentFileWrapperDataBag": []');
		expect(body).toContain('Refine your query');
	});
});

describe('every fixture is a well-formed MockScript', () => {
	const ids = fs.readdirSync(FIXTURE_DIR).filter(f => f.endsWith('.json')).map(f => f.replace(/\.json$/, ''));

	it('all 8 T-case fixtures are present', () => {
		expect(ids.sort()).toStrictEqual([
			't1-us-claims-exhausted',
			't2-empty-citation-sibling',
			't3a-transient-5xx-recovers',
			't3b-transient-5xx-persistent',
			't4-multistep-chain',
			't5-truncation-not-nodata',
			't6-true-zero-reformulate',
			't7-negative-control-bounded',
			't8-jurisdiction-nonblock',
		].sort());
	});

	it.each(ids)('%s parses and every rule carries a response or responses', id => {
		const script = loadFixture(id);
		expect(script.id).toBe(id);
		expect(Array.isArray(script.rules)).toBe(true);
		for (const rule of script.rules) {
			expect(typeof rule.tool).toBe('string');
			const hasOne = Boolean(rule.response) || (Array.isArray(rule.responses) && rule.responses.length > 0);
			expect(hasOne).toBe(true);
		}
	});
});

// ─────────────────────────────────────────────────────────────────────────────────────────
// The design's "would it have caught this?" table (H4 §5), executed offline: each pre-fix
// Sonnet-4 give-up is a RED on the structural predicate; each post-fix good run is a GREEN.
// ─────────────────────────────────────────────────────────────────────────────────────────
describe('gate red-check: H1 pre-fix give-ups fail RED, post-fix good runs pass GREEN', () => {
	it('T1 (R1): quit without web fallback = RED; used fetch_webpage = GREEN', () => {
		const preFix = traj(
			[['patent_api_request', 'TRUNCATED'], ['patent_api_request', 'TRUNCATED']],
			"Since we don't have web search capabilities, use commercial patent databases like Derwent / PatBase / Orbit.",
		);
		const postFix = traj(
			[['patent_api_request', 'TRUNCATED'], ['get_patent_details', 'OK'], ['fetch_webpage', 'OK']],
			'I retrieved the full claims from the USPTO grant document.',
		);
		expect(H.cases.t1_reached_web_fallback(preFix)).toBe(false);
		expect(H.cases.t1_reached_web_fallback(postFix)).toBe(true);
	});

	it('T2 (S3): never reached backward citation on the app number = RED; reached it = GREEN', () => {
		const preFix = traj(
			[['get_patent_details', 'OK'], ['search_forward_citations', 'EMPTY'], ['get_register_events', 'OK']],
			'No X-category prior-art references were found.',
		);
		const postFix = traj(
			[['get_patent_details', 'OK'], ['search_forward_citations', 'EMPTY'], ['get_patent_family', 'OK'], ['get_continuity', 'OK'], ['search_citations', 'OK', { applicationNumber: '16473445', category: 'X' }]],
			'Cited as X against the US application: US20060169553A1.',
		);
		// The current-tree ideal: route STRAIGHT to the backward citation, never hitting the
		// empty forward dead-end. The support guard must not penalize that.
		const idealNoDeadEnd = traj(
			[['get_patent_details', 'OK'], ['get_patent_family', 'OK'], ['search_citations', 'OK', { applicationNumber: '16473445' }]],
			'Cited as X: US20060169553A1.',
		);
		expect(H.cases.t2_reached_backward_citation(preFix)).toBe(false); // primary goes RED
		expect(H.cases.t2_reached_backward_citation(postFix)).toBe(true);
		expect(H.cases.t2_did_not_stop_at_empty_forward(preFix)).toBe(true); // moved on (wrong tool) — primary still fails the case
		expect(H.cases.t2_did_not_stop_at_empty_forward(idealNoDeadEnd)).toBe(true); // skipped the dead-end entirely
		// A true stop-at-empty-forward (no later tool) goes RED on the support guard too.
		const stoppedAtEmpty = traj([['get_patent_details', 'OK'], ['search_forward_citations', 'EMPTY']], 'No X references found.');
		expect(H.cases.t2_did_not_stop_at_empty_forward(stoppedAtEmpty)).toBe(false);
	});

	it('T3a/T3b (R4): one attempt then give-up = RED; retried through the 5xx = GREEN', () => {
		const preFix = traj([['search_patents', 'HTTP_5XX']], 'Backend connectivity issues preventing the forward citation analysis.');
		const postFixA = traj([['build_patent_query', 'OK'], ['search_patents', 'HTTP_5XX'], ['search_patents', 'HTTP_5XX'], ['search_patents', 'OK']]);
		const postFixB = traj([['search_patents', 'HTTP_5XX'], ['search_patents', 'HTTP_5XX'], ['search_patents', 'HTTP_5XX'], ['search_patents', 'HTTP_5XX']]);
		expect(H.cases.t3a_retried_search(preFix)).toBe(false);
		expect(H.cases.t3a_retried_search(postFixA)).toBe(true);
		expect(H.cases.t3a_continued_past_5xx(postFixA)).toBe(true);
		expect(H.cases.t3b_persisted_3plus(preFix)).toBe(false);
		expect(H.cases.t3b_persisted_3plus(postFixB)).toBe(true);
	});

	it('T4: stop after step 1 = RED; reach the terminal tool over the minimal chain = GREEN', () => {
		const preFix = traj([['get_patent_details', 'OK']], 'Here is the bibliography.');
		// The current tree's real walk: family → continuity → citations (3 distinct), skipping
		// a redundant get_patent_details because it already has the number.
		const minimalChain = traj([['get_patent_family', 'OK'], ['get_continuity', 'OK'], ['search_citations', 'OK', { applicationNumber: '16473445' }]]);
		expect(H.cases.t4_reached_terminal_tool(preFix)).toBe(false);
		expect(H.cases.t4_walked_the_chain(preFix)).toBe(false);
		expect(H.cases.t4_reached_terminal_tool(minimalChain)).toBe(true);
		expect(H.cases.t4_walked_the_chain(minimalChain)).toBe(true);
		// A stop after step 2 (2 distinct) still fails the walk guard.
		const stopAtStep2 = traj([['get_patent_family', 'OK'], ['get_continuity', 'OK']], 'Found the app number.');
		expect(H.cases.t4_walked_the_chain(stopAtStep2)).toBe(false);
	});

	it('T5: read the truncation-drop as no-data-and-stop = RED; offloaded/fell back = GREEN', () => {
		const preFix = traj([['patent_api_request', 'TRUNCATED']], 'The response was truncated; no claim data is available.');
		const postFix = traj([['patent_api_request', 'TRUNCATED'], ['fetch_webpage', 'OK']], 'Retrieved the claims from Google Patents.');
		expect(H.cases.t5_reacted_after_truncation(preFix)).toBe(false);
		expect(H.cases.t5_reacted_after_truncation(postFix)).toBe(true);
	});

	it('T6: stop at first clean zero = RED; reformulate/broaden = GREEN', () => {
		const preFix = traj([['search_patents', 'EMPTY']], 'No prior art found.');
		const postFix = traj([['build_patent_query', 'OK'], ['search_patents', 'EMPTY'], ['search_patents', 'OK']]);
		expect(H.cases.t6_reformulated_after_zero(preFix)).toBe(false);
		expect(H.cases.t6_reformulated_after_zero(postFix)).toBe(true);
	});

	it('T7 negative control: bounded null stays GREEN; runaway grind goes RED', () => {
		const bounded = traj([['build_patent_query', 'OK'], ['search_patents', 'EMPTY'], ['search_patents', 'EMPTY']], 'I could not find any matching patents.');
		const runaway = traj(Array.from({ length: 20 }, () => ['search_patents', 'EMPTY'] as CallSpec), '');
		expect(H.cases.t7_bounded_engagement(bounded)).toBe(true);
		expect(H.cases.t7_bounded_engagement(runaway)).toBe(false);
	});

	it('T8: jurisdiction question before any search = RED; searched first = GREEN', () => {
		const preFix = traj([['vscode_askQuestions', 'OK'], ['search_patents', 'OK']]);
		const postFix = traj([['build_patent_query', 'OK'], ['search_patents', 'OK']]);
		expect(H.cases.t8_searched_before_jurisdiction_question(preFix)).toBe(false);
		expect(H.cases.t8_searched_before_jurisdiction_question(postFix)).toBe(true);
	});
});
