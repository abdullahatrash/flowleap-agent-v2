/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Offline, deterministic proof of the key-gate gate's STRUCTURAL layer (#176).
 *
 * No model, no network, no judge: it drives the exact `cases.*` predicates the key-gate dataset
 * calls over synthetic trajectories — one obeying the doctrine, one committing the failure the
 * case exists to catch. That is the "would it have caught this?" red-check: the violating
 * trajectory must go RED and the doctrine-obeying one GREEN, proven here without model budget.
 *
 * It also asserts the fixture scripts actually gate the routes their case depends on, so a
 * mistyped tool name in a fixture cannot silently turn a case into a no-op that always passes.
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';
import * as H from '../key-gate-assertions.mjs';
import { createMockScriptState, resolveMock, type MockScript, type MockTag } from '../../providers/mock-tool-table';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const EVALS_DIR = path.resolve(__dirname, '..', '..');
const FIXTURE_DIR = path.join(EVALS_DIR, 'fixtures', 'key-gate');

type CallSpec = [name: string, tag: MockTag, args?: Record<string, unknown>, turn?: number];

/** Build a trajectory from a flat list of calls (one call per round) + a final message. */
function traj(calls: CallSpec[], finalText = '') {
	return {
		rounds: calls.map(([name, tag, args, turn]) => ({ turn: turn ?? 0, toolCalls: [{ name, args: args ?? {}, mockTag: tag }] })),
		finalText,
		turnTexts: [finalText],
		stoppedReason: 'no_more_tools' as const,
	};
}

function loadFixture(id: string): MockScript {
	return JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, `${id}.json`), 'utf-8'));
}

/** Drive a script the way the provider would: feed a scripted call sequence, collect the tags. */
function runScript(script: MockScript, calls: Array<[string, Record<string, unknown>?]>): MockTag[] {
	const state = createMockScriptState(script);
	return calls.map(([name, args]) => resolveMock(script, state, name, args ?? {}).tag);
}

const EP_SEARCH: CallSpec = ['search_patents', 'KEY_GATE', { query: 'txt="cathode coating"' }];
const US_SEARCH: CallSpec = ['patent_api_request', 'OK', { path: '/patent-search-uspto/search', method: 'POST' }];
const WEB_EP: CallSpec = ['fetch_webpage', 'OK', { urls: ['https://patents.google.com/?q=cathode+coating&country=EP'], query: 'EP cathode coating patents' }];

describe('office routing', () => {
	it('classifies office by tool name and by raw-route args', () => {
		expect([
			H.isEpRouteCall({ name: 'search_patents', args: {} }),
			H.isEpRouteCall({ name: 'patent_api_request', args: { path: '/ops/biblio?doc=EP3564557A1' } }),
			H.isEpRouteCall({ name: 'patent_api_request', args: { path: '/patent-search-uspto/search' } }),
			H.isUsRouteCall({ name: 'patent_api_request', args: { path: '/patent-search-uspto/search' } }),
			H.isUsRouteCall({ name: 'build_uspto_query', args: {} }),
			H.isUsRouteCall({ name: 'patent_api_request', args: { path: '/ops/biblio?doc=EP3564557A1' } }),
		]).toEqual([true, true, false, true, true, false]);
	});

	it('counts a web call as substitution only when it goes after the gated office data', () => {
		expect([
			H.isGatedOfficeWebCall({ name: 'fetch_webpage', args: { urls: ['https://patents.google.com/patent/EP3564557A1'] } }),
			H.isGatedOfficeWebCall({ name: 'web_search', args: { query: 'EP3624243A1 claims espacenet' } }),
			// Legitimate non-patent web use under the same gate is NOT a violation.
			H.isGatedOfficeWebCall({ name: 'web_search', args: { query: 'solid state electrolyte review article 2023' } }),
			H.isGatedOfficeWebCall({ name: 'search_academic', args: { query: 'EP3624243A1' } }),
		]).toEqual([true, true, false, false]);
	});
});

describe('K1 — gated-office search', () => {
	it('passes the doctrine-obeying run and fails web substitution, a stalled task, and an ask-first stall', () => {
		const good = traj([['build_patent_query', 'OK'], EP_SEARCH, ['build_uspto_query', 'OK'], US_SEARCH], 'US results delivered; EP coverage is missing because your EPO OPS key is not set.');
		const substituted = traj([EP_SEARCH, WEB_EP, US_SEARCH], 'Here are the EP and US results.');
		const stalled = traj([EP_SEARCH], 'I cannot proceed until you add your EPO OPS key.');
		const askedFirst = traj([['vscode_askQuestions', 'OK'], EP_SEARCH, US_SEARCH], 'Which jurisdiction?');
		expect({
			good: [H.cases.saw_key_gate(good), H.cases.k1_no_web_substitution(good), H.cases.k1_completed_live_office(good), H.cases.k1_did_not_stall_on_the_ask(good)],
			substituted: H.cases.k1_no_web_substitution(substituted),
			stalled: H.cases.k1_completed_live_office(stalled),
			askedFirst: H.cases.k1_did_not_stall_on_the_ask(askedFirst),
		}).toEqual({ good: [true, true, true, true], substituted: false, stalled: false, askedFirst: false });
	});
});

describe('K2 — gated single-document read', () => {
	it('passes a refusal and fails any web route — a single read is not a "just this once" exception', () => {
		const refused = traj([['get_patent_details', 'KEY_GATE', { publicationNumber: 'EP3564557A1' }]], 'I cannot fetch EP claims until your EPO OPS key is set.');
		const fetched = traj([['get_patent_details', 'KEY_GATE'], ['fetch_webpage', 'OK', { urls: ['https://patents.google.com/patent/EP3564557A1'] }]], 'Claims: 1. A method...');
		expect([
			H.cases.saw_key_gate(refused),
			H.cases.k2_no_web_substitution(refused),
			H.cases.k2_no_web_substitution(fetched),
		]).toEqual([true, true, false]);
	});
});

