/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Trajectory-structural assertion helpers for the H4 gate (design §3).
 *
 * Plain-JS ESM on purpose: these run in BOTH promptfoo's inline `javascript` assertion
 * sandbox (via dynamic `import()`) and the offline vitest spec, so they must not depend on
 * a TypeScript loader. Every helper is a pure function over a parsed trajectory object —
 * fully deterministic, no model, no network. The give-up NARRATION check is deliberately
 * NOT here: that one thing structure cannot see is left to the thin secondary llm-rubric
 * layer.
 *
 * A trajectory is `{ rounds: [{ toolCalls: [{ name, args, mockTag }] }], finalText, stoppedReason }`,
 * exactly what {@link file://../providers/trajectory-provider.ts} emits.
 *
 * @typedef {'OK'|'EMPTY'|'HTTP_5XX'|'TRUNCATED'} MockTag
 * @typedef {{ name: string, args: Record<string, unknown>, mockTag: MockTag }} FlatCall
 * @typedef {{ rounds: {toolCalls: FlatCall[]}[], finalText: string, stoppedReason?: string }} Trajectory
 */

/**
 * Accept either a parsed trajectory or the JSON string promptfoo hands assertions.
 * @param {unknown} output
 * @returns {Trajectory}
 */
export function parseTrajectory(output) {
	const traj = typeof output === 'string' ? JSON.parse(output) : output;
	if (!traj || !Array.isArray(traj.rounds)) {
		throw new Error('parseTrajectory: output is not a trajectory object with a rounds array');
	}
	return traj;
}

/**
 * Flatten all tool calls across rounds into a single ordered list.
 * @param {Trajectory} traj
 * @returns {FlatCall[]}
 */
export function flatCalls(traj) {
	const calls = [];
	for (const round of traj.rounds) {
		for (const call of round.toolCalls || []) {
			calls.push(call);
		}
	}
	return calls;
}

/**
 * Lenient argument-subset match: every key in `argMatch` is present in `args` and the call
 * value contains the expected value (case-insensitive substring).
 * @param {Record<string, unknown>} args
 * @param {Record<string, string|number>} argMatch
 */
function argsMatch(args, argMatch) {
	return Object.entries(argMatch).every(([key, expected]) => {
		const actual = args?.[key];
		if (actual === undefined || actual === null) {
			return false;
		}
		return String(actual).toLowerCase().includes(String(expected).toLowerCase());
	});
}

/**
 * Did the trajectory ever reach one of `names` (optionally with matching args)?
 * @param {Trajectory} traj
 * @param {string|string[]} names one tool name or a set of acceptable names
 * @param {{ argMatch?: Record<string, string|number> }} [opts]
 * @returns {boolean}
 */
export function reachedTool(traj, names, opts = {}) {
	const wanted = Array.isArray(names) ? names : [names];
	return flatCalls(traj).some(call =>
		wanted.includes(call.name) && (!opts.argMatch || argsMatch(call.args, opts.argMatch)),
	);
}

/**
 * Core "did call N+1 happen after failure-result N" check.
 *
 * Finds the FIRST call whose result carried `mockTag` (EMPTY / HTTP_5XX / TRUNCATED) and
 * returns true when a subsequent tool call exists before the run ended — of a DIFFERENT tool
 * when `differentTool` (route to a sibling / fallback), or any tool when `differentTool:false`
 * (a retry of the same tool counts, e.g. a transient-5xx retry).
 *
 * @param {Trajectory} traj
 * @param {MockTag} mockTag
 * @param {{ differentTool?: boolean }} [opts]
 * @returns {boolean}
 */
export function reactedAfter(traj, mockTag, opts = {}) {
	const differentTool = opts.differentTool !== false; // default true
	const calls = flatCalls(traj);
	const firstIdx = calls.findIndex(c => c.mockTag === mockTag);
	if (firstIdx < 0) {
		return false;
	}
	const failedName = calls[firstIdx].name;
	for (let i = firstIdx + 1; i < calls.length; i++) {
		if (!differentTool || calls[i].name !== failedName) {
			return true;
		}
	}
	return false;
}

/**
 * How many times a given tool was called across the whole trajectory.
 * @param {Trajectory} traj
 * @param {string} name
 * @returns {number}
 */
export function countTool(traj, name) {
	return flatCalls(traj).filter(c => c.name === name).length;
}

/**
 * Was `name` the FIRST tool call of the run? (used to detect a stall before any search).
 * @param {Trajectory} traj
 * @param {string} name
 * @returns {boolean}
 */
export function firstToolWas(traj, name) {
	const calls = flatCalls(traj);
	return calls.length > 0 && calls[0].name === name;
}

/**
 * Did any call before the first occurrence of `beforeName` reach one of `names`?
 * Answers "did a search tool run before the jurisdiction question was asked" (T8).
 * @param {Trajectory} traj
 * @param {string|string[]} names
 * @param {string} beforeName the gate/blocker tool
 * @returns {boolean}
 */
export function reachedToolBefore(traj, names, beforeName) {
	const wanted = Array.isArray(names) ? names : [names];
	const calls = flatCalls(traj);
	const blockerIdx = calls.findIndex(c => c.name === beforeName);
	const limit = blockerIdx < 0 ? calls.length : blockerIdx;
	for (let i = 0; i < limit; i++) {
		if (wanted.includes(calls[i].name)) {
			return true;
		}
	}
	return false;
}

/**
 * Number of distinct tool names in the trajectory.
 * @param {Trajectory} traj
 * @returns {number}
 */
export function distinctToolCount(traj) {
	return new Set(flatCalls(traj).map(c => c.name)).size;
}

/**
 * Did any tool result in the trajectory carry the given tag?
 * @param {Trajectory} traj
 * @param {MockTag} tag
 * @returns {boolean}
 */
export function sawTag(traj, tag) {
	return flatCalls(traj).some(c => c.mockTag === tag);
}

/**
 * Per-case structural predicates (H4 §4). Each takes a parsed trajectory and returns the
 * boolean the gate asserts. Kept HERE (not inline in the dataset YAML) so the promptfoo
 * asserts and the offline vitest spec exercise the exact same logic — no drift. Every one
 * is a pure function; the give-up NARRATION checks stay in the dataset's llm-rubric layer.
 */
export const cases = {
	/** T1 — reached the web fallback after the backend claims route was exhausted. */
	t1_reached_web_fallback: traj => reachedTool(traj, ['fetch_webpage', 'web_search']),

	/** T2 — reached the sibling backward-citation tool keyed on the US application number. */
	t2_reached_backward_citation: traj => reachedTool(traj, 'search_citations', { argMatch: { applicationNumber: '16473445' } }),
	/**
	 * T2 — did NOT stop at the empty forward-citation dead-end. Passes when the model either
	 * never hit the wrong tool at all (routed straight to the correct backward citation — the
	 * ideal, observed with the current prompt) OR moved on to a different tool after the empty
	 * forward result. The failure this guards is the S3 give-up: hit the empty forward result
	 * and stop. It must not penalize the model for being good enough to skip the dead-end.
	 */
	t2_did_not_stop_at_empty_forward: traj => !sawTag(traj, 'EMPTY') || reactedAfter(traj, 'EMPTY', { differentTool: true }),

	/** T3a — retried the search at least twice (through the transient 5xx). */
	t3a_retried_search: traj => countTool(traj, 'search_patents') >= 2,
	/** T3a — continued past the first 5xx (a subsequent call, retry included). */
	t3a_continued_past_5xx: traj => reactedAfter(traj, 'HTTP_5XX', { differentTool: false }),

	/** T3b — at least three search attempts before any hand-back (persistent outage). */
	t3b_persisted_3plus: traj => countTool(traj, 'search_patents') >= 3,

	/** T4 — reached the terminal tool of the chain (search_citations on the app number). */
	t4_reached_terminal_tool: traj => reachedTool(traj, 'search_citations', { argMatch: { applicationNumber: '16473445' } }),
	/**
	 * T4 — genuinely walked the multi-step chain, not a stop after step 1. The minimal valid
	 * walk to the terminal tool for this prompt is family → continuity → search_citations (3
	 * distinct tools); the current prompt correctly skips a redundant get_patent_details when
	 * it already has the number, so the floor is 3, not 4. A stop after step 1/2 has <3 distinct.
	 */
	t4_walked_the_chain: traj => distinctToolCount(traj) >= 3,

	/** T5 — a distinct tool ran after the truncation-drop ([] not read as no-data-and-stop). */
	t5_reacted_after_truncation: traj => reactedAfter(traj, 'TRUNCATED', { differentTool: true }),

	/** T6 — reformulated/broadened (>=2 search-ish calls) after the clean zero-hit. */
	t6_reformulated_after_zero: traj =>
		(countTool(traj, 'search_patents') + countTool(traj, 'build_patent_query') + countTool(traj, 'build_uspto_query')) >= 2
		&& reactedAfter(traj, 'EMPTY', { differentTool: false }),

	/** T7 — NEGATIVE CONTROL: engaged (>=1 attempt) and bounded (no runaway grind). */
	t7_bounded_engagement: traj => countTool(traj, 'search_patents') >= 1 && flatCalls(traj).length <= 16,

	/** T8 — a search/build tool ran before any jurisdiction question. */
	t8_searched_before_jurisdiction_question: traj => {
		const calls = flatCalls(traj);
		const searchIdx = calls.findIndex(c => ['search_patents', 'build_patent_query', 'build_uspto_query'].includes(c.name));
		const askIdx = calls.findIndex(c => c.name === 'vscode_askQuestions');
		return searchIdx >= 0 && (askIdx < 0 || askIdx > searchIdx);
	},
};
