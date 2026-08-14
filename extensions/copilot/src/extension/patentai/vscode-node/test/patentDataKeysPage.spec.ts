/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';

import { AuthRequiredError, DataKeyInvalidError, IPatentBackendClient, PatentBackendError } from '../patentBackendClient';
import { renderPatentDataKeysPageHtml, testPatentDataConnection } from '../patentDataKeysPage';

/** One provider's verdict as `POST /v1/keys/validate` reports it. */
interface Verdict {
	source: 'user' | 'server' | 'none';
	valid: boolean | null;
	message?: string;
}

/**
 * A client whose `post` answers with a scripted key-validation body (or rejects), recording the path
 * and options so a test can assert the call went to the validation endpoint and skipped the cache.
 */
function makeClient(behavior: { post?: (path: string, body: unknown, token: unknown, options?: unknown) => Promise<unknown> }): { client: IPatentBackendClient; calls: { path: string; options?: unknown }[] } {
	const calls: { path: string; options?: unknown }[] = [];
	const client = {
		_serviceBrand: undefined,
		get: async () => ({}),
		post: async (path: string, body: unknown, token: unknown, options?: unknown) => {
			calls.push({ path, options });
			return behavior.post ? behavior.post(path, body, token, options) : {};
		},
		getCustomerPortalUrl: async () => '',
	} as IPatentBackendClient;
	return { client, calls };
}

/** A validation response with the given per-provider verdicts. */
function validationResponse(providers: { epo?: Verdict; uspto?: Verdict }) {
	return async () => ({ success: true, providers });
}

const VERIFIED: Verdict = { source: 'user', valid: true, message: 'EPO OPS accepted the supplied consumer key/secret.' };
const USPTO_VERIFIED: Verdict = { source: 'user', valid: true, message: 'USPTO ODP accepted the supplied API key.' };

describe('testPatentDataConnection', () => {

	it('calls the key-validation endpoint, outside the read cache, and reports the per-provider verdict', async () => {
		const { client, calls } = makeClient({
			post: validationResponse({ epo: VERIFIED, uspto: USPTO_VERIFIED }),
		});

		const epo = await testPatentDataConnection(client, 'epo');
		const uspto = await testPatentDataConnection(client, 'uspto');

		expect(calls.map(c => c.path)).toEqual(['/keys/validate', '/keys/validate']);
		expect(calls[0].options).toEqual(expect.objectContaining({ bypassReadCache: true }));
		expect([epo, uspto]).toEqual([
			{ ok: true, message: 'EPO OPS accepted the supplied consumer key/secret.' },
			{ ok: true, message: 'USPTO ODP accepted the supplied API key.' },
		]);
	});

	it('reports a rejected key as a failure attributed to the provider under test', async () => {
		const { client } = makeClient({
			post: validationResponse({ epo: { source: 'user', valid: false, message: 'EPO OPS rejected the key pair.' } }),
		});

		const result = await testPatentDataConnection(client, 'epo');

		expect(result).toEqual({
			ok: false,
			message: 'EPO OPS rejected the key pair.',
			failedProvider: 'epo',
		});
	});

	it('does not report FlowLeap server credentials as the user key passing, and does not call it a failure either', async () => {
		const { client } = makeClient({
			post: validationResponse({ uspto: { source: 'server', valid: null, message: 'Using FlowLeap server credentials.' } }),
		});

		const result = await testPatentDataConnection(client, 'uspto');

		expect(result).toEqual({ ok: true, message: 'Using FlowLeap server credentials.' });
		expect(result.failedProvider).toBeUndefined();
	});

	it('says the key could not be verified when the provider was unreachable', async () => {
		const { client } = makeClient({
			post: validationResponse({ uspto: { source: 'user', valid: null, message: 'USPTO ODP unavailable; could not verify the key.' } }),
		});

		const result = await testPatentDataConnection(client, 'uspto');

		expect(result.ok).toBe(false);
		expect(result.message).toBe('USPTO ODP unavailable; could not verify the key.');
		expect(result.failedProvider).toBeUndefined();
	});

	it('attributes a rejection the seam raised to the provider the backend named — even when testing the other one', async () => {
		// The key-forwarding middleware validates the EPO pair eagerly on any guarded request, so
		// testing USPTO with a broken EPO pair stored fails on EPO before the handler runs.
		const { client } = makeClient({ post: () => Promise.reject(new DataKeyInvalidError('bad epo', 'epo')) });

		const testingUspto = await testPatentDataConnection(client, 'uspto');

		expect(testingUspto.ok).toBe(false);
		expect(testingUspto.failedProvider).toBe('epo');
		expect(testingUspto.message).toContain('EPO OPS credentials rejected');
		expect(testingUspto.message).toContain('Fix or clear that provider first');
	});

	it('maps signed-out and unreachable-backend states to actionable messages without blaming a key', async () => {
		const signedOut = await testPatentDataConnection(
			makeClient({ post: () => Promise.reject(new AuthRequiredError('no session')) }).client, 'epo');
		const down = await testPatentDataConnection(
			makeClient({ post: () => Promise.reject(new PatentBackendError(undefined, 'Request timed out after 15000 ms.')) }).client, 'epo');

		expect(signedOut).toEqual({ ok: false, message: 'Sign in to FlowLeap first (the test runs through your FlowLeap account).' });
		expect(signedOut.failedProvider).toBeUndefined();
		expect(down.ok).toBe(false);
		expect(down.failedProvider).toBeUndefined();
		expect(down.message).toContain('Could not reach the FlowLeap backend');
	});
});

describe('renderPatentDataKeysPageHtml', () => {

	it('renders the key fields as a static, secret-free skeleton', () => {
		const html = renderPatentDataKeysPageHtml('test-nonce');

		// The three fields, correctly named per provider portal terminology.
		expect(html).toContain('Consumer Key');
		expect(html).toContain('Consumer Secret');
		expect(html).toContain('API Key');
		// The LLM BYOK entry point rendered alongside the data-key cards — no acronym on the button.
		expect(html).toContain('Add AI Model');
		expect(html).not.toContain('Add AI Model (BYOK)');
		// Key-source guidance is a persistent caption, not a load-bearing placeholder.
		expect(html).toContain('field-hint');
		expect(html).toContain('developers.epo.org');
		expect(html).toContain('data.uspto.gov/myodp');
		// Masked inputs only; no value attributes — key material never reaches the markup.
		expect(html.match(/type="password"/g)).toHaveLength(3);
		// Scoped to <input> because the Privacy row's <option value="…"> entries are static
		// verdict names, not user data.
		expect(html).not.toMatch(/<input[^>]*\svalue=/);
		// Locked-down CSP with the provided nonce.
		expect(html).toContain(`script-src 'nonce-test-nonce'`);
		expect(html).toContain(`default-src 'none'`);
	});
});

describe('Privacy section', () => {

	it('discloses the OCR processor and retention, not just a switch', () => {
		const html = renderPatentDataKeysPageHtml('test-nonce');

		// A user must be able to learn what is uploaded and to whom without triggering it.
		expect(html).toContain('Document OCR');
		expect(html).toContain('processed by Mistral');
		expect(html).toContain('cached for 24 hours');
		// Three choices, reversible in both directions.
		expect(html).toContain('value="ask"');
		expect(html).toContain('value="always"');
		expect(html).toContain('value="never"');
	});
});

