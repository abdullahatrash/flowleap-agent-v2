/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { IAuthenticationService } from '../../../platform/authentication/common/authentication';
import { IVSCodeExtensionContext } from '../../../platform/extContext/common/extensionContext';
import { ILogService } from '../../../platform/log/common/logService';
import { Disposable } from '../../../util/vs/base/common/lifecycle';
import { IExtensionContribution } from '../../common/contributions';
import { getPatentAIConfig } from './configService';
import { registerFlowleapAuthContextKeys } from './flowleapAuthContextKeys';
import { FlowLeapAuthenticationProvider } from './flowleapAuthProvider';
import { triggerFlowleapSignIn } from './flowleapSignIn';
import { PatentAIAuthService } from './patentAuthService';

/**
 * Activation contribution for FlowLeap authentication (ADR 0002).
 *
 * Surfaces the single `flowleap` account in the Accounts menu and registers the sign-in
 * commands. The reactive `401`/`402` backend gates and the onboarding/subscription context
 * keys are intentionally NOT wired here — they depend on the patent backend client (issue #11)
 * and the onboarding gate (issue #21), and are added by those layers.
 */
export class PatentAIContribution extends Disposable implements IExtensionContribution {
	readonly id = 'patentai';

	/** The flow owner. Created in {@link _registerAuthProvider}; the commands drive it. */
	private _authProvider: FlowLeapAuthenticationProvider | undefined;

	constructor(
		@ILogService private readonly _logService: ILogService,
		@IAuthenticationService private readonly _authService: IAuthenticationService,
		@IVSCodeExtensionContext private readonly _extensionContext: IVSCodeExtensionContext,
	) {
		super();
		this._initialize();
	}

	private _initialize(): void {
		this._logService.info('[Patent AI] Initializing FlowLeap authentication');

		// Each step runs in isolation. A failure in one must never abort _initialize:
		// throwing here disposes the whole contribution and unregisters its commands —
		// including `patent-ai.signIn`, which other surfaces (the chat sign-in affordance,
		// the onboarding gate in #21) call. Its absence would surface to the user as
		// "command 'patent-ai.signIn' not found".
		this._safeStep('validate configuration', () => this._validateConfiguration());
		this._safeStep('register auth provider', () => this._registerAuthProvider());
		this._safeStep('register auth commands', () => this._registerAuthCommands());
		this._safeStep('log authentication status', () => this._logAuthenticationStatus());

		this._logService.info('[Patent AI] FlowLeap authentication ready');
	}

	/**
	 * Run a single initialization step in isolation. Any error is logged and swallowed so
	 * one broken step can't fail the whole contribution — which would dispose its
	 * registrations, e.g. the `patent-ai.signIn` command other surfaces depend on.
	 */
	private _safeStep(label: string, step: () => void): void {
		try {
			step();
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this._logService.error(`[Patent AI] Initialization step failed (${label}): ${message}`);
		}
	}

	/**
	 * Register FlowLeap as the single authentication provider in VS Code's Accounts menu. The
	 * provider OWNS the sign-in flow (ADR 0002); we keep its instance so the commands can drive it.
	 */
	private _registerAuthProvider(): void {
		const provider = FlowLeapAuthenticationProvider.register(this._extensionContext, this._logService);
		this._authProvider = provider;
		this._register(provider);

		// Bridge the provider's session changes onto the IAuthenticationService seam so existing
		// `onDidAuthenticationChange` consumers (BYOK policy, model picker, context keys, …) still
		// react to FlowLeap sign-in/out now that the provider — not the service — owns the flow.
		// Only identity changes (added/removed) are bridged, not label-only `{changed}` refreshes,
		// matching `onDidAuthenticationChange`'s contract. The cast is safe: PatentAIAuthService is
		// what's registered as IAuthenticationService.
		const patentAuthService = this._authService as unknown as PatentAIAuthService;
		this._register(provider.onDidChangeSessions(e => {
			if ((e.added?.length ?? 0) > 0 || (e.removed?.length ?? 0) > 0) {
				patentAuthService.notifyAuthenticationChanged();
			}
		}));

		// Mirror the provider's session state into the `flowleap.signedIn` / `flowleap.signedOut`
		// context keys so UI surfaces can gate on auth state (separate concern from the bridge above).
		this._register(registerFlowleapAuthContextKeys(provider));

		this._logService.info('[Patent AI] FlowLeap authentication provider registered');
	}

