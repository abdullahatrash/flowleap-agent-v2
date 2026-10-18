/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';
import type { MockScript } from '../mock-tool-table';
import TrajectoryProvider from '../trajectory-provider';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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
	// PRD 0024 C4: the app's completion guard runs when the model stops. A chart saved with open points
	// and a turn that ends without a Round Report must come back to the model as the guard's hook message, once.
	const receipt = 'Prior-art artifact receipt: {"reportUri":"file:///w/chart.md","reportDigest":"a","evidenceUri":"file:///w/chart.evidence.json","evidenceDigest":"b"} fallbacksNotCovered=2 rounds=0 notCovered=3,4\nOpen points: 2. Critical date: 2018-03-15. Write the Round Report now: …\nOpen point [rung-3]: Claim 3 (fallback of claim 1) is not found in the cited art: magnet\nOpen point [rung-4]: Claim 4 (fallback of claim 1) is not found in the cited art: vent hole';
	it('runs the real completion guard when the model stops, and sends its reason back as the loop does', async () => {
		const script: MockScript = { id: 'guard', rules: [{ tool: 'write_patent_results', response: { tag: 'OK', body: `Successfully wrote patent results to chart.md\n${receipt}` } }] };
		const save = { id: 'w1', type: 'function', function: { name: 'write_patent_results', arguments: JSON.stringify({ template: 'invalidity-claim-chart', filePath: 'chart.md', content: '', coverage: [{ feature: 'Claim 1 as a whole' }] }) } };
		const lastMessages: Array<{ role: string; content: unknown }> = [];
		let call = 0;
		const provider = new TrajectoryProvider(undefined, {
			fetch: async (_url, init) => {
				const body = JSON.parse(String(init?.body));
				lastMessages.push(body.messages[body.messages.length - 1]);
				return jsonResponse(call++ === 0
					? { choices: [{ message: { tool_calls: [save] } }] }
					: { choices: [{ finish_reason: 'stop', message: { content: `stop ${call}` } }] });
			},
			env: { OPENROUTER_API_KEY: 'test-key' },
			loadScript: () => script,
		});

		const result = await provider.callApi('Build an invalidity chart for EP1 and save it.', { vars: { mockScript: 'guard', completionGuard: true } });

		const parsed = JSON.parse(String(result.output));
		expect({
			guardNudges: parsed.guardNudges,
			hookMessage: lastMessages[2],
			finalText: parsed.finalText,
			modelCalls: call,
		}).toEqual({
			guardNudges: ['The saved chart lists 2 open points (rung-3, rung-4) and this turn ends without a Round Report. Write the Round Report now: the receipt, then each open point as a numbered question that names its id, with your recommended next step, then the line "Reply with the numbers to run, \'all\', or your own steer." Then end the turn. Do not run a Search Round before the expert answers.'],
			hookMessage: { role: 'user', content: `You were about to complete but a hook blocked you with the following message: "${parsed.guardNudges[0]}". Please address this requirement before completing.` },
			finalText: 'stop 3',
			modelCalls: 3,
		});
	});

	it('lets a Round Report end the turn, and checks the expert\'s follow-up turn with the first turn as history', async () => {
		const script: MockScript = { id: 'guard', rules: [{ tool: 'write_patent_results', response: { tag: 'OK', body: `Successfully wrote patent results to chart.md\n${receipt}` } }] };
		const save = (id: string) => ({ id, type: 'function', function: { name: 'write_patent_results', arguments: JSON.stringify({ template: 'invalidity-claim-chart', filePath: 'chart.md', content: '', coverage: [{ feature: 'Claim 1 as a whole' }] }) } });
		const report = '1. [rung-3] Claim 3 is not found. Recommended: search magnet detents.\n2. [rung-4] Claim 4 is not found. Recommended: search vent holes.\nReply with the numbers to run, \'all\', or your own steer.';
		// Turn 0: save, then a Round Report. Turn 1 (the expert's answer): save again, stop without a report, then report.
		const replies = [{ tool_calls: [save('w1')] }, { content: report }, { tool_calls: [save('w2')] }, { content: 'Saved the round.' }, { content: report }];
		let call = 0;
		const provider = new TrajectoryProvider(undefined, {
			fetch: async () => jsonResponse({ choices: [{ finish_reason: 'stop', message: replies[call++] }] }),
			env: { OPENROUTER_API_KEY: 'test-key' },
			loadScript: () => script,
		});

		const result = await provider.callApi('Build an invalidity chart for EP1 and save it.', { vars: { mockScript: 'guard', completionGuard: true, followUpPrompt: 'Run 1 and 2.' } });

		const parsed = JSON.parse(String(result.output));
		expect({ nudges: parsed.guardNudges.length, turnTexts: parsed.turnTexts, modelCalls: call }).toEqual({ nudges: 1, turnTexts: [report, report], modelCalls: 5 });
	});

	it('opens the first turn with the replayed skill run and sends the case\'s output budget', async () => {
		const bodies: Array<{ max_tokens: number; messages: Array<{ role: string; content: unknown; tool_calls?: Array<{ function: { name: string; arguments: string } }> }> }> = [];
		const provider = new TrajectoryProvider(undefined, {
			fetch: async (_url, init) => {
				bodies.push(JSON.parse(String(init?.body)));
				return jsonResponse({ choices: [{ finish_reason: 'stop', message: { content: 'done' } }] });
			},
			env: { OPENROUTER_API_KEY: 'test-key' },
			loadScript: () => SCRIPT,
		});

		await provider.callApi('chart it', { vars: { mockScript: 'spec-script', skill: 'invalidity-analysis', maxTokens: 16000 } });

		const [, user, skillCall, skillResult] = bodies[0].messages;
		expect({
			maxTokens: bodies[0].max_tokens,
			user,
			skillCall: skillCall.tool_calls?.[0].function,
			skillContext: String(skillResult.content).startsWith('<skill-context name="invalidity-analysis">'),
		}).toEqual({
			maxTokens: 16000,
			user: { role: 'user', content: 'chart it' },
			skillCall: { name: 'skill', arguments: '{"skill":"invalidity-analysis"}' },
			skillContext: true,
		});
	});
	it('offers read_file to a skill case and answers it from the skill\'s files', async () => {
		const skillMd = path.resolve(__dirname, '..', '..', '..', 'assets', 'skills', 'invalidity-analysis', 'SKILL.md');
		const reads = [
			{ id: 'r1', type: 'function', function: { name: 'read_file', arguments: JSON.stringify({ filePath: skillMd, startLine: 1, endLine: 1 }) } },
			{ id: 'r2', type: 'function', function: { name: 'read_file', arguments: JSON.stringify({ filePath: '/nowhere.md', startLine: 1, endLine: 5 }) } },
		];
		const offered: boolean[] = [];
		let call = 0;
		const provider = new TrajectoryProvider(undefined, {
			fetch: async (_url, init) => {
				const body = JSON.parse(String(init?.body));
				offered.push(body.tools.some((tool: { function: { name: string } }) => tool.function.name === 'read_file'));
				return jsonResponse(call++ === 0 ? { choices: [{ message: { tool_calls: reads } }] } : { choices: [{ finish_reason: 'stop', message: { content: 'done' } }] });
			},
			env: { OPENROUTER_API_KEY: 'test-key' },
			loadScript: () => SCRIPT,
		});

		const result = await provider.callApi('chart it', { vars: { mockScript: 'spec-script', skill: 'invalidity-analysis' } });

		const calls = JSON.parse(String(result.output)).rounds[0].toolCalls.map((c: { mockTag: string; resultBody: string }) => ({ tag: c.mockTag, body: c.resultBody }));
		expect({ offered, calls }).toEqual({
			offered: [true, true],
			calls: [{ tag: 'OK', body: fs.readFileSync(skillMd, 'utf-8').split('\n')[0] }, { tag: 'EMPTY', body: 'File not found: /nowhere.md' }],
		});
	});
});
