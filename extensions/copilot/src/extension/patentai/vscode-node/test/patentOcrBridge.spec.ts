/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import type { CancellationToken } from '../../../../util/vs/base/common/cancellation';
import { OCR_RUN_COMMAND_ID } from '../../common/ocrBridge';
import {
	AuthRequiredError,
	DataKeysRequiredError,
	IPatentBackendClient,
	IPatentBackendRequestOptions,
	PatentBackendError,
	RateLimitError,
	SubscriptionRequiredError,
	TransientBackendError,
} from '../patentBackendClient';
import { runOcrThroughSeam } from '../patentOcrBridge';

// ── Fakes ──────────────────────────────────────────────────────────────────────

/** A client whose `post` answers with a scripted result (or throws), recording path/body/options. */
function makeBackendClient(result: unknown | (() => never)) {
	const calls: { path: string; body?: unknown; options?: IPatentBackendRequestOptions }[] = [];
	const client: IPatentBackendClient = {
		_serviceBrand: undefined,
		async getCustomerPortalUrl(): Promise<string> { return ''; },
		getTrialModelKey(): never { throw new Error('getTrialModelKey not exercised in this test fake'); },
		async post<T>(path: string, body: unknown, _token: CancellationToken, options?: IPatentBackendRequestOptions): Promise<T> {
			calls.push({ path, body, options });
			if (typeof result === 'function') {
				return (result as () => never)();
			}
			return result as T;
		},
		async get<T>(): Promise<T> { throw new Error('the OCR bridge does not GET'); },
	};
	return { client, calls };
}

function makeToken(): CancellationToken {
	return {
		isCancellationRequested: false,
		onCancellationRequested() {
			return { dispose: () => { /* noop */ } };
		},
	};
}

const REQUEST = { file: 'YmFzZTY0', filename: 'office-action.pdf' };

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('runOcrThroughSeam', () => {

	it('calls the ocr tool on the facade and returns the markdown, images and page count', async () => {
		const { client, calls } = makeBackendClient({
			success: true,
			tool: 'ocr',
			data: {
				markdown: '# Office Action',
				images: [{ id: 'img-0', base64: 'aGVsbG8=', mimeType: 'image/jpeg' }],
				pageCount: 3,
			},
		});

		const outcome = await runOcrThroughSeam(client, REQUEST, makeToken());

		expect(calls).toHaveLength(1);
		expect(calls[0].path).toBe('/tools/ocr');
		// include_images: the PDF viewer saves the images to disk, and the
		// backend's ocr tool is text-only unless asked.
		expect(calls[0].body).toEqual({
			file: 'YmFzZTY0',
			filename: 'office-action.pdf',
			include_images: true,
		});
		expect(outcome).toEqual({
			ok: true,
			markdown: '# Office Action',
			images: [{ id: 'img-0', base64: 'aGVsbG8=', mimeType: 'image/jpeg' }],
			pageCount: 3,
		});
	});

	it('reports each seam gating failure by CODE, never by message text', async () => {
		const codeFor = async (error: Error) => {
			const { client } = makeBackendClient(() => { throw error; });
			const outcome = await runOcrThroughSeam(client, REQUEST, makeToken());
			return outcome.ok ? 'ok' : outcome.code;
		};

		expect({
			auth: await codeFor(new AuthRequiredError('session expired')),
			subscription: await codeFor(new SubscriptionRequiredError('trial needed', 'https://flowleap.co/pricing')),
			dataKeys: await codeFor(new DataKeysRequiredError('add your keys', 'epo')),
			rateLimited: await codeFor(new RateLimitError('slow down', 30)),
			transient: await codeFor(new TransientBackendError('gateway', 502)),
			cancelled: await codeFor(new PatentBackendError(undefined, 'Request cancelled.')),
			unclassified: await codeFor(new PatentBackendError(418, 'teapot')),
			nonBackend: await codeFor(new Error('boom')),
		}).toEqual({
			auth: 'auth_required',
			subscription: 'subscription_required',
			dataKeys: 'data_keys_required',
			rateLimited: 'rate_limited',
			transient: 'transient',
			cancelled: 'cancelled',
			unclassified: 'backend_error',
			nonBackend: 'backend_error',
		});
	});

	it('answers instead of throwing, so the code survives the command boundary', async () => {
		const { client } = makeBackendClient(() => { throw new AuthRequiredError('session expired'); });

		// No rejection to catch: the PDF viewer reads `ok` and branches on `code`.
		await expect(runOcrThroughSeam(client, REQUEST, makeToken())).resolves.toEqual(
			expect.objectContaining({ ok: false, code: 'auth_required' }));
	});

	it('pins the command id the PDF viewer hand-mirrors', () => {
		expect(OCR_RUN_COMMAND_ID).toBe('flowleap.ocr.run');
	});
});
