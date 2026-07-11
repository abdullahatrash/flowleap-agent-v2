/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';

import { AuthRequiredError, DataKeyInvalidError, IPatentBackendClient, PatentBackendError } from '../patentBackendClient';
import { renderPatentDataKeysPageHtml, testPatentDataConnection } from '../patentDataKeysPage';

function makeClient(behavior: { get?: () => Promise<unknown>; post?: () => Promise<unknown> }): IPatentBackendClient {
	return {
		_serviceBrand: undefined,
		get: behavior.get ?? (async () => ({})),
		post: behavior.post ?? (async () => ({})),
	} as IPatentBackendClient;
}

describe('testPatentDataConnection', () => {

	it('reports success per provider through the normal seam', async () => {
		const client = makeClient({});

		expect([
			await testPatentDataConnection(client, 'epo'),
			await testPatentDataConnection(client, 'uspto'),
		]).toEqual([
			{ ok: true, message: 'EPO OPS credentials verified.' },
			{ ok: true, message: 'USPTO ODP key verified.' },
		]);
	});

	it('attributes a rejection to the provider the backend named — even when testing the other one', async () => {
		const epoRejected = () => Promise.reject(new DataKeyInvalidError('bad epo', 'epo'));

		const testingEpo = await testPatentDataConnection(makeClient({ get: epoRejected }), 'epo');
		// Testing USPTO while a broken EPO pair is stored: the eager EPO validation fails first.
		const testingUspto = await testPatentDataConnection(makeClient({ post: epoRejected }), 'uspto');

		expect(testingEpo.ok).toBe(false);
		expect(testingEpo.failedProvider).toBe('epo');
		expect(testingEpo.message).toContain('EPO OPS credentials rejected');
		expect(testingEpo.message).toContain('Update the key');
		expect(testingUspto.ok).toBe(false);
		expect(testingUspto.failedProvider).toBe('epo');
		expect(testingUspto.message).toContain('EPO OPS credentials rejected');
		expect(testingUspto.message).toContain('Fix or clear that provider first');
	});

	it('maps signed-out and unreachable-backend states to actionable messages without blaming a key', async () => {
		const signedOut = await testPatentDataConnection(
			makeClient({ get: () => Promise.reject(new AuthRequiredError('no session')) }), 'epo');
		const down = await testPatentDataConnection(
			makeClient({ get: () => Promise.reject(new PatentBackendError(undefined, 'Request timed out after 15000 ms.')) }), 'epo');

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
		expect(html).not.toContain('value=');
		// Locked-down CSP with the provided nonce.
		expect(html).toContain(`script-src 'nonce-test-nonce'`);
		expect(html).toContain(`default-src 'none'`);
	});
});
