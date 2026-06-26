/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { getPatentAIConfig } from './configService';
import { PatentAIAuthService } from './patentAuthService';

const PROVIDER_ID = 'flowleap';
const PROVIDER_LABEL = 'FlowLeap';
const SESSION_ID = 'flowleap-session';

interface JwtUserClaims {
	sub?: string;
	email?: string;
	name?: string;
}

/**
 * The single `flowleap` authentication provider (ADR 0002). Surfaces {@link PatentAIAuthService}'s
 * Clerk sign-in state to VS Code's Accounts menu and to `vscode.authentication.getSession('flowleap', …)`.
 * Sign-in/out is delegated to the auth service — this provider does NOT run its own OAuth flow.
 */
export class FlowLeapAuthenticationProvider implements vscode.AuthenticationProvider, vscode.Disposable {
	static readonly ID = PROVIDER_ID;
	static readonly LABEL = PROVIDER_LABEL;

	private readonly _onDidChangeSessions = new vscode.EventEmitter<vscode.AuthenticationProviderAuthenticationSessionsChangeEvent>();
	readonly onDidChangeSessions = this._onDidChangeSessions.event;

	private _currentSession: vscode.AuthenticationSession | undefined;
	private _cachedUserInfo: { email?: string; name?: string } | undefined;
	private readonly _disposables: vscode.Disposable[] = [];

	constructor(
		private readonly _authService: PatentAIAuthService,
		_context: vscode.ExtensionContext,
	) {
		// Sync initial state.
		this._syncSession();

		// Listen for auth changes from the Clerk-based auth service.
		this._disposables.push(
			this._authService.onDidAuthenticationChange(() => this._syncSession()),
		);
	}

	/**
	 * Register this provider with VS Code's authentication system.
	 * Call this once during extension activation.
	 */
	static register(authService: PatentAIAuthService, context: vscode.ExtensionContext): vscode.Disposable {
		const provider = new FlowLeapAuthenticationProvider(authService, context);
		const registration = vscode.authentication.registerAuthenticationProvider(
			PROVIDER_ID,
			PROVIDER_LABEL,
			provider,
			{ supportsMultipleAccounts: false },
		);
		return vscode.Disposable.from(registration, provider);
	}

	// ============================================================================
	// AuthenticationProvider interface
	// ============================================================================

	async getSessions(_scopes?: readonly string[]): Promise<vscode.AuthenticationSession[]> {
		// FlowLeap has a single logical session; scopes are not differentiated.
		return this._currentSession ? [this._currentSession] : [];
	}

	async createSession(_scopes: readonly string[]): Promise<vscode.AuthenticationSession> {
		// Trigger the existing Clerk sign-in flow.
		await this._authService.signIn();

		if (!this._currentSession) {
			throw new Error('Sign-in completed but no session was created');
		}

		return this._currentSession;
	}

	async removeSession(_sessionId: string): Promise<void> {
		await this._authService.signOut();
		// _syncSession runs via the onDidAuthenticationChange listener.
	}

	// ============================================================================
	// Internal
	// ============================================================================

	/**
	 * Sync the VS Code auth session with the PatentAIAuthService state.
	 * Called on init and whenever auth state changes.
	 */
	private _syncSession(): void {
		const token = this._authService.getAccessToken();

		if (token && this._authService.isAuthenticated) {
			const claims = this._parseJwtClaims(token);

			// Use JWT claims first, then cached user info from backend.
			const email = claims.email || this._cachedUserInfo?.email;
			const name = claims.name || this._cachedUserInfo?.name;

			// If no user info yet, fetch from backend asynchronously.
			if (!email && !this._cachedUserInfo) {
				this._fetchUserInfo(token);
			}

			const label = name ? `${name} (${email || 'FlowLeap User'})` : (email || 'FlowLeap User');

			const newSession: vscode.AuthenticationSession = {
				id: SESSION_ID,
				accessToken: token,
				account: {
					id: claims.sub || 'flowleap-user',
					label,
				},
				scopes: [],
			};

			const oldSession = this._currentSession;
			this._currentSession = newSession;

			if (!oldSession) {
				this._onDidChangeSessions.fire({ added: [newSession], removed: [], changed: [] });
			} else if (oldSession.account.label !== newSession.account.label) {
				// Remove old + add new so VS Code replaces the entry.
				this._onDidChangeSessions.fire({ added: [newSession], removed: [oldSession], changed: [] });
			}
		} else if (this._currentSession) {
			// User signed out.
			const removed = this._currentSession;
			this._currentSession = undefined;
			this._cachedUserInfo = undefined;
			this._onDidChangeSessions.fire({ added: [], removed: [removed], changed: [] });
		}
	}

	/**
	 * Fetch the user profile from the backend and update the session label.
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
				this._syncSession();
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

	dispose(): void {
		this._onDidChangeSessions.dispose();
		for (const d of this._disposables) {
			d.dispose();
		}
	}
}
