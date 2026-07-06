/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as l10n from '@vscode/l10n';
import { IEnvService } from '../../../platform/env/common/envService';
import { ILogService } from '../../../platform/log/common/logService';
import { IFetcherService, Response } from '../../../platform/networking/common/fetcherService';
import { INotificationService } from '../../../platform/notification/common/notificationService';
import { CancellationToken } from '../../../util/vs/base/common/cancellation';
import { createServiceIdentifier } from '../../../util/common/services';
import { URI } from '../../../util/vs/base/common/uri';
import { EPO_OPS_KEY_HEADER, EPO_OPS_SECRET_HEADER, getPatentDataKeys, USPTO_ODP_KEY_HEADER } from '../common/patentDataKeysRegistry';
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
 * Thrown when the backend answers `400 { error: { code: 'patent_provider_key_invalid',
 * provider } }` — EPO OPS / USPTO ODP rejected the USER's forwarded data key (#30 wire
 * contract). Deliberately not 401 (Clerk re-sign-in) or 402: the recovery action is
 * "update your patent-data keys". Extends {@link PatentBackendError} so tool catch paths
 * keep working.
 */
export class DataKeyInvalidError extends PatentBackendError {
	readonly code = 'patent_provider_key_invalid';
	constructor(message: string, readonly provider: 'epo' | 'uspto') {
		super(400, message);
		this.name = 'DataKeyInvalidError';
	}
}

/**
 * Thrown when the backend answers `400 { error: { code: 'data_keys_required', provider? } }` — after
 * the trial ends, patent-data calls need the USER's own EPO OPS / USPTO key and none was forwarded
 * (ADR 0008 / flowleap-backend#76). Distinct from {@link DataKeyInvalidError} (a *rejected* key): here
 * no key was sent at all. The recovery action is "add your patent-data keys". `provider` names the
 * missing provider when the backend identifies one; otherwise the prompt is generic. Extends
 * {@link PatentBackendError} so tool catch paths keep working.
 */
