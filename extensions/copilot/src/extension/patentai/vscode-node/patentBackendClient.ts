/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { IEnvService } from '../../../platform/env/common/envService';
import { ILogService } from '../../../platform/log/common/logService';
import { IFetcherService, Response } from '../../../platform/networking/common/fetcherService';
import { INotificationService } from '../../../platform/notification/common/notificationService';
import { CancellationToken } from '../../../util/vs/base/common/cancellation';
import { createServiceIdentifier } from '../../../util/common/services';
import { URI } from '../../../util/vs/base/common/uri';
import { getPatentAccessToken } from '../common/patentTokenRegistry';
import { getPatentAIConfig } from './configService';

// ── Error types ───────────────────────────────────────────────────────────────

/** Thrown by {@link IPatentBackendClient} when the backend returns a non-2xx status (or aborts). */
export class PatentBackendError extends Error {
	constructor(readonly status: number | undefined, message: string) {
		super(message);
		this.name = 'PatentBackendError';
	}
}

/**
 * Thrown when the backend rejects a gated patent route with
 * `402 { error: { code: 'subscription_required', upgradeUrl } }`.
 *
 * Detected once, here at the shared client seam, so every patent tool inherits a clean
 * upgrade prompt instead of a raw JSON body. It extends {@link PatentBackendError}, so the
 * tools' `catch (err instanceof PatentBackendError)` paths keep working — they just surface
 * this clearer message.
 *
 * Security note: this is UX only. The backend `402` is the real, server-enforced gate
 * (Clerk + Polar); never treat the absence of this error as proof of access.
 */
export class SubscriptionRequiredError extends PatentBackendError {
	readonly code = 'subscription_required';
	constructor(message: string, readonly upgradeUrl: string | undefined) {
		super(402, message);
		this.name = 'SubscriptionRequiredError';
	}
}

/**
 * Thrown when the backend rejects a request with `401` — the Clerk token is missing, expired,
 * or invalid. A `401` is unambiguously an auth failure (unlike `402`, which is contract-specific),
 * so this is raised for any `401` body.
 *
 * Extends {@link PatentBackendError} so existing `catch (err instanceof PatentBackendError)` paths
 * keep working. UX only — the backend stays the real, server-enforced gate.
 */
export class AuthRequiredError extends PatentBackendError {
	readonly code = 'auth_required';
	constructor(message: string) {
		super(401, message);
		this.name = 'AuthRequiredError';
	}
}

/**
 * Model-facing recovery hint for an auth/setup failure from the backend. Tools append this to
 * their error result so the assistant can tell the user the concrete next step in-chat — the
 * actionable notification the seam fires is easy to miss mid-conversation. Empty for every
 * other backend error, so tools keep their generic error format.
 */
export function patentBackendErrorRecoveryHint(error: PatentBackendError): string {
	if (error instanceof AuthRequiredError) {
		return ' The user is not signed in to FlowLeap (a notification with a Sign In button was shown). Ask the user to run the "FlowLeap: Sign In" command, then retry this tool.';
	}
	if (error instanceof SubscriptionRequiredError) {
		return ' FlowLeap needs to be set up before patent data is available (a notification with the next step was shown). Ask the user to complete it, then retry this tool.';
	}
	return '';
}

// ── Service options + interface ────────────────────────────────────────────────

export interface IPatentBackendRequestOptions {
	/** Request timeout in milliseconds. Defaults to 30 000. */
	readonly timeoutMs?: number;
}

export const IPatentBackendClient = createServiceIdentifier<IPatentBackendClient>('IPatentBackendClient');

/**
 * The single seam every patent-data tool goes through to reach the FlowLeap backend.
 *
 * Centralising the request here means the `401 → re-sign-in` and `402 → start-trial` gating is
 * implemented once and inherited by every tool, rather than re-checked in each. Tools must never
 * `fetch` the backend directly.
 */
export interface IPatentBackendClient {
	readonly _serviceBrand: undefined;

	/**
	 * POSTs JSON to `${apiUrl}${path}` with `Authorization: Bearer <OAuth token>` (omitted when no
	 * token is registered). Returns parsed JSON. Throws {@link AuthRequiredError} on `401`,
	 * {@link SubscriptionRequiredError} on a gated `402`, or {@link PatentBackendError} otherwise.
	 */
	post<T>(path: string, body: unknown, token: CancellationToken, options?: IPatentBackendRequestOptions): Promise<T>;

	/**
	 * GETs `${apiUrl}${pathWithQuery}` with `Authorization: Bearer <OAuth token>` and no request
	 * body. Same return/throw contract as {@link post}.
	 */
	get<T>(pathWithQuery: string, token: CancellationToken, options?: IPatentBackendRequestOptions): Promise<T>;
}

