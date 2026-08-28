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
import { ITelemetryService } from '../../../platform/telemetry/common/telemetry';
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
 * (Clerk + Stripe); never treat the absence of this error as proof of access.
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
 *
 * Also raised for the ODP taxonomy's `503 odp_api_key_missing` — the same "no USPTO key anywhere"
 * verdict wearing a different code and status. The gate is normalized here (as the CLI normalizes it
 * to `provider_keys_required`) so the recovery path stays the one the user needs, while `status`
 * still reports the wire status — `400` or `503`, never anything else.
 */
export class DataKeysRequiredError extends PatentBackendError {
	readonly code = 'data_keys_required';
	constructor(message: string, readonly provider: 'epo' | 'uspto' | undefined, status: 400 | 503 = 400) {
		super(status, message);
		this.name = 'DataKeysRequiredError';
	}
}

/**
 * Thrown when the backend answers `429 { error: { code: 'trial_data_budget_exhausted', provider,
 * remaining, resets_at } }` (ADR 0017 / flowleap-backend#334) — the trialing user's daily shared
 * data budget on FlowLeap's own patent-data credentials is spent. Checked by CODE before the
 * generic 429 mapping, so it is never mistaken for "slow down": the budget resets at the next UTC
 * day (`resetsAt`), and the user's own free keys lift it permanently. Joins the data-keys
 * notification family — the recovery action is the keys UI. Extends {@link PatentBackendError} so
 * tool catch paths keep working.
 */
export class TrialDataBudgetExhaustedError extends PatentBackendError {
	readonly code = 'trial_data_budget_exhausted';
	constructor(
		message: string,
		readonly provider: 'epo' | 'uspto' | undefined,
		readonly resetsAt: string | undefined,
		readonly retryAfterSeconds: number | undefined,
	) {
		super(429, message);
		this.name = 'TrialDataBudgetExhaustedError';
	}
}

/**
 * Thrown when the backend answers `403 { error: { code: 'trial_model_key_unavailable', reason } }`
 * on the Trial Model key route (ADR 0015 / flowleap-backend#302) — the caller's subscription is not
 * `trialing`, so no trial LLM key is served. A first-class typed outcome, not a failure: the
 * recovery is "hide the FlowLeap Trial provider and steer to BYO-key", which the trial provider
 * applies itself — deliberately no notification at the seam, since the fetch runs silently on
 * every model listing. Extends {@link PatentBackendError} so shared catch paths keep working.
 */
export class TrialModelKeyUnavailableError extends PatentBackendError {
	readonly code = 'trial_model_key_unavailable';
	constructor(message: string, readonly reason: string | undefined) {
		super(403, message);
		this.name = 'TrialModelKeyUnavailableError';
	}
}

/**
 * Thrown when the backend answers `429` and the request could not be transparently retried within a
 * short {@link https://developer.mozilla.org/docs/Web/HTTP/Headers/Retry-After Retry-After} budget —
 * the caller is being rate-limited. Kept distinct from the generic non-2xx path so tools surface a
 * clear "wait and retry" message instead of a raw body. `retryAfterSeconds` carries the server's hint
 * when it supplied one. Extends {@link PatentBackendError} so tool catch paths keep working.
 */
export class RateLimitError extends PatentBackendError {
	readonly code = 'rate_limited';
	constructor(message: string, readonly retryAfterSeconds: number | undefined) {
		super(429, message);
		this.name = 'RateLimitError';
	}
}

/**
 * Thrown when the backend returns a generic server-side failure the client already retried and
 * could not clear — a `5xx` status, a gateway error (`502`/`503`/`504`), or a client-enforced
 * request timeout. These are *transient*: the query itself is fine, the backend is momentarily
 * unavailable, so the recovery action is "wait briefly and retry" — unlike a `4xx`, which needs the
 * user to change something. Kept distinct from the generic {@link PatentBackendError} so a tool
 * surfaces a clear "transient, retry" steer instead of a dead end.
 *
 * The model-facing `message` is a short status line only: raw nginx HTML error pages and internal
 * exception text (e.g. a `502` carrying an upstream stack fragment) are stripped, so the assistant
 * reads "transient, retry" rather than a wall of gateway markup. `status` is the HTTP code, or
 * `undefined` for a client-side timeout. Extends {@link PatentBackendError} so tool catch paths keep
 * working.
 */
export class TransientBackendError extends PatentBackendError {
	readonly code = 'transient';
	constructor(message: string, status: number | undefined) {
		super(status, message);
		this.name = 'TransientBackendError';
	}
}

