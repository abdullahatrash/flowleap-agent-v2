/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mocks captured for assertions. `vi.hoisted` runs before the hoisted `vi.mock`
// factories below, so they can close over these.
const { openExternalMock, registerUriHandlerMock, showWarningMessageMock, showInformationMessageMock, showErrorMessageMock } = vi.hoisted(() => ({
	openExternalMock: vi.fn(async (_uri: unknown) => true),
	registerUriHandlerMock: vi.fn((_handler: { handleUri: (uri: unknown) => void }) => ({ dispose: () => { /* noop */ } })),
	showWarningMessageMock: vi.fn(),
	showInformationMessageMock: vi.fn(),
	showErrorMessageMock: vi.fn(),
}));

// The `vscode` test alias points at a types shim with no `window`/`env`/`EventEmitter`; provide the
// few runtime members the provider touches. `EventEmitter` is a tiny real implementation so the
// `onDidChangeSessions` event can be asserted without stubbing globals.
vi.mock('vscode', () => {
	class FakeEventEmitter<T> {
		private readonly _listeners = new Set<(e: T) => void>();
		readonly event = (listener: (e: T) => void) => {
			this._listeners.add(listener);
			return { dispose: () => { this._listeners.delete(listener); } };
		};
		fire(e: T): void {
			for (const listener of [...this._listeners]) {
				listener(e);
			}
		}
		dispose(): void {
			this._listeners.clear();
		}
	}
	return {
		Uri: { parse: (value: string) => value },
		window: {
			showWarningMessage: showWarningMessageMock,
			showInformationMessage: showInformationMessageMock,
			showErrorMessage: showErrorMessageMock,
		},
		env: { openExternal: openExternalMock },
		EventEmitter: FakeEventEmitter,
	};
});

// Keep the vscode-config and token-registry dependencies out of the unit.
vi.mock('../configService', () => ({
	getPatentAIConfig: () => ({
		apiUrl: 'https://api.test/v1',
		clientId: 'patent-ai-agent',
		authUrl: 'https://api.test/oauth/authorize',
		redirectUri: 'flowleap://github.copilot-chat/callback',
		frontendUrl: 'https://flowleap.co',
	}),
}));

vi.mock('../../common/patentTokenRegistry', () => ({
	registerPatentAccessTokenProvider: vi.fn(),
	getPatentAccessToken: vi.fn(() => undefined),
}));

// The provider registers its callback through the shared extension URI router; mock it to feed
// the auth handler straight to the captured registerUriHandler mock, so each test invokes its
// own instance's handler (no module-singleton state leaking across cases).
vi.mock('../../../uriHandler/vscode-node/extensionUriHandler', () => ({
	registerUriRoute: (_matches: unknown, handler: { handleUri: (uri: unknown) => void }) => {
		registerUriHandlerMock(handler);
		return { dispose: () => { /* noop */ } };
	},
}));

import { FlowLeapAuthenticationProvider } from '../flowleapAuthProvider';
import type { ILogService } from '../../../../platform/log/common/logService';

/** Stub ILogService that ignores all calls. */
function makeLogService(): ILogService {
	return {
		trace: vi.fn(),
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	} as unknown as ILogService;
}

// Mirrors the provider's private TOKEN_STORAGE_KEY — used to seed a restorable token.
const TOKEN_STORAGE_KEY = 'patent-ai-clerk-token';

/** Minimal extension context: an in-memory secret store plus a subscriptions array. */
function makeExtensionContext(seed?: { token: string; expiresAt: number }) {
	const store = new Map<string, string>();
	if (seed) {
		store.set(TOKEN_STORAGE_KEY, JSON.stringify(seed));
	}
	return {
		secrets: {
			get: async (key: string) => store.get(key),
			store: async (key: string, value: string) => { store.set(key, value); },
			delete: async (key: string) => { store.delete(key); },
		},
		subscriptions: [],
	} as unknown as import('vscode').ExtensionContext;
}

/** Build a JWT-shaped token carrying the given claims (so the session label needs no profile fetch). */
function makeJwt(claims: Record<string, unknown>): string {
	const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
	return `header.${payload}.sig`;
}

/** Mutable fake clock for the injectable `_now` seam (no global stubbing). */
function fakeClock(startMs: number) {
	let nowMs = startMs;
	return {
		now: () => nowMs,
		advance: (deltaMs: number) => { nowMs += deltaMs; },
	};
}

