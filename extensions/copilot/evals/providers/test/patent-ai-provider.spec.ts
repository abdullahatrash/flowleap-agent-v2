/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';
import PatentAIProvider from '../patent-ai-provider';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const EVALS_DIR = path.resolve(__dirname, '..', '..');

const SYSTEM_PROMPT = fs.readFileSync(path.join(EVALS_DIR, 'prompts', 'system-prompt.txt'), 'utf-8');
const TOOL_DEFINITIONS = JSON.parse(fs.readFileSync(path.join(EVALS_DIR, 'prompts', 'tool-definitions.json'), 'utf-8'));

const SUCCESS_BODY = {
	choices: [
		{
			message: {
				content: 'Hello from patent ai',
				tool_calls: [
					{ id: 'call_1', type: 'function', function: { name: 'search_patents', arguments: '{"query":"widget"}' } },
				],
			},
		},
	],
	model: 'google/gemini-2.5-flash',
	usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
};

interface RecordedCall {
	readonly url: string;
	readonly init: RequestInit;
}

/** A fake `fetch` that records every call and hands the response to a caller-supplied handler. */
function createFetchStub(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
	const calls: RecordedCall[] = [];
	const fetchFn: typeof fetch = async (input, init) => {
		const url = typeof input === 'string' ? input : input.toString();
		const requestInit = init ?? {};
		calls.push({ url, init: requestInit });
		return handler(url, requestInit);
	};
	return { fetchFn, calls };
}

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('PatentAIProvider', () => {
	it('returns an error and never calls fetch when no api key is configured', async () => {
		const { fetchFn, calls } = createFetchStub(() => jsonResponse(SUCCESS_BODY));
		const provider = new PatentAIProvider(undefined, { fetch: fetchFn, env: {} });

		const result = await provider.callApi('test prompt');

		expect(result).toStrictEqual({
			error: 'No API key configured. Set EVAL_API_KEY or OPENROUTER_API_KEY before running evals.',
		});
		expect(calls).toHaveLength(0);
	});

	it('prefers EVAL_API_KEY over the OPENROUTER_API_KEY fallback', async () => {
		const { fetchFn, calls } = createFetchStub(() => jsonResponse(SUCCESS_BODY));
		const env: NodeJS.ProcessEnv = { EVAL_API_KEY: 'eval-key', OPENROUTER_API_KEY: 'or-key' };
		const provider = new PatentAIProvider(undefined, { fetch: fetchFn, env });

		await provider.callApi('test prompt');

		expect(calls[0].init.headers).toStrictEqual({
			'Content-Type': 'application/json',
			'Authorization': 'Bearer eval-key',
		});
	});

	it('falls back to OPENROUTER_API_KEY when EVAL_API_KEY is unset', async () => {
		const { fetchFn, calls } = createFetchStub(() => jsonResponse(SUCCESS_BODY));
		const env: NodeJS.ProcessEnv = { OPENROUTER_API_KEY: 'or-key-only' };
		const provider = new PatentAIProvider(undefined, { fetch: fetchFn, env });

		await provider.callApi('test prompt');

		expect(calls[0].init.headers).toStrictEqual({
			'Content-Type': 'application/json',
			'Authorization': 'Bearer or-key-only',
		});
	});

	it('builds the endpoint URL from the default base, and strips trailing slashes on a custom one without doubling /v1', async () => {
		const env: NodeJS.ProcessEnv = { EVAL_API_KEY: 'k' };
		const defaultRun = createFetchStub(() => jsonResponse(SUCCESS_BODY));
		await new PatentAIProvider(undefined, { fetch: defaultRun.fetchFn, env }).callApi('p');

		const customRun = createFetchStub(() => jsonResponse(SUCCESS_BODY));
		await new PatentAIProvider(undefined, {
			fetch: customRun.fetchFn,
			env: { ...env, EVAL_API_BASE_URL: 'https://example.com/v1/' },
		}).callApi('p');

		expect([defaultRun.calls[0].url, customRun.calls[0].url]).toStrictEqual([
			'https://openrouter.ai/api/v1/chat/completions',
			'https://example.com/v1/chat/completions',
		]);
	});

	it('resolves the model with precedence: provider config, then EVAL_MODEL, then the built-in default', async () => {
		const env: NodeJS.ProcessEnv = { EVAL_API_KEY: 'k' };

		const configured = createFetchStub(() => jsonResponse(SUCCESS_BODY));
		await new PatentAIProvider({ config: { model: 'anthropic/claude-sonnet-4.5' } }, {
			fetch: configured.fetchFn,
			env: { ...env, EVAL_MODEL: 'openai/gpt-5.2' },
		}).callApi('p');

		const fromEnv = createFetchStub(() => jsonResponse(SUCCESS_BODY));
		await new PatentAIProvider(undefined, { fetch: fromEnv.fetchFn, env: { ...env, EVAL_MODEL: 'openai/gpt-5.2' } }).callApi('p');

		const fallback = createFetchStub(() => jsonResponse(SUCCESS_BODY));
		await new PatentAIProvider(undefined, { fetch: fallback.fetchFn, env }).callApi('p');

		const bodies = [configured, fromEnv, fallback].map(run => JSON.parse(String(run.calls[0].init.body)).model);
		expect(bodies).toStrictEqual(['anthropic/claude-sonnet-4.5', 'openai/gpt-5.2', 'anthropic/claude-sonnet-5']);
	});

	it('sends a request body with the system prompt first, the full tool surface, and fixed sampling options', async () => {
		const { fetchFn, calls } = createFetchStub(() => jsonResponse(SUCCESS_BODY));
		const provider = new PatentAIProvider({ config: { model: 'openai/gpt-5.2-mini' } }, { fetch: fetchFn, env: { EVAL_API_KEY: 'k' } });

		await provider.callApi('what is the novelty of claim 1?');

		const body = JSON.parse(String(calls[0].init.body));
		expect(body).toStrictEqual({
			model: 'openai/gpt-5.2-mini',
			messages: [
				{ role: 'system', content: SYSTEM_PROMPT },
				{ role: 'user', content: 'what is the novelty of claim 1?' },
			],
			tools: TOOL_DEFINITIONS,
			tool_choice: 'auto',
			stream: false,
			temperature: 0,
			max_tokens: 4096,
		});
	});

	it('maps a successful upstream response to the {text, tool_calls} output contract with token usage', async () => {
		const { fetchFn } = createFetchStub(() => jsonResponse(SUCCESS_BODY));
		const provider = new PatentAIProvider(undefined, { fetch: fetchFn, env: { EVAL_API_KEY: 'k' } });

		const result = await provider.callApi('test prompt');

		expect(JSON.parse(String(result.output))).toStrictEqual({
			text: 'Hello from patent ai',
			tool_calls: SUCCESS_BODY.choices[0].message.tool_calls,
		});
		expect(result.tokenUsage).toStrictEqual({ total: 15, prompt: 10, completion: 5 });
	});

	it('returns an error string with the status and body text for a non-OK response', async () => {
		const { fetchFn } = createFetchStub(() => new Response('Rate limited', { status: 429 }));
		const provider = new PatentAIProvider(undefined, { fetch: fetchFn, env: { EVAL_API_KEY: 'k' } });

		const result = await provider.callApi('test prompt');

		expect(result).toStrictEqual({ error: 'API returned 429: Rate limited' });
	});

	it('returns an error string when fetch itself throws', async () => {
		const { fetchFn } = createFetchStub(() => {
			throw new Error('network down');
		});
		const provider = new PatentAIProvider(undefined, { fetch: fetchFn, env: { EVAL_API_KEY: 'k' } });

		const result = await provider.callApi('test prompt');

		expect(result).toStrictEqual({ error: 'Request failed: network down' });
	});
});
