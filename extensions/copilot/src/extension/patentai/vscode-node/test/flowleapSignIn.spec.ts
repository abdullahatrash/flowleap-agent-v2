/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it, vi } from 'vitest';
import type { AuthenticationSession } from 'vscode';
import { IFlowleapSignInDeps, triggerFlowleapSignIn } from '../flowleapSignIn';

/** A valid (content-irrelevant) session — only its presence drives the success path. */
const SESSION: AuthenticationSession = {
	id: 'flowleap-session',
	accessToken: 'tok',
	account: { id: 'u1', label: 'FlowLeap User' },
	scopes: [],
};

/** Build deps with injected fakes; `authed` controls the short-circuit, `getSession` the flow. */
function makeDeps(opts: { authed?: boolean; getSession?: () => Promise<AuthenticationSession | undefined> }) {
	const getSession = vi.fn(opts.getSession ?? (async () => SESSION));
	const deps: IFlowleapSignInDeps = {
		waitForInit: vi.fn(async () => { /* resolved */ }),
		isAuthenticated: vi.fn(() => opts.authed ?? false),
		getSession,
		showInfo: vi.fn(),
		showError: vi.fn(),
		log: vi.fn(),
	};
	return { deps, getSession };
}

describe('triggerFlowleapSignIn', () => {
	it('short-circuits when already authenticated: true, no getSession, no toast', async () => {
		const { deps, getSession } = makeDeps({ authed: true });

		expect(await triggerFlowleapSignIn(deps, false)).toBe(true);
		expect(getSession).not.toHaveBeenCalled();
		expect(deps.showInfo).not.toHaveBeenCalled();
	});

	it('signs in via getSession and shows the success toast when not silent', async () => {
		const { deps, getSession } = makeDeps({ authed: false });

		expect(await triggerFlowleapSignIn(deps, false)).toBe(true);
		expect(getSession).toHaveBeenCalledTimes(1);
		expect(deps.showInfo).toHaveBeenCalledTimes(1);
		expect(deps.showError).not.toHaveBeenCalled();
	});

	it('returns false + error toast when getSession rejects (cancel / dead-on-arrival token)', async () => {
		const { deps } = makeDeps({ authed: false, getSession: async () => { throw new Error('Sign-in canceled.'); } });

		expect(await triggerFlowleapSignIn(deps, false)).toBe(false);
		expect(deps.showError).toHaveBeenCalledTimes(1);
	});

	it('returns false + error toast when getSession resolves without a session', async () => {
		const { deps } = makeDeps({ authed: false, getSession: async () => undefined });

		expect(await triggerFlowleapSignIn(deps, false)).toBe(false);
		expect(deps.showError).toHaveBeenCalledTimes(1);
	});

	it('suppresses all toasts when silent (success and failure)', async () => {
		const ok = makeDeps({ authed: false });
		expect(await triggerFlowleapSignIn(ok.deps, true)).toBe(true);
		expect(ok.deps.showInfo).not.toHaveBeenCalled();

		const fail = makeDeps({ authed: false, getSession: async () => { throw new Error('nope'); } });
		expect(await triggerFlowleapSignIn(fail.deps, true)).toBe(false);
		expect(fail.deps.showError).not.toHaveBeenCalled();
	});
});
