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
import { FlowLeapAuthenticationProvider } from './flowleapAuthProvider';
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
	 * Register FlowLeap as the single authentication provider in VS Code's Accounts menu.
	 */
	private _registerAuthProvider(): void {
		const patentAuthService = this._authService as unknown as PatentAIAuthService;
		this._register(FlowLeapAuthenticationProvider.register(patentAuthService, this._extensionContext));
		this._logService.info('[Patent AI] FlowLeap authentication provider registered');
	}

	/**
	 * Register the sign-in / sign-out / cancel commands.
	 */
	private _registerAuthCommands(): void {
		const patentAuthService = this._authService as unknown as PatentAIAuthService;

		// Sign In. `options.silent` suppresses toasts: a blocking onboarding overlay dims
		// notifications, so a toast fired there renders hidden "under the dialog"; such callers
		// pass silent:true and show their own inline status. Returns the resulting auth state so
		// callers (e.g. the onboarding gate, #21) can decide whether to advance.
		this._register(vscode.commands.registerCommand('patent-ai.signIn', async (options?: { silent?: boolean }): Promise<boolean> => {
			this._logService.info('[Patent AI] Sign In command executed');
			const silent = options?.silent === true;

			// If a valid session already exists, don't force another browser round-trip.
			await patentAuthService.waitForInitialization();
			if (patentAuthService.isAuthenticated) {
				this._logService.info('[Patent AI] Already authenticated; skipping browser sign-in');
				return true;
			}

			try {
				await patentAuthService.signIn();
				// Gate the toast on REAL auth state: signIn() can resolve while the stored token
				// is already invalid (e.g. a dead-on-arrival short-lived token).
				const authed = patentAuthService.isAuthenticated;
				if (!silent) {
					if (authed) {
						vscode.window.showInformationMessage('Successfully signed in to FlowLeap');
					} else {
						vscode.window.showErrorMessage('Sign in did not complete. Please try again.');
					}
				}
				return authed;
			} catch (error) {
				const message = error instanceof Error ? error.message : 'Unknown error';
				this._logService.error(`[Patent AI] Sign in failed: ${message}`);
				if (!silent) {
					vscode.window.showErrorMessage(`Sign in failed: ${message}`);
				}
				return false;
			}
		}));

		// Sign Out.
		this._register(vscode.commands.registerCommand('patent-ai.signOut', async (): Promise<void> => {
			this._logService.info('[Patent AI] Sign Out command executed');
			try {
				await patentAuthService.signOut();
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
			patentAuthService.cancelSignIn();
		}));

		this._logService.info('[Patent AI] Authentication commands registered');
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
		const patentAuthService = this._authService as unknown as PatentAIAuthService;
		void patentAuthService.waitForInitialization().then(() => {
			this._logService.info(`[Patent AI] FlowLeap authentication ${patentAuthService.isAuthenticated ? 'active' : 'inactive (signed out)'}`);
		});
	}
}
