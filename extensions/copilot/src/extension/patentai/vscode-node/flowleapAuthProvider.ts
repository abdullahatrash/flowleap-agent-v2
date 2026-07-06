/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as crypto from 'crypto';
import * as vscode from 'vscode';
import type { ILogService } from '../../../platform/log/common/logService';
import { getPatentAccessToken, registerPatentAccessTokenProvider } from '../common/patentTokenRegistry';
import { registerUriRoute } from '../../uriHandler/vscode-node/extensionUriHandler';
import { getPatentAIConfig } from './configService';
import type { FlowLeapSubscriptionSnapshot, FlowLeapSubscriptionStatus } from '../common/trialCountdown';

const PROVIDER_ID = 'flowleap';
const PROVIDER_LABEL = 'FlowLeap';
const SESSION_ID = 'flowleap-session';

// Token storage keys
const TOKEN_STORAGE_KEY = 'patent-ai-clerk-token';
const TOKEN_EXPIRY_BUFFER_MS = 5 * 60 * 1000; // 5 minutes buffer before expiry

interface JwtUserClaims {
	sub?: string;
	email?: string;
	name?: string;
}

interface StoredTokenData {
	token: string;
	expiresAt: number;
}

interface TokenCallbackData {
	token: string;
	expiresIn?: number; // seconds until expiry
}

/**
 * The single `flowleap` authentication provider (ADR 0002), and the OWNER of the one sign-in flow.
 *
 * It runs the Clerk deep-link flow itself: open the system browser → the website handles Clerk
 * sign-in → it redirects back to the `flowleap://…/callback` deep link with the JWT-template token
 * → the token is persisted to SecretStorage. This is the idiomatic `vscode.AuthenticationProvider`
 * shape: {@link createSession} runs sign-in, {@link getSessions} reads the stored token (deleting it
 * when expired), {@link removeSession} clears it, and {@link onDidChangeSessions} fires on both. The
 * FlowLeap UI shell reads state via `vscode.authentication.getSession('flowleap', …)`.
 *
 * The token never rides the {@link import('../../../platform/authentication/common/authentication').IAuthenticationService}
 * seam (that seam is a GitHub-bypass null object — see `patentAuthService.ts`). Backend-facing code
 * reads the live token through the {@link getPatentAccessToken} registry, whose accessor this provider
 * registers; surfacing the token via any GitHub-session accessor would both break BYOK and leak the
 * JWT to GitHub endpoints, so it is deliberately kept off that seam.
 */
export class FlowLeapAuthenticationProvider implements vscode.AuthenticationProvider, vscode.Disposable {
	static readonly ID = PROVIDER_ID;
	static readonly LABEL = PROVIDER_LABEL;

	private readonly _onDidChangeSessions = new vscode.EventEmitter<vscode.AuthenticationProviderAuthenticationSessionsChangeEvent>();
	readonly onDidChangeSessions = this._onDidChangeSessions.event;

	// Auth state
	private _clerkToken?: string;
	private _tokenExpiresAt: number = 0;
	private _isInitialized: boolean = false;

	// The VS Code session derived from the current valid token, and the lazily-fetched profile
	// used to enrich its Accounts-menu label.
	private _currentSession: vscode.AuthenticationSession | undefined;
	private _cachedUserInfo: { email?: string; name?: string } | undefined;

	// Pending auth callback state
	private _pendingAuthResolve?: (data: TokenCallbackData) => void;
	private _pendingAuthReject?: (error: Error) => void;
	private _pendingState?: string;
	// In-flight sign-in flow, shared so concurrent callers dedupe onto one flow.
	private _signInInFlight?: Promise<void>;
	// Handle for the callback timeout, kept so success and cancel can both clear it.
	private _authTimeout?: ReturnType<typeof setTimeout>;

	private readonly _disposables: vscode.Disposable[] = [];

	constructor(
		private readonly _context: vscode.ExtensionContext,
		private readonly _logService: ILogService,
		// Clock seam: defaults to the real wall clock. Tests inject a fake to exercise
		// the token-expiry decision deterministically without stubbing globals.
		private readonly _now: () => number = Date.now,
	) {
		this._logService.info('[Patent AI Auth] Initializing authentication provider');

		// Register this provider as the OAuth token provider for backend-facing consumers.
		registerPatentAccessTokenProvider(() => this.getAccessToken());

		// Register persistent URI handler for the OAuth callback.
		this._registerUriHandler();

		// Restore stored token (async).
		this._initializeAuth();

		this._logService.info('[Patent AI Auth] Authentication provider ready');
	}

