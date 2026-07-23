/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Scripted mock tool table for the trajectory replay provider (H4 gate design §3).
 *
 * A "mock script" is a deterministic table of `(toolName [, argMatch]) → response`,
 * loaded from a fixture JSON under `evals/fixtures/trajectory/`. Failure responses
 * (EMPTY / HTTP_5XX / TRUNCATED) are canned strings copied verbatim from the H1 repro
 * corpus transcripts, so the whole loop is reproducible at temperature 0 with no network
 * and no live backend.
 *
 * Resolution semantics (see {@link resolveMock}): the first rule whose `tool` matches the
 * call name (and whose optional `argMatch` is a subset of the call args) wins. A rule may
 * carry a single `response` or a `responses` sequence consumed one-per-call (transient
 * failure then recovery); past the end of a sequence the last element repeats. Unmatched
 * calls fall back to the script `default` (a benign OK), so the model can always make
 * forward progress on tools the case does not care about.
 */

/** Which failure/success shape a mock result carries. Tags flow into the trajectory so structural asserts can see them. */
export type MockTag = 'OK' | 'EMPTY' | 'HTTP_5XX' | 'TRUNCATED';

export interface MockResponse {
	/** Classification of this result, surfaced on the trajectory tool call. */
	readonly tag: MockTag;
	/** The canned tool-result body handed back to the model as the `role: tool` message content. */
	readonly body: string;
}

export interface MockRule {
	/** Tool name this rule matches. */
	readonly tool: string;
	/** Optional argument subset that must be present (lenient substring match) for the rule to fire. */
	readonly argMatch?: Record<string, string | number>;
	/** Single canned response (mutually exclusive with `responses`). */
	readonly response?: MockResponse;
	/** Per-call sequence: call N gets element N, clamped to the last element once exhausted. */
	readonly responses?: readonly MockResponse[];
}

export interface MockScript {
	readonly id: string;
	readonly description?: string;
	readonly rules: readonly MockRule[];
	/** Response for any tool call no rule matched. Defaults to a benign OK when omitted. */
	readonly default?: MockResponse;
}

/** Per-run mutable state: tracks how many times each rule (by index) has fired, for sequence rules. */
export interface MockScriptState {
	readonly counters: number[];
}

export function createMockScriptState(script: MockScript): MockScriptState {
	return { counters: new Array<number>(script.rules.length).fill(0) };
}

const DEFAULT_OK: MockResponse = { tag: 'OK', body: 'OK (no scripted result for this tool).' };

/** True when every key in `argMatch` is present in `args` and the call value contains the expected value (case-insensitive). */
function argsMatch(args: Record<string, unknown>, argMatch: Record<string, string | number>): boolean {
	return Object.entries(argMatch).every(([key, expected]) => {
		const actual = args[key];
		if (actual === undefined || actual === null) {
			return false;
		}
		return String(actual).toLowerCase().includes(String(expected).toLowerCase());
	});
}

/**
 * Resolve one tool call against the script, advancing sequence counters in place.
 *
 * @param script The loaded mock script.
 * @param state  Mutable per-run counters (from {@link createMockScriptState}).
 * @param toolName Name of the tool the model called.
 * @param args   Parsed tool-call arguments.
 */
export function resolveMock(
	script: MockScript,
	state: MockScriptState,
	toolName: string,
	args: Record<string, unknown>,
): MockResponse {
	for (let i = 0; i < script.rules.length; i++) {
		const rule = script.rules[i];
		if (rule.tool !== toolName) {
			continue;
		}
		if (rule.argMatch && !argsMatch(args, rule.argMatch)) {
			continue;
		}
		if (rule.responses && rule.responses.length > 0) {
			const idx = Math.min(state.counters[i], rule.responses.length - 1);
			state.counters[i]++;
			return rule.responses[idx];
		}
		if (rule.response) {
			state.counters[i]++;
			return rule.response;
		}
	}
	return script.default ?? DEFAULT_OK;
}