// ── Internal UX payloads ───────────────────────────────────────────────────────

interface SubscriptionRequiredInfo {
	readonly message: string;
	readonly upgradeUrl: string | undefined;
}

interface AuthRequiredInfo {
	readonly message: string;
	/**
	 * True when no local token existed before the request — the user was never signed in (or
	 * signed out), so the prompt is an invitation, not an expired-session warning.
	 */
	readonly signedOut?: boolean;
}

// ── Implementation ──────────────────────────────────────────────────────────────

const SIGN_IN_ACTION = 'Sign In';
const START_TRIAL_ACTION = 'Start Free Trial';
const SIGNED_OUT_MESSAGE = 'Sign in to FlowLeap to use patent data.';

/**
 * DI implementation of {@link IPatentBackendClient}.
 *
 * Replaces the old fork's module-global UX hooks (`setSubscriptionRequiredHandler` &c.) with
 * constructor-injected services: the `402`/`401` gating UX is driven through {@link INotificationService}
 * and {@link IEnvService}, never module singletons. The bearer token is read from the
 * {@link getPatentAccessToken} registry seam so the request path stays decoupled from the auth
 * provider. Re-auth on `401` is triggered through the `patent-ai.signIn` command — owned by the
 * FlowLeap auth provider — so the client never depends on the auth provider's concrete type.
 */
export class PatentBackendClient implements IPatentBackendClient {
	readonly _serviceBrand: undefined;

	constructor(
		@ILogService private readonly _logService: ILogService,
		@INotificationService private readonly _notificationService: INotificationService,
		@IEnvService private readonly _envService: IEnvService,
		@IFetcherService private readonly _fetcherService: IFetcherService,
	) { }

	post<T>(path: string, body: unknown, token: CancellationToken, options?: IPatentBackendRequestOptions): Promise<T> {
		return this._request<T>('POST', path, body, token, options);
	}

	get<T>(pathWithQuery: string, token: CancellationToken, options?: IPatentBackendRequestOptions): Promise<T> {
		return this._request<T>('GET', pathWithQuery, undefined, token, options);
	}

	/**
	 * Internal implementation for all HTTP requests to the FlowLeap backend. Handles auth, timeout,
	 * cancellation, and error normalisation (including the centralized `401`/`402` gating).
	 */
	private async _request<T>(method: 'GET' | 'POST', path: string, body: unknown, token: CancellationToken, options?: IPatentBackendRequestOptions): Promise<T> {
		const config = getPatentAIConfig();
		const url = `${config.apiUrl}${path}`;
		const timeoutMs = options?.timeoutMs ?? 30_000;

		// The fetcher service enforces the timeout natively; we only wire the CancellationToken to an
		// abort controller so a cancelled request aborts the in-flight fetch.
		const abort = this._fetcherService.makeAbortController();
		const cancelSub = token.onCancellationRequested(() => abort.abort());

		const headers: Record<string, string> = {};
		if (method === 'POST') {
			headers['Content-Type'] = 'application/json';
		}
		// Bearer token comes from the registry seam (FlowLeapAuthenticationProvider registers its accessor there),
		// keeping the request path decoupled from the auth service. No apiKey fallback exists — FlowLeap
		// is BYOK for inference and the backend is the Clerk-gated paid path (ADR 0002/0004).
		const accessToken = getPatentAccessToken();
		if (accessToken) {
			headers['Authorization'] = `Bearer ${accessToken}`;
		}

		try {
			this._logService.debug(`[PatentBackendClient] ${method} ${url}`);

			let response: Response;
			try {
				response = await this._fetcherService.fetch(url, {
					callSite: 'patentBackendClient',
					method,
					headers,
					body: method === 'POST' ? JSON.stringify(body) : undefined,
					timeout: timeoutMs,
					signal: abort.signal,
				});
			} catch (err) {
				// A timeout (enforced by the fetcher) and a cancellation (our abort) both surface as abort
				// errors; disambiguate via the token to preserve the original error messages.
				if (this._fetcherService.isAbortError(err)) {
					if (token.isCancellationRequested) {
						throw new PatentBackendError(undefined, 'Request cancelled.');
					}
					throw new PatentBackendError(undefined, `Request timed out after ${timeoutMs} ms.`);
				}
				throw err;
			}

			this._logService.debug(`[PatentBackendClient] ${response.status} ${url} (${response.headers.get('content-length') ?? '?'} bytes)`);

			if (!response.ok) {
				const text = await response.text();

				// Centralized subscription gate: gated patent routes answer
				// `402 { error: { code: 'subscription_required', upgradeUrl } }` when the user has no
				// active/trialing subscription. Detect it once here so every tool surfaces a clean
				// upgrade prompt and a "Start free trial" notification instead of a raw JSON body.
				if (response.status === 402) {
					const info = parseSubscriptionRequired(text);
					if (info) {
						this._fireSubscriptionRequiredUx(info);
						throw new SubscriptionRequiredError(info.message, info.upgradeUrl);
					}
				}

				// Centralized auth gate: a `401` means the Clerk token is missing, expired, or invalid.
				// The client knows *before* the request whether a local token existed, so it can tell
				// never-signed-in apart from an expired session without trusting the backend body: no
				// token → a sign-in invitation; token sent but rejected → the expired-session prompt.
				if (response.status === 401) {
					const info: AuthRequiredInfo = accessToken
						? parseAuthRequired(text)
						: { message: SIGNED_OUT_MESSAGE, signedOut: true };
					this._fireAuthRequiredUx(info);
					throw new AuthRequiredError(info.message);
				}

				const truncated = text.length > 500 ? text.substring(0, 500) + '…' : text;
				throw new PatentBackendError(response.status, truncated);
			}

			return await response.json() as T;
		} finally {
			cancelSub.dispose();
		}
	}