	/**
	 * Construct the provider and register it with VS Code's authentication system. Call this once
	 * during extension activation. Returns the instance so the activation contribution can drive the
	 * sign-in/out commands and bridge {@link onDidChangeSessions} onto the platform auth seam.
	 */
	static register(context: vscode.ExtensionContext, logService: ILogService, now?: () => number): FlowLeapAuthenticationProvider {
		const provider = new FlowLeapAuthenticationProvider(context, logService, now);
		const registration = vscode.authentication.registerAuthenticationProvider(
			PROVIDER_ID,
			PROVIDER_LABEL,
			provider,
			{ supportsMultipleAccounts: false },
		);
		provider._disposables.push(registration);
		return provider;
	}

	// ============================================================================
	// AuthenticationProvider interface
	// ============================================================================

	async getSessions(_scopes?: readonly string[]): Promise<vscode.AuthenticationSession[]> {
		// FlowLeap has a single logical session; scopes are not differentiated.
		const token = this.getAccessToken();
		if (token) {
			if (!this._currentSession) {
				this._currentSession = this._buildSession(token);
			}
			return [this._currentSession];
		}

		// No valid token. If we were still holding state for an expired one, delete it from storage
		// and clear the in-memory session so the Accounts menu reflects the signed-out state.
		if (this._clerkToken || this._currentSession) {
			await this._clearToken();
		}
		return [];
	}

	async createSession(_scopes: readonly string[]): Promise<vscode.AuthenticationSession> {
		// Run the deep-link flow; it builds and caches the session and fires `{added}` on success.
		await this.signIn();

		if (!this._currentSession) {
			// Sign-in resolved without a usable session — e.g. a dead-on-arrival short-lived token.
			throw new Error('Sign-in completed but no session was created');
		}

		return this._currentSession;
	}

	async removeSession(_sessionId: string): Promise<void> {
		await this._clearToken();
	}

	// ============================================================================
	// Sign-in flow (owned here)
	// ============================================================================

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
	 * and clears the 5-minute timeout, returning the provider to a clean,
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

		// Build the canonical callback deep link from the product URI scheme + the extension id. It
		// MUST exactly equal a backend allow-list entry, for example
		// `flowleap://flowleap.patent-ai/callback`
		// (oauth.ts REGISTERED_CLIENTS does EXACT-string matching). The authority is the lower-cased
		// extension id (`flowleap.patent-ai`); `.toString(true)` skips
		// percent-encoding so `URLSearchParams.set` below encodes it exactly once.
		//
		// We deliberately do NOT route through `vscode.env.asExternalUri`: on desktop it appends a
		// `?windowId=N` query, which both double-encodes (`...callback%253FwindowId%253D1`) AND breaks
		// the backend's exact-match allow-list -> "Invalid redirect_uri for this client". Sign-in is
		// desktop-only (PRD 0002), so the remote/web URI rewriting asExternalUri offers is not needed.
		const callbackUri = vscode.Uri.from({
			scheme: vscode.env.uriScheme,
			authority: this._context.extension.id.toLowerCase(),
			path: '/callback'
		}).toString(true);

		// Build auth URL - backend will redirect to website for Clerk sign-in
		const authUrl = new URL(config.authUrl);
		authUrl.searchParams.set('client_id', config.clientId);
		authUrl.searchParams.set('redirect_uri', callbackUri);
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

		this._logService.info(`[Patent AI Auth] Token expires in ${tokenData.expiresIn || 3600} seconds`);

		// Persist token to secure storage
		const storedData: StoredTokenData = {
			token: tokenData.token,
			expiresAt: this._tokenExpiresAt,
		};
		await this._context.secrets.store(TOKEN_STORAGE_KEY, JSON.stringify(storedData));

		this._logService.info('[Patent AI Auth] Successfully authenticated via Clerk');

		// Build/cache the session from the freshly stored token and fire `{added}`. Gated on real
		// validity, so a dead-on-arrival token produces no session (and createSession then throws).
		this._refreshSession();
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
		this._disposables.push(handler);
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