/**
 * Model-facing recovery hint for an auth/setup/transient failure from the backend. Tools append
 * this to their error result so the assistant can tell the user (or itself) the concrete next step
 * in-chat — the actionable notification the seam fires is easy to miss mid-conversation, and a
 * transient `5xx`/gateway/timeout needs a "wait and retry" steer, not a give-up. The
 * {@link DataKeysRequiredError} hint carries the key-gate doctrine's no-substitution steer, so the
 * reactive path says what the system prompt says. Empty only for the
 * generic {@link PatentBackendError} (an unclassified `4xx`), so tools keep their generic format there.
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
		return ` Patent data now requires the user's own ${providerClause}key (a notification with an "Add Patent Data Keys" button was shown). Ask the user to run the "FlowLeap: Patent Data Keys" command to add it, then retry this tool. This is a user-action stop, not a dead route: do NOT substitute web or Google Patents data for this office, for searches or for single-document reads. Meanwhile continue with any office whose key is live and with the keyless tools (PATSTAT analytics, legal search, academic search), and name the missing-key gap in your answer.`;
	}
	if (error instanceof TrialDataBudgetExhaustedError) {
		const resetClause = error.resetsAt ? `It resets at ${error.resetsAt}` : 'It resets at the next UTC day';
		return ` Today's shared trial data budget is used up (a notification with an "Add Patent Data Keys" button was shown). ${resetClause}, and the user's own free EPO/USPTO keys lift it permanently — ask the user to run the "FlowLeap: Patent Data Keys" command. This is a user-action stop, not a dead route: do NOT substitute web or Google Patents data for this office. Meanwhile continue with the keyless tools (PATSTAT analytics, legal search, academic search) and name the budget gap in your answer.`;
	}
	if (error instanceof RateLimitError) {
		const waitClause = error.retryAfterSeconds ? `Wait at least ${error.retryAfterSeconds} seconds` : 'Wait a few seconds';
		return ` The FlowLeap backend is rate-limiting requests (HTTP 429). ${waitClause} before retrying this tool.`;
	}
	if (error instanceof TransientBackendError) {
		const statusClause = error.status !== undefined ? ` (HTTP ${error.status})` : '';
		return ` The patent backend is temporarily unavailable${statusClause} — this is transient, not a coverage limit. Wait briefly and retry the same query, or try a different office (USPTO) meanwhile.`;
	}
	return '';
}

// ── Service options + interface ────────────────────────────────────────────────

export interface IPatentBackendRequestOptions {
	/** Request timeout in milliseconds. Defaults to 30 000. */
	readonly timeoutMs?: number;
	/**
	 * Target the backend ROOT host (the api origin with the `/v1` patent-tools suffix stripped) rather
	 * than the `/v1` prefix — for account routes such as `/api/invoices` and `/billing/*` that live
	 * outside `/v1`. Defaults to false (the normal `/v1` patent-data path).
	 */
	readonly rootHost?: boolean;
	/**
	 * Keep this request out of the per-session read cache — neither served from it nor stored in it.
	 *
	 * The cache exists because patent-data calls are reads: the same document asked for twice in a
	 * burst is the same document. A call WITHOUT read semantics breaks that assumption — the billing
	 * portal mints a fresh single-use URL, and a key-validation verdict is a live probe of credentials
	 * the user is editing. Replaying either from a 60-second cache returns a stale answer that reads
	 * like a fresh one.
	 */
	readonly bypassReadCache?: boolean;
}

/**
 * One payload configures the whole trial LLM experience (ADR 0015): the provisioned OpenRouter
 * runtime key, the curated Trial Models list, and the daily spend cap. `models` is ordered by
 * contract — the first entry is the default trial model.
 */
export interface TrialModelKeyPayload {
	readonly key: string;
	readonly models: readonly string[];
	readonly cap: { readonly dailyUsd: number };
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

	/**
	 * Fetches the user's Stripe billing-portal URL from `GET /api/invoices` (an account route on the
	 * backend ROOT, outside the `/v1` patent-tools prefix). Returns the `portalUrl`. Inherits the seam's
	 * typed errors — {@link AuthRequiredError} on `401`, {@link SubscriptionRequiredError} on a gated
	 * `402` — and throws {@link PatentBackendError} when the backend returns no URL.
	 */
	getCustomerPortalUrl(token: CancellationToken): Promise<string>;

