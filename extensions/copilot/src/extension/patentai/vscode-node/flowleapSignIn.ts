/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { AuthenticationSession } from 'vscode';

/**
 * The dependencies {@link triggerFlowleapSignIn} needs, injected so the flow is testable without a
 * VS Code host (the injectable-seam pattern). Production wires these to the auth provider,
 * `vscode.authentication`, and `vscode.window`.
 */
export interface IFlowleapSignInDeps {
	/** Resolve once the provider has restored any stored token (avoids the init race). */
	waitForInit(): Promise<void>;
	/** Whether a valid FlowLeap session currently exists (synchronous, provider-backed). */
	isAuthenticated(): boolean;
	/** Run native sign-in: `vscode.authentication.getSession('flowleap', [], { createIfNone: true })`. */
	getSession(): Promise<AuthenticationSession | undefined>;
	showInfo(message: string): void;
	showError(message: string): void;
	log(message: string): void;
}

/**
 * The single sign-in entry point behind both the `flowleap.signIn` command and the `patent-ai.signIn`
 * alias. Routes through the native `getSession({ createIfNone: true })` path so VS Code owns dedup,
 * session persistence, and the Accounts badge (the provider's `createSession` runs the deep-link flow).
 *
 * @param silent suppress all toasts — a blocking onboarding overlay dims notifications, so a toast
 *   fired there renders hidden "under the dialog"; such callers (e.g. the onboarding gate, #21) pass
 *   `silent:true` and show their own inline status.
 * @returns whether the user ends up authenticated.
 */
export async function triggerFlowleapSignIn(deps: IFlowleapSignInDeps, silent: boolean): Promise<boolean> {
	// REQUIRED (init race): the provider restores its token asynchronously in `_initializeAuth`.
	// Calling getSession before that settles would see no session and wrongly prompt for sign-in.
	await deps.waitForInit();

	// Already signed in: short-circuit with no toast and WITHOUT calling getSession, so a
	// re-invocation never re-opens the browser or shows a redundant "Successfully signed in".
	if (deps.isAuthenticated()) {
		deps.log('[Patent AI] Already authenticated; skipping sign-in');
		return true;
	}

	try {
		const session = await deps.getSession();
		if (session) {
			if (!silent) {
				deps.showInfo('Successfully signed in to FlowLeap');
			}
			return true;
		}
		// Defensive: with `createIfNone:true` getSession throws rather than resolving falsy, but
		// guard the case anyway so a future API change can't silently report success.
		if (!silent) {
			deps.showError('Sign in did not complete. Please try again.');
		}
		return false;
	} catch (error) {
		// The user cancelled the consent dialog, or `createSession` rejected (cancel / timeout /
		// dead-on-arrival token).
		const message = error instanceof Error ? error.message : 'Unknown error';
		deps.log(`[Patent AI] Sign in failed: ${message}`);
		if (!silent) {
			deps.showError(`Sign in failed: ${message}`);
		}
		return false;
	}
}
