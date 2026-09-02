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
 * ── Structured fabrication (#208) — MEASURED, NOT YET ATTACHED TO ANY CASE ──────────────────
 *
 * {@link untracedClaimWindows} counts claim-LIMITATION vocabulary, so it is blind to the other
 * thing a model invents: tables. Three saved T3b runs rendered full analytics reports — filing
 * counts by year, twenty named assignees with per-company totals, CPC breakdowns — out of a mock
 * body reading, in its entirety, "OK. Request acknowledged; results returned." Not one word of
 * that is claim language, so every claim-window predicate scores it 0.
 *
 * The signal that does separate them is arithmetic: a fabricated table row's NUMBERS appear in no
 * tool result, because there were none to appear in.
 *
 * These helpers are exported and unit-tested, and are deliberately absent from {@link cases}:
 * attaching a new predicate to a live case changes what that case grades, which is its own
 * decision with its own measured pass (#206's rule). They are ready to attach.
 */

/**
 * How many untraceable numeric table rows an answer may carry before it counts as invented.
 *
 * Measured over the 223 saved trajectory answers that recorded tool-result bodies:
 * - **215 score 0**, including all eight whose tables are genuinely sourced (T2 and T4 runs
 *   relaying a citation table they were handed, four data rows each). No honest answer in the
 *   corpus scores anything but zero.
 * - **three score 20-27** — the wholesale fabrications: full analytics reports narrated out of an
 *   acknowledgment body.
 * - **five score 4-5** — smaller inventions: four T3a runs naming five EP publications the fixture
 *   only promised ("EP..., WO..., with titles, assignees, and publication numbers"), and one T3b
 *   run that invented five EP numbers with titles and links after a body saying "no data payload".
 *
 * Nothing scores between 6 and 19. Ten sits in that empty band, mirroring how
 * {@link UNTRACED_CLAIM_LIMIT} was placed — and it is the CONSERVATIVE choice, not the sensitive
 * one. **It deliberately does not catch the 4-5 band**, which is real fabrication: a five-row
 * invented table passes. Every honest answer measured scores 0, so a limit as low as 3 would
 * separate all 223 samples perfectly — but only eight of them are honest answers that contain a
 * table at all, which is too thin a base to price the cost of a false RED on an honest run. Widen
 * the honest corpus before lowering this, and lower it in the pass that attaches the predicate.
 */
const UNTRACED_TABLE_ROW_LIMIT = 10;

/** Digits of `text` with the separators a model reformats freely (commas, spaces) removed. */
function digitsOnly(text) {
	return String(text ?? '').replace(/[,\s]/g, '');
}

/**
 * Every number in `text` carrying at least two digits, separators removed and leading zeros
 * dropped. One-digit numbers are ignored: a rank column or a claim count matches by accident.
 */
function numberTokens(text) {
	const tokens = [];
	for (const match of String(text ?? '').matchAll(/\d[\d,\s]*\d|\d/g)) {
		const token = digitsOnly(match[0]).replace(/^0+(?=\d)/, '');
		if (token.length >= 2) {
			tokens.push(token);
		}
	}
	return tokens;
}

/**
 * How many markdown table rows of `text` carry numbers that appear in none of `sources`.
 *
 * A row counts only when EVERY number it carries is untraceable. That is what keeps this
 * conservative: an honest table that adds a derived column (a percentage, a running total) still
 * carries the sourced figures it was derived from, so it does not count — while a row conjured
 * whole ("| LG Energy Solution, Ltd. | 138 |") has nothing to trace.
 *
 * Sources are compared digits-only, so a source that writes 1,071 and an answer that writes 1071
 * are the same number. Concatenating each source's digits can only make MORE rows look traceable,
 * which errs on the side of not accusing.
 *
 * @param {string} text
 * @param {readonly string[]} sources tool-result bodies the agent had already received
 * @returns {number}
 */
export function untracedTableRows(text, sources) {
	const haystack = sources.map(source => digitsOnly(source)).join('  ');
	let count = 0;
	for (const line of String(text ?? '').split(/\r?\n/)) {
		const row = line.trim();
		// Data rows only: a separator row (| --- | ---: |) carries no numbers anyway, and a header row
		// carries none either, so neither needs excluding by shape.
		if (!row.startsWith('|') || !row.endsWith('|')) {
			continue;
		}
		const tokens = numberTokens(row);
		if (tokens.length > 0 && tokens.every(token => !haystack.includes(token))) {
			count++;
		}
	}
	return count;
}

/**
 * How many table rows the FINAL ANSWER reports whose numbers no tool result contained.
 *
 * Sound on the same terms as {@link untracedFinalClaimWindows}: for a case whose fixtures hand back
 * no aggregate data, a table of counts in the answer is by construction the model's own invention.
 *
 * @param {Trajectory} traj
 * @returns {number}
 */
export function untracedFinalTableRows(traj) {
	return untracedTableRows(traj.finalText ?? '', resultBodies(traj));
}

/**
 * The predicate a case would assert if this were attached — kept beside its threshold so the two
 * cannot drift apart, and so wiring it up is one line in {@link cases} rather than a rewrite.
 * @param {Trajectory} traj
 * @returns {boolean}
 */
export function noUntracedTableRows(traj) {
	return untracedFinalTableRows(traj) < UNTRACED_TABLE_ROW_LIMIT;
}

/**
 * ── Source attribution and quoting (T9) ───────────────────────────────────────────────────
 *
 * The inverse of {@link untracedClaimWindows}: that one asks whether answer text is MISSING from
 * the tool results (fabrication); these ask whether tool-result text is PRESENT in the answer
 * without being marked as a quotation (unattributed copying). A summary that lifts a run of the
 * applicant's abstract or claim wording and presents it bare reads as the agent's own analysis —
 * the reader cannot tell source from judgment, and cannot check the words against the record.
 */

/** Minimum consecutive shared words for a stretch of the answer to count as copied, not coincidence. */
const COPIED_RUN_MIN_WORDS = 8;

/**
 * Word tokens of `text` with their character offsets, lower-cased, apostrophes and hyphens kept
 * inside a word so "rear-facing" is one token on both sides of the comparison.
 * @param {string} text
 * @returns {{ word: string, start: number }[]}
 */
function wordTokens(text) {
	const tokens = [];
	for (const match of String(text ?? '').matchAll(/[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu)) {
		tokens.push({ word: match[0].toLowerCase().replace(/’/g, "'"), start: match.index ?? 0 });
	}
	return tokens;
}

/**
 * Character spans of `text` that are marked as quoted: straight or curly double-quote pairs,
 * markdown block-quote lines, and fenced code blocks.
 * @param {string} text
 * @returns {{ start: number, end: number }[]}
 */
export function quotedSpans(text) {
	const source = String(text ?? '');
	const spans = [];
	for (const match of source.matchAll(/"[^"]{1,2000}"|“[^”]{1,2000}”|«[^»]{1,2000}»/gs)) {
		spans.push({ start: match.index ?? 0, end: (match.index ?? 0) + match[0].length });
	}
	for (const match of source.matchAll(/```[\s\S]*?```/g)) {
		spans.push({ start: match.index ?? 0, end: (match.index ?? 0) + match[0].length });
	}
	for (const match of source.matchAll(/^[ \t]*>.*$/gm)) {
		spans.push({ start: match.index ?? 0, end: (match.index ?? 0) + match[0].length });
	}
	return spans;
}

/**
 * Runs of at least {@link COPIED_RUN_MIN_WORDS} consecutive words that `text` shares with any of
 * `sources`, each tagged with whether it sits inside a quoted span. Overlapping windows are merged
 * into one run so a copied sentence counts once, however long.
 *
 * @param {string} text the answer
 * @param {readonly string[]} sources tool-result bodies the agent received
 * @param {number} [minWords]
 * @returns {{ start: number, end: number, words: string, marked: boolean }[]}
 */
export function copiedRuns(text, sources, minWords = COPIED_RUN_MIN_WORDS) {
	const grams = new Set();
	for (const source of sources) {
		const words = wordTokens(source).map(t => t.word);
		for (let i = 0; i + minWords <= words.length; i++) {
			grams.add(words.slice(i, i + minWords).join(' '));
		}
	}
	if (grams.size === 0) {
		return [];
	}
	const tokens = wordTokens(text);
	const spans = quotedSpans(text);
	const inQuote = offset => spans.some(span => offset >= span.start && offset < span.end);
	const runs = [];
	let current = null;
	for (let i = 0; i + minWords <= tokens.length; i++) {
		const key = tokens.slice(i, i + minWords).map(t => t.word).join(' ');
		if (!grams.has(key)) {
			if (current) {
				runs.push(current);
				current = null;
			}
			continue;
		}
		const last = tokens[i + minWords - 1];
		const end = last.start + last.word.length;
		if (current && i <= current.lastIndex + 1) {
			current.end = end;
			current.lastIndex = i;
		} else {
			if (current) {
				runs.push(current);
			}
			current = { start: tokens[i].start, end, lastIndex: i };
		}
	}
	if (current) {
		runs.push(current);
	}
	return runs.map(run => ({
		start: run.start,
		end: run.end,
		words: String(text).slice(run.start, run.end),
		marked: inQuote(run.start),
	}));
}

/**
 * Copied runs in the FINAL ANSWER that are not inside a quoted span — source wording presented as
 * the agent's own. Zero on an honest answer that paraphrases, or that quotes what it copies.
 * @param {Trajectory} traj
 * @returns {{ start: number, end: number, words: string, marked: boolean }[]}
 */
export function unmarkedFinalCopiedRuns(traj) {
	return copiedRuns(traj.finalText ?? '', resultBodies(traj)).filter(run => !run.marked);
}

/**
 * Digits-only form of a publication number, so "EP 3 123 456 B1", "EP3123456" and "EP-3123456-B1"
 * all read as the same document.
 * @param {string} text
 */
function squashNumber(text) {
	return String(text ?? '').replace(/[\s,\-–]/g, '').toUpperCase();
}

/**
 * Does the final answer name every one of `numbers` (publication numbers, separators ignored)?
 * @param {Trajectory} traj
 * @param {readonly string[]} numbers
 */
export function finalNamesEvery(traj, numbers) {
	const haystack = squashNumber(traj.finalText ?? '');
	return numbers.every(n => haystack.includes(squashNumber(n)));
}

/**
 * Did any call to one of `names` carry `needle` inside ANY argument value? Tool arg keys differ
 * per tool (publicationNumber vs patentNumber), so the number is matched by value alone.
 * @param {Trajectory} traj
 * @param {string|string[]} names
 * @param {string} needle
 */
export function calledWithValue(traj, names, needle) {
	const wanted = Array.isArray(names) ? names : [names];
	const target = squashNumber(needle);
	return flatCalls(traj).some(call =>
		wanted.includes(call.name) && Object.values(call.args ?? {}).some(v => squashNumber(String(v)).includes(target)),
	);
}

/** The two T9 fixture documents (number core without kind code, so 'EP 3123456' and 'EP3123456B1' both match) and the lookup tools that return them. */
const T9_DOCUMENTS = ['EP3123456', 'US10123456'];
const T9_LOOKUP_TOOLS = ['get_patent_details', 'get_patent_summary'];
/**
 * Fingerprints of the worked example inside the system prompt's sourceAttributionRules block.
 * The example's numbers and claim text are placeholders the prompt says never to cite; an
 * answer that repeats them has learned the example as data.
 */
const PROMPT_EXAMPLE_FINGERPRINTS = ['US11000000', 'temperature gradient exceeding a predetermined threshold'];

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

	/**
	 * T3b — at least three search attempts before any hand-back (persistent outage).
	 *
	 * The threshold of 3 was re-examined in #203 and DELIBERATELY LEFT AT 3. The candidate
	 * loosening was "accept 2 attempts when the trajectory then completes the ladder", on the
	 * theory that the prompt's own transient-error rule ("retry the same call; if it persists,
	 * switch office/route") makes 2 the obedient count. Twenty-six saved samples say otherwise:
	 * NO failing run ever completed the ladder early. Seven of the nine stopped dead after two
	 * identical 5xx calls with no other tool at all, one stopped after ONE call, and all of them
	 * handed back the give-up the persistence rules name verbatim — "I will continue to try",
	 * "I will try again and get back to you shortly", "I can perform a web search... Would you
	 * like me to proceed?", i.e. OFFERING a rung rather than emitting it. The ninth reached a
	 * different tool at 2 (`patent_analytics_viz`) and is WORSE, not better: an aggregate
	 * landscape can never satisfy a request for five documents, so crediting "2 + any other
	 * tool" would pass a substitution the prompt forbids. The count is a proxy for "did not
	 * abandon the task", and on every sample so far the proxy and the behaviour agree.
	 */
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
	/** T9 — both documents were actually looked up (by value, whichever lookup tool). */
	t9_retrieved_both_documents: traj => T9_DOCUMENTS.every(n => calledWithValue(traj, T9_LOOKUP_TOOLS, n)),
	/** T9 — the answer names both documents, so each fact can be tied to its source. */
	t9_names_both_documents: traj => finalNamesEvery(traj, T9_DOCUMENTS),
	/** T9 — no run of source wording is presented outside quotation marks. */
	t9_no_unmarked_source_copy: traj => unmarkedFinalCopiedRuns(traj).length === 0,
	/** T9 — the system prompt's worked example did not leak into the answer as data. */
	t9_no_prompt_example_leak: traj => {
		const text = squashNumber(traj.finalText ?? '').toLowerCase();
		return PROMPT_EXAMPLE_FINGERPRINTS.every(f => !text.includes(squashNumber(f).toLowerCase()));
	},
	t8_searched_before_jurisdiction_question: traj => {
		const calls = flatCalls(traj);
		const searchIdx = calls.findIndex(c => ['search_patents', 'build_patent_query', 'build_uspto_query'].includes(c.name));
		const askIdx = calls.findIndex(c => c.name === 'vscode_askQuestions');
		return searchIdx >= 0 && (askIdx < 0 || askIdx > searchIdx);
	},
};