	/**
	 * Fetches the Trial Model key and curated model list from `GET /v1/trial/model-key`
	 * (ADR 0015). Throws {@link TrialModelKeyUnavailableError} on the typed `403` (the caller
	 * is not `trialing`); transport failures surface as the seam's usual typed errors
	 * ({@link TransientBackendError}, {@link AuthRequiredError}, …). Never cached: the response
	 * carries a live credential, and a trial that just started must show on the next listing.
	 */
	getTrialModelKey(token: CancellationToken): Promise<TrialModelKeyPayload>;
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

interface TrialDataBudgetInfo {
	readonly message: string;
	readonly provider: 'epo' | 'uspto' | undefined;
	readonly resetsAt: string | undefined;
}

// ── Hardening tunables ───────────────────────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 30_000;
/** Extra attempts after the first for retryable failures (network errors, 5xx, short-Retry-After 429). */
const MAX_RETRIES = 2;
const RETRY_BASE_DELAY_MS = 250;
const RETRY_MAX_DELAY_MS = 4_000;
/** A 429's `Retry-After` is only honored inline (retry) when it is within this budget; longer waits surface a {@link RateLimitError}. */
const RATE_LIMIT_MAX_RETRY_WAIT_MS = 5_000;
/** Short TTL for the per-session read cache — long enough to dedupe a burst of identical tool calls, short enough to stay fresh. */
const CACHE_TTL_MS = 60_000;
const CACHE_MAX_ENTRIES = 100;
/** Internal funnel event: one per public request. Endpoint/method/status only — never request bodies or keys. */
const REQUEST_TELEMETRY_EVENT = 'flowleap.patentBackend.request';
/** Client-identity header the backend logs per `/v1` request (ADR 0014 rule 5). */
const CLIENT_HEADER = 'X-FlowLeap-Client';
/** Product half of the client-identity header value; the version half is the extension's own. */
const CLIENT_PRODUCT = 'vscode';

/** One cached read: the parsed value and the wall-clock time it stops being served. */
interface CacheEntry {
	readonly value: unknown;
	readonly expiresAt: number;
}

/** Per-request telemetry, split into the string dimensions and numeric measures the sink expects. */
interface RequestTelemetry {
	readonly endpoint: string;
	readonly method: 'GET' | 'POST';
	readonly statusClass: string;
	readonly latencyMs: number;
	readonly responseBytes: number;
	readonly retries: number;
	readonly servedFromCache: boolean;
	readonly backendCached: boolean;
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

	/**
	 * Whether the trial-data-budget notifications fired this session (ADR 0017) — one flag for the
	 * exhausted toast, one for the ≥80% warn-band note. The budget is one combined daily number, so
	 * unlike `_dataKeysRequiredPrompted` there is nothing to key by provider; the thrown error (and
	 * the envelope warning) still reaches every tool.
	 */
	private _trialBudgetExhaustedPrompted = false;
	private _trialBudgetLowNoted = false;

	/**
	 * Per-session read cache keyed by method+path+body. Patent-data calls are reads (#89), so an
	 * identical repeated call within {@link CACHE_TTL_MS} can be served without re-hitting the backend.
	 * Bounded to {@link CACHE_MAX_ENTRIES} with oldest-first eviction — a dedupe buffer, not a store.
	 *
	 * Calls WITHOUT read semantics opt out via {@link IPatentBackendRequestOptions.bypassReadCache}
	 * and are neither served from here nor stored here.
	 */
	private readonly _cache = new Map<string, CacheEntry>();

	constructor(
		@ILogService private readonly _logService: ILogService,
		@INotificationService private readonly _notificationService: INotificationService,
		@IEnvService private readonly _envService: IEnvService,
		@IFetcherService private readonly _fetcherService: IFetcherService,
		@ITelemetryService private readonly _telemetryService: ITelemetryService,
	) { }

	post<T>(path: string, body: unknown, token: CancellationToken, options?: IPatentBackendRequestOptions): Promise<T> {
		return this._request<T>('POST', path, body, token, options);
	}

	get<T>(pathWithQuery: string, token: CancellationToken, options?: IPatentBackendRequestOptions): Promise<T> {
		return this._request<T>('GET', pathWithQuery, undefined, token, options);
	}

	async getCustomerPortalUrl(token: CancellationToken): Promise<string> {
		// Not a read: Stripe mints a fresh portal URL per call, so a cached one is a dead link.
		const res = await this.get<{ portalUrl?: string }>('/api/invoices', token, { rootHost: true, bypassReadCache: true });
		if (!res?.portalUrl) {
			throw new PatentBackendError(undefined, 'The FlowLeap backend did not return a customer portal URL.');
		}
		return res.portalUrl;
	}

	async getTrialModelKey(token: CancellationToken): Promise<TrialModelKeyPayload> {
		const res = await this.get<{ key?: unknown; models?: unknown; cap?: { dailyUsd?: unknown } }>('/trial/model-key', token, { bypassReadCache: true });
		const key = typeof res?.key === 'string' && res.key.length > 0 ? res.key : undefined;
		const models = Array.isArray(res?.models) ? res.models.filter((m): m is string => typeof m === 'string' && m.length > 0) : [];
		if (!key || models.length === 0) {
			throw new PatentBackendError(undefined, 'The FlowLeap backend returned an invalid Trial Model key payload.');
		}
		return {
			key,
			models,
			cap: { dailyUsd: typeof res.cap?.dailyUsd === 'number' ? res.cap.dailyUsd : 0 },
		};
	}

