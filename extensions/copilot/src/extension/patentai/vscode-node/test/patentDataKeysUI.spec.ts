/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { vi } from 'vitest';

vi.mock('vscode', () => ({
	commands: { registerCommand: vi.fn() },
	window: {},
	env: {},
	Uri: { parse: vi.fn() },
	ProgressLocation: { Notification: 15 },
}));

import { AuthRequiredError, DataKeyInvalidError, IPatentBackendClient, PatentBackendError } from '../patentBackendClient';
import { testPatentDataConnection } from '../patentDataKeysUI';

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
		expect(testingEpo.message).toContain('EPO OPS credentials rejected');
		expect(testingEpo.message).toContain('Update the key');
		expect(testingUspto.ok).toBe(false);
		expect(testingUspto.message).toContain('EPO OPS credentials rejected');
		expect(testingUspto.message).toContain('Fix or clear that provider first');
	});

	it('maps signed-out and unreachable-backend states to actionable messages', async () => {
		const signedOut = await testPatentDataConnection(
			makeClient({ get: () => Promise.reject(new AuthRequiredError('no session')) }), 'epo');
		const down = await testPatentDataConnection(
			makeClient({ get: () => Promise.reject(new PatentBackendError(undefined, 'Request timed out after 15000 ms.')) }), 'epo');

		expect(signedOut).toEqual({ ok: false, message: 'Sign in to FlowLeap first (the test runs through your FlowLeap account).' });
		expect(down.ok).toBe(false);
		expect(down.message).toContain('Could not reach the FlowLeap backend');
	});
});