	/**
	 * Sign out and clear stored tokens.
	 */
	async signOut(): Promise<void> {
		this._logService.info('[Patent AI Auth] Signing out');
		await this._clearToken();
		this._logService.info('[Patent AI Auth] Signed out successfully');
	}

	// ============================================================================
	// Token + session state
	// ============================================================================

	/**
	 * Initialize authentication by restoring a stored, unexpired token. The session itself is built
	 * lazily on the first {@link getSessions} call so activation never blocks on the profile fetch.
	 */
	private async _initializeAuth(): Promise<void> {
		try {
			const storedData = await this._context.secrets.get(TOKEN_STORAGE_KEY);
			if (storedData) {
				const tokenData: StoredTokenData = JSON.parse(storedData);

				if (tokenData.token && tokenData.expiresAt > this._now()) {
					this._clerkToken = tokenData.token;
					this._tokenExpiresAt = tokenData.expiresAt;
					this._logService.info('[Patent AI Auth] Restored valid token from storage');
				} else {
					// Token expired, clear it
					await this._context.secrets.delete(TOKEN_STORAGE_KEY);
					this._logService.info('[Patent AI Auth] Stored token expired, cleared');
				}
			}
		} catch (error) {
			this._logService.error(`[Patent AI Auth] Failed to restore token: ${error}`);
		}
		this._isInitialized = true;
	}

	/**
	 * Get the current Clerk token if authenticated and not expired. Synchronous and side-effect
	 * free — this is the accessor registered with {@link registerPatentAccessTokenProvider} and is
	 * called per backend request, so it must not touch storage or fire events.
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
		return this.getAccessToken() !== undefined;
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
	 * Build/replace the cached session from the current valid token and fire the change event.
	 * Gated on real validity so a dead-on-arrival token yields no session. Mirrors the prior
	 * provider's mirror logic, now driven directly by the flow rather than an external event.
	 */
	private _refreshSession(): void {
		const validToken = this.getAccessToken();
		const oldSession = this._currentSession;

		if (validToken) {
			const newSession = this._buildSession(validToken);
			this._currentSession = newSession;
			this._onDidChangeSessions.fire({ added: [newSession], removed: oldSession ? [oldSession] : [], changed: [] });
		} else if (oldSession) {
			this._currentSession = undefined;
			this._cachedUserInfo = undefined;
			this._onDidChangeSessions.fire({ added: [], removed: [oldSession], changed: [] });
		}
	}

	/**
	 * Clear the in-memory token + session and delete the persisted secret. Fires `{removed}` when a
	 * session was present. Shared by {@link signOut}, {@link removeSession}, and the expiry path in
	 * {@link getSessions} — local-only sign-out per ADR 0006 (no backend revoke).
	 */
	private async _clearToken(): Promise<void> {
		// Report a `{removed}` session whenever a token existed — even if `_currentSession` was never
		// materialized. `_currentSession` is built lazily by `getSessions()`, but `_initializeAuth`
		// restores the TOKEN on startup without building the session. Without this, a sign-out before
		// any `getSessions()` call would fire NO event, leaving the `flowleap.signedIn` context key
		// (so the palette Sign In/Sign Out gating) and the Accounts menu stuck "signed in". Synthesize
		// the session from the token so listeners always re-evaluate auth state.
		const removed = this._currentSession ?? (this._clerkToken ? this._buildSession(this._clerkToken) : undefined);

		this._clerkToken = undefined;
		this._tokenExpiresAt = 0;
		this._currentSession = undefined;
		this._cachedUserInfo = undefined;

		try {
			await this._context.secrets.delete(TOKEN_STORAGE_KEY);
		} catch (error) {
			this._logService.error(`[Patent AI Auth] Failed to clear token: ${error}`);
		}

		if (removed) {
			this._onDidChangeSessions.fire({ added: [], removed: [removed], changed: [] });
		}
	}