	/**
	 * Internal implementation for all HTTP requests to the FlowLeap backend. Orchestrates the
	 * per-session read cache, retry-with-backoff, the centralized `401`/`402`/`400`/`429` gating, and
	 * one telemetry event per public request. The single network attempt lives in {@link _attempt}.
	 */
	private async _request<T>(method: 'GET' | 'POST', path: string, body: unknown, token: CancellationToken, options?: IPatentBackendRequestOptions): Promise<T> {
		const startedAt = Date.now();
		const endpoint = endpointLabel(path);
		const cacheable = !options?.bypassReadCache;
		const cacheKey = cacheKeyFor(method, path, body);

		const cached = cacheable ? this._cacheGet(cacheKey) : undefined;
		if (cached) {
			this._sendRequestTelemetry({ endpoint, method, statusClass: 'cache', latencyMs: Date.now() - startedAt, responseBytes: 0, retries: 0, servedFromCache: true, backendCached: true });
			return cached.value as T;
		}

		const config = getPatentAIConfig();
		// Account routes (`/api/*`, `/billing/*`) live on the api origin without the `/v1` patent-tools
		// suffix; patent-data routes keep the `/v1` prefix. Same gating/retry/telemetry either way.
		const base = options?.rootHost ? config.apiUrl.replace(/\/v1\/?$/, '') : config.apiUrl;
		const url = `${base}${path}`;
		const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
		// Bearer token comes from the registry seam (FlowLeapAuthenticationProvider registers its accessor there),
		// keeping the request path decoupled from the auth service. Read once so retries reuse it; the client
		// knows whether a token existed *before* the request to disambiguate 401 (see the auth gate below).
		const accessToken = getPatentAccessToken();
		const headers = this._buildHeaders(method, accessToken);

		let statusClass = 'network-error';
		let responseBytes = 0;
		let retries = 0;
		let backendCached = false;
		try {
			const { response, retries: usedRetries, bodyText } = await this._fetchWithRetry(method, url, headers, body, timeoutMs, token);
			retries = usedRetries;
			statusClass = classifyStatus(response.status);

			// The retry loop consumes the body when it has to classify one; the stream is single-read.
			const text = bodyText ?? await response.text();
			responseBytes = byteLength(text);

			if (!response.ok) {
				this._throwForErrorResponse(response, text, accessToken);
			}

			const value = text ? JSON.parse(text) as T : undefined as T;
			backendCached = backendCachedFlag(value);
			this._noteTrialBudgetLowWarning(value);
			if (cacheable) {
				this._cacheSet(cacheKey, value);
			}
			return value;
		} finally {
			this._sendRequestTelemetry({ endpoint, method, statusClass, latencyMs: Date.now() - startedAt, responseBytes, retries, servedFromCache: false, backendCached });
		}
	}

	/**
	 * Build the request headers: JSON content type for POST, the client-version header, the Bearer
	 * token (when one is registered), and the BYO patent-data key headers (#31, ADR 0005) forwarded
	 * per the #30 wire contract. The two providers are independent (EPO-only / USPTO-only are valid).
	 * Never log the key values.
	 */
	private _buildHeaders(method: 'GET' | 'POST', accessToken: string | undefined): Record<string, string> {
		const headers: Record<string, string> = {};
		if (method === 'POST') {
			headers['Content-Type'] = 'application/json';
		}
		// Client identity (backend ADR 0014 rule 5): the backend logs product/version on every /v1
		// request so retirement decisions rest on usage evidence rather than hand counts. Purely
		// observational — no request is ever rejected on it.
		headers[CLIENT_HEADER] = `${CLIENT_PRODUCT}/${this._envService.getVersion()}`;
		if (accessToken) {
			headers['Authorization'] = `Bearer ${accessToken}`;
		}
		const dataKeys = getPatentDataKeys();
		if (dataKeys?.epo) {
			headers[EPO_OPS_KEY_HEADER] = dataKeys.epo.key;
			headers[EPO_OPS_SECRET_HEADER] = dataKeys.epo.secret;
		}
		if (dataKeys?.usptoOdp) {
			headers[USPTO_ODP_KEY_HEADER] = dataKeys.usptoOdp;
		}
		return headers;
	}

