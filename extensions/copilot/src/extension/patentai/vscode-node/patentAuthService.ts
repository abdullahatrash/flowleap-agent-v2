/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as crypto from 'crypto';
import * as vscode from 'vscode';
import type { AuthenticationGetSessionOptions, AuthenticationSession } from 'vscode';
import { IAuthenticationService, StrictAuthenticationPresentationOptions } from '../../../platform/authentication/common/authentication';
import { CopilotToken } from '../../../platform/authentication/common/copilotToken';
import { GitHubLoginFailedError } from '../../../platform/authentication/vscode-node/copilotTokenManager';
import { IVSCodeExtensionContext } from '../../../platform/extContext/common/extensionContext';
import { ILogService } from '../../../platform/log/common/logService';
import { Emitter, Event } from '../../../util/vs/base/common/event';
import { registerUriRoute } from '../../uriHandler/vscode-node/extensionUriHandler';
import { getPatentAIConfig } from './configService';
import { registerPatentAccessTokenProvider } from '../common/patentTokenRegistry';

// Token storage keys
const TOKEN_STORAGE_KEY = 'patent-ai-clerk-token';
const TOKEN_EXPIRY_BUFFER_MS = 5 * 60 * 1000; // 5 minutes buffer before expiry

interface StoredTokenData {
	token: string;
	expiresAt: number;
}

interface TokenCallbackData {
	token: string;
	expiresIn?: number; // seconds until expiry
}

/**
 * The single FlowLeap authentication service (ADR 0002).
 *
 * Owns the one sign-in flow: a Clerk `flowleap` JWT-template token obtained via the system
 * browser → `flowleap://…/callback` deep link → SecretStorage. The {@link FlowLeapAuthenticationProvider}
 * surfaces this state to the Accounts menu, and the FlowLeap UI shell reads it via
 * `vscode.authentication.getSession('flowleap', …)`.
 *
 * It also stands in for the stock `AuthenticationService` at the {@link IAuthenticationService}
 * seam to implement the **GitHub bypass**: FlowLeap has no GitHub identity, so every GitHub-session
 * accessor reports "signed out" (`undefined`). This is the clean bypass — it never triggers GitHub
 * OAuth, and a signed-out GitHub state is exactly what makes `isClientBYOKAllowed` permit BYOK
 * inference without a Copilot token. The Copilot/CAPI token is intentionally NOT mocked here; that
 * lives in the CAPI layer (issue #8). {@link getCopilotToken} therefore throws rather than minting
 * a fake token.
 */
export class PatentAIAuthService implements IAuthenticationService {
	readonly _serviceBrand: undefined;

	// Auth state
	private _clerkToken?: string;
	private _tokenExpiresAt: number = 0;
	private _isAuthenticated: boolean = false;
	private _isInitialized: boolean = false;

