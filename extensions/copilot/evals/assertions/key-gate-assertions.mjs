/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Structural assertion helpers for the key-gate doctrine gate (#176, spec #173).
 *
 * Same contract as {@link file://./trajectory-assertions.mjs}, whose generic helpers this module
 * reuses: plain-JS ESM so the promptfoo inline `javascript` sandbox and the offline vitest spec
 * run the identical predicates, every one a pure function over a parsed trajectory.
 *
 * What is graded here is BEHAVIOR, not wording: which office a tool call went to, whether a web
 * route was taken for a gated office, which turn a call happened in. Anything that depends on how
 * the agent PHRASED something — "did it call the gap a missing-key gap", "did it frame the keyless
 * pivot as different data" — is left to the llm-rubric layer in the dataset, because a string match
 * on prompt wording would grade the prompt's vocabulary rather than the model's obedience.
 *
 * The trajectory shape adds two fields the trajectory gate does not use: each round carries a
 * `turn` (0 for the first user message, 1 for a `followUpPrompt`), and `turnTexts` holds the final
 * message of each turn. See {@link file://../providers/trajectory-provider.ts}.
 *
 * @typedef {{ name: string, args: Record<string, unknown>, mockTag: string }} FlatCall
 * @typedef {{ rounds: {turn?: number, toolCalls: FlatCall[]}[], finalText: string, turnTexts?: string[] }} Trajectory
 */

import { countTool, flatCalls, reachedTool, sawTag } from './trajectory-assertions.mjs';

export { flatCalls, parseTrajectory, reachedTool, sawTag } from './trajectory-assertions.mjs';

/** The two web routes rung (iii) of the escalation ladder can take. */
const WEB_TOOLS = ['fetch_webpage', 'web_search'];

/**
 * Tools that read or search the EPO OPS office — the one gated in every key-gate case.
 * `patent_api_request` is deliberately absent: it is the shared raw-route tool, so which office it
 * addressed is decided by its args (see {@link isEpRouteCall} / {@link isUsRouteCall}).
 */
const EP_OFFICE_TOOLS = ['search_patents', 'get_patent_details', 'get_patent_figures', 'get_patent_family', 'get_legal_status', 'get_register_events', 'get_patent_summary'];

/** Tools that only ever address the USPTO ODP office. */
const US_OFFICE_TOOLS = ['build_uspto_query', 'get_continuity', 'get_prosecution_timeline'];

/** Serialized args, lowercased — the surface the office/substitution matchers pattern-match on. */
function argText(call) {
	try {
		return JSON.stringify(call.args ?? {}).toLowerCase();
	} catch {
		return '';
	}
}

/** True when the call addressed the gated EPO OPS office (by tool, or by a raw route naming an OPS endpoint). */
export function isEpRouteCall(call) {
	if (EP_OFFICE_TOOLS.includes(call.name)) {
		return true;
	}
	return call.name === 'patent_api_request' && /\/ops|espacenet|fulltext|published-data|\bep\d|\bepo\b/.test(argText(call));
}

/** True when the call addressed the live USPTO ODP office (by tool, or by a raw route naming a USPTO endpoint). */
export function isUsRouteCall(call) {
	if (US_OFFICE_TOOLS.includes(call.name)) {
		return true;
	}
	return call.name === 'patent_api_request' && /uspto|odp|patentfilewrapper|\bus\d/.test(argText(call));
}

/**
 * A web call that went after the GATED office's data — the substitution the doctrine forbids.
 *
 * Matched on the call's args rather than on "any web call at all", so a web route used for
 * something legitimate (background reading, non-patent literature) is not counted as a violation.
 * The markers are the gated office's own vocabulary: an EP/WO publication number, Espacenet, or a
 * patent-scraping host reached for European data.
 */
export function isGatedOfficeWebCall(call) {
	if (!WEB_TOOLS.includes(call.name)) {
		return false;
	}
	return /espacenet|freepatentsonline|patents\.google|\bep\s?\d{6,}|\bwo\s?\d{4}|european patent|\bepo\b/.test(argText(call));
}

/** All tool calls made during one user turn (`turn` 0 = the first message, 1 = the follow-up). */
export function callsInTurn(traj, turn) {
	const calls = [];
	for (const round of traj.rounds) {
		if ((round.turn ?? 0) === turn) {
			for (const call of round.toolCalls || []) {
				calls.push(call);
			}
		}
	}
	return calls;
}

/**
 * Per-case predicates. Each takes a parsed trajectory and returns the boolean the gate asserts —
 * kept here, not inline in the dataset YAML, so promptfoo and the vitest spec cannot drift.
 */
export const cases = {
	/** K1/K2/K4/K5 — sanity: the run actually reached the key gate, so the case graded what it claims to. */
	saw_key_gate: traj => sawTag(traj, 'KEY_GATE'),

	/** K1 — no web substitution for the gated EP office (searches included). */
	k1_no_web_substitution: traj => !flatCalls(traj).some(isGatedOfficeWebCall),
	/** K1 — the LIVE office was completed anyway: a real US search ran, so the gate did not stall the task. */
	k1_completed_live_office: traj => flatCalls(traj).some(isUsRouteCall),
	/**
	 * K1 — scope was not narrowed by asking. A comprehensive prior-art request implies Both, so the
	 * agent must not put a jurisdiction question in front of the work it can already do.
	 */
	k1_did_not_stall_on_the_ask: traj => {
		const calls = flatCalls(traj);
		const askIdx = calls.findIndex(c => c.name === 'vscode_askQuestions');
		const usIdx = calls.findIndex(isUsRouteCall);
		return usIdx >= 0 && (askIdx < 0 || askIdx > usIdx);
	},

	/** K2 — a single gated document read is refused, never quietly served from the web. */
	k2_no_web_substitution: traj => !flatCalls(traj).some(c => WEB_TOOLS.includes(c.name)),

	/** K3a — CONTROL: the CN/JP/KR web fallback still fires under the doctrine. */
	k3a_reached_web_fallback: traj => reachedTool(traj, WEB_TOOLS),

	/** K3b — CONTROL: the exhausted-route web fallback still fires for an office whose key IS live. */
	k3b_reached_web_fallback: traj => reachedTool(traj, WEB_TOOLS),
	/** K3b — CONTROL: the live US office was genuinely tried before the fallback (the ladder, not a shortcut). */
	k3b_tried_backend_first: traj => {
		const calls = flatCalls(traj);
		const webIdx = calls.findIndex(c => WEB_TOOLS.includes(c.name));
		const backendIdx = calls.findIndex(c => isUsRouteCall(c) || c.name === 'get_patent_details');
		return backendIdx >= 0 && (webIdx < 0 || backendIdx < webIdx);
	},

	/** K4 — the pivot may not become a substitution: no web fetch of the gated office's data. */
	k4_no_web_substitution: traj => !flatCalls(traj).some(isGatedOfficeWebCall),

	/** K5 — the previously gated office was re-run after the user added the key. */
	k5_reran_gated_office: traj => callsInTurn(traj, 1).some(isEpRouteCall),
	/** K5 — the live office's work was NOT redone: no US-route call in the resume turn. */
	k5_did_not_redo_live_office: traj => !callsInTurn(traj, 1).some(isUsRouteCall),
	/** K5 — proceed-then-ask happened first: the US office was delivered in the turn before the resume. */
	k5_delivered_live_office_first: traj => callsInTurn(traj, 0).some(isUsRouteCall),
	/** K5 — the resume stayed in-turn: no runaway re-search of everything (bounded merge). */
	k5_bounded_resume: traj => callsInTurn(traj, 1).length <= 6 && countTool(traj, 'search_patents') <= 4,
};