	/**
	 * Run {@link _attempt} with exponential backoff (jittered) on the retryable failures every patent
	 * route can safely repeat: network errors, `5xx`, and a `429` whose `Retry-After` is within
	 * {@link RATE_LIMIT_MAX_RETRY_WAIT_MS}. Timeouts and cancellations are NOT retried — they surface as
	 * the same {@link PatentBackendError} messages as before. Returns the final response (which may be a
	 * non-2xx the caller then gates) together with how many retries it took, plus `bodyText` when the
	 * loop already consumed the single-read body to classify it.
	 */
	private async _fetchWithRetry(method: 'GET' | 'POST', url: string, headers: Record<string, string>, body: unknown, timeoutMs: number, token: CancellationToken): Promise<{ response: Response; retries: number; bodyText?: string }> {
		let attempt = 0;
		for (; ;) {
			let response: Response;
			try {
				response = await this._attempt(method, url, headers, body, timeoutMs, token);
			} catch (err) {
				// A timeout (enforced by the fetcher) and a cancellation (our abort) both surface as abort
				// errors; disambiguate via the token to preserve the original messages, and never retry them.
				if (this._fetcherService.isAbortError(err)) {
					if (token.isCancellationRequested) {
						throw new PatentBackendError(undefined, 'Request cancelled.');
					}
					// A timeout is transient (the backend is slow/unreachable right now), so it earns the
					// same "wait and retry" steer as a 5xx. Message keeps "timed out" for the log/UX.
					throw new TransientBackendError(`Request timed out after ${timeoutMs} ms.`, undefined);
				}
				// A genuine network error is transient — retry it while budget remains.
				if (attempt < MAX_RETRIES && !token.isCancellationRequested) {
					this._logService.debug(`[PatentBackendClient] network error on ${url}; retry ${attempt + 1}/${MAX_RETRIES}`);
					await this._backoffDelay(attempt, token);
					attempt++;
					continue;
				}
				throw err;
			}

			// A short `Retry-After` on a 429 is honored inline: wait it out and retry once more.
			if (response.status === 429) {
				const retryAfterMs = parseRetryAfterMs(response);
				if (retryAfterMs !== undefined && retryAfterMs <= RATE_LIMIT_MAX_RETRY_WAIT_MS && attempt < MAX_RETRIES) {
					void response.body.destroy().catch(() => { /* discarded body */ });
					this._logService.debug(`[PatentBackendClient] 429 on ${url}; honoring Retry-After ${retryAfterMs} ms (retry ${attempt + 1}/${MAX_RETRIES})`);
					await this._delay(retryAfterMs, token);
					attempt++;
					continue;
				}
				return { response, retries: attempt };
			}

			// `5xx` is retryable — the read can be safely repeated. One exception: a `503` may be the
			// USPTO key gate (`odp_api_key_missing`), which is a permanent verdict wearing a transient
			// status, so retrying it only delays the prompt the user needs. Peek that one body instead
			// of discarding it and stop early on a match; the body is single-read, so the peeked text
			// is threaded back for the caller to reuse.
			if (response.status >= 500 && response.status <= 599 && attempt < MAX_RETRIES) {
				if (response.status === 503) {
					const bodyText = await response.text();
					if (parseOdpKeyMissing(bodyText)) {
						return { response, retries: attempt, bodyText };
					}
				} else {
					response.body.destroy();
				}
				this._logService.debug(`[PatentBackendClient] ${response.status} on ${url}; retry ${attempt + 1}/${MAX_RETRIES}`);
				await this._backoffDelay(attempt, token);
				attempt++;
				continue;
			}

			return { response, retries: attempt };
		}
	}

	/**
	 * A single network attempt: wires the {@link CancellationToken} to an abort controller (so a
	 * cancelled request aborts the in-flight fetch) and delegates the native timeout to the fetcher.
	 * Throws the fetcher's raw error (including abort errors) for {@link _fetchWithRetry} to classify.
	 */
	private async _attempt(method: 'GET' | 'POST', url: string, headers: Record<string, string>, body: unknown, timeoutMs: number, token: CancellationToken): Promise<Response> {
		const abort = this._fetcherService.makeAbortController();
		const cancelSub = token.onCancellationRequested(() => abort.abort());
		try {
			this._logService.debug(`[PatentBackendClient] ${method} ${url}`);
			const response = await this._fetcherService.fetch(url, {
				callSite: 'patentBackendClient',
				method,
				headers,
				body: method === 'POST' ? JSON.stringify(body) : undefined,
				timeout: timeoutMs,
				signal: abort.signal,
			});
			this._logService.debug(`[PatentBackendClient] ${response.status} ${url} (${response.headers.get('content-length') ?? '?'} bytes)`);
			return response;
		} finally {
			cancelSub.dispose();
		}
	}

