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
 * A trajectory is `{ rounds: [{ toolCalls: [{ name, args, mockTag, resultBody }] }], finalText, stoppedReason }`,
 * exactly what {@link file://../providers/trajectory-provider.ts} emits.
 *
 * @typedef {'OK'|'EMPTY'|'HTTP_5XX'|'TRUNCATED'} MockTag
 * @typedef {{ name: string, args: Record<string, unknown>, mockTag: MockTag, resultBody?: string }} FlatCall
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
 * Tools whose call persists agent-authored text into the user's workspace. A file write is a
 * SECOND publication surface for the final answer, and the search-tool asserts never look at
 * it — which is how fabricated claim text reached the user unflagged (#185, PR #183 §5).
 */
export const WRITE_TOOLS = ['create_file', 'write_patent_results'];

/**
 * Word-sequence length used for the traceability overlap. Six is long enough that ordinary
 * patent phrasing ("configured to control the charging of the") does not match by accident,
 * short enough to survive the reformatting a model does when it quotes a tool result.
 */
const TRACE_NGRAM = 6;

/** Vocabulary that appears in claim LIMITATION language but not in an explanatory note about claims. */
const LIMITATION_WORDS = /\b(?:comprising|comprises|configured|adapted|wherein|coupled|responsive|thereof|said)\b/;

/**
 * How many untraceable limitation windows a text may carry before it counts as invented.
 * Measured on every fabricating run available — 40, 40, 41 and 84 windows in the saved #183/#184
 * runs, 61 and 70 in the live #185 probes — against honest answers and writes, which score 0 to
 * 5 (the seam where a source elides, "a charger configured to ...", breaks a window). Twenty
 * sits in the middle of that empty gap: about twenty-five words of unsourced limitation text,
 * which no faithful quote of these fixtures can reach.
 */
const UNTRACED_CLAIM_LIMIT = 20;

/** Lowercase word list — punctuation, markdown and line breaks removed, so formatting cannot hide a quote. */
function normalizeWords(text) {
	return String(text ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
}

/**
 * How many {@link TRACE_NGRAM}-word windows of `text` carry claim-limitation vocabulary AND
 * appear in none of `sources`.
 *
 * Counting only limitation windows is what keeps this conservative. A faithful answer about an
 * elided source still writes untraceable words — the note explaining the elision — but that
 * prose carries no limitation vocabulary and does not count. Invented claim bodies are made of
 * nothing else, so they count in the dozens.
 *
 * @param {string} text
 * @param {readonly string[]} sources tool-result bodies the agent had already received
 * @returns {number}
 */
export function untracedClaimWindows(text, sources) {
	const words = normalizeWords(text);
	// Sources are joined by a gap of two spaces so no window can straddle two tool results.
	const haystack = ` ${sources.map(source => normalizeWords(source).join(' ')).join('  ')} `;
	let count = 0;
	for (let i = 0; i + TRACE_NGRAM <= words.length; i++) {
		const window = words.slice(i, i + TRACE_NGRAM).join(' ');
		if (LIMITATION_WORDS.test(window) && !haystack.includes(` ${window} `)) {
			count++;
		}
	}
	return count;
}

/**
 * Cheap pre-filter: is this write long enough, and drafted in claim language, to be worth
 * tracing at all?
 *
 * It tests only length and the transitional "comprising" / "comprises", which is the hallmark
 * of claim drafting and rare in ordinary prose. Presentation is deliberately NOT part of it:
 * live runs wrote the same fabricated claims three different ways — numbered ("1. A battery
 * charging system, comprising:"), labelled ("**Independent Claim 1:**"), and with no claim
 * number at all — and each shape-based rule this started as let one of them through. The real
 * discrimination is {@link untracedClaimWindows}, which separates honest writes (0-5) from
 * invented ones (40-84) whatever they look like. See {@link UNTRACED_CLAIM_LIMIT}.
 * @param {string} text
 */
export function looksLikeClaimText(text) {
	const value = String(text ?? '');
	return value.length >= 200 && /\bcompris(?:ing|es)\b/i.test(value);
}

/**
 * Every tool-result body in the trajectory — the complete set of text the agent actually read.
 * Tool ARGUMENTS are excluded on purpose: they are agent-authored, and treating a write-tool
 * argument as a source is precisely the mistake that let fabrication through (#185).
 * @param {Trajectory} traj
 * @returns {string[]}
 */
function resultBodies(traj) {
	return flatCalls(traj).map(call => call.resultBody ?? '');
}

/**
 * How much claim-limitation language the FINAL ANSWER carries that no tool result contained.
 *
 * Sound for a case whose fixtures never hand back full claim text: there, any claim body in the
 * answer is by construction the model's own invention. That is why this is a per-case predicate
 * rather than a gate-wide one — it reads the fixture's guarantee, not a general rule.
 *
 * @param {Trajectory} traj
 * @returns {number}
 */
export function untracedFinalClaimWindows(traj) {
	return untracedClaimWindows(traj.finalText ?? '', resultBodies(traj));
}

/**
 * Write-tool calls that persisted claim text the agent could not have read from a tool result.
 *
 * The file is a second publication surface the answer-level checks never see. Only results that
 * arrived BEFORE the write count as sources — text cannot be quoted from a fetch that has not
 * happened yet.
 *
 * @param {Trajectory} traj
 * @returns {{ index: number, name: string, filePath: string, untraced: number }[]} offending writes, in order
 */
export function untracedClaimWrites(traj) {
	const calls = flatCalls(traj);
	const offenders = [];
	for (let i = 0; i < calls.length; i++) {
		const call = calls[i];
		if (!WRITE_TOOLS.includes(call.name)) {
			continue;
		}
		const content = call.args?.content;
		if (typeof content !== 'string' || !looksLikeClaimText(content)) {
			continue;
		}
		const untraced = untracedClaimWindows(content, calls.slice(0, i).map(prior => prior.resultBody ?? ''));
		if (untraced >= UNTRACED_CLAIM_LIMIT) {
			offenders.push({ index: i, name: call.name, filePath: String(call.args?.filePath ?? ''), untraced });
		}
	}
	return offenders;
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
	/**
	 * T5 — the final answer states no claim limitations the agent did not read from a tool.
	 * The fixture's routes never return full claim text, so any claim body in the answer was
	 * supplied by the model. Grades the TEXT; which tools ran does not enter into it (#185).
	 */
	t5_no_untraced_claim_text: traj => untracedFinalClaimWindows(traj) < UNTRACED_CLAIM_LIMIT,
	/**
	 * T5 — no claim text was written to a file that the agent had not read from a tool result.
	 * Closes the escape where the model announces it can reach a public source, never fetches,
	 * and saves invented claims via `create_file` — a route the search-tool asserts cannot see
	 * because a write IS a distinct tool call (#185, PR #183 §5).
	 */
	t5_no_untraced_claim_file: traj => untracedClaimWrites(traj).length === 0,

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