	// Pending auth callback state
	private _pendingAuthResolve?: (data: TokenCallbackData) => void;
	private _pendingAuthReject?: (error: Error) => void;
	private _pendingState?: string;
	// In-flight sign-in flow, shared so concurrent callers dedupe onto one flow.
	private _signInInFlight?: Promise<void>;
	// Handle for the callback timeout, kept so success and cancel can both clear it.
	private _authTimeout?: ReturnType<typeof setTimeout>;

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
		@IVSCodeExtensionContext private readonly _extensionContext: IVSCodeExtensionContext,
		// Clock seam: defaults to the real wall clock. Tests inject a fake to exercise
		// the token-expiry decision deterministically without stubbing globals.
		private readonly _now: () => number = Date.now,
	) {
		this._logService.info('[Patent AI Auth] Initializing authentication service');

		// Register this service as the OAuth token provider for backend-facing consumers.
		registerPatentAccessTokenProvider(() => this.getAccessToken());

		// Register persistent URI handler for the OAuth callback.
		this._registerUriHandler();

		// Restore stored token (async).
		this._initializeAuth();

		this._logService.info('[Patent AI Auth] Authentication service ready');
	}

	/**
	 * Initialize authentication by restoring a stored, unexpired token.
	 */
	private async _initializeAuth(): Promise<void> {
		try {
			const storedData = await this._extensionContext.secrets.get(TOKEN_STORAGE_KEY);
			if (storedData) {
				const tokenData: StoredTokenData = JSON.parse(storedData);

				if (tokenData.token && tokenData.expiresAt > this._now()) {
					this._clerkToken = tokenData.token;
					this._tokenExpiresAt = tokenData.expiresAt;
					this._isAuthenticated = true;
					this._logService.info('[Patent AI Auth] Restored valid token from storage');
				} else {
					// Token expired, clear it
					await this._extensionContext.secrets.delete(TOKEN_STORAGE_KEY);
					this._logService.info('[Patent AI Auth] Stored token expired, cleared');
				}
			}
		} catch (error) {
			this._logService.error(`[Patent AI Auth] Failed to restore token: ${error}`);
		}
		this._isInitialized = true;
	}

	/**
	 * Register a persistent handler for the OAuth callback deep link. The extension may only
	 * register a single `vscode.window.registerUriHandler`, so we route through the shared
	 * {@link registerUriRoute} dispatcher and claim only the `flowleap://…/callback` path —
	 * other URIs (e.g. the copilot-debug handler's) are left to their own routes.
	 */
	private _registerUriHandler(): void {
		const handler = registerUriRoute(
			uri => uri.path.endsWith('/callback'),
			{ handleUri: (uri: vscode.Uri) => this._handleOAuthCallback(uri) },
		);
		this._extensionContext.subscriptions.push(handler);
	}

	/**
	 * Handle the OAuth callback deep link from the browser.
	 */
	private _handleOAuthCallback(uri: vscode.Uri): void {
		this._logService.info(`[Patent AI Auth] Received OAuth callback: ${uri.path}`);

		const params = new URLSearchParams(uri.query);
		const token = params.get('token');
		const state = params.get('state');
		const error = params.get('error');
		const expiresIn = params.get('expires_in'); // seconds until expiry

		if (error) {
			this._logService.error(`[Patent AI Auth] OAuth error: ${error}`);
			this._pendingAuthReject?.(new Error(`OAuth error: ${error}`));
			this._clearPendingAuth();
			return;
		}

		if (!this._pendingState) {
			// No in-flight sign-in in THIS process: the original attempt's state was lost
			// to an extension-host restart, or the deep link cold-launched a fresh
			// instance. ADR 0002 keeps cold-start sign-in out of scope — pending state is
			// never persisted, and we must not complete sign-in without a CSRF state to
			// match against. So surface a clear "try again" for a real (token- or
			// error-bearing) callback instead of silently dropping it and leaving the
			// user staring at a stalled sign-in.
			this._logService.warn('[Patent AI Auth] Callback received with no pending sign-in; cannot complete — user must retry');
			if (token || error) {
				void vscode.window.showWarningMessage('Sign-in didn\'t complete. Please sign in again.');
			}
			return;
		}

		if (state !== this._pendingState) {
			this._logService.error('[Patent AI Auth] State mismatch - possible CSRF attack');
			this._pendingAuthReject?.(new Error('State mismatch'));
			this._clearPendingAuth();
			return;
		}

		if (token) {
			this._logService.info('[Patent AI Auth] Clerk token received');
			const tokenData: TokenCallbackData = {
				token,
				expiresIn: expiresIn ? parseInt(expiresIn, 10) : undefined
			};
			this._pendingAuthResolve?.(tokenData);
			this._clearPendingAuth();
		} else {
			this._pendingAuthReject?.(new Error('No token in callback'));
			this._clearPendingAuth();
		}
	}

	private _clearPendingAuth(): void {
		if (this._authTimeout) {
			clearTimeout(this._authTimeout);
			this._authTimeout = undefined;
		}
		this._pendingAuthResolve = undefined;
		this._pendingAuthReject = undefined;
		this._pendingState = undefined;
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

	//#region Clerk token authentication

	/**
	 * Get the current Clerk token if authenticated and not expired.
	 */
	public getAccessToken(): string | undefined {
		// Gate on the token's REAL expiry, not the refresh buffer: a short-lived token
		// (e.g. the ~55s Clerk fallback when the JWT template is misconfigured) must stay
		// usable for its real lifetime instead of reading as absent the instant it's
		// stored — which made a "successful" sign-in immediately look signed-out (ADR 0004).
		if (this._clerkToken && this._tokenExpiresAt > this._now()) {
			// Within the refresh buffer of expiry: hint only (no silent refresh — the
			// implicit flow has no refresh token). The token is still valid and returned.
			if (this._tokenExpiresAt <= this._now() + TOKEN_EXPIRY_BUFFER_MS) {
				this._logService.trace('[Patent AI Auth] Token nearing expiry; user will need to re-authenticate soon');
			}
			return this._clerkToken;
		}
		return undefined;
	}

	/**
	 * Whether the user is currently authenticated with a valid token.
	 */
	public get isAuthenticated(): boolean {
		return this._isAuthenticated && this.getAccessToken() !== undefined;
	}

	/**
	 * Resolve once stored-token restoration has completed, so callers can read
	 * {@link isAuthenticated} reliably during activation.
	 */
	public async waitForInitialization(): Promise<void> {
		if (this._isInitialized) {
			return;
		}
		await new Promise<void>(resolve => {
			const check = () => {
				if (this._isInitialized) {
					resolve();
				} else {
					setTimeout(check, 50);
				}
			};
			check();
		});
	}

	/**
	 * Whether the user currently has an access-granting subscription
	 * (`active` or `trialing`) — mirrors the backend's gate. Treats an
	 * inconclusive check as "no access"; callers that must not nag on an
	 * inconclusive result should use {@link getSubscriptionAccess} instead.
	 */
	public async hasActiveSubscription(): Promise<boolean> {
		return (await this.getSubscriptionAccess()) === 'active';
	}

	/**
	 * Tri-state subscription access for proactive UX. Unlike
	 * {@link hasActiveSubscription}, this distinguishes a *confirmed* lack of
	 * access (`inactive`, from a successful backend response) from an
	 * *inconclusive* check (`unknown`: signed out, token not yet ready, or the
	 * request failed). Proactive nudges must fire only on `inactive`, so a
	 * subscribed user is never nagged because a single activation-time check
	 * couldn't reach the backend. The reactive `402` gate remains the real,
	 * server-enforced access control.
	 */
	public async getSubscriptionAccess(): Promise<'active' | 'inactive' | 'unknown'> {
		const token = this.getAccessToken();
		if (!token) {
			return 'unknown';
		}
		try {
			const config = getPatentAIConfig();
			const url = `${config.apiUrl.replace(/\/v1\/?$/, '')}/billing/subscription`;
			const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
			if (!res.ok) {
				return 'unknown';
			}
			const data = await res.json() as { hasSubscription?: boolean; subscription?: { status?: string } | null };
			const status = data.subscription?.status;
			return status === 'active' || status === 'trialing' ? 'active' : 'inactive';
		} catch (error) {
			this._logService.warn(`[Patent AI Auth] Failed to determine subscription access: ${error}`);
			return 'unknown';
		}
	}

	/**
	 * Ensure the user is authenticated, prompting sign-in if needed.
	 * Returns true if authenticated, false if the user cancelled.
	 */
	public async requireAuth(): Promise<boolean> {
		await this.waitForInitialization();

		if (this.isAuthenticated) {
			return true;
		}

		const action = await vscode.window.showInformationMessage(
			'Sign in to FlowLeap to continue',
			'Sign In',
			'Cancel'
		);

		if (action === 'Sign In') {
			try {
				await this.signIn();
				return this.isAuthenticated;
			} catch (error) {
				this._logService.error(`[Patent AI Auth] Sign in failed: ${error}`);
				vscode.window.showErrorMessage(`Sign in failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
				return false;
			}
		}

		return false;
	}

	/**
	 * Start the OAuth flow: open the system browser; the website handles Clerk sign-in and
	 * redirects back to the `flowleap://…/callback` deep link with the template token.
	 */
	async signIn(): Promise<void> {
		// Dedupe concurrent sign-in flows. Multiple callers (the onboarding modal,
		// the chat sign-in affordance, the command palette) firing signIn() while one
		// is pending would each overwrite _pendingState and the pending callback
		// promise, orphaning the earlier flow so it hangs until its 5-min timeout.
		// Reuse the in-flight flow instead.
		if (this._signInInFlight) {
			this._logService.info('[Patent AI Auth] Sign-in already in progress; awaiting the existing flow');
			return this._signInInFlight;
		}
		this._signInInFlight = this._doSignIn().finally(() => {
			this._signInInFlight = undefined;
		});
		return this._signInInFlight;
	}

	/**
	 * Cancel an in-flight sign-in attempt.
	 *
	 * Rejects the pending callback promise — so the awaiting {@link signIn} settles
	 * and `_signInInFlight` clears via its `finally` — clears the pending CSRF state,
	 * and clears the 5-minute timeout, returning the service to a clean,
	 * not-authenticated state from which a fresh {@link signIn} can start. No-op when
	 * nothing is in flight. The non-trapping foundation reused by the onboarding modal
	 * and the reactive 401 re-auth.
	 */
	cancelSignIn(): void {
		if (!this._pendingAuthReject) {
			this._logService.info('[Patent AI Auth] cancelSignIn: no sign-in in progress');
			return;
		}
		this._logService.info('[Patent AI Auth] Sign-in canceled');
		this._pendingAuthReject(new Error('Sign-in canceled.'));
		this._clearPendingAuth();
	}

	private async _doSignIn(): Promise<void> {
		const config = getPatentAIConfig();
		this._logService.info('[Patent AI Auth] Starting OAuth flow');

		const state = crypto.randomBytes(16).toString('hex');

		// Store state for callback validation
		this._pendingState = state;

		// Build auth URL - backend will redirect to website for Clerk sign-in
		const authUrl = new URL(config.authUrl);
		authUrl.searchParams.set('client_id', config.clientId);
		authUrl.searchParams.set('redirect_uri', config.redirectUri);
		authUrl.searchParams.set('response_type', 'token');
		authUrl.searchParams.set('state', state);

		this._logService.info('[Patent AI Auth] Opening browser for authorization');
		await vscode.env.openExternal(vscode.Uri.parse(authUrl.toString()));

		// Wait for callback with Clerk token
		const tokenData = await this._waitForCallback();

		// Store token with actual expiry from backend.
		// Default to 1 hour if expires_in not provided (typical Clerk token lifetime).
		const expiresInMs = (tokenData.expiresIn || 3600) * 1000;
		this._clerkToken = tokenData.token;
		this._tokenExpiresAt = this._now() + expiresInMs;
		this._isAuthenticated = true;

		this._logService.info(`[Patent AI Auth] Token expires in ${tokenData.expiresIn || 3600} seconds`);

		// Persist token to secure storage
		const storedData: StoredTokenData = {
			token: tokenData.token,
			expiresAt: this._tokenExpiresAt,
		};
		await this._extensionContext.secrets.store(TOKEN_STORAGE_KEY, JSON.stringify(storedData));

		this._logService.info('[Patent AI Auth] Successfully authenticated via Clerk');
		this._onDidAuthenticationChange.fire();
	}

	/**
	 * Sign out and clear stored tokens.
	 */
	async signOut(): Promise<void> {
		this._logService.info('[Patent AI Auth] Signing out');

		this._clerkToken = undefined;
		this._tokenExpiresAt = 0;
		this._isAuthenticated = false;

		await this._extensionContext.secrets.delete(TOKEN_STORAGE_KEY);

		this._onDidAuthenticationChange.fire();
		this._logService.info('[Patent AI Auth] Signed out successfully');
	}

	private async _waitForCallback(): Promise<TokenCallbackData> {
		return new Promise((resolve, reject) => {
			this._pendingAuthResolve = resolve;
			this._pendingAuthReject = reject;

			// 5 minute timeout (handle kept so it can be cleared on success/cancel).
			this._authTimeout = setTimeout(() => {
				if (this._pendingAuthReject) {
					this._pendingAuthReject(new Error('Authentication timed out. Please try again.'));
					this._clearPendingAuth();
				}
			}, 5 * 60 * 1000);
		});
	}

	//#endregion

	dispose(): void {
		this._onDidAuthenticationChange.dispose();
		this._onDidAccessTokenChange.dispose();
		this._onDidAdoAuthenticationChange.dispose();
		this._onDidCopilotTokenChange.dispose();
	}
}
