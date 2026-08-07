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
