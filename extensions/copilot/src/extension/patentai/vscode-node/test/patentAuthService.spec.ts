/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mocks captured for assertions. `vi.hoisted` runs before the hoisted `vi.mock`
// factories below, so they can close over these.
const { openExternalMock, registerUriHandlerMock, showWarningMessageMock } = vi.hoisted(() => ({
	openExternalMock: vi.fn(async (_uri: unknown) => true),
	registerUriHandlerMock: vi.fn((_handler: { handleUri: (uri: unknown) => void }) => ({ dispose: () => { /* noop */ } })),
	showWarningMessageMock: vi.fn(),
}));

// The `vscode` test alias points at a types shim with no `window`/`env`; provide the
// few runtime members the sign-in flow touches.
vi.mock('vscode', () => ({
	Uri: { parse: (value: string) => value },
	window: { registerUriHandler: registerUriHandlerMock, showWarningMessage: showWarningMessageMock },
	env: { openExternal: openExternalMock },
}));

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
}));

// The service registers its callback through the shared extension URI router; mock it to feed
// the auth handler straight to the captured registerUriHandler mock, so each test invokes its
// own instance's handler (no module-singleton state leaking across cases).
vi.mock('../../../uriHandler/vscode-node/extensionUriHandler', () => ({
	registerUriRoute: (_matches: unknown, handler: { handleUri: (uri: unknown) => void }) => {
		registerUriHandlerMock(handler);
		return { dispose: () => { /* noop */ } };
	},
}));

import { PatentAIAuthService } from '../patentAuthService';
import type { ILogService } from '../../../../platform/log/common/logService';
import type { IVSCodeExtensionContext } from '../../../../platform/extContext/common/extensionContext';

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

// Mirrors the service's private TOKEN_STORAGE_KEY — used to seed a restorable token.
const TOKEN_STORAGE_KEY = 'patent-ai-clerk-token';

/** Minimal extension context: an in-memory secret store plus a subscriptions array. */
function makeExtensionContext(seed?: { token: string; expiresAt: number }): IVSCodeExtensionContext {
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
	} as unknown as IVSCodeExtensionContext;
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

describe('PatentAIAuthService.cancelSignIn', () => {
	let service: PatentAIAuthService;

	beforeEach(async () => {
		vi.clearAllMocks();
		service = new PatentAIAuthService(makeLogService(), makeExtensionContext());
		await service.waitForInitialization();
	});

	it('rejects the in-flight attempt and stays not-authenticated', async () => {
		expect(service.isAuthenticated).toBe(false);

		const signIn = service.signIn();
		signIn.catch(() => { /* rejection asserted below */ });
		await tick(); // let openExternal resolve so the pending callback is registered

		service.cancelSignIn();

		await expect(signIn).rejects.toThrow('Sign-in canceled.');
		expect(service.isAuthenticated).toBe(false);
	});

	it('allows a fresh signIn after a cancel (a new browser flow opens)', async () => {
		const first = service.signIn();
		first.catch(() => { /* rejection asserted below */ });
		await tick();
		service.cancelSignIn();
		await expect(first).rejects.toThrow('Sign-in canceled.');
		expect(openExternalMock).toHaveBeenCalledTimes(1);

		const second = service.signIn();
		second.catch(() => { /* cleaned up below */ });
		await tick();
		expect(openExternalMock).toHaveBeenCalledTimes(2);

		service.cancelSignIn(); // clean up the second in-flight attempt
		await expect(second).rejects.toThrow('Sign-in canceled.');
	});

	it('dedupes concurrent signIn() calls into one browser flow (re-auth debounce)', async () => {
		// Many 401s in one agent turn fire many re-auth triggers; signIn() dedupes
		// them onto a single in-flight flow, so the browser opens once.
		const a = service.signIn();
		const b = service.signIn();
		a.catch(() => { /* asserted below */ });
		b.catch(() => { /* asserted below */ });
		await tick();

		expect(openExternalMock).toHaveBeenCalledTimes(1);

		service.cancelSignIn();
		await expect(a).rejects.toThrow('Sign-in canceled.');
		await expect(b).rejects.toThrow('Sign-in canceled.');
	});

	it('is a no-op when no sign-in is in progress', () => {
		expect(() => service.cancelSignIn()).not.toThrow();
		expect(service.isAuthenticated).toBe(false);
	});
});

describe('PatentAIAuthService OAuth callback handling', () => {
	let service: PatentAIAuthService;

	beforeEach(async () => {
		vi.clearAllMocks();
		service = new PatentAIAuthService(makeLogService(), makeExtensionContext());
		await service.waitForInitialization();
	});

	/** Invoke the URI handler the service registered during construction. */
	function handleCallback(query: string): void {
		const handler = registerUriHandlerMock.mock.calls[0][0];
		handler.handleUri({ path: '/callback', query });
	}

	it('surfaces a clear failure for a callback with no pending sign-in (cold-start/restart)', () => {
		// A real-looking callback arrives, but nothing is in flight in this process —
		// the pending CSRF state was lost to a restart / cold-launch (ADR 0002).
		handleCallback('token=abc.def.ghi&state=deadbeef');

		expect(showWarningMessageMock).toHaveBeenCalledTimes(1);
		expect(service.isAuthenticated).toBe(false);
	});

	it('rejects a callback whose state does not match the in-flight attempt (CSRF guard)', async () => {
		const signIn = service.signIn();
		signIn.catch(() => { /* asserted below */ });
		await tick();

		handleCallback('token=attacker.token&state=not-the-real-state');

		await expect(signIn).rejects.toThrow('State mismatch');
		expect(service.isAuthenticated).toBe(false);
	});

	it('completes sign-in when the callback state matches the in-flight attempt', async () => {
		const signIn = service.signIn();
		await tick();

		// The service generated a random state and put it in the opened auth URL.
		const openedUrl = String(openExternalMock.mock.calls[0][0]);
		const state = new URL(openedUrl).searchParams.get('state');
		handleCallback(`token=abc.def.ghi&state=${state}&expires_in=2592000`);

		await expect(signIn).resolves.toBeUndefined();
		expect(service.isAuthenticated).toBe(true);
	});
});

describe('PatentAIAuthService token-expiry decision', () => {
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
		const service = new PatentAIAuthService(makeLogService(), ctx, clock.now);
		await service.waitForInitialization();

		expect(service.isAuthenticated).toBe(true);
		expect(service.getAccessToken()).toBe('stored.jwt');
	});

	it('treats a token past its real exp as not authenticated', async () => {
		const clock = fakeClock(T0);
		const ctx = makeExtensionContext({ token: 'stored.jwt', expiresAt: T0 + TWO_MINUTES });
		const service = new PatentAIAuthService(makeLogService(), ctx, clock.now);
		await service.waitForInitialization();
		expect(service.isAuthenticated).toBe(true); // valid at T0

		clock.advance(SIX_MINUTES); // now past the real exp (T0 + 2 min)

		expect(service.getAccessToken()).toBeUndefined();
		expect(service.isAuthenticated).toBe(false);
	});

	it('defaults to the real clock when none is injected', async () => {
		const ctx = makeExtensionContext({ token: 'stored.jwt', expiresAt: Date.now() + 60 * 60_000 });
		const service = new PatentAIAuthService(makeLogService(), ctx);
		await service.waitForInitialization();

		expect(service.isAuthenticated).toBe(true);
	});
});
