/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import type { AuthenticationProviderAuthenticationSessionsChangeEvent, AuthenticationSession } from 'vscode';
import {
	FLOWLEAP_SIGNED_IN_CONTEXT_KEY,
	FLOWLEAP_SIGNED_OUT_CONTEXT_KEY,
	IFlowleapAuthState,
	registerFlowleapAuthContextKeys,
} from '../flowleapAuthContextKeys';

type ChangeEvent = AuthenticationProviderAuthenticationSessionsChangeEvent;

/** A valid (content-irrelevant) session — only array lengths drive the update logic. */
const SESSION: AuthenticationSession = {
	id: 'flowleap-session',
	accessToken: 'tok',
	account: { id: 'u1', label: 'FlowLeap User' },
	scopes: [],
};

/** Fake auth source: mutable `isAuthenticated`, a fireable session-change event, gated init. */
function makeFakeSource(initialAuthed: boolean) {
	const emitter = new vscode.EventEmitter<ChangeEvent>();
	let authed = initialAuthed;
	let resolveInit!: () => void;
	const initialized = new Promise<void>(resolve => { resolveInit = resolve; });

	const source: IFlowleapAuthState = {
		get isAuthenticated() { return authed; },
		waitForInitialization: () => initialized,
		onDidChangeSessions: emitter.event,
	};
	return {
		source,
		setAuthed: (value: boolean) => { authed = value; },
		completeInit: () => { resolveInit(); },
		fire: (e: ChangeEvent) => emitter.fire(e),
	};
}

/** Flush microtasks so the post-`waitForInitialization()` seed runs. */
const flush = () => new Promise<void>(resolve => setTimeout(resolve, 0));

describe('registerFlowleapAuthContextKeys', () => {
	it('seeds the keys from the restored state once initialization settles (signed out)', async () => {
		const { source, completeInit } = makeFakeSource(false);
		const setContextKey = vi.fn();

		registerFlowleapAuthContextKeys(source, setContextKey);
		completeInit();
		await flush();

		expect(setContextKey).toHaveBeenCalledWith(FLOWLEAP_SIGNED_IN_CONTEXT_KEY, false);
		expect(setContextKey).toHaveBeenCalledWith(FLOWLEAP_SIGNED_OUT_CONTEXT_KEY, true);
	});

	it('flips the keys on an {added} identity change and back on {removed}', async () => {
		const fake = makeFakeSource(false);
		const setContextKey = vi.fn();
		registerFlowleapAuthContextKeys(fake.source, setContextKey);
		fake.completeInit();
		await flush();
		setContextKey.mockClear();

		fake.setAuthed(true);
		fake.fire({ added: [SESSION], removed: [], changed: [] });
		expect(setContextKey).toHaveBeenCalledWith(FLOWLEAP_SIGNED_IN_CONTEXT_KEY, true);
		expect(setContextKey).toHaveBeenCalledWith(FLOWLEAP_SIGNED_OUT_CONTEXT_KEY, false);

		setContextKey.mockClear();
		fake.setAuthed(false);
		fake.fire({ added: [], removed: [SESSION], changed: [] });
		expect(setContextKey).toHaveBeenCalledWith(FLOWLEAP_SIGNED_IN_CONTEXT_KEY, false);
		expect(setContextKey).toHaveBeenCalledWith(FLOWLEAP_SIGNED_OUT_CONTEXT_KEY, true);
	});

	it('ignores a label-only {changed} event (no update)', async () => {
		const fake = makeFakeSource(true);
		const setContextKey = vi.fn();
		registerFlowleapAuthContextKeys(fake.source, setContextKey);
		fake.completeInit();
		await flush();
		setContextKey.mockClear();

		fake.fire({ added: [], removed: [], changed: [SESSION] });
		expect(setContextKey).not.toHaveBeenCalled();
	});

	it('stops updating once the returned disposable is disposed', async () => {
		const fake = makeFakeSource(false);
		const setContextKey = vi.fn();
		const disposable = registerFlowleapAuthContextKeys(fake.source, setContextKey);
		fake.completeInit();
		await flush();
		setContextKey.mockClear();

		disposable.dispose();
		fake.setAuthed(true);
		fake.fire({ added: [SESSION], removed: [], changed: [] });
		expect(setContextKey).not.toHaveBeenCalled();
	});
});
