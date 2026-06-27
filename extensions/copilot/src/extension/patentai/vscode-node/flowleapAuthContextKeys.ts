/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

/** Context key set when a valid FlowLeap session exists. */
export const FLOWLEAP_SIGNED_IN_CONTEXT_KEY = 'flowleap.signedIn';
/**
 * Context key set when there is no valid FlowLeap session. Always the inverse of
 * {@link FLOWLEAP_SIGNED_IN_CONTEXT_KEY} — the two are kept mutually exclusive so UI can gate on
 * either without ambiguity.
 */
export const FLOWLEAP_SIGNED_OUT_CONTEXT_KEY = 'flowleap.signedOut';

/**
 * The minimal view of the FlowLeap auth provider this contribution needs to mirror auth state into
 * the when-clause engine. {@link import('./flowleapAuthProvider').FlowLeapAuthenticationProvider}
 * satisfies it; tests pass a fake.
 */
export interface IFlowleapAuthState {
	readonly isAuthenticated: boolean;
	waitForInitialization(): Promise<void>;
	readonly onDidChangeSessions: vscode.Event<vscode.AuthenticationProviderAuthenticationSessionsChangeEvent>;
}

/**
 * Mirror the FlowLeap provider's auth state into the `flowleap.signedIn` / `flowleap.signedOut`
 * context keys so later UI surfaces (the Accounts CTA, command-palette gating, the chat welcome CTA)
 * can gate on it. This issue only PRODUCES the keys — there is no consumer yet.
 *
 * State is read directly from the provider's synchronous {@link IFlowleapAuthState.isAuthenticated}
 * (the provider is the sole session source). The keys are seeded once token restore settles
 * (reflecting a restored session), then updated on every identity change — gated on added/removed,
 * skipping label-only `{changed}` refreshes, matching the `onDidAuthenticationChange` bridge in the
 * contribution.
 *
 * Known limitation: a token that expires while idle does not fire `{removed}` until the next
 * `getSessions()` enumeration, so the keys can be briefly stale after a silent expiry. The reactive
 * 401 path handles expiry-in-use; an idle-expiry timer is intentionally out of scope here.
 *
 * @returns the `onDidChangeSessions` listener disposable.
 */
export function registerFlowleapAuthContextKeys(
	source: IFlowleapAuthState,
	setContextKey: (key: string, value: boolean) => void = (key, value) => void vscode.commands.executeCommand('setContext', key, value),
): vscode.Disposable {
	const update = () => {
		const signedIn = source.isAuthenticated;
		setContextKey(FLOWLEAP_SIGNED_IN_CONTEXT_KEY, signedIn);
		setContextKey(FLOWLEAP_SIGNED_OUT_CONTEXT_KEY, !signedIn);
	};

	// Seed with the restored-token truth once initialization settles.
	void source.waitForInitialization().then(update);

	// Update on identity changes only; a label-only `{changed}` refresh is not an auth-state change.
	return source.onDidChangeSessions(e => {
		if ((e.added?.length ?? 0) > 0 || (e.removed?.length ?? 0) > 0) {
			update();
		}
	});
}
