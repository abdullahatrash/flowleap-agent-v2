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

import { AuthRequiredError, DataKeyInvalidError, DataKeysRequiredError, PatentBackendClient, PatentBackendError, patentBackendErrorRecoveryHint, RateLimitError, SubscriptionRequiredError, TransientBackendError, TrialDataBudgetExhaustedError, TrialModelKeyUnavailableError } from '../patentBackendClient';
import { registerPatentDataKeysProvider } from '../../common/patentDataKeysRegistry';
import { registerPatentAccessTokenProvider } from '../../common/patentTokenRegistry';
import type { IEnvService } from '../../../../platform/env/common/envService';
import type { ILogService } from '../../../../platform/log/common/logService';
import { FetchOptions, HeadersImpl, IFetcherService, isAbortError, Response } from '../../../../platform/networking/common/fetcherService';
import type { INotificationService } from '../../../../platform/notification/common/notificationService';
import type { ITelemetryService } from '../../../../platform/telemetry/common/telemetry';
import { Event } from '../../../../util/vs/base/common/event';
import type { CancellationToken } from '../../../../util/vs/base/common/cancellation';

// Action labels the client surfaces — mirror the private consts in patentBackendClient.ts.
const SIGN_IN_ACTION = 'Sign In';
const SUBSCRIBE_ACTION = 'Subscribe';
// Localized via l10n.t in the client; with no bundle configured l10n returns the source string.
const ADD_KEYS_ACTION = 'Add Patent Data Keys';

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

/** The client reads `getVersion()` for the `X-FlowLeap-Client` header, and opens upgrade URLs. */
function makeEnvService() {
	const openExternal = vi.fn(async () => true);
	const getVersion = vi.fn(() => '9.9.9');
	return { service: { openExternal, getVersion } as unknown as IEnvService, openExternal, getVersion };
}