	/**
	 * Build a VS Code session from a token, deriving the Accounts-menu label from the JWT claims
	 * (falling back to a backend profile fetch when the claims carry no name/email).
	 */
	private _buildSession(token: string): vscode.AuthenticationSession {
		const claims = this._parseJwtClaims(token);

		// Use JWT claims first, then cached user info from backend.
		const email = claims.email || this._cachedUserInfo?.email;
		const name = claims.name || this._cachedUserInfo?.name;

		// If no user info yet, fetch from backend asynchronously.
		if (!email && !this._cachedUserInfo) {
			void this._fetchUserInfo(token);
		}

		const label = name ? `${name} (${email || 'FlowLeap User'})` : (email || 'FlowLeap User');

		return {
			id: SESSION_ID,
			accessToken: token,
			account: {
				id: claims.sub || 'flowleap-user',
				label,
			},
			scopes: [],
		};
	}

	/**
	 * Fetch the user profile from the backend and refresh the session label.
	 */
	private async _fetchUserInfo(token: string): Promise<void> {
		try {
			const config = getPatentAIConfig();
			const profileUrl = `${config.apiUrl.replace(/\/v1\/?$/, '')}/api/profile`;
			const res = await fetch(profileUrl, {
				headers: { Authorization: `Bearer ${token}` },
			});
			if (res.ok) {
				const data = await res.json() as { email?: string; name?: string; user?: { email?: string; name?: string } };
				this._cachedUserInfo = {
					email: data.email || data.user?.email,
					name: data.name || data.user?.name,
				};
				// Rebuild the label only if we are still signed in with this same token.
				if (this._currentSession && this._currentSession.accessToken === token) {
					const updated = this._buildSession(token);
					this._currentSession = updated;
					this._onDidChangeSessions.fire({ added: [], removed: [], changed: [updated] });
				}
			}
		} catch {
			// Silently fail — label stays as fallback.
		}
	}

	/**
	 * Parse user claims from a JWT token payload.
	 */
	private _parseJwtClaims(token: string): JwtUserClaims {
		try {
			const parts = token.split('.');
			if (parts.length !== 3) {
				return {};
			}
			const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf-8'));
			return {
				sub: payload.sub,
				email: payload.email,
				name: payload.name,
			};
		} catch {
			return {};
		}
	}

	// ============================================================================
	// FlowLeap subscription / access helpers
	//
	// Re-homed here from the auth service (ADR 0002). They read the token through the
	// `patentTokenRegistry` seam — NEVER the IAuthenticationService seam — so the FlowLeap token
	// stays off that seam (Verified Finding 2). They have no callers yet; the proactive-UX and
	// reactive 402-gate surfaces (later issues) will consume them.
	// ============================================================================

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
		const { status } = await this.getSubscriptionSnapshot();
		if (status === 'unknown') {
			return 'unknown';
		}
		return status === 'active' || status === 'trialing' ? 'active' : 'inactive';
	}

	/**
	 * A single read of the FlowLeap subscription that preserves the RAW status — `active` (paid)
	 * and `trialing` are kept distinct here, unlike {@link getSubscriptionAccess} which collapses
	 * both to "has access" — and surfaces `currentPeriodEnd` so the trial-countdown pill can name
	 * the days left. Inconclusive reads (signed out, token not ready, non-OK response, network
	 * error) return `{ status: 'unknown' }` with no end date, so a subscribed user is never nagged
	 * on a transient failure. The reactive `402` gate remains the real, server-enforced control.
	 */
	public async getSubscriptionSnapshot(): Promise<FlowLeapSubscriptionSnapshot> {
		const token = getPatentAccessToken();
		if (!token) {
			return { status: 'unknown' };
		}
		try {
			const config = getPatentAIConfig();
			const url = `${config.apiUrl.replace(/\/v1\/?$/, '')}/billing/subscription`;
			const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
			if (!res.ok) {
				return { status: 'unknown' };
			}
			const data = await res.json() as { hasSubscription?: boolean; subscription?: { status?: string; currentPeriodEnd?: string | null } | null };
			const rawStatus = data.subscription?.status;
			const status: FlowLeapSubscriptionStatus =
				rawStatus === 'active' ? 'active'
					: rawStatus === 'trialing' ? 'trialing'
						: 'inactive';
			return { status, currentPeriodEnd: data.subscription?.currentPeriodEnd ?? null };
		} catch (error) {
			this._logService.warn(`[Patent AI Auth] Failed to determine subscription access: ${error}`);
			return { status: 'unknown' };
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

	dispose(): void {
		this._onDidChangeSessions.dispose();
		for (const d of this._disposables) {
			d.dispose();
		}
		this._disposables.length = 0;
	}
}