/** Flush microtasks + a macrotask so `signIn()` reaches the pending-callback state. */
const tick = () => new Promise<void>(resolve => setTimeout(resolve, 0));

describe('FlowLeapAuthenticationProvider.cancelSignIn', () => {
	let provider: FlowLeapAuthenticationProvider;

	beforeEach(async () => {
		vi.clearAllMocks();
		provider = new FlowLeapAuthenticationProvider(makeExtensionContext(), makeLogService());
		await provider.waitForInitialization();
	});

	it('rejects the in-flight attempt and stays not-authenticated', async () => {
		expect(provider.isAuthenticated).toBe(false);

		const signIn = provider.signIn();
		signIn.catch(() => { /* rejection asserted below */ });
		await tick(); // let openExternal resolve so the pending callback is registered

		provider.cancelSignIn();

		await expect(signIn).rejects.toThrow('Sign-in canceled.');
		expect(provider.isAuthenticated).toBe(false);
	});

	it('allows a fresh signIn after a cancel (a new browser flow opens)', async () => {
		const first = provider.signIn();
		first.catch(() => { /* rejection asserted below */ });
		await tick();
		provider.cancelSignIn();
		await expect(first).rejects.toThrow('Sign-in canceled.');
		expect(openExternalMock).toHaveBeenCalledTimes(1);

		const second = provider.signIn();
		second.catch(() => { /* cleaned up below */ });
		await tick();
		expect(openExternalMock).toHaveBeenCalledTimes(2);

		provider.cancelSignIn(); // clean up the second in-flight attempt
		await expect(second).rejects.toThrow('Sign-in canceled.');
	});

	it('dedupes concurrent signIn() calls into one browser flow (re-auth debounce)', async () => {
		// Many 401s in one agent turn fire many re-auth triggers; signIn() dedupes
		// them onto a single in-flight flow, so the browser opens once.
		const a = provider.signIn();
		const b = provider.signIn();
		a.catch(() => { /* asserted below */ });
		b.catch(() => { /* asserted below */ });
		await tick();

		expect(openExternalMock).toHaveBeenCalledTimes(1);

		provider.cancelSignIn();
		await expect(a).rejects.toThrow('Sign-in canceled.');
		await expect(b).rejects.toThrow('Sign-in canceled.');
	});

	it('is a no-op when no sign-in is in progress', () => {
		expect(() => provider.cancelSignIn()).not.toThrow();
		expect(provider.isAuthenticated).toBe(false);
	});
});

describe('FlowLeapAuthenticationProvider OAuth callback handling', () => {
	let provider: FlowLeapAuthenticationProvider;

	beforeEach(async () => {
		vi.clearAllMocks();
		provider = new FlowLeapAuthenticationProvider(makeExtensionContext(), makeLogService());
		await provider.waitForInitialization();
	});

	/** Invoke the URI handler the provider registered during construction. */
	function handleCallback(query: string): void {
		const handler = registerUriHandlerMock.mock.calls[0][0];
		handler.handleUri({ path: '/callback', query });
	}

	it('surfaces a clear failure for a callback with no pending sign-in (cold-start/restart)', () => {
		// A real-looking callback arrives, but nothing is in flight in this process —
		// the pending CSRF state was lost to a restart / cold-launch (ADR 0002).
		handleCallback('token=abc.def.ghi&state=deadbeef');

		expect(showWarningMessageMock).toHaveBeenCalledTimes(1);
		expect(provider.isAuthenticated).toBe(false);
	});

	it('rejects a callback whose state does not match the in-flight attempt (CSRF guard)', async () => {
		const signIn = provider.signIn();
		signIn.catch(() => { /* asserted below */ });
		await tick();

		handleCallback('token=attacker.token&state=not-the-real-state');

		await expect(signIn).rejects.toThrow('State mismatch');
		expect(provider.isAuthenticated).toBe(false);
	});

	it('completes sign-in when the callback state matches the in-flight attempt', async () => {
		const signIn = provider.signIn();
		await tick();

		// The provider generated a random state and put it in the opened auth URL.
		const openedUrl = String(openExternalMock.mock.calls[0][0]);
		const state = new URL(openedUrl).searchParams.get('state');
		handleCallback(`token=${makeJwt({ sub: 'u1', email: 'user@flowleap.co' })}&state=${state}&expires_in=2592000`);

		await expect(signIn).resolves.toBeUndefined();
		expect(provider.isAuthenticated).toBe(true);
	});
});