export class DataKeysRequiredError extends PatentBackendError {
	readonly code = 'data_keys_required';
	constructor(message: string, readonly provider: 'epo' | 'uspto' | undefined) {
		super(400, message);
		this.name = 'DataKeysRequiredError';
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
	if (error instanceof DataKeyInvalidError) {
		const providerName = error.provider === 'epo' ? 'EPO OPS' : 'USPTO ODP';
		return ` The user's ${providerName} data key was rejected by the provider. Ask the user to run the "FlowLeap: Patent Data Keys" command to update it, then retry this tool.`;
	}
	if (error instanceof DataKeysRequiredError) {
		const providerClause = error.provider ? `${error.provider === 'epo' ? 'EPO OPS' : 'USPTO ODP'} ` : 'EPO OPS or USPTO ';
		return ` Patent data now requires the user's own ${providerClause}key (a notification with an "Add Patent Data Keys" button was shown). Ask the user to run the "FlowLeap: Patent Data Keys" command to add it, then retry this tool.`;
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
const UPDATE_KEYS_ACTION = 'Patent Data Keys';
const SIGNED_OUT_MESSAGE = 'Sign in to FlowLeap to use patent data.';

interface DataKeyInvalidInfo {
	readonly message: string;
	readonly provider: 'epo' | 'uspto';
}

interface DataKeysRequiredInfo {
	readonly message: string;
	readonly provider: 'epo' | 'uspto' | undefined;
}

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

	/**
	 * Providers already prompted for `data_keys_required` this session (keyed by provider, or `*`
	 * when none was named). Patent tools can fail in a burst — one gated call per tool — so the
	 * recovery notification fires at most once per provider per session while the thrown error still
	 * reaches every tool. Mirrors the intent of a debounce; there is no shared throttle helper to reuse.
	 */
	private readonly _dataKeysRequiredPrompted = new Set<string>();

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
		// BYO patent-data keys (#31, ADR 0005): forwarded per the #30 wire contract when the
		// user configured them; absent headers mean the backend's FlowLeap-key behavior. The
		// two providers are independent (EPO-only / USPTO-only are valid). Never log these.
		const dataKeys = getPatentDataKeys();
		if (dataKeys?.epo) {
			headers[EPO_OPS_KEY_HEADER] = dataKeys.epo.key;
			headers[EPO_OPS_SECRET_HEADER] = dataKeys.epo.secret;
		}
		if (dataKeys?.usptoOdp) {
			headers[USPTO_ODP_KEY_HEADER] = dataKeys.usptoOdp;
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

				// Centralized data-key gate: `400 patent_provider_key_invalid` means EPO/USPTO
				// rejected the USER's forwarded key (#30 contract). Prompt the keys UI once here
				// so every tool inherits the "update your keys" action.
				if (response.status === 400) {
					const info = parseDataKeyInvalid(text);
					if (info) {
						this._fireDataKeyInvalidUx(info);
						throw new DataKeyInvalidError(info.message, info.provider);
					}
					// Post-trial: patent data now runs on the user's own keys and none was forwarded
					// (`data_keys_required`, ADR 0008). Prompt the keys UI once per provider per session.
					const required = parseDataKeysRequired(text);
					if (required) {
						this._fireDataKeysRequiredUx(required);
						throw new DataKeysRequiredError(required.message, required.provider);
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

	/**
	 * Show the "update your keys" prompt for a rejected data key, opening the keys UI when
	 * accepted. Fire-and-forget: a failing prompt must never mask the {@link DataKeyInvalidError}.
	 */
	private _fireDataKeyInvalidUx(info: DataKeyInvalidInfo): void {
		this._promptDataKeyInvalid(info).catch(err => this._logService.warn(`[PatentBackendClient] data-key prompt failed: ${err}`));
	}

	private async _promptDataKeyInvalid(info: DataKeyInvalidInfo): Promise<void> {
		const choice = await this._notificationService.showWarningMessage(info.message, UPDATE_KEYS_ACTION);
		if (choice === UPDATE_KEYS_ACTION) {
			await vscode.commands.executeCommand('flowleap.patentDataKeys');
		}
	}

	/**
	 * Show the "add your patent-data keys" prompt for a `data_keys_required` gate, opening the keys
	 * UI (focused on the named provider when known) when accepted. Debounced to once per provider per
	 * session and fire-and-forget, so it never masks the {@link DataKeysRequiredError}.
	 */
	private _fireDataKeysRequiredUx(info: DataKeysRequiredInfo): void {
		const guardKey = info.provider ?? '*';
		if (this._dataKeysRequiredPrompted.has(guardKey)) {
			return;
		}
		this._dataKeysRequiredPrompted.add(guardKey);
		this._promptDataKeysRequired(info).catch(err => this._logService.warn(`[PatentBackendClient] data-keys-required prompt failed: ${err}`));
	}

	private async _promptDataKeysRequired(info: DataKeysRequiredInfo): Promise<void> {
		const addKeysAction = l10n.t('Add Patent Data Keys');
		const choice = await this._notificationService.showWarningMessage(info.message, addKeysAction);
		if (choice === addKeysAction) {
			// Forward the provider so the keys UI focuses the missing section (the command ignores a
			// non-'epo'/'uspto' arg, so an unknown provider harmlessly opens the keys view unfocused).
			await vscode.commands.executeCommand('flowleap.patentDataKeys', info.provider);
		}
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

/** Parse a `400` body, returning data-key info only when it matches the #30 contract. */
function parseDataKeyInvalid(body: string): DataKeyInvalidInfo | undefined {
	try {
		const parsed = JSON.parse(body) as { error?: { code?: string; message?: string; provider?: string } };
		const error = parsed?.error;
		if (error?.code !== 'patent_provider_key_invalid' || (error.provider !== 'epo' && error.provider !== 'uspto')) {
			return undefined;
		}
		const providerName = error.provider === 'epo' ? 'EPO OPS' : 'USPTO ODP';
		return {
			message: error.message || `${providerName} rejected your patent-data key. Update it to continue.`,
			provider: error.provider,
		};
	} catch {
		// Not JSON — let the caller fall back to generic error handling.
		return undefined;
	}
}

/** Parse a `400` body, returning data-keys-required info only when it matches the ADR 0008 contract. */
function parseDataKeysRequired(body: string): DataKeysRequiredInfo | undefined {
	try {
		const parsed = JSON.parse(body) as { error?: { code?: string; message?: string; provider?: string } };
		const error = parsed?.error;
		if (error?.code !== 'data_keys_required') {
			return undefined;
		}
		const provider = error.provider === 'epo' || error.provider === 'uspto' ? error.provider : undefined;
		const providerName = provider === 'epo' ? 'EPO OPS' : provider === 'uspto' ? 'USPTO ODP' : undefined;
		const fallback = providerName
			? l10n.t('Patent data now runs on your own keys. Add your {0} key to continue.', providerName)
			: l10n.t('Patent data now runs on your own keys. Add your EPO OPS or USPTO key to continue.');
		return { message: error.message || fallback, provider };
	} catch {
		// Not JSON — let the caller fall back to generic error handling.
		return undefined;
	}
}

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
