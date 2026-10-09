/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { HOSTED_GATE_SESSION_HEADER, HOSTED_GATE_SESSION_PATH, readHostedGateSession } from '../../browser/patentHostedSession.web.contribution.js';

suite('Hosted Workspace gate session (#548)', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	interface IFakeAnswer {
		readonly status?: number;
		readonly body?: unknown;
		readonly error?: Error;
	}

	/** A fetch that records the request and answers with `status` and `body`, or throws `error`. */
	function fakeFetch(answer: IFakeAnswer) {
		const requests: { url: string; init: RequestInit | undefined }[] = [];
		const fetchImpl = (async (url: string, init?: RequestInit) => {
			requests.push({ url, init });
			if (answer.error) {
				throw answer.error;
			}
			return new Response(typeof answer.body === 'string' ? answer.body : JSON.stringify(answer.body), { status: answer.status ?? 200 });
		}) as typeof fetch;
		return { fetchImpl, requests };
	}

	test('reads the token from the same-origin gate endpoint with the custom header', async () => {
		const { fetchImpl, requests } = fakeFetch({ body: { token: 'aaa.bbb.ccc' } });

		const session = await readHostedGateSession(fetchImpl, new NullLogService());

		assert.deepStrictEqual({
			session,
			url: requests[0].url,
			credentials: requests[0].init?.credentials,
			cache: requests[0].init?.cache,
			redirect: requests[0].init?.redirect,
			headers: requests[0].init?.headers,
		}, {
			session: { token: 'aaa.bbb.ccc' },
			url: HOSTED_GATE_SESSION_PATH,
			credentials: 'same-origin',
			cache: 'no-store',
			redirect: 'error',
			headers: { [HOSTED_GATE_SESSION_HEADER]: '1' },
		});
	});

	test('answers undefined for every refusal and every malformed answer', async () => {
		const answers: Record<string, IFakeAnswer> = {
			noCookie: { status: 401, body: { error: 'no session' } },
			noHeader: { status: 403, body: { error: 'forbidden' } },
			noGate: { status: 404, body: 'Not Found' },
			notJson: { body: '<html>' },
			noToken: { body: {} },
			tokenNotString: { body: { token: 42 } },
			tokenWithQuote: { body: { token: 'a"b' } },
			emptyToken: { body: { token: '' } },
			network: { error: new TypeError('Failed to fetch') },
		};
		const results: Record<string, unknown> = {};
		for (const [name, answer] of Object.entries(answers)) {
			results[name] = await readHostedGateSession(fakeFetch(answer).fetchImpl, new NullLogService());
		}

		assert.deepStrictEqual(results, Object.fromEntries(Object.keys(answers).map(name => [name, undefined])));
	});
});