	/**
	 * Apply the centralized error gating for a non-2xx response — `402` subscription, `400` data-key,
	 * `401` auth, and `429` rate-limit — always throwing. Preserves the exact typed errors and
	 * notification UX every tool already depends on; only the `429` branch is new (#89).
	 */
	private _throwForErrorResponse(response: Response, text: string, accessToken: string | undefined): never {
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

		// Trial-model-key gate: `403 trial_model_key_unavailable` (ADR 0015) is a first-class
		// typed outcome — the caller is not `trialing`. The trial provider maps it to "hide the
		// provider, steer to BYO-key" itself; no notification here, since the fetch runs silently
		// in the background on every model listing.
		if (response.status === 403) {
			const info = parseTrialModelKeyUnavailable(text);
			if (info) {
				throw new TrialModelKeyUnavailableError(info.message, info.reason);
			}
		}

		// Trial-data-budget gate (ADR 0017): checked by CODE before the generic 429 mapping, so a
		// spent daily budget is never surfaced as "slow down" — waiting minutes will not clear it
		// (its Retry-After runs to the next UTC day, past the inline-retry budget by construction).
		// Joins the data-keys notification family: the durable fix is the user's own free keys.
		if (response.status === 429) {
			const budget = parseTrialDataBudgetExhausted(text);
			if (budget) {
				this._fireTrialBudgetExhaustedUx(budget);
				const retryAfterMs = parseRetryAfterMs(response);
				throw new TrialDataBudgetExhaustedError(
					budget.message,
					budget.provider,
					budget.resetsAt,
					retryAfterMs !== undefined ? Math.ceil(retryAfterMs / 1000) : undefined,
				);
			}
		}

		// Rate-limit gate: a `429` that survived the inline Retry-After retry (too long a wait, or
		// budget exhausted). Surface a distinct, clear "wait and retry" error carrying the server hint.
		if (response.status === 429) {
			const retryAfterMs = parseRetryAfterMs(response);
			const retryAfterSeconds = retryAfterMs !== undefined ? Math.ceil(retryAfterMs / 1000) : undefined;
			throw new RateLimitError(rateLimitMessage(text, retryAfterSeconds), retryAfterSeconds);
		}

		// The one `5xx` that is NOT transient: the ODP client answers `503 odp_api_key_missing` when
		// no USPTO ODP key reached it (server-side or forwarded). Waiting will never clear it — the
		// user has to add a key — so it joins the `data_keys_required` gate rather than the transient
		// path, and inherits its deep link into the USPTO card. The code names the office itself, so
		// the backend sends no `provider` field.
		if (response.status === 503) {
			const odpKeyMissing = parseOdpKeyMissing(text);
			if (odpKeyMissing) {
				this._fireDataKeysRequiredUx(odpKeyMissing);
				throw new DataKeysRequiredError(odpKeyMissing.message, 'uspto', 503);
			}
		}

		// Transient gate: a `5xx` (incl. gateway `502`/`503`/`504`) that survived the client's retry
		// budget. The raw body is often an nginx HTML error page or an upstream stack fragment — noise
		// that reads as a permanent dead end — so surface only a short, body-free status line and let
		// the recovery hint say "transient, wait and retry."
		if (response.status >= 500 && response.status <= 599) {
			throw new TransientBackendError(transientStatusLine(response.status), response.status);
		}

		const truncated = text.length > 500 ? text.substring(0, 500) + '…' : text;
		throw new PatentBackendError(response.status, truncated);
	}

	// ── Retry timing ────────────────────────────────────────────────────────────

	/** Exponential backoff (base doubles per attempt, capped) with full jitter, cancellation-aware. */
	private _backoffDelay(attempt: number, token: CancellationToken): Promise<void> {
		const capped = Math.min(RETRY_MAX_DELAY_MS, RETRY_BASE_DELAY_MS * 2 ** attempt);
		const jittered = capped / 2 + Math.random() * (capped / 2);
		return this._delay(jittered, token);
	}

