/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { AuthenticationGetSessionOptions, AuthenticationSession } from 'vscode';
import { IAuthenticationService, StrictAuthenticationPresentationOptions } from '../../../platform/authentication/common/authentication';
import { CopilotToken } from '../../../platform/authentication/common/copilotToken';
import { GitHubLoginFailedError } from '../../../platform/authentication/vscode-node/copilotTokenManager';
import { ILogService } from '../../../platform/log/common/logService';
import { Emitter, Event } from '../../../util/vs/base/common/event';

/**
 * The FlowLeap stand-in for the stock `AuthenticationService` at the {@link IAuthenticationService}
 * seam — a stateless **GitHub-bypass null object** (ADR 0002).
 *
 * It knows nothing about FlowLeap/Clerk: the one sign-in flow and the FlowLeap token live entirely
 * in {@link import('./flowleapAuthProvider').FlowLeapAuthenticationProvider} and travel via the
 * `patentTokenRegistry` / `vscode.authentication.getSession('flowleap', …)`, NEVER through this seam.
 *
 * Its sole job is the **GitHub bypass**: FlowLeap has no GitHub identity, so every GitHub-session
 * accessor reports "signed out" (`undefined`). That is the clean bypass — it never triggers GitHub
 * OAuth, and a signed-out GitHub state is exactly what makes `isClientBYOKAllowed` permit BYOK
 * inference without a Copilot token (`byokProvider.ts`). Surfacing the FlowLeap token here would both
 * break BYOK AND leak the JWT to GitHub endpoints, so it is deliberately kept off this seam
 * (Verified Finding 2). The Copilot/CAPI token is disabled separately at the token-manager seam
 * (`PatentAICopilotTokenManager`, #8); {@link getCopilotToken} therefore throws rather than minting
 * a fake token.
 */
export class PatentAIAuthService implements IAuthenticationService {
	readonly _serviceBrand: undefined;

	private readonly _onDidAuthenticationChange = new Emitter<void>();
	readonly onDidAuthenticationChange: Event<void> = this._onDidAuthenticationChange.event;

	private readonly _onDidAccessTokenChange = new Emitter<void>();
	readonly onDidAccessTokenChange: Event<void> = this._onDidAccessTokenChange.event;

	private readonly _onDidAdoAuthenticationChange = new Emitter<void>();
	readonly onDidAdoAuthenticationChange: Event<void> = this._onDidAdoAuthenticationChange.event;

	// FlowLeap never mints a Copilot token, so this event never fires.
	private readonly _onDidCopilotTokenChange = new Emitter<void>();
	readonly onDidCopilotTokenChange: Event<void> = this._onDidCopilotTokenChange.event;

	constructor(
		@ILogService private readonly _logService: ILogService,
	) {
		this._logService.info('[Patent AI Auth] GitHub-bypass authentication service ready (FlowLeap sign-in is owned by FlowLeapAuthenticationProvider)');
	}

	/**
	 * Fire {@link onDidAuthenticationChange}. The FlowLeap sign-in flow is owned by
	 * {@link import('./flowleapAuthProvider').FlowLeapAuthenticationProvider}; the activation
	 * contribution bridges the provider's `onDidChangeSessions` to this method so consumers wired to
	 * the {@link IAuthenticationService} seam (BYOK policy, model picker, context keys, …) still
	 * react to FlowLeap sign-in/out. No FlowLeap token crosses this seam — only the notification.
	 */
	notifyAuthenticationChanged(): void {
		this._onDidAuthenticationChange.fire();
	}

	//#region IAuthenticationService — GitHub bypass

	get isMinimalMode(): boolean {
		return false;
	}

	// FlowLeap has no GitHub identity. Reporting "signed out" here is the clean GitHub bypass:
	// it never triggers GitHub OAuth, and `isClientBYOKAllowed(hasGitHubSession=false, …)` returns
	// true, so BYOK inference is permitted without any Copilot token.
	get anyGitHubSession(): AuthenticationSession | undefined {
		return undefined;
	}

	get permissiveGitHubSession(): AuthenticationSession | undefined {
		return undefined;
	}

	// No GitHub/proxy token pathway exists, so there is no Copilot-token source.
	readonly hasCopilotTokenSource: boolean = false;

	getGitHubSession(kind: 'permissive' | 'any', options: AuthenticationGetSessionOptions & { createIfNone: StrictAuthenticationPresentationOptions }): Promise<AuthenticationSession>;
	getGitHubSession(kind: 'permissive' | 'any', options: AuthenticationGetSessionOptions & { forceNewSession: StrictAuthenticationPresentationOptions }): Promise<AuthenticationSession>;
	getGitHubSession(kind: 'permissive' | 'any', options: Omit<AuthenticationGetSessionOptions, 'createIfNone' | 'forceNewSession'>): Promise<AuthenticationSession | undefined>;
	async getGitHubSession(_kind: 'permissive' | 'any', _options: AuthenticationGetSessionOptions): Promise<AuthenticationSession | undefined> {
		// Never prompt for or return a GitHub session — the agent must work with none present.
		return undefined;
	}

	//#endregion

	//#region IAuthenticationService — Copilot token (deferred to the CAPI layer, #8)

	get copilotToken(): Omit<CopilotToken, 'token'> | undefined {
		return undefined;
	}

	async getCopilotToken(_force?: boolean): Promise<CopilotToken> {
		// FlowLeap is BYOK-only and never mints a Copilot/CAPI token. Throw the same
		// `GitHubLoginFailedError` reason the CAPI-disabled token manager (#8) uses, so token
		// consumers (e.g. ContextKeysContribution) take the already-supported "no Copilot token /
		// BYOK" branch — a debug log and the GitHubLoginFailed welcome-view state, not an error.
		// No token is fabricated here; mock-token concerns belong to the CAPI layer (#8).
		throw new GitHubLoginFailedError('GitHubLoginFailed');
	}

	resetCopilotToken(_httpError?: number): void {
		// No-op — there is no Copilot token to reset.
	}

	public speculativeDecodingEndpointToken: string | undefined;

	async getAdoAccessTokenBase64(_options?: AuthenticationGetSessionOptions): Promise<string | undefined> {
		return undefined;
	}

	//#endregion

	dispose(): void {
		this._onDidAuthenticationChange.dispose();
		this._onDidAccessTokenChange.dispose();
		this._onDidAdoAuthenticationChange.dispose();
		this._onDidCopilotTokenChange.dispose();
	}
}
