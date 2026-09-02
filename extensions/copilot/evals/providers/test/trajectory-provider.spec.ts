/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import type { MockScript } from '../mock-tool-table';
import TrajectoryProvider from '../trajectory-provider';

const SCRIPT: MockScript = {
	id: 'spec-script',
	rules: [{ tool: 'search_patents', response: { tag: 'OK', body: 'one hit' } }],
	default: { tag: 'OK', body: 'OK' },
};

const CONTEXT = { vars: { mockScript: 'spec-script' } };

function jsonResponse(body: unknown): Response {
	return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

/** A `fetch` that answers every round with the same canned chat-completions body. */
function createFetchStub(body: unknown): typeof fetch {
	return async () => jsonResponse(body);
}

function createProvider(body: unknown): TrajectoryProvider {
	return new TrajectoryProvider(undefined, {
		fetch: createFetchStub(body),
		env: { OPENROUTER_API_KEY: 'test-key' },
		loadScript: () => SCRIPT,
	});
}

describe('TrajectoryProvider', () => {
	it('marks the system prompt as a prompt-cache breakpoint, and not when EVAL_PROMPT_CACHE=0', async () => {
		const bodies: Array<Record<string, unknown>> = [];
		const capture: typeof fetch = async (_url, init) => {
			bodies.push(JSON.parse(String(init?.body)));
			return jsonResponse({ choices: [{ finish_reason: 'stop', message: { content: 'done' } }] });
		};
		const cached = new TrajectoryProvider(undefined, { fetch: capture, env: { OPENROUTER_API_KEY: 'k' }, loadScript: () => SCRIPT });
		const plain = new TrajectoryProvider(undefined, { fetch: capture, env: { OPENROUTER_API_KEY: 'k', EVAL_PROMPT_CACHE: '0' }, loadScript: () => SCRIPT });

		await cached.callApi('q', CONTEXT);
		await plain.callApi('q', CONTEXT);

		const system = (i: number) => (bodies[i].messages as Array<{ role: string; content: unknown }>)[0];
		const cachedContent = system(0).content as Array<{ type: string; cache_control?: unknown; text: string }>;
		expect({
			cachedShape: { role: system(0).role, parts: cachedContent.length, type: cachedContent[0].type, cache_control: cachedContent[0].cache_control, sameText: cachedContent[0].text === system(1).content },
			plainIsString: typeof system(1).content,
		}).toEqual({
			cachedShape: { role: 'system', parts: 1, type: 'text', cache_control: { type: 'ephemeral' }, sameText: true },
			plainIsString: 'string',
		});
	});

	it('settles a normal answer into a trajectory', async () => {
		const provider = createProvider({ choices: [{ finish_reason: 'stop', message: { content: 'here are the results' } }] });

		const result = await provider.callApi('find prior art', CONTEXT);

		expect(JSON.parse(String(result.output))).toEqual({
			rounds: [],
			finalText: 'here are the results',
			turnTexts: ['here are the results'],
			stoppedReason: 'no_more_tools',
		});
	});

	// Without the body on the trajectory, a grader can only see WHICH tools ran, which is how
	// invented claim text passed T5 (#185): an OK fetch that returns an elided stub and an OK
	// fetch that returns the real text are indistinguishable by tag.
	it('records the result body the model was handed for each tool call', async () => {
		let round = 0;
		const provider = new TrajectoryProvider(undefined, {
			fetch: async () => jsonResponse(round++ === 0
				? { choices: [{ message: { tool_calls: [{ id: 'c1', type: 'function', function: { name: 'search_patents', arguments: '{"query":"battery"}' } }] } }] }
				: { choices: [{ finish_reason: 'stop', message: { content: 'done' } }] }),
			env: { OPENROUTER_API_KEY: 'test-key' },
			loadScript: () => SCRIPT,
		});

		const result = await provider.callApi('find prior art', CONTEXT);

		expect(JSON.parse(String(result.output)).rounds).toEqual([
			{ turn: 0, toolCalls: [{ name: 'search_patents', args: { query: 'battery' }, mockTag: 'OK', resultBody: 'one hit' }] },
		]);
	});

	// #263: sonnet-5 answers a bare tools-stripped continuation with EMPTY content, which
	// silently scored every capped trajectory as a wordless give-up. The wrap-up turn must
	// carry an explicit user nudge and retry once on empty content.
	it('nudges and retries the wrap-up turn instead of accepting empty finalText at the round cap', async () => {
		const requests: { hasTools: boolean; lastMessage: { role: string; content: string | null } }[] = [];
		let wrapAttempt = 0;
		const provider = new TrajectoryProvider({ config: { maxRounds: 2 } }, {
			fetch: async (_url, init) => {
				const body = JSON.parse(String(init?.body));
				requests.push({ hasTools: Boolean(body.tools), lastMessage: body.messages[body.messages.length - 1] });
				if (body.tools) {
					return jsonResponse({ choices: [{ message: { tool_calls: [{ id: 'c1', type: 'function', function: { name: 'search_patents', arguments: '{}' } }] } }] });
				}
				wrapAttempt++;
				return jsonResponse({ choices: [{ finish_reason: 'stop', message: { content: wrapAttempt === 1 ? '' : 'honest give-up narration' } }] });
			},
			env: { OPENROUTER_API_KEY: 'test-key' },
			loadScript: () => SCRIPT,
		});

		const result = await provider.callApi('find prior art', CONTEXT);

		const parsed = JSON.parse(String(result.output));
		const wrapRequests = requests.filter(r => !r.hasTools);
		expect({
			stoppedReason: parsed.stoppedReason,
			finalText: parsed.finalText,
			wrapAttempts: wrapRequests.length,
			nudgeRole: wrapRequests[0]?.lastMessage.role,
			nudgeMentionsFinalAnswer: /final answer/.test(String(wrapRequests[0]?.lastMessage.content)),
		}).toEqual({
			stoppedReason: 'max_rounds',
			finalText: 'honest give-up narration',
			wrapAttempts: 2,
			nudgeRole: 'user',
			nudgeMentionsFinalAnswer: true,
		});
	});

	// OpenRouter reports an upstream rate limit INSIDE a 200 body. Read as a normal answer it
	// would score a round the model never got to run as a give-up — a silent false verdict.
	it('surfaces an upstream error carried in a 200 body instead of scoring it as an empty answer', async () => {
		const provider = createProvider({
			choices: [{
				finish_reason: 'error',
				error: { code: 429, message: 'google/gemini-2.5-pro is temporarily rate-limited upstream.' },
				message: { content: null },
			}],
		});

		const result = await provider.callApi('find prior art', CONTEXT);

		expect(result.output).toBeUndefined();
		expect(result.error).toMatch(/rate-limited upstream/);
	});
});