	/** Resolve after `ms`, or reject with the cancellation {@link PatentBackendError} if the token fires first. */
	private _delay(ms: number, token: CancellationToken): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			if (token.isCancellationRequested) {
				reject(new PatentBackendError(undefined, 'Request cancelled.'));
				return;
			}
			const timer = setTimeout(() => {
				sub.dispose();
				resolve();
			}, ms);
			const sub = token.onCancellationRequested(() => {
				clearTimeout(timer);
				reject(new PatentBackendError(undefined, 'Request cancelled.'));
			});
		});
	}

	// ── Session read cache ──────────────────────────────────────────────────────

	/** Return a live (non-expired) cache entry, pruning it if the TTL has passed. */
	private _cacheGet(key: string): CacheEntry | undefined {
		const entry = this._cache.get(key);
		if (!entry) {
			return undefined;
		}
		if (entry.expiresAt <= Date.now()) {
			this._cache.delete(key);
			return undefined;
		}
		return entry;
	}

	/** Store a successful read, evicting the oldest entry when the bound is reached (Map keeps insertion order). */
	private _cacheSet(key: string, value: unknown): void {
		if (this._cache.size >= CACHE_MAX_ENTRIES && !this._cache.has(key)) {
			const oldest = this._cache.keys().next().value;
			if (oldest !== undefined) {
				this._cache.delete(oldest);
			}
		}
		this._cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
	}

	// ── Telemetry ───────────────────────────────────────────────────────────────

	/** Emit the single per-request funnel event: endpoint/method/status dimensions, latency/size measures. */
	private _sendRequestTelemetry(t: RequestTelemetry): void {
		this._telemetryService.sendInternalMSFTTelemetryEvent(
			REQUEST_TELEMETRY_EVENT,
			{ endpoint: t.endpoint, method: t.method, statusClass: t.statusClass },
			{
				latencyMs: t.latencyMs,
				responseBytes: t.responseBytes,
				retries: t.retries,
				servedFromCache: t.servedFromCache ? 1 : 0,
				backendCached: t.backendCached ? 1 : 0,
			},
		);
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

	/**
	 * Show the "trial data budget used up" prompt (ADR 0017), opening the keys UI when accepted.
	 * Once per session and fire-and-forget, so it never masks the
	 * {@link TrialDataBudgetExhaustedError}.
	 */
	private _fireTrialBudgetExhaustedUx(info: TrialDataBudgetInfo): void {
		if (this._trialBudgetExhaustedPrompted) {
			return;
		}
		this._trialBudgetExhaustedPrompted = true;
		this._promptTrialBudgetExhausted(info).catch(err => this._logService.warn(`[PatentBackendClient] trial-budget prompt failed: ${err}`));
	}

	private async _promptTrialBudgetExhausted(info: TrialDataBudgetInfo): Promise<void> {
		const addKeysAction = l10n.t('Add Patent Data Keys');
		const choice = await this._notificationService.showWarningMessage(info.message, addKeysAction);
		if (choice === addKeysAction) {
			// Forward the provider that hit the wall so the keys UI focuses that card (an
			// unknown/undefined provider harmlessly opens the keys view unfocused).
			await vscode.commands.executeCommand('flowleap.patentDataKeys', info.provider);
		}
	}

	/**
	 * ADR 0017 warn-band: once ≥80% of today's shared trial data budget is spent, SUCCESS envelopes
	 * carry a `trial_data_budget_low` warning (`remaining`, `resets_at`). Surface it once per session
	 * as an info toast with the keys deep link — the wall never arrives unannounced — and log every
	 * occurrence. Never blocks or alters the response the tool receives.
	 */
	private _noteTrialBudgetLowWarning(value: unknown): void {
		const warnings = (value as { warnings?: unknown })?.warnings;
		if (!Array.isArray(warnings)) {
			return;
		}
		const low = warnings.find(w => (w as { code?: string })?.code === 'trial_data_budget_low') as
			| { message?: string; remaining?: number; resets_at?: string }
			| undefined;
		if (!low) {
			return;
		}
		const message = typeof low.message === 'string' && low.message
			? low.message
			: l10n.t('Your shared trial data budget is almost used up for today. Add your own free EPO/USPTO keys for unlimited access.');
		this._logService.info(`[PatentBackendClient] trial_data_budget_low: remaining=${low.remaining ?? '?'} resets_at=${low.resets_at ?? '?'}`);
		if (this._trialBudgetLowNoted) {
			return;
		}
		this._trialBudgetLowNoted = true;
		(async () => {
			const addKeysAction = l10n.t('Add Patent Data Keys');
			const choice = await this._notificationService.showInformationMessage(message, addKeysAction);
			if (choice === addKeysAction) {
				await vscode.commands.executeCommand('flowleap.patentDataKeys');
			}
		})().catch(err => this._logService.warn(`[PatentBackendClient] trial-budget-low note failed: ${err}`));
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

// ── Request-shaping helpers ───────────────────────────────────────────────────────

/** Coarse endpoint label for telemetry: the first path segment, query stripped (low cardinality, no IDs beyond the route). */
function endpointLabel(path: string): string {
	const query = path.indexOf('?');
	const clean = query >= 0 ? path.slice(0, query) : path;
	return clean.split('/').filter(Boolean)[0] ?? '';
}

/** Cache key for a read: method + path + serialized body (identical inputs → identical key). */
function cacheKeyFor(method: 'GET' | 'POST', path: string, body: unknown): string {
	return body === undefined ? `${method} ${path}` : `${method} ${path} ${JSON.stringify(body)}`;
}

/** Bucket an HTTP status for telemetry: `429` kept distinct, everything else by hundreds (`2xx`, `4xx`, `5xx`). */
function classifyStatus(status: number): string {
	return status === 429 ? '429' : `${Math.floor(status / 100)}xx`;
}

/** UTF-8 byte length of a response body (measured, not the maybe-absent `content-length` header). */
function byteLength(text: string): number {
	return new TextEncoder().encode(text).length;
}

/**
 * True when the backend marked this response as served from its own cache. The flag lives at the top
 * level of the facade envelope (`{ success, tool, data, executionTimeMs, cached }`) and is omitted
 * rather than falsified when the backend has no verdict, so an absent flag reads as "not cached".
 */
function backendCachedFlag(value: unknown): boolean {
	return typeof value === 'object' && value !== null && (value as { cached?: unknown }).cached === true;
}

/**
 * Parse a `Retry-After` header into milliseconds. Supports both forms: an integer delta-seconds and an
 * HTTP date. Returns `undefined` when absent or unparseable (never negative).
 */
function parseRetryAfterMs(response: Response): number | undefined {
	const raw = response.headers.get('retry-after');
	if (!raw) {
		return undefined;
	}
	const seconds = Number(raw.trim());
	if (Number.isFinite(seconds)) {
		return Math.max(0, seconds * 1000);
	}
	const dateMs = Date.parse(raw);
	if (!Number.isNaN(dateMs)) {
		return Math.max(0, dateMs - Date.now());
	}
	return undefined;
}

/** Clean, user-facing rate-limit message: the backend's own message when present, else a clear fallback with the wait hint. */
function rateLimitMessage(body: string, retryAfterSeconds: number | undefined): string {
	try {
		const parsed = JSON.parse(body) as { error?: { message?: string } };
		if (parsed?.error?.message) {
			return parsed.error.message;
		}
	} catch {
		// Not JSON — fall through to the default message.
	}
	return retryAfterSeconds
		? `The FlowLeap backend is rate-limiting requests. Please wait ${retryAfterSeconds} seconds and try again.`
		: 'The FlowLeap backend is rate-limiting requests. Please wait a few seconds and try again.';
}

/** Human-readable labels for the transient statuses we surface — keeps the model-facing line body-free. */
const TRANSIENT_STATUS_LABELS: Record<number, string> = {
	500: 'Internal Server Error',
	502: 'Bad Gateway',
	503: 'Service Unavailable',
	504: 'Gateway Timeout',
};

/**
 * One-line, body-free status summary for a transient `5xx`. Deliberately does NOT include the raw
 * response body: gateway errors arrive as nginx HTML pages or upstream stack fragments, which are
 * noise to the model and read as a permanent failure. The recovery hint carries the "retry" steer.
 */
function transientStatusLine(status: number): string {
	const label = TRANSIENT_STATUS_LABELS[status] ?? 'Server error';
	return `The patent backend returned HTTP ${status} (${label}).`;
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

/** Parse a `429` body, returning trial-budget info only when it matches the ADR 0017 contract. */
function parseTrialDataBudgetExhausted(body: string): TrialDataBudgetInfo | undefined {
	try {
		const parsed = JSON.parse(body) as { error?: { code?: string; message?: string; provider?: string; resets_at?: string } };
		const error = parsed?.error;
		if (error?.code !== 'trial_data_budget_exhausted') {
			return undefined;
		}
		const provider = error.provider === 'epo' || error.provider === 'uspto' ? error.provider : undefined;
		return {
			message: error.message || l10n.t('Today\'s shared trial data budget is used up. Add your own free EPO/USPTO keys for unlimited access.'),
			provider,
			resetsAt: typeof error.resets_at === 'string' ? error.resets_at : undefined,
		};
	} catch {
		// Not JSON — let the caller fall through to the generic rate-limit gate.
		return undefined;
	}
}

/**
 * Parse a `503` body, returning the USPTO key-gate info only when it carries the ODP taxonomy's
 * `odp_api_key_missing` code. The backend's own message names an env var (`Set USPTO_ODP_API_KEY…`),
 * which is server-operator language, so the user-facing message is always ours.
 */
function parseOdpKeyMissing(body: string): DataKeysRequiredInfo | undefined {
	try {
		const parsed = JSON.parse(body) as { error?: { code?: string } };
		if (parsed?.error?.code !== 'odp_api_key_missing') {
			return undefined;
		}
		return {
			message: l10n.t('US patent data needs your own USPTO ODP key. Add it to continue.'),
			provider: 'uspto',
		};
	} catch {
		// Not JSON (a gateway HTML page) — let the caller fall through to the transient gate.
		return undefined;
	}
}

/** Parse a `403` body, returning trial-key-unavailable info only when it matches the ADR 0015 contract. */
function parseTrialModelKeyUnavailable(body: string): { message: string; reason: string | undefined } | undefined {
	try {
		const parsed = JSON.parse(body) as { error?: { code?: string; message?: string; reason?: string } };
		const error = parsed?.error;
		if (error?.code !== 'trial_model_key_unavailable') {
			return undefined;
		}
		return {
			message: error.message || l10n.t('Trial Models serve the trial window only — add your own LLM provider key to continue.'),
			reason: typeof error.reason === 'string' ? error.reason : undefined,
		};
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
