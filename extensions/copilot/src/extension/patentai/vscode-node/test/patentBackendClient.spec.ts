/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The client triggers 401 re-auth through `vscode.commands.executeCommand('patent-ai.signIn')`.
// Capture the call so the re-auth test can assert it (the `vscode` test alias has no `commands`).
const { executeCommandMock } = vi.hoisted(() => ({ executeCommandMock: vi.fn(async () => undefined) }));
vi.mock('vscode', () => ({ commands: { executeCommand: executeCommandMock } }));

// Keep the vscode-backed config dependency out of the unit; the client reads apiUrl from here.
vi.mock('../configService', () => ({
	getPatentAIConfig: () => ({
		apiUrl: 'https://api.test/v1',
		clientId: 'patent-ai-agent',
		authUrl: 'https://api.test/oauth/authorize',
		frontendUrl: 'https://flowleap.co',
	}),
}));

import { AuthRequiredError, PatentBackendClient, PatentBackendError, SubscriptionRequiredError } from '../patentBackendClient';
import { registerPatentAccessTokenProvider } from '../../common/patentTokenRegistry';
import type { IEnvService } from '../../../../platform/env/common/envService';
import type { ILogService } from '../../../../platform/log/common/logService';
import { FetchOptions, HeadersImpl, IFetcherService, isAbortError, Response } from '../../../../platform/networking/common/fetcherService';
import type { INotificationService } from '../../../../platform/notification/common/notificationService';
import { Event } from '../../../../util/vs/base/common/event';
import type { CancellationToken } from '../../../../util/vs/base/common/cancellation';

// Action labels the client surfaces — mirror the private consts in patentBackendClient.ts.
const SIGN_IN_ACTION = 'Sign In';
const START_TRIAL_ACTION = 'Start Free Trial';

// The single seam the client now goes through to reach the network.
type FetchImpl = (url: string, options: FetchOptions) => Promise<Response>;

// ── Fakes ──────────────────────────────────────────────────────────────────────

