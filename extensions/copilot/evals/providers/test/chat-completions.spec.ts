/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { requestChatCompletion, systemMessage } from '../chat-completions';

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/** Sends one request and returns the URL it went to and the choice or the error message. */
async function send(env: NodeJS.ProcessEnv, response: Response) {
	const urls: string[] = [];
	const fetchStub: typeof fetch = async url => {
		urls.push(String(url));
		return response;
	};
	try {
		const choice = await requestChatCompletion({ fetch: fetchStub, env, apiKey: 'k', body: { model: 'm' } });
		return { urls, choice, error: undefined };
	} catch (err) {
		return { urls, choice: undefined, error: err instanceof Error ? err.message : String(err) };
	}
}

describe('chat completions shared by the eval providers', () => {
	it('sends to OpenRouter by default, or to EVAL_API_BASE_URL without its trailing slashes', async () => {
		const defaultUrl = await send({}, jsonResponse({ choices: [{ finish_reason: 'stop', message: { content: 'a' } }] }));
		const customUrl = await send({ EVAL_API_BASE_URL: 'http://localhost:9/v1//' }, jsonResponse({ choices: [{ finish_reason: 'stop', message: { content: 'a' } }] }));
		expect([defaultUrl.urls, customUrl.urls, customUrl.choice]).toEqual([
			['https://openrouter.ai/api/v1/chat/completions'],
			['http://localhost:9/v1/chat/completions'],
			{ finish_reason: 'stop', message: { content: 'a' } },
		]);
	});

	it('throws on an HTTP error, on no choice, and on an upstream error carried in a 200 body', async () => {
		const results = await Promise.all([
			send({}, new Response('busy', { status: 503 })),
			send({}, jsonResponse({ choices: [] })),
			send({}, jsonResponse({ choices: [{ finish_reason: 'error', error: { code: 429, message: 'rate-limited upstream' }, message: { content: null } }] })),
		]);
		expect(results.map(result => result.error)).toEqual([
			'API returned 503: busy',
			'No choices in response',
			'Upstream error in a 200 response (finish_reason=error): rate-limited upstream',
		]);
	});

	it('marks the system prompt as a prompt-cache breakpoint, and not when EVAL_PROMPT_CACHE=0', () => {
		expect([systemMessage('S', {}), systemMessage('S', { EVAL_PROMPT_CACHE: '0' })]).toEqual([
			{ role: 'system', content: [{ type: 'text', text: 'S', cache_control: { type: 'ephemeral' } }] },
			{ role: 'system', content: 'S' },
		]);
	});
});