describe('FlowLeapAuthenticationProvider session lifecycle', () => {
	beforeEach(() => vi.clearAllMocks());

	/** Drive `createSession` through the deep-link flow, returning the provider and the new session. */
	async function createSessionViaFlow(clock: { now: () => number }) {
		const provider = new FlowLeapAuthenticationProvider(makeExtensionContext(), makeLogService(), clock.now);
		await provider.waitForInitialization();
		const create = provider.createSession([]);
		await tick();
		const openedUrl = String(openExternalMock.mock.calls[0][0]);
		const state = new URL(openedUrl).searchParams.get('state');
		const handler = registerUriHandlerMock.mock.calls[0][0];
		handler.handleUri({ path: '/callback', query: `token=${makeJwt({ sub: 'u1', email: 'user@flowleap.co' })}&state=${state}&expires_in=2592000` });
		const session = await create;
		return { provider, session };
	}

	it('createSession returns the new session, getSessions exposes it, and removeSession clears it and fires {removed}', async () => {
		const clock = fakeClock(1_700_000_000_000);
		const { provider, session } = await createSessionViaFlow(clock);

		expect(session.account.label).toContain('user@flowleap.co');
		expect(await provider.getSessions()).toEqual([session]);

		const changes: Array<{ removed?: readonly unknown[] }> = [];
		provider.onDidChangeSessions(e => changes.push(e));

		await provider.removeSession(session.id);

		expect(await provider.getSessions()).toEqual([]);
		expect(provider.isAuthenticated).toBe(false);
		expect(changes.at(-1)?.removed).toHaveLength(1);
	});

	it('getSessions returns [] and deletes the secret once the token has expired', async () => {
		const clock = fakeClock(1_700_000_000_000);
		const { provider } = await createSessionViaFlow(clock);
		expect(await provider.getSessions()).toHaveLength(1);

		clock.advance(2_592_000_000 + 60_000); // past the 30-day expiry

		expect(await provider.getSessions()).toEqual([]);
		expect(provider.getAccessToken()).toBeUndefined();
	});
});

describe('FlowLeapAuthenticationProvider token-expiry decision', () => {
	const T0 = 1_700_000_000_000; // fixed epoch ms; the injected clock controls "now"
	const TWO_MINUTES = 2 * 60_000;
	const SIX_MINUTES = 6 * 60_000;

	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('treats a token within the 5-min buffer but before its real exp as still authenticated', async () => {
		// Expires in 2 min — inside the 5-min refresh buffer, but NOT expired. The fix
		// gates on the real exp, not exp-minus-buffer, so it must stay valid.
		const clock = fakeClock(T0);
		const ctx = makeExtensionContext({ token: 'stored.jwt', expiresAt: T0 + TWO_MINUTES });
		const provider = new FlowLeapAuthenticationProvider(ctx, makeLogService(), clock.now);
		await provider.waitForInitialization();

		expect(provider.isAuthenticated).toBe(true);
		expect(provider.getAccessToken()).toBe('stored.jwt');
	});

	it('treats a token past its real exp as not authenticated', async () => {
		const clock = fakeClock(T0);
		const ctx = makeExtensionContext({ token: 'stored.jwt', expiresAt: T0 + TWO_MINUTES });
		const provider = new FlowLeapAuthenticationProvider(ctx, makeLogService(), clock.now);
		await provider.waitForInitialization();
		expect(provider.isAuthenticated).toBe(true); // valid at T0

		clock.advance(SIX_MINUTES); // now past the real exp (T0 + 2 min)

		expect(provider.getAccessToken()).toBeUndefined();
		expect(provider.isAuthenticated).toBe(false);
	});

	it('defaults to the real clock when none is injected', async () => {
		const ctx = makeExtensionContext({ token: 'stored.jwt', expiresAt: Date.now() + 60 * 60_000 });
		const provider = new FlowLeapAuthenticationProvider(ctx, makeLogService());
		await provider.waitForInitialization();

		expect(provider.isAuthenticated).toBe(true);
	});
});