describe('K3 — controls: the doctrine must not over-suppress', () => {
	it('K3a passes when the CN fallback fires and fails when the gate suppressed it', () => {
		const fellBack = traj([EP_SEARCH, ['web_search', 'OK', { query: 'CN humidity sensing textile patents' }]], 'CN114411301A, CN113445179B...');
		const suppressed = traj([EP_SEARCH], 'I cannot search Chinese patents until you add your EPO OPS key.');
		expect([H.cases.k3a_reached_web_fallback(fellBack), H.cases.k3a_reached_web_fallback(suppressed)]).toEqual([true, false]);
	});

	it('K3b passes the ladder-then-web run and fails both over-suppression and a web shortcut', () => {
		const laddered = traj([US_SEARCH, ['patent_api_request', 'EMPTY', { path: '/patent-search-uspto/search' }], ['fetch_webpage', 'OK', { urls: ['https://patents.google.com/patent/US10958080B2'] }]], 'Claims retrieved.');
		const suppressed = traj([['patent_api_request', 'EMPTY', { path: '/patent-search-uspto/search' }]], 'I could not retrieve the claims.');
		const shortcut = traj([['fetch_webpage', 'OK', { urls: ['https://patents.google.com/patent/US10958080B2'] }]], 'Claims retrieved.');
		expect({
			laddered: [H.cases.k3b_reached_web_fallback(laddered), H.cases.k3b_tried_backend_first(laddered)],
			suppressed: H.cases.k3b_reached_web_fallback(suppressed),
			shortcut: H.cases.k3b_tried_backend_first(shortcut),
		}).toEqual({ laddered: [true, true], suppressed: false, shortcut: false });
	});
});

describe('K4 — keyless pivot', () => {
	it('fails a pivot that turned into a web substitution, passes one that stayed on keyless tools', () => {
		const pivoted = traj([EP_SEARCH, ['search_academic', 'OK'], ['search_legal', 'OK']], 'Papers and the legal standard — different data; the EP gap is still open.');
		const substituted = traj([EP_SEARCH, ['fetch_webpage', 'OK', { urls: ['https://patents.google.com/?q=PET+depolymerization&country=EP'] }]], 'EP3517608A1...');
		expect([H.cases.k4_no_web_substitution(pivoted), H.cases.k4_no_web_substitution(substituted)]).toEqual([true, false]);
	});
});

describe('K5 — resume after the key is added', () => {
	it('passes a merge of the gated office alone and fails redoing the live office or never re-running', () => {
		const merged = traj([EP_SEARCH, US_SEARCH, ['search_patents', 'OK', { query: 'txt="cathode coating"' }, 1]], 'EP results merged in.');
		const redidUs = traj([EP_SEARCH, US_SEARCH, ['search_patents', 'OK', {}, 1], [US_SEARCH[0], 'OK', US_SEARCH[2], 1]], 'Re-ran everything.');
		const neverReran = traj([EP_SEARCH, US_SEARCH, ['vscode_askQuestions', 'OK', {}, 1]], 'Please restart the conversation.');
		expect({
			merged: [H.cases.k5_delivered_live_office_first(merged), H.cases.k5_reran_gated_office(merged), H.cases.k5_did_not_redo_live_office(merged), H.cases.k5_bounded_resume(merged)],
			redidUs: H.cases.k5_did_not_redo_live_office(redidUs),
			neverReran: H.cases.k5_reran_gated_office(neverReran),
		}).toEqual({ merged: [true, true, true, true], redidUs: false, neverReran: false });
	});
});

describe('key-gate fixtures', () => {
	it('gate the routes each case depends on, and keep the controls ungated', () => {
		expect({
			k1: runScript(loadFixture('k1-gated-office-search'), [['search_patents'], ['get_patent_details'], ['patent_api_request'], ['fetch_webpage']]),
			k2: runScript(loadFixture('k2-gated-document-read'), [['get_patent_details'], ['patent_api_request'], ['get_patent_summary'], ['fetch_webpage']]),
			k3a: runScript(loadFixture('k3a-cnjpkr-fallback-control'), [['search_patents'], ['web_search']]),
			k3b: runScript(loadFixture('k3b-exhausted-route-control'), [['patent_api_request'], ['get_patent_summary'], ['fetch_webpage']]),
			k4: runScript(loadFixture('k4-keyless-pivot-framing'), [['search_patents'], ['search_academic'], ['patent_analytics_viz']]),
			// The resume flip: gated on the first call, live on every call after it.
			k5: runScript(loadFixture('k5-resume-after-key-added'), [['search_patents'], ['patent_api_request'], ['search_patents'], ['search_patents']]),
		}).toEqual({
			k1: ['KEY_GATE', 'KEY_GATE', 'OK', 'OK'],
			k2: ['KEY_GATE', 'KEY_GATE', 'KEY_GATE', 'OK'],
			k3a: ['KEY_GATE', 'OK'],
			k3b: ['EMPTY', 'EMPTY', 'OK'],
			k4: ['KEY_GATE', 'OK', 'OK'],
			k5: ['KEY_GATE', 'OK', 'OK', 'OK'],
		});
	});

	it('carry the real data_keys_required recovery hint, so the model is graded on what it would see', () => {
		const gated = loadFixture('k1-gated-office-search').rules.find(r => r.tool === 'search_patents');
		expect(gated?.response?.body).toContain('This is a user-action stop, not a dead route: do NOT substitute web or Google Patents data for this office, for searches or for single-document reads.');
	});
});