	/**
	 * Show the "Start free trial" notification for a gated `402`, opening the upgrade URL when the
	 * user accepts. Fire-and-forget: a failing prompt must never mask the {@link SubscriptionRequiredError}.
	 */
	private _fireSubscriptionRequiredUx(info: SubscriptionRequiredInfo): void {
		this._promptSubscriptionRequired(info).catch(err => this._logService.warn(`[PatentBackendClient] subscription prompt failed: ${err}`));
	}

	private async _promptSubscriptionRequired(info: SubscriptionRequiredInfo): Promise<void> {
		if (!info.upgradeUrl) {
			void this._notificationService.showInformationMessage(info.message);
			return;
		}
		const choice = await this._notificationService.showInformationMessage(info.message, START_TRIAL_ACTION);
		if (choice === START_TRIAL_ACTION) {
			await this._envService.openExternal(URI.parse(info.upgradeUrl));
		}
	}

	/**
	 * Show the re-sign-in prompt for a `401`, starting the FlowLeap sign-in flow when the user
	 * accepts. Fire-and-forget: a failing prompt must never mask the {@link AuthRequiredError}.
	 */
	private _fireAuthRequiredUx(info: AuthRequiredInfo): void {
		this._promptAuthRequired(info).catch(err => this._logService.warn(`[PatentBackendClient] re-auth prompt failed: ${err}`));
	}

	private async _promptAuthRequired(info: AuthRequiredInfo): Promise<void> {
		// A signed-out user did nothing wrong — invite with an info toast; reserve the warning
		// severity for a session that was working and then expired.
		const choice = info.signedOut
			? await this._notificationService.showInformationMessage(info.message, SIGN_IN_ACTION)
			: await this._notificationService.showWarningMessage(info.message, SIGN_IN_ACTION);
		if (choice === SIGN_IN_ACTION) {
			// Trigger interactive sign-in through the command owned by the FlowLeap auth provider.
			// Decoupled via the command id so the client never depends on the provider/auth-service
			// concrete type (and this survives the canonical `flowleap.signIn` alias added later).
			await vscode.commands.executeCommand('patent-ai.signIn');
		}
	}
}

// ── Body parsing ────────────────────────────────────────────────────────────────

/** Extract a clean message from a `401` body, falling back to a default. */
function parseAuthRequired(body: string): AuthRequiredInfo {
	const fallback = 'Your FlowLeap session has expired. Please sign in again.';
	try {
		const parsed = JSON.parse(body) as { error?: { message?: string } };
		return { message: parsed?.error?.message || fallback };
	} catch {
		// Not JSON — use the default message.
		return { message: fallback };
	}
}

/** Parse a `402` body, returning subscription-gate info only when it matches the contract. */
function parseSubscriptionRequired(body: string): SubscriptionRequiredInfo | undefined {
	try {
		const parsed = JSON.parse(body) as { error?: { code?: string; message?: string; upgradeUrl?: string } };
		const error = parsed?.error;
		if (error?.code !== 'subscription_required') {
			return undefined;
		}
		const baseMessage = error.message
			|| 'An active FlowLeap subscription is required. Start your free trial to continue.';
		const message = error.upgradeUrl ? `${baseMessage}\n\nUpgrade: ${error.upgradeUrl}` : baseMessage;
		return { message, upgradeUrl: error.upgradeUrl };
	} catch {
		// Not JSON — let the caller fall back to generic error handling.
		return undefined;
	}
}