function makeLogService(): ILogService {
	return { trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as ILogService;
}

function makeNotificationService() {
	const showInformationMessage = vi.fn(async () => undefined);
	const showWarningMessage = vi.fn(async () => undefined);
	return {
		service: { showInformationMessage, showWarningMessage } as unknown as INotificationService,
		showInformationMessage,
		showWarningMessage,
	};
}

function makeEnvService() {
	const openExternal = vi.fn(async () => true);
	return { service: { openExternal } as unknown as IEnvService, openExternal };
}

/**
 * A real (no `any`-cast) {@link IFetcherService} whose `fetch` is scripted per test. Members the
 * client never exercises are no-ops/throwers — an acceptable test fake that still implements the
 * full interface. `makeAbortController`/`isAbortError` are wired so the timeout and cancellation
 * paths behave exactly like the production fetcher.
 */
function makeFetcherService(impl: FetchImpl): IFetcherService {
	return {
		_serviceBrand: undefined,
		onDidFetch: Event.None,
		onDidCompleteFetch: Event.None,
		getUserAgentLibrary: () => 'test-stub',
		fetch: impl,
		makeAbortController: () => new AbortController(),
		isAbortError,
		createWebSocket() { throw new Error('createWebSocket not implemented in PatentBackendClient test fake'); },
		disconnectAll: () => Promise.resolve(undefined),
		isInternetDisconnectedError: () => false,
		isFetcherError: () => false,
		isNetworkProcessCrashedError: () => false,
		getUserMessageForFetcherError: () => '',
		fetchWithPagination() { throw new Error('fetchWithPagination not implemented in PatentBackendClient test fake'); },
	};
}

/** Build a client wired to fresh fakes and the given scripted fetch, exposing the spies for assertions. */
function makeClient(fetchImpl: FetchImpl) {
	const notification = makeNotificationService();
	const env = makeEnvService();
	const client = new PatentBackendClient(makeLogService(), notification.service, env.service, makeFetcherService(fetchImpl));
	return { client, notification, env };
}

/** Stub CancellationToken that is never cancelled. */
function makeToken(): CancellationToken {
	return {
		isCancellationRequested: false,
		onCancellationRequested(_listener: () => void) {
			return { dispose: () => { /* noop */ } };
		},
	};
}

/** Cancellation token that fires after a short delay. */
function makeCancellingToken(delayMs = 20): CancellationToken {
	const listeners: Array<() => void> = [];
	let cancelled = false;
	const token: CancellationToken = {
		get isCancellationRequested() { return cancelled; },
		onCancellationRequested(listener: () => void) {
			if (cancelled) {
				setTimeout(listener, 0);
			} else {
				listeners.push(listener);
			}
			return { dispose: () => { /* noop */ } };
		},
	};
	setTimeout(() => {
		cancelled = true;
		for (const l of listeners) {
			l();
		}
	}, delayMs);
	return token;
}

/** A fetch that hangs until its timeout elapses or its abort signal fires, then rejects like the real fetcher. */
function hangingFetch(): FetchImpl {
	return (_url, options) => new Promise<Response>((_resolve, reject) => {
		const fail = () => reject(new DOMException('The operation was aborted.', 'AbortError'));
		if (options.signal?.aborted) {
			fail();
			return;
		}
		const timer = typeof options.timeout === 'number' ? setTimeout(fail, options.timeout) : undefined;
		options.signal?.addEventListener('abort', () => {
			if (timer !== undefined) {
				clearTimeout(timer);
			}
			fail();
		});
	});
}

/** Build a platform Response with a JSON body. */
function makeResponse(status: number, body: unknown): Response {
	return Response.fromText(status, '', new HeadersImpl({ 'content-type': 'application/json' }), JSON.stringify(body), 'test-stub');
}

/** Flush pending microtasks/timers so fire-and-forget UX promises settle before assertions. */
function flush(): Promise<void> {
	return new Promise(resolve => setImmediate(resolve));
}

/** Run `fn`, returning whatever it throws (or undefined if it resolves). */
async function captureThrow(fn: () => Promise<unknown>): Promise<unknown> {
	try {
		await fn();
		return undefined;
	} catch (err) {
		return err;
	}
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('PatentBackendClient.post', () => {

	beforeEach(() => registerPatentAccessTokenProvider(() => undefined));
	afterEach(() => vi.restoreAllMocks());

	it('resolves parsed JSON and sends a Bearer Authorization header from the token registry', async () => {
		registerPatentAccessTokenProvider(() => 'tok-123');
		let capturedOptions: FetchOptions | undefined;
		const { client } = makeClient(async (_url, options) => {
			capturedOptions = options;
			return makeResponse(200, { success: true, results: [42] });
		});

		const result = await client.post<{ success: boolean; results: number[] }>('/patent-search', { query: 'AI' }, makeToken());

		expect(result).toEqual({ success: true, results: [42] });
		expect(capturedOptions?.headers?.['Authorization']).toBe('Bearer tok-123');
	});

	it('sends no Authorization header when no token is registered', async () => {
		let capturedOptions: FetchOptions | undefined;
		const { client } = makeClient(async (_url, options) => {
			capturedOptions = options;
			return makeResponse(200, { success: true });
		});

		await client.post('/patent-search', {}, makeToken());

		expect(capturedOptions?.headers?.['Authorization']).toBeUndefined();
	});

	it('throws PatentBackendError carrying the status on a non-OK response', async () => {
		const { client } = makeClient(async () => makeResponse(422, { error: 'Unprocessable Entity' }));

		const thrown = await captureThrow(() => client.post('/patent-search', { query: 'x' }, makeToken()));

		expect(thrown).toBeInstanceOf(PatentBackendError);
		expect((thrown as PatentBackendError).status).toBe(422);
	});

	it('rejects with a timeout PatentBackendError when fetch never resolves', async () => {
		const { client } = makeClient(hangingFetch());

		const thrown = await captureThrow(() => client.post('/patent-search', {}, makeToken(), { timeoutMs: 50 }));

		expect(thrown).toBeInstanceOf(PatentBackendError);
		expect((thrown as PatentBackendError).message).toContain('timed out');
	}, 3000);

	it('rejects with "Request cancelled." when the cancellation token fires', async () => {
		const { client } = makeClient(hangingFetch());

		const thrown = await captureThrow(() => client.post('/patent-search', {}, makeCancellingToken(20), { timeoutMs: 5000 }));

		expect(thrown).toBeInstanceOf(PatentBackendError);
		expect((thrown as PatentBackendError).message).toBe('Request cancelled.');
	}, 3000);
});

describe('PatentBackendClient.get', () => {

	beforeEach(() => registerPatentAccessTokenProvider(() => undefined));
	afterEach(() => vi.restoreAllMocks());

	it('resolves parsed JSON, builds the URL, sends Authorization, and sends no Content-Type', async () => {
		registerPatentAccessTokenProvider(() => 'tok-get');
		let capturedUrl: string | undefined;
		let capturedOptions: FetchOptions | undefined;
		const { client } = makeClient(async (url, options) => {
			capturedUrl = url;
			capturedOptions = options;
			return makeResponse(200, { success: true, data: { docId: 'EP1234567' } });
		});

		const result = await client.get<{ success: boolean; data: { docId: string } }>('/patent-search-bq/EP-1234567-A1', makeToken());

		expect(result.data.docId).toBe('EP1234567');
		expect(capturedUrl).toBe('https://api.test/v1/patent-search-bq/EP-1234567-A1');
		expect(capturedOptions?.headers?.['Authorization']).toBe('Bearer tok-get');
		expect(capturedOptions?.headers?.['Content-Type']).toBeUndefined();
	});

	it('throws PatentBackendError carrying the status on a non-OK response', async () => {
		const { client } = makeClient(async () => makeResponse(404, { error: 'Not Found' }));

		const thrown = await captureThrow(() => client.get('/patent-search-bq/MISSING-123', makeToken()));

		expect(thrown).toBeInstanceOf(PatentBackendError);
		expect((thrown as PatentBackendError).status).toBe(404);
	});
});

describe('subscription gate (402 subscription_required)', () => {

	const BODY = {
		error: {
			message: 'An active FlowLeap subscription is required. Start your free trial to continue.',
			type: 'payment_required',
			code: 'subscription_required',
			upgradeUrl: 'https://flowleap.co/pricing',
		},
	};

	beforeEach(() => registerPatentAccessTokenProvider(() => undefined));
	afterEach(() => vi.restoreAllMocks());

	it('throws a structured SubscriptionRequiredError carrying upgradeUrl, code, and a clean message', async () => {
		const { client } = makeClient(async () => makeResponse(402, BODY));

		const thrown = await captureThrow(() => client.post('/patent-search', { query: 'AI' }, makeToken()));

		// Subclass of PatentBackendError so existing tool catch blocks still match.
		expect(thrown).toBeInstanceOf(PatentBackendError);
		expect(thrown).toBeInstanceOf(SubscriptionRequiredError);
		const err = thrown as SubscriptionRequiredError;
		expect(err.status).toBe(402);
		expect(err.code).toBe('subscription_required');
		expect(err.upgradeUrl).toBe('https://flowleap.co/pricing');
		expect(err.message).toContain('https://flowleap.co/pricing');
		expect(err.message).not.toContain('"error"');
	});

	it('shows the "Start free trial" notification and opens the upgrade URL when accepted', async () => {
		const { client, notification, env } = makeClient(async () => makeResponse(402, BODY));
		notification.showInformationMessage.mockResolvedValueOnce(START_TRIAL_ACTION as never);

		await captureThrow(() => client.post('/patent-search', {}, makeToken()));
		await flush();

		expect(notification.showInformationMessage).toHaveBeenCalledWith(expect.stringContaining('subscription'), START_TRIAL_ACTION);
		expect(env.openExternal).toHaveBeenCalledTimes(1);
	});

	it('does not let a throwing notification mask the SubscriptionRequiredError', async () => {
		const { client, notification } = makeClient(async () => makeResponse(402, BODY));
		notification.showInformationMessage.mockImplementationOnce(() => { throw new Error('boom'); });

		const thrown = await captureThrow(() => client.post('/patent-search', {}, makeToken()));

		expect(thrown).toBeInstanceOf(SubscriptionRequiredError);
	});

	it('falls back to a generic PatentBackendError for a 402 without the subscription_required code', async () => {
		const { client, notification } = makeClient(async () => makeResponse(402, { error: { code: 'insufficient_funds', message: 'nope' } }));

		const thrown = await captureThrow(() => client.post('/patent-search', {}, makeToken()));

		expect(thrown).toBeInstanceOf(PatentBackendError);
		expect(thrown).not.toBeInstanceOf(SubscriptionRequiredError);
		expect((thrown as PatentBackendError).status).toBe(402);
		expect(notification.showInformationMessage).not.toHaveBeenCalled();
	});

	it('leaves other backend errors (500) unchanged', async () => {
		const { client } = makeClient(async () => makeResponse(500, { error: 'Internal Server Error' }));

		const thrown = await captureThrow(() => client.get('/patent-search-bq/EP-1-A1', makeToken()));

		expect(thrown).toBeInstanceOf(PatentBackendError);
		expect(thrown).not.toBeInstanceOf(SubscriptionRequiredError);
		expect((thrown as PatentBackendError).status).toBe(500);
	});
});

describe('auth gate (401)', () => {

	const BODY = { error: { message: 'Authentication required. Please sign in.', code: 'unauthorized' } };

	beforeEach(() => registerPatentAccessTokenProvider(() => undefined));
	afterEach(() => vi.restoreAllMocks());

	it('throws a structured AuthRequiredError carrying status 401 and a clean message', async () => {
		const { client } = makeClient(async () => makeResponse(401, BODY));

		const thrown = await captureThrow(() => client.post('/patent-search', { query: 'AI' }, makeToken()));

		// Subclass of PatentBackendError so existing tool catch blocks still match.
		expect(thrown).toBeInstanceOf(PatentBackendError);
		expect(thrown).toBeInstanceOf(AuthRequiredError);
		const err = thrown as AuthRequiredError;
		expect(err.status).toBe(401);
		expect(err.code).toBe('auth_required');
		expect(err.message).not.toContain('"error"');
	});

	it('never-signed-in (no local token): shows a sign-in invitation (info, no "expired" language) and starts sign-in when accepted', async () => {
		const { client, notification } = makeClient(async () => makeResponse(401, BODY));
		notification.showInformationMessage.mockResolvedValueOnce(SIGN_IN_ACTION as never);

		const thrown = await captureThrow(() => client.get('/citation-search/EP-1-A1', makeToken()));
		await flush();

		expect(thrown).toBeInstanceOf(AuthRequiredError);
		// The client knows no token was sent — the backend body must not turn this into an
		// "expired session" claim for a user who never signed in.
		expect((thrown as AuthRequiredError).message).not.toContain('expired');
		expect(notification.showInformationMessage).toHaveBeenCalledWith(expect.not.stringContaining('expired'), SIGN_IN_ACTION);
		expect(notification.showWarningMessage).not.toHaveBeenCalled();
		// Sign-in is triggered through the FlowLeap provider's sign-in command (decoupled from the
		// concrete provider/auth-service type).
		expect(executeCommandMock).toHaveBeenCalledWith('patent-ai.signIn');
	});

	it('expired session (token was sent): shows the expired-session warning and starts sign-in when accepted — even for a non-JSON body', async () => {
		registerPatentAccessTokenProvider(() => 'tok-stale');
		const { client, notification } = makeClient(async () => makeResponse(401, 'not json'));
		notification.showWarningMessage.mockResolvedValueOnce(SIGN_IN_ACTION as never);

		const thrown = await captureThrow(() => client.get('/citation-search/EP-1-A1', makeToken()));
		await flush();

		expect(thrown).toBeInstanceOf(AuthRequiredError);
		expect((thrown as AuthRequiredError).message).toContain('expired');
		expect(notification.showWarningMessage).toHaveBeenCalledWith(expect.stringContaining('expired'), SIGN_IN_ACTION);
		expect(notification.showInformationMessage).not.toHaveBeenCalled();
		expect(executeCommandMock).toHaveBeenCalledWith('patent-ai.signIn');
	});

	it('expired session: prefers the backend-supplied message from a JSON body', async () => {
		registerPatentAccessTokenProvider(() => 'tok-stale');
		const { client, notification } = makeClient(async () => makeResponse(401, BODY));

		const thrown = await captureThrow(() => client.post('/patent-search', {}, makeToken()));
		await flush();

		expect((thrown as AuthRequiredError).message).toBe('Authentication required. Please sign in.');
		expect(notification.showWarningMessage).toHaveBeenCalledWith('Authentication required. Please sign in.', SIGN_IN_ACTION);
	});

	it('does not let a throwing notification mask the AuthRequiredError', async () => {
		const { client, notification } = makeClient(async () => makeResponse(401, BODY));
		notification.showInformationMessage.mockImplementationOnce(() => { throw new Error('boom'); });

		const thrown = await captureThrow(() => client.post('/patent-search', {}, makeToken()));

		expect(thrown).toBeInstanceOf(AuthRequiredError);
	});
});