	/**
	 * Register the sign-in / sign-out / cancel commands. They drive the {@link FlowLeapAuthenticationProvider}
	 * flow owner. The commands are always registered even if the provider failed to initialize, so
	 * other surfaces (the chat sign-in affordance, the onboarding gate in #21) never hit a
	 * "command 'patent-ai.signIn' not found"; a missing provider surfaces as a clear error instead.
	 */
	private _registerAuthCommands(): void {
		// Sign In. Canonical user-facing command `flowleap.signIn` and the `patent-ai.signIn` alias
		// (kept for existing callers: the onboarding gate #21, the chat affordance, and the reactive
		// 401 re-auth that fires `executeCommand('patent-ai.signIn')`) both route through the SAME
		// native `getSession({createIfNone:true})` path via {@link triggerFlowleapSignIn}.
		const signInHandler = (options?: { silent?: boolean }): Promise<boolean> => this._triggerSignIn(options?.silent === true);
		this._register(vscode.commands.registerCommand('flowleap.signIn', signInHandler));
		this._register(vscode.commands.registerCommand('patent-ai.signIn', signInHandler));

		// Sign Out.
		this._register(vscode.commands.registerCommand('patent-ai.signOut', async (): Promise<void> => {
			this._logService.info('[Patent AI] Sign Out command executed');
			const provider = this._authProvider;
			if (!provider) {
				this._logService.error('[Patent AI] Sign Out: authentication provider unavailable');
				return;
			}
			try {
				await provider.signOut();
				vscode.window.showInformationMessage('Signed out of FlowLeap');
			} catch (error) {
				const message = error instanceof Error ? error.message : 'Unknown error';
				this._logService.error(`[Patent AI] Sign out failed: ${message}`);
				vscode.window.showErrorMessage(`Sign out failed: ${message}`);
			}
		}));

		// Cancel Sign-In. Lets a blocked surface abort an in-flight deep-link sign-in so the
		// 5-minute wait is never a trap. Invoked programmatically, so it is deliberately not
		// declared in `contributes.commands` / the command palette.
		this._register(vscode.commands.registerCommand('patent-ai.cancelSignIn', (): void => {
			this._logService.info('[Patent AI] Cancel Sign-In command executed');
			this._authProvider?.cancelSignIn();
		}));

		this._logService.info('[Patent AI] Authentication commands registered');
	}

	/**
	 * Drive the native sign-in path. Both `flowleap.signIn` and the `patent-ai.signIn` alias call
	 * this; `silent` suppresses toasts for blocking-overlay callers (see {@link triggerFlowleapSignIn}).
	 * The provider-unavailable guard lives here (the helper assumes a provider), so the commands stay
	 * registered and degrade to a clear error even if provider init failed.
	 */
	private async _triggerSignIn(silent: boolean): Promise<boolean> {
		this._logService.info('[Patent AI] Sign In command executed');

		const provider = this._authProvider;
		if (!provider) {
			this._logService.error('[Patent AI] Sign In: authentication provider unavailable');
			if (!silent) {
				vscode.window.showErrorMessage('Sign in is unavailable. Please reload the window and try again.');
			}
			return false;
		}

		return triggerFlowleapSignIn({
			waitForInit: () => provider.waitForInitialization(),
			isAuthenticated: () => provider.isAuthenticated,
			// Native path: VS Code owns dedup, session persistence, and the Accounts badge; the
			// provider's `createSession` runs the deep-link flow. `trustedExtensionAuthAccess`
			// (product.json) pre-authorizes this extension so no consent modal is shown.
			getSession: () => Promise.resolve(vscode.authentication.getSession(FlowLeapAuthenticationProvider.ID, [], { createIfNone: true })),
			showInfo: message => void vscode.window.showInformationMessage(message),
			showError: message => void vscode.window.showErrorMessage(message),
			log: message => this._logService.info(message),
		}, silent);
	}

	/**
	 * Validate FlowLeap configuration on startup.
	 */
	private _validateConfiguration(): void {
		const config = getPatentAIConfig();
		this._logService.info(`[Patent AI] Backend URL: ${config.apiUrl}`);
		try {
			new URL(config.apiUrl);
		} catch {
			this._logService.error(`[Patent AI] Invalid backend URL: ${config.apiUrl}`);
		}
	}

	/**
	 * Log FlowLeap sign-in status once stored-token restore has settled.
	 */
	private _logAuthenticationStatus(): void {
		const provider = this._authProvider;
		if (!provider) {
			return;
		}
		void provider.waitForInitialization().then(() => {
			this._logService.info(`[Patent AI] FlowLeap authentication ${provider.isAuthenticated ? 'active' : 'inactive (signed out)'}`);
		});
	}
}