function makeTelemetryService() {
	const sendInternalMSFTTelemetryEvent = vi.fn();
	return { service: { sendInternalMSFTTelemetryEvent } as unknown as ITelemetryService, sendInternalMSFTTelemetryEvent };
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
	const telemetry = makeTelemetryService();
	const client = new PatentBackendClient(makeLogService(), notification.service, env.service, makeFetcherService(fetchImpl), telemetry.service);
	return { client, notification, env, telemetry };
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

/** Build a platform Response with a JSON body and optional extra headers (e.g. Retry-After). */
function makeResponse(status: number, body: unknown, extraHeaders?: Record<string, string>): Response {
	return Response.fromText(status, '', new HeadersImpl({ 'content-type': 'application/json', ...extraHeaders }), JSON.stringify(body), 'test-stub');
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

	it('sends the client-version header on every request (ADR 0014 rule 5)', async () => {
		let capturedOptions: FetchOptions | undefined;
		const { client } = makeClient(async (_url, options) => {
			capturedOptions = options;
			return makeResponse(200, { success: true });
		});

		await client.post('/tools/search_patents', { query: 'AI' }, makeToken());

		expect(capturedOptions?.headers?.['X-FlowLeap-Client']).toBe('vscode/9.9.9');
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

describe('BYO patent-data key forwarding (#31)', () => {

	beforeEach(() => {
		registerPatentAccessTokenProvider(() => undefined);
		registerPatentDataKeysProvider(() => undefined);
	});
	afterEach(() => vi.restoreAllMocks());

	it('forwards the #30 wire-contract headers per configuration (both, EPO-only, USPTO-only, none)', async () => {
		const captured: Array<Record<string, string> | undefined> = [];
		const { client } = makeClient(async (_url, options) => {
			captured.push(options.headers);
			return makeResponse(200, { success: true });
		});
		const configs = [
			{ epo: { key: 'ek', secret: 'es' }, usptoOdp: 'uk' },
			{ epo: { key: 'ek', secret: 'es' } },
			{ usptoOdp: 'uk' },
			undefined,
		];

		// Distinct body per config so the #89 session cache (keyed on method+path+body) does not
		// dedupe these otherwise-identical calls — each must reach the network to forward its headers.
		for (const [i, keys] of configs.entries()) {
			registerPatentDataKeysProvider(() => keys);
			await client.post('/patent-search', { i }, makeToken());
		}

		expect(captured.map(h => [h?.['X-EPO-OPS-Key'], h?.['X-EPO-OPS-Secret'], h?.['X-USPTO-ODP-Key']])).toEqual([
			['ek', 'es', 'uk'],
			['ek', 'es', undefined],
			[undefined, undefined, 'uk'],
			[undefined, undefined, undefined],
		]);
	});
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

	it('shows the "Subscribe" notification and opens the upgrade URL when accepted', async () => {
		const { client, notification, env } = makeClient(async () => makeResponse(402, BODY));
		notification.showInformationMessage.mockResolvedValueOnce(SUBSCRIBE_ACTION as never);

		await captureThrow(() => client.post('/patent-search', {}, makeToken()));
		await flush();

		expect(notification.showInformationMessage).toHaveBeenCalledWith(expect.stringContaining('subscription'), SUBSCRIBE_ACTION);
		expect(env.openExternal).toHaveBeenCalledTimes(1);
	});

	// A burst of gated tool calls used to stack one identical toast per call; the
	// prompt is now once per session while the error still reaches every caller.
	it('prompts once per session for repeated 402s', async () => {
		const { client, notification } = makeClient(async () => makeResponse(402, BODY));

		await captureThrow(() => client.post('/patent-search', {}, makeToken()));
		const second = await captureThrow(() => client.post('/patent-search', {}, makeToken()));
		await flush();

		expect(second).toBeInstanceOf(SubscriptionRequiredError);
		expect(notification.showInformationMessage).toHaveBeenCalledTimes(1);
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

describe('data-key gate (400 patent_provider_key_invalid)', () => {

	const BODY = {
		error: {
			message: 'EPO OPS rejected the supplied consumer key/secret (HTTP 401). Check your OPS credentials.',
			type: 'invalid_request_error',
			code: 'patent_provider_key_invalid',
			provider: 'epo',
		},
	};

	beforeEach(() => registerPatentAccessTokenProvider(() => 'tok-123'));
	afterEach(() => vi.restoreAllMocks());

	it('throws a structured DataKeyInvalidError, shows the keys prompt, and opens the keys UI when accepted', async () => {
		const { client, notification } = makeClient(async () => makeResponse(400, BODY));
		notification.showWarningMessage.mockResolvedValueOnce('Patent Data Keys' as never);

		const thrown = await captureThrow(() => client.post('/patent-search', {}, makeToken()));
		await flush();

		expect(thrown).toBeInstanceOf(PatentBackendError);
		expect(thrown).toBeInstanceOf(DataKeyInvalidError);
		expect((thrown as DataKeyInvalidError).provider).toBe('epo');
		expect(notification.showWarningMessage).toHaveBeenCalledWith(expect.stringContaining('EPO OPS'), 'Patent Data Keys');
		expect(executeCommandMock).toHaveBeenCalledWith('flowleap.patentDataKeys');
	});

	it('leaves a generic 400 (no matching code) untyped', async () => {
		const { client, notification } = makeClient(async () => makeResponse(400, { error: { code: 'bad_request', message: 'nope' } }));

		const thrown = await captureThrow(() => client.post('/patent-search', {}, makeToken()));

		expect(thrown).toBeInstanceOf(PatentBackendError);
		expect(thrown).not.toBeInstanceOf(DataKeyInvalidError);
		expect(notification.showWarningMessage).not.toHaveBeenCalled();
	});

	it('a patent_provider_key_invalid 400 stays DataKeyInvalidError, not DataKeysRequiredError', async () => {
		const { client } = makeClient(async () => makeResponse(400, BODY));

		const thrown = await captureThrow(() => client.post('/patent-search', {}, makeToken()));

		expect(thrown).toBeInstanceOf(DataKeyInvalidError);
		expect(thrown).not.toBeInstanceOf(DataKeysRequiredError);
	});
});

describe('data-keys-required gate (400 data_keys_required, ADR 0008)', () => {

	const BODY = {
		error: {
			message: 'Your trial has ended. Add your EPO OPS key to continue using patent data.',
			type: 'invalid_request_error',
			code: 'data_keys_required',
			provider: 'epo',
		},
	};

	beforeEach(() => registerPatentAccessTokenProvider(() => 'tok-123'));
	afterEach(() => vi.restoreAllMocks());

	it('throws a structured DataKeysRequiredError carrying status 400, code, and the named provider', async () => {
		const { client } = makeClient(async () => makeResponse(400, BODY));

		const thrown = await captureThrow(() => client.post('/patent-search', {}, makeToken()));

		expect(thrown).toBeInstanceOf(PatentBackendError);
		expect(thrown).toBeInstanceOf(DataKeysRequiredError);
		const err = thrown as DataKeysRequiredError;
		expect(err.status).toBe(400);
		expect(err.code).toBe('data_keys_required');
		expect(err.provider).toBe('epo');
	});

	it('shows the "Add Patent Data Keys" prompt and opens the keys UI focused on the named provider when accepted', async () => {
		const { client, notification } = makeClient(async () => makeResponse(400, BODY));
		notification.showWarningMessage.mockResolvedValueOnce(ADD_KEYS_ACTION as never);

		await captureThrow(() => client.post('/patent-search', {}, makeToken()));
		await flush();

		expect(notification.showWarningMessage).toHaveBeenCalledWith(expect.any(String), ADD_KEYS_ACTION);
		expect(executeCommandMock).toHaveBeenCalledWith('flowleap.patentDataKeys', 'epo');
	});

	it('falls back to a localized message and opens the keys UI unfocused when no provider is named', async () => {
		const noProviderBody = { error: { code: 'data_keys_required' } };
		const { client, notification } = makeClient(async () => makeResponse(400, noProviderBody));
		notification.showWarningMessage.mockResolvedValueOnce(ADD_KEYS_ACTION as never);

		const thrown = await captureThrow(() => client.post('/patent-search', {}, makeToken()));
		await flush();

		expect((thrown as DataKeysRequiredError).provider).toBeUndefined();
		expect(notification.showWarningMessage).toHaveBeenCalledWith(expect.stringContaining('your own keys'), ADD_KEYS_ACTION);
		expect(executeCommandMock).toHaveBeenCalledWith('flowleap.patentDataKeys', undefined);
	});

	it('debounces: a burst of gated calls for the same provider prompts only once per session', async () => {
		const { client, notification } = makeClient(async () => makeResponse(400, BODY));

		await captureThrow(() => client.post('/patent-search', {}, makeToken()));
		await captureThrow(() => client.post('/patent-search', {}, makeToken()));
		await captureThrow(() => client.get('/citation-search/EP-1-A1', makeToken()));
		await flush();

		expect(notification.showWarningMessage).toHaveBeenCalledTimes(1);
	});

	it('does not let a throwing notification mask the DataKeysRequiredError', async () => {
		const { client, notification } = makeClient(async () => makeResponse(400, BODY));
		notification.showWarningMessage.mockImplementationOnce(() => { throw new Error('boom'); });

		const thrown = await captureThrow(() => client.post('/patent-search', {}, makeToken()));

		expect(thrown).toBeInstanceOf(DataKeysRequiredError);
	});
});

describe('USPTO key gate through a 503 (odp_api_key_missing, E1)', () => {

	// The ODP taxonomy's own "no USPTO key" verdict: a 5xx status on a permanent, user-fixable cause,
	// and no `provider` field — the code names the office itself.
	const BODY = {
		success: false,
		error: { code: 'odp_api_key_missing', message: 'USPTO ODP API key not configured. Set USPTO_ODP_API_KEY environment variable.' },
		status: 503,
	};

	beforeEach(() => registerPatentAccessTokenProvider(() => 'tok-123'));
	afterEach(() => vi.restoreAllMocks());

	it('is a DataKeysRequiredError for USPTO, not a transient backend error', async () => {
		const { client } = makeClient(async () => makeResponse(503, BODY));

		const thrown = await captureThrow(() => client.post('/tools/search_patents', { provider: 'uspto' }, makeToken()));

		expect(thrown).toBeInstanceOf(DataKeysRequiredError);
		expect(thrown).not.toBeInstanceOf(TransientBackendError);
		const err = thrown as DataKeysRequiredError;
		expect(err.code).toBe('data_keys_required');
		expect(err.provider).toBe('uspto');
		expect(err.status).toBe(503); // the real wire status, normalized code notwithstanding
	});

	it('deep-links into the USPTO card of the keys UI when the prompt is accepted', async () => {
		const { client, notification } = makeClient(async () => makeResponse(503, BODY));
		notification.showWarningMessage.mockResolvedValueOnce(ADD_KEYS_ACTION as never);

		await captureThrow(() => client.post('/tools/search_patents', { provider: 'uspto' }, makeToken()));
		await flush();

		expect(notification.showWarningMessage).toHaveBeenCalledWith(expect.any(String), ADD_KEYS_ACTION);
		expect(executeCommandMock).toHaveBeenCalledWith('flowleap.patentDataKeys', 'uspto');
	});

	it('is not retried — waiting never adds a key', async () => {
		const fetch = scriptedFetch([makeResponse(503, BODY)]);
		const { client } = makeClient(fetch);

		await captureThrow(() => client.post('/tools/search_patents', { provider: 'uspto' }, makeToken()));

		expect(fetch.calls()).toBe(1);
	}, 5000);

	it('leaves an ordinary 503 on the transient path (retried, then a transient error)', async () => {
		const fetch = scriptedFetch([Response.fromText(503, '', new HeadersImpl({ 'content-type': 'text/html' }), '<html>503 Service Unavailable</html>', 'test-stub')]);
		const { client } = makeClient(fetch);

		const thrown = await captureThrow(() => client.get('/patent-search-bq/EP-1-A1', makeToken()));

		expect(thrown).toBeInstanceOf(TransientBackendError);
		expect(thrown).not.toBeInstanceOf(DataKeysRequiredError);
		expect(fetch.calls()).toBe(3);
	}, 5000);

	it('carries the key-gate recovery hint for USPTO, not a "wait and retry" steer', () => {
		const hint = patentBackendErrorRecoveryHint(new DataKeysRequiredError('nope', 'uspto', 503));

		expect(hint).toContain('USPTO ODP');
		expect(hint).toContain('"FlowLeap: Patent Data Keys"');
		expect(hint).not.toContain('transient');
	});
});

describe('patentBackendErrorRecoveryHint', () => {

	it('maps each error type to its model-facing hint (empty for generic backend errors)', () => {
		expect([
			patentBackendErrorRecoveryHint(new AuthRequiredError('nope')),
			patentBackendErrorRecoveryHint(new SubscriptionRequiredError('nope', 'https://flowleap.co/pricing')),
			patentBackendErrorRecoveryHint(new DataKeyInvalidError('nope', 'uspto')),
			patentBackendErrorRecoveryHint(new DataKeysRequiredError('nope', 'epo')),
			patentBackendErrorRecoveryHint(new DataKeysRequiredError('nope', undefined)),
			patentBackendErrorRecoveryHint(new PatentBackendError(500, 'boom')),
		]).toEqual([
			expect.stringContaining('"FlowLeap: Sign In"'),
			expect.stringContaining('subscribe'),
			expect.stringContaining('"FlowLeap: Patent Data Keys"'),
			expect.stringContaining('"FlowLeap: Patent Data Keys"'),
			expect.stringContaining('"FlowLeap: Patent Data Keys"'),
			'',
		]);
	});

	it('the data-keys-required hint names the provider when known and is generic otherwise', () => {
		expect(patentBackendErrorRecoveryHint(new DataKeysRequiredError('nope', 'epo'))).toContain('EPO OPS');
		expect(patentBackendErrorRecoveryHint(new DataKeysRequiredError('nope', undefined))).toContain('EPO OPS or USPTO');
	});

	// The reactive path must say what the system prompt's key-gate doctrine says: a key gate is a
	// user-action stop, so no web substitution for that office — the other live offices and the
	// keyless tools carry on, and the gap is named as a missing-key gap.
	it('the data-keys-required hint carries the no-substitution steer and the keep-going steer', () => {
		const hint = patentBackendErrorRecoveryHint(new DataKeysRequiredError('nope', 'epo'));
		expect({
			userActionStop: hint.includes('user-action stop, not a dead route'),
			noWebSubstitution: hint.includes('do NOT substitute web or Google Patents data for this office'),
			coversSingleDocumentReads: hint.includes('for searches or for single-document reads'),
			continuesElsewhere: hint.includes('continue with any office whose key is live and with the keyless tools'),
			namesTheGap: hint.includes('name the missing-key gap'),
		}).toEqual({ userActionStop: true, noWebSubstitution: true, coversSingleDocumentReads: true, continuesElsewhere: true, namesTheGap: true });
	});

	it('maps a RateLimitError to a "wait and retry" hint, naming the wait when known', () => {
		expect(patentBackendErrorRecoveryHint(new RateLimitError('slow down', 12))).toContain('12 seconds');
		expect(patentBackendErrorRecoveryHint(new RateLimitError('slow down', undefined))).toContain('a few seconds');
	});

	it('maps a TrialDataBudgetExhaustedError to the keys steer with the reset instant — never a "wait and retry"', () => {
		const hint = patentBackendErrorRecoveryHint(new TrialDataBudgetExhaustedError('spent', 'uspto', '2026-08-29T00:00:00.000Z', 50400));
		expect({
			namesReset: hint.includes('resets at 2026-08-29T00:00:00.000Z'),
			steersToKeys: hint.includes('Patent Data Keys'),
			userActionStop: hint.includes('user-action stop'),
			noWebSubstitution: hint.includes('do NOT substitute web or Google Patents data'),
			notARateLimitSteer: !hint.includes('rate-limiting'),
		}).toEqual({ namesReset: true, steersToKeys: true, userActionStop: true, noWebSubstitution: true, notARateLimitSteer: true });
		expect(patentBackendErrorRecoveryHint(new TrialDataBudgetExhaustedError('spent', undefined, undefined, undefined))).toContain('next UTC day');
	});

	it('maps a TransientBackendError to a "transient, wait and retry" hint, naming the status when known', () => {
		const withStatus = patentBackendErrorRecoveryHint(new TransientBackendError('boom', 504));
		const noStatus = patentBackendErrorRecoveryHint(new TransientBackendError('boom', undefined));
		expect(withStatus).toContain('temporarily unavailable (HTTP 504)');
		expect(withStatus).toContain('retry the same query');
		expect(noStatus).toContain('temporarily unavailable —');
	});
});

// ── #89 hardening: retry, 429, telemetry, session cache ─────────────────────────

/** A fetch that returns the given responses/throws in sequence, one per call, exposing the call count. */
function scriptedFetch(steps: Array<Response | Error>): FetchImpl & { calls: () => number } {
	let call = 0;
	const impl: FetchImpl = async () => {
		const step = steps[Math.min(call, steps.length - 1)];
		call++;
		if (step instanceof Error) {
			throw step;
		}
		return step;
	};
	return Object.assign(impl, { calls: () => call });
}

describe('retry with backoff (#89)', () => {

	beforeEach(() => registerPatentAccessTokenProvider(() => undefined));
	afterEach(() => vi.restoreAllMocks());

	it('retries a transient network error and then succeeds', async () => {
		const fetch = scriptedFetch([new Error('ECONNRESET'), makeResponse(200, { success: true, results: [1] })]);
		const { client } = makeClient(fetch);

		const result = await client.post<{ success: boolean; results: number[] }>('/patent-search', { query: 'AI' }, makeToken());

		expect(result).toEqual({ success: true, results: [1] });
		expect(fetch.calls()).toBe(2);
	}, 5000);

	it('retries a 5xx and then succeeds', async () => {
		const fetch = scriptedFetch([makeResponse(503, { error: 'unavailable' }), makeResponse(200, { success: true })]);
		const { client } = makeClient(fetch);

		const result = await client.get<{ success: boolean }>('/patent-search-bq/EP-1-A1', makeToken());

		expect(result).toEqual({ success: true });
		expect(fetch.calls()).toBe(2);
	}, 5000);

	it('absorbs a short 503 Retry-After inline and then succeeds (PRD 0001 S6)', async () => {
		const backpressure = { error: { message: 'EPO OPS asked us to wait 0.2 seconds.', type: 'upstream', code: 'upstream_unavailable' } };
		const fetch = scriptedFetch([makeResponse(503, backpressure, { 'retry-after': '0.2' }), makeResponse(200, { success: true })]);
		const { client } = makeClient(fetch);

		const result = await client.get<{ success: boolean }>('/patent-search-bq/EP-1-A1', makeToken());

		expect({ result, calls: fetch.calls() }).toEqual({ result: { success: true }, calls: 2 });
	}, 5000);

	it('returns a long 503 Retry-After at once, with the seconds in the model-facing hint', async () => {
		const backpressure = { error: { message: 'EPO OPS asked us to wait 60 seconds.', type: 'upstream', code: 'upstream_unavailable' } };
		const fetch = scriptedFetch([makeResponse(503, backpressure, { 'retry-after': '60' })]);
		const { client } = makeClient(fetch);

		const thrown = await captureThrow(() => client.get('/patent-search-bq/EP-1-A1', makeToken())) as TransientBackendError;

		expect({
			type: thrown.constructor.name,
			status: thrown.status,
			retryAfterSeconds: thrown.retryAfterSeconds,
			calls: fetch.calls(),
			hintNamesTheWait: patentBackendErrorRecoveryHint(thrown).includes('Wait at least 60 seconds before retrying this tool'),
		}).toEqual({ type: 'TransientBackendError', status: 503, retryAfterSeconds: 60, calls: 1, hintNamesTheWait: true });
	}, 5000);

	it('surfaces the error once retries are exhausted (persistent 5xx)', async () => {
		const fetch = scriptedFetch([makeResponse(500, { error: 'boom' })]);
		const { client } = makeClient(fetch);

		const thrown = await captureThrow(() => client.get('/patent-search-bq/EP-1-A1', makeToken()));

		expect(thrown).toBeInstanceOf(PatentBackendError);
		expect((thrown as PatentBackendError).status).toBe(500);
		expect(fetch.calls()).toBe(3); // initial + 2 retries
	}, 5000);
});

describe('rate-limit gate (429, #89)', () => {

	beforeEach(() => registerPatentAccessTokenProvider(() => undefined));
	afterEach(() => vi.restoreAllMocks());

	it('honors a short Retry-After: waits and retries once, then succeeds', async () => {
		const fetch = scriptedFetch([
			makeResponse(429, { error: { message: 'slow down' } }, { 'retry-after': '1' }),
			makeResponse(200, { success: true }),
		]);
		const { client } = makeClient(fetch);

		const started = Date.now();
		const result = await client.get<{ success: boolean }>('/patent-search-bq/EP-1-A1', makeToken());

		expect(result).toEqual({ success: true });
		expect(fetch.calls()).toBe(2);
		expect(Date.now() - started).toBeGreaterThanOrEqual(800); // actually waited out Retry-After
	}, 5000);

	it('surfaces a typed RateLimitError (with retryAfterSeconds) when Retry-After exceeds the inline budget', async () => {
		const fetch = scriptedFetch([makeResponse(429, { error: { message: 'rate limited' } }, { 'retry-after': '30' })]);
		const { client } = makeClient(fetch);

		const thrown = await captureThrow(() => client.get('/patent-search-bq/EP-1-A1', makeToken()));

		// Subclass of PatentBackendError so existing tool catch blocks still match.
		expect(thrown).toBeInstanceOf(PatentBackendError);
		expect(thrown).toBeInstanceOf(RateLimitError);
		const err = thrown as RateLimitError;
		expect(err.status).toBe(429);
		expect(err.code).toBe('rate_limited');
		expect(err.retryAfterSeconds).toBe(30);
		expect(fetch.calls()).toBe(1); // not retried inline
	}, 5000);
});

describe('trial data budget gate (429 trial_data_budget_exhausted, ADR 0017)', () => {

	// Message text is deliberately uninformative — the gate matches the CODE only
	// (backend ADR 0014: wording is freely editable).
	const BODY = {
		success: false,
		error: {
			message: 'wording the backend is free to change at any time',
			code: 'trial_data_budget_exhausted',
			provider: 'uspto',
			remaining: 0,
			resets_at: '2026-08-29T00:00:00.000Z',
			retry_after: 50400,
		},
		status: 429,
	};

	beforeEach(() => registerPatentAccessTokenProvider(() => 'tok-123'));
	afterEach(() => vi.restoreAllMocks());

	it('throws a typed TrialDataBudgetExhaustedError — never a RateLimitError — carrying provider, resetsAt, retryAfterSeconds', async () => {
		const { client } = makeClient(async () => makeResponse(429, BODY, { 'retry-after': '50400' }));

		const thrown = await captureThrow(() => client.post('/tools/search_patents', {}, makeToken()));

		expect(thrown).toBeInstanceOf(PatentBackendError);
		expect(thrown).toBeInstanceOf(TrialDataBudgetExhaustedError);
		expect(thrown).not.toBeInstanceOf(RateLimitError);
		const err = thrown as TrialDataBudgetExhaustedError;
		expect(err.status).toBe(429);
		expect(err.code).toBe('trial_data_budget_exhausted');
		expect(err.provider).toBe('uspto');
		expect(err.resetsAt).toBe('2026-08-29T00:00:00.000Z');
		expect(err.retryAfterSeconds).toBe(50400);
	}, 5000);

	it('shows the budget prompt once per session and deep-links the keys UI focused on the provider that hit the wall', async () => {
		const { client, notification } = makeClient(async () => makeResponse(429, BODY, { 'retry-after': '50400' }));
		notification.showWarningMessage.mockResolvedValueOnce(ADD_KEYS_ACTION as never);

		await captureThrow(() => client.post('/tools/search_patents', {}, makeToken()));
		await captureThrow(() => client.post('/tools/get_claims', {}, makeToken()));
		await flush();

		expect(notification.showWarningMessage).toHaveBeenCalledTimes(1);
		expect(executeCommandMock).toHaveBeenCalledWith('flowleap.patentDataKeys', 'uspto');
	}, 5000);

	it('a 429 without the code stays the generic RateLimitError', async () => {
		const { client } = makeClient(async () => makeResponse(429, { error: { message: 'rate limited' } }, { 'retry-after': '30' }));

		const thrown = await captureThrow(() => client.post('/tools/search_patents', {}, makeToken()));

		expect(thrown).toBeInstanceOf(RateLimitError);
		expect(thrown).not.toBeInstanceOf(TrialDataBudgetExhaustedError);
	}, 5000);
});

describe('trial_data_budget_low warning on success envelopes (ADR 0017)', () => {

	const SUCCESS = {
		success: true,
		tool: 'search_patents',
		data: { docs: [] },
		executionTimeMs: 5,
		warnings: [{ code: 'trial_data_budget_low', message: '12 of 300 remain today.', remaining: 12, resets_at: '2026-08-29T00:00:00.000Z' }],
	};

	beforeEach(() => registerPatentAccessTokenProvider(() => 'tok-123'));
	afterEach(() => vi.restoreAllMocks());

	it('returns the envelope unchanged and notes the warning once per session with the keys deep link', async () => {
		const { client, notification } = makeClient(async () => makeResponse(200, SUCCESS));
		notification.showInformationMessage.mockResolvedValueOnce(ADD_KEYS_ACTION as never);

		const value = await client.post<typeof SUCCESS>('/tools/search_patents', { q: 1 }, makeToken());
		await flush();

		expect(value.warnings[0].code).toBe('trial_data_budget_low');
		expect(notification.showInformationMessage).toHaveBeenCalledTimes(1);
		expect(executeCommandMock).toHaveBeenCalledWith('flowleap.patentDataKeys');

		// Different body → different cache key → a real second request; still only one note.
		await client.post('/tools/search_patents', { q: 2 }, makeToken());
		await flush();
		expect(notification.showInformationMessage).toHaveBeenCalledTimes(1);
	}, 5000);

	it('a success envelope without warnings notes nothing', async () => {
		const { client, notification } = makeClient(async () => makeResponse(200, { success: true, tool: 'search_patents', data: {} }));

		await client.post('/tools/search_patents', {}, makeToken());
		await flush();

		expect(notification.showInformationMessage).not.toHaveBeenCalled();
	}, 5000);
});

describe('transient gate (5xx/gateway/timeout, H8)', () => {

	beforeEach(() => registerPatentAccessTokenProvider(() => undefined));
	afterEach(() => vi.restoreAllMocks());

	it('maps a persistent gateway 502 to a body-free TransientBackendError (strips the raw nginx/stack body)', async () => {
		// A real gateway failure: an nginx HTML page wrapping an upstream stack fragment — exactly the
		// noise the model must not read as a permanent dead end.
		const rawBody = '<html><head><title>502 Bad Gateway</title></head><body>odpRequest.q?.trim is not a function</body></html>';
		const fetch = scriptedFetch([Response.fromText(502, '', new HeadersImpl({ 'content-type': 'text/html' }), rawBody, 'test-stub')]);
		const { client } = makeClient(fetch);

		const thrown = await captureThrow(() => client.get('/patent-search-bq/EP-1-A1', makeToken())) as TransientBackendError;

		// Subclass of PatentBackendError so existing tool catch blocks still match; message is a short
		// status line with the hint's "transient, retry" steer — no HTML, no internal exception text.
		expect(thrown).toBeInstanceOf(PatentBackendError);
		expect(thrown).toBeInstanceOf(TransientBackendError);
		expect(thrown.status).toBe(502);
		expect(thrown.message + patentBackendErrorRecoveryHint(thrown)).toBe(
			'The patent backend returned HTTP 502 (Bad Gateway). The patent backend is temporarily unavailable (HTTP 502) — this is transient, not a coverage limit. Wait briefly and retry the same query, or try a different office (USPTO) meanwhile.'
		);
		expect(thrown.message).not.toContain('odpRequest');
		expect(fetch.calls()).toBe(3); // initial + 2 retries before the transient error surfaces
	}, 5000);

	it('maps a request timeout to a TransientBackendError (status undefined, still "timed out")', async () => {
		const { client } = makeClient(hangingFetch());

		const thrown = await captureThrow(() => client.post('/patent-search', {}, makeToken(), { timeoutMs: 50 })) as TransientBackendError;

		expect(thrown).toBeInstanceOf(TransientBackendError);
		expect(thrown.status).toBeUndefined();
		expect(thrown.message).toContain('timed out');
	}, 3000);
});

describe('per-request telemetry (#89)', () => {

	beforeEach(() => registerPatentAccessTokenProvider(() => undefined));
	afterEach(() => vi.restoreAllMocks());

	it('emits one event per request with endpoint, status class, latency, and size', async () => {
		const { client, telemetry } = makeClient(async () => makeResponse(200, { success: true, cached: true, results: [1, 2] }));

		await client.post('/patent-search', { query: 'AI' }, makeToken());

		expect(telemetry.sendInternalMSFTTelemetryEvent).toHaveBeenCalledTimes(1);
		const [event, properties, measurements] = telemetry.sendInternalMSFTTelemetryEvent.mock.calls[0];
		expect(event).toBe('flowleap.patentBackend.request');
		expect(properties).toEqual(expect.objectContaining({ endpoint: 'patent-search', method: 'POST', statusClass: '2xx' }));
		expect(measurements).toEqual(expect.objectContaining({
			latencyMs: expect.any(Number),
			responseBytes: expect.any(Number),
			retries: 0,
			servedFromCache: 0,
			backendCached: 1, // backend `cached: true` flag surfaced
		}));
		expect(measurements.responseBytes).toBeGreaterThan(0);
	});
});

describe('session read cache (#89)', () => {

	beforeEach(() => registerPatentAccessTokenProvider(() => undefined));
	afterEach(() => vi.restoreAllMocks());

	it('serves an identical repeated read from cache without a second fetch', async () => {
		const fetch = scriptedFetch([makeResponse(200, { success: true, results: [7] })]);
		const { client, telemetry } = makeClient(fetch);

		const first = await client.post<{ results: number[] }>('/patent-search', { query: 'AI' }, makeToken());
		const second = await client.post<{ results: number[] }>('/patent-search', { query: 'AI' }, makeToken());

		expect(second).toEqual(first);
		expect(fetch.calls()).toBe(1);
		// Second request reports served-from-cache in telemetry.
		const measurements = telemetry.sendInternalMSFTTelemetryEvent.mock.calls[1][2];
		expect(measurements).toEqual(expect.objectContaining({ servedFromCache: 1 }));
	});

	it('keeps a bypassReadCache call out of the cache, in both directions', async () => {
		const fetch = scriptedFetch([makeResponse(200, { r: 1 }), makeResponse(200, { r: 2 })]);
		const { client } = makeClient(fetch);

		const first = await client.post<{ r: number }>('/keys/validate', {}, makeToken(), { bypassReadCache: true });
		const second = await client.post<{ r: number }>('/keys/validate', {}, makeToken(), { bypassReadCache: true });

		// Neither served from the cache nor stored in it: a live probe must not be replayed.
		expect([first, second]).toEqual([{ r: 1 }, { r: 2 }]);
		expect(fetch.calls()).toBe(2);
	});

	it('does not cache across a differing request body', async () => {
		const fetch = scriptedFetch([makeResponse(200, { r: 1 }), makeResponse(200, { r: 2 })]);
		const { client } = makeClient(fetch);

		const a = await client.post<{ r: number }>('/patent-search', { query: 'AI' }, makeToken());
		const b = await client.post<{ r: number }>('/patent-search', { query: 'ML' }, makeToken());

		expect([a, b]).toEqual([{ r: 1 }, { r: 2 }]);
		expect(fetch.calls()).toBe(2);
	});
});

describe('getCustomerPortalUrl (#118)', () => {

	beforeEach(() => registerPatentAccessTokenProvider(() => 'tok-portal'));
	afterEach(() => vi.restoreAllMocks());

	it('returns the portalUrl and targets the ROOT host (no /v1 prefix)', async () => {
		let capturedUrl: string | undefined;
		const { client } = makeClient(async url => {
			capturedUrl = url;
			return makeResponse(200, { portalUrl: 'https://billing.stripe.com/p/session/abc' });
		});

		const url = await client.getCustomerPortalUrl(makeToken());

		expect(url).toBe('https://billing.stripe.com/p/session/abc');
		// apiUrl is https://api.test/v1; the account route drops the /v1 suffix.
		expect(capturedUrl).toBe('https://api.test/api/invoices');
	});

	it('mints a fresh portal URL per call instead of replaying a cached one', async () => {
		const fetch = scriptedFetch([
			makeResponse(200, { portalUrl: 'https://billing.stripe.com/p/session/first' }),
			makeResponse(200, { portalUrl: 'https://billing.stripe.com/p/session/second' }),
		]);
		const { client } = makeClient(fetch);

		const first = await client.getCustomerPortalUrl(makeToken());
		const second = await client.getCustomerPortalUrl(makeToken());

		expect([first, second]).toEqual([
			'https://billing.stripe.com/p/session/first',
			'https://billing.stripe.com/p/session/second',
		]);
		expect(fetch.calls()).toBe(2);
	});

	it('throws PatentBackendError when the backend returns no URL', async () => {
		const { client } = makeClient(async () => makeResponse(200, {}));

		const thrown = await captureThrow(() => client.getCustomerPortalUrl(makeToken()));

		expect(thrown).toBeInstanceOf(PatentBackendError);
	});

	it('inherits the seam typed error on 401', async () => {
		const { client } = makeClient(async () => makeResponse(401, { error: { message: 'expired' } }));

		const thrown = await captureThrow(() => client.getCustomerPortalUrl(makeToken()));

		expect(thrown).toBeInstanceOf(AuthRequiredError);
	});
});

describe('getTrialModelKey (ADR 0015, #241)', () => {

	beforeEach(() => registerPatentAccessTokenProvider(() => 'tok-trial'));
	afterEach(() => vi.restoreAllMocks());

	const successBody = {
		key: 'sk-or-v1-trial',
		models: ['deepseek/deepseek-v4-flash-0731', 'google/gemini-3.7-flash', 'openai/gpt-5.6-luna'],
		cap: { dailyUsd: 5 },
	};

	it('resolves the payload from GET /v1/trial/model-key, preserving the served model order', async () => {
		let capturedUrl: string | undefined;
		const { client } = makeClient(async url => {
			capturedUrl = url;
			return makeResponse(200, successBody);
		});

		const payload = await client.getTrialModelKey(makeToken());

		expect(capturedUrl).toBe('https://api.test/v1/trial/model-key');
		expect(payload).toEqual(successBody);
	});

	it('never serves the key from the read cache (each call is a fresh backend read)', async () => {
		const fetch = scriptedFetch([makeResponse(200, successBody), makeResponse(200, successBody)]);
		const { client } = makeClient(fetch);

		await client.getTrialModelKey(makeToken());
		await client.getTrialModelKey(makeToken());

		expect(fetch.calls()).toBe(2);
	});

	it('maps the typed 403 denial to TrialModelKeyUnavailableError carrying the reason, with no notification', async () => {
		const { client, notification } = makeClient(async () => makeResponse(403, {
			error: {
				message: 'Trial Model keys serve the trial window only — add your own LLM provider key to continue.',
				type: 'trial_model_key',
				code: 'trial_model_key_unavailable',
				reason: 'not_trialing',
			},
		}));

		const thrown = await captureThrow(() => client.getTrialModelKey(makeToken())) as TrialModelKeyUnavailableError;
		await flush();

		expect(thrown).toBeInstanceOf(PatentBackendError);
		expect(thrown).toBeInstanceOf(TrialModelKeyUnavailableError);
		expect(thrown.status).toBe(403);
		expect(thrown.reason).toBe('not_trialing');
		// The trial provider owns the recovery (hide + BYO-key steer); the seam stays silent here.
		expect(notification.showInformationMessage).not.toHaveBeenCalled();
		expect(notification.showWarningMessage).not.toHaveBeenCalled();
	});

	it('surfaces a retried 503 upstream_unavailable as the transient "wait and retry" error', async () => {
		const body = { error: { message: 'Could not provision the Trial Model key. Retry the same request.', type: 'upstream', code: 'upstream_unavailable', service: 'openrouter' } };
		const fetch = scriptedFetch([makeResponse(503, body), makeResponse(503, body), makeResponse(503, body)]);
		const { client } = makeClient(fetch);

		const thrown = await captureThrow(() => client.getTrialModelKey(makeToken())) as TransientBackendError;

		expect(thrown).toBeInstanceOf(TransientBackendError);
		expect(thrown.status).toBe(503);
		expect(fetch.calls()).toBe(3); // initial + 2 retries — the 503 is retryable by contract
	}, 5000);

	it('inherits the seam auth gate on 401', async () => {
		const { client } = makeClient(async () => makeResponse(401, { error: { message: 'expired' } }));

		const thrown = await captureThrow(() => client.getTrialModelKey(makeToken()));

		expect(thrown).toBeInstanceOf(AuthRequiredError);
	});

	it('rejects a malformed success payload (missing key or empty model list)', async () => {
		const { client } = makeClient(async () => makeResponse(200, { key: 'sk-or-v1-trial', models: [] }));

		const thrown = await captureThrow(() => client.getTrialModelKey(makeToken()));

		expect(thrown).toBeInstanceOf(PatentBackendError);
		expect((thrown as PatentBackendError).message).toContain('invalid Trial Model key payload');
	});
});
