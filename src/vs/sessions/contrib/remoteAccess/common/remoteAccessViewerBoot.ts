/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// The pure part of the Remote Access Viewer boot page (PRD 0018 B4,
// docs/remote-access/RELAY-CONTRACT.md section 5 and section 8,
// docs/remote-access/VIEWER.md): the page configuration, the build pick, the
// pair list and the Pairing claim. No DOM, so it runs in unit tests.
//
// Site layout (remote.flowleap.co):
//   /index.html       the boot page, the same for every build
//   /loader.js        picks the build folder and loads its boot script
//   /config.json      { clerkPublishableKey, apiBaseUrl } (not in any build)
//   /versions.json    { latest, versions: [newest first] } (kept builds)
//   /<version>/       one Viewer build: boot.js, out/, node_modules/

import { localize } from '../../../../nls.js';
import { computePairingProof, derivePairKey, IRemoteAccessPairingCode, isUuid, parsePairingCode } from '../../../../platform/agentHost/common/remoteAccessCrypto.js';

// ---- Configuration -------------------------------------------------------------------

export interface IRemoteAccessViewerConfig {
	/** The Clerk publishable key of the FlowLeap Clerk instance. Absent only with {@link devToken}. */
	readonly clerkPublishableKey?: string;
	/** `https://api.flowleap.co` */
	readonly apiBaseUrl: string;
	/** The Relay's Viewer socket. Derived from {@link apiBaseUrl} when absent. */
	readonly relayUrl: string;
	/**
	 * Local development only: a fixed token instead of a Clerk sign-in, for a
	 * backend that runs with `SKIP_AUTH=true`. Ignored unless the page runs on
	 * localhost or 127.0.0.1.
	 */
	readonly devToken?: string;
}

/** `https://api.flowleap.co` → `wss://api.flowleap.co/v1/remote-access/viewer` */
export function relayViewerUrl(apiBaseUrl: string): string {
	const url = new URL('/v1/remote-access/viewer', apiBaseUrl);
	url.protocol = url.protocol === 'http:' ? 'ws:' : 'wss:';
	return url.toString();
}

function isLocalHostname(hostname: string): boolean {
	return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

/** Reads `config.json`. `undefined` when it is not usable. */
export function parseViewerConfig(value: unknown, pageHostname: string): IRemoteAccessViewerConfig | undefined {
	if (typeof value !== 'object' || value === null) {
		return undefined;
	}
	const raw = value as { clerkPublishableKey?: unknown; apiBaseUrl?: unknown; relayUrl?: unknown; devToken?: unknown };
	if (typeof raw.apiBaseUrl !== 'string' || !/^https?:\/\//.test(raw.apiBaseUrl)) {
		return undefined;
	}
	const devToken = typeof raw.devToken === 'string' && raw.devToken && isLocalHostname(pageHostname) ? raw.devToken : undefined;
	const clerkPublishableKey = typeof raw.clerkPublishableKey === 'string' && /^pk_(test|live)_/.test(raw.clerkPublishableKey) ? raw.clerkPublishableKey : undefined;
	if (!clerkPublishableKey && !devToken) {
		return undefined;
	}
	const apiBaseUrl = raw.apiBaseUrl.replace(/\/+$/, '');
	const relayUrl = typeof raw.relayUrl === 'string' && /^wss?:\/\//.test(raw.relayUrl) ? raw.relayUrl : relayViewerUrl(apiBaseUrl);
	return { clerkPublishableKey, apiBaseUrl, relayUrl, devToken };
}

/** The Clerk Frontend API host encoded in a publishable key (`pk_live_<base64("clerk.flowleap.co$")>`). */
export function clerkFrontendApiFromPublishableKey(publishableKey: string): string | undefined {
	const encoded = publishableKey.split('_')[2];
	if (!encoded) {
		return undefined;
	}
	let decoded: string;
	try {
		decoded = atob(encoded);
	} catch {
		return undefined;
	}
	if (!decoded.endsWith('$')) {
		return undefined;
	}
	const host = decoded.slice(0, -1);
	return /^[a-z0-9.-]+$/i.test(host) ? host : undefined;
}

// ---- Builds --------------------------------------------------------------------------

export interface IRemoteAccessViewerBuilds {
	readonly latest: string;
	/** Kept builds, newest first. */
	readonly versions: readonly string[];
}

const VERSION_PATTERN = /^[0-9A-Za-z][0-9A-Za-z.+-]{0,63}$/;

/** Reads `versions.json`. */
export function parseViewerBuilds(value: unknown): IRemoteAccessViewerBuilds | undefined {
	if (typeof value !== 'object' || value === null) {
		return undefined;
	}
	const raw = value as { latest?: unknown; versions?: unknown };
	if (!Array.isArray(raw.versions)) {
		return undefined;
	}
	const versions = raw.versions.filter((v): v is string => typeof v === 'string' && VERSION_PATTERN.test(v));
	const latest = typeof raw.latest === 'string' && versions.includes(raw.latest) ? raw.latest : versions[0];
	return latest ? { latest, versions } : undefined;
}

/**
 * The build folder the page loads: the first path segment when it names a kept
 * build (`/0.9.0/`), else the newest build (`/`, `/pair`, an old link).
 */
export function pickLoadedBuild(pathname: string, builds: IRemoteAccessViewerBuilds): string {
	const first = pathname.split('/').filter(Boolean)[0];
	return first && builds.versions.includes(first) ? first : builds.latest;
}

export const enum ViewerBuildPick {
	/** The loaded build matches the Host, or the Host's version is not known yet. */
	Stay = 'stay',
	/** Another kept build matches the Host: reload into it. */
	Switch = 'switch',
	/** No kept build matches the Host. Stay, and tell the user. */
	Missing = 'missing',
}

/** Section 8: after `welcome`, reload into the Host's version when the loaded build differs. */
export function pickBuildForHost(loaded: string, hostAppVersion: string | undefined, builds: IRemoteAccessViewerBuilds): { readonly pick: ViewerBuildPick; readonly version: string } {
	if (!hostAppVersion || hostAppVersion === loaded) {
		return { pick: ViewerBuildPick.Stay, version: loaded };
	}
	if (builds.versions.includes(hostAppVersion)) {
		return { pick: ViewerBuildPick.Switch, version: hostAppVersion };
	}
	return { pick: ViewerBuildPick.Missing, version: hostAppVersion };
}

/** The pairing code in a `/pair#<pairId>.<secret>` link (the QR code). `undefined` on other pages. */
export function pairingCodeFromLocation(pathname: string, hash: string): IRemoteAccessPairingCode | undefined {
	if (!/\/pair\/?$/.test(pathname) || !hash) {
		return undefined;
	}
	return parsePairingCode(hash.replace(/^#/, ''));
}

// ---- Pairs ---------------------------------------------------------------------------

export interface IRemoteAccessPairView {
	readonly pairId: string;
	readonly hostId: string;
	readonly hostLabel: string;
	readonly viewerLabel: string | null;
	readonly state: 'offered' | 'paired';
	readonly createdAt: string;
	readonly lastSeenAt: string | null;
}

/** Reads `GET /v1/remote-access/pairs`. Drops rows that are not pairs. */
export function parsePairList(value: unknown): IRemoteAccessPairView[] {
	const pairs = (value as { pairs?: unknown } | null)?.pairs;
	if (!Array.isArray(pairs)) {
		return [];
	}
	const result: IRemoteAccessPairView[] = [];
	for (const item of pairs) {
		const row = item as Partial<Record<keyof IRemoteAccessPairView, unknown>>;
		if (typeof row?.pairId !== 'string' || !isUuid(row.pairId) || typeof row.hostId !== 'string' || !isUuid(row.hostId)
			|| typeof row.hostLabel !== 'string' || (row.state !== 'offered' && row.state !== 'paired')) {
			continue;
		}
		result.push({
			pairId: row.pairId.toLowerCase(),
			hostId: row.hostId.toLowerCase(),
			hostLabel: row.hostLabel,
			viewerLabel: typeof row.viewerLabel === 'string' ? row.viewerLabel : null,
			state: row.state,
			createdAt: typeof row.createdAt === 'string' ? row.createdAt : '',
			lastSeenAt: typeof row.lastSeenAt === 'string' ? row.lastSeenAt : null,
		});
	}
	return result;
}

/** How a pair row shows on this device. */
export const enum ViewerPairStatus {
	/** Paired, and this browser holds the pair key: the Viewer can follow it. */
	Ready = 'ready',
	/** Paired from another browser or device: this browser has no key. */
	OtherDevice = 'otherDevice',
	/** The Host offered it; nobody has claimed it yet. */
	Offered = 'offered',
}

export function viewerPairStatus(pair: IRemoteAccessPairView, keyIsHere: boolean): ViewerPairStatus {
	if (pair.state === 'offered') {
		return ViewerPairStatus.Offered;
	}
	return keyIsHere ? ViewerPairStatus.Ready : ViewerPairStatus.OtherDevice;
}

/** A short name for this device, sent as the `viewerLabel` (the Host's Manage Viewers list shows it). */
export function defaultViewerLabel(userAgent: string): string {
	if (/iPad/.test(userAgent)) {
		return 'iPad';
	}
	if (/iPhone/.test(userAgent)) {
		return 'iPhone';
	}
	if (/Android/.test(userAgent)) {
		return /Mobile/.test(userAgent) ? 'Android phone' : 'Android tablet';
	}
	if (/Macintosh/.test(userAgent)) {
		return 'Mac browser';
	}
	if (/Windows/.test(userAgent)) {
		return 'Windows browser';
	}
	if (/Linux/.test(userAgent)) {
		return 'Linux browser';
	}
	return 'Browser';
}

// ---- REST ----------------------------------------------------------------------------

/** The `fetch` subset the boot page uses, so tests can answer without a network. */
export type ViewerFetch = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<{ status: number; json(): Promise<unknown> }>;

export const enum ViewerApiErrorKind {
	SignInRequired = 'signInRequired',
	SubscriptionRequired = 'subscriptionRequired',
	/** The pair does not exist for this account: expired offer, removed, or another account. */
	PairNotFound = 'pairNotFound',
	AlreadyClaimed = 'alreadyClaimed',
	/** The pairing code does not match. `attemptsLeft` is 0 when the Relay removed the offer. */
	CodeMismatch = 'codeMismatch',
	/** Remote Access is switched off on the backend (404 `endpoint_not_found`). */
	NotEnabled = 'notEnabled',
	Network = 'network',
	Other = 'other',
}

export class ViewerApiError extends Error {
	constructor(readonly kind: ViewerApiErrorKind, message: string, readonly attemptsLeft?: number) {
		super(message);
		this.name = 'ViewerApiError';
	}
}

/** The localized sentence for a failed pair call. */
export function viewerApiErrorMessage(kind: ViewerApiErrorKind, attemptsLeft?: number): string {
	switch (kind) {
		case ViewerApiErrorKind.SignInRequired:
			return localize('remoteAccessViewer.api.signIn', "Your FlowLeap sign-in is not valid for Remote Access. Sign in again.");
		case ViewerApiErrorKind.SubscriptionRequired:
			return localize('remoteAccessViewer.api.subscription', "Remote Access needs an active FlowLeap subscription or trial.");
		case ViewerApiErrorKind.PairNotFound:
			return localize('remoteAccessViewer.api.notFound', "This pairing code is not valid for your account. It may have expired (codes last 10 minutes). Pair again on the Host.");
		case ViewerApiErrorKind.AlreadyClaimed:
			return localize('remoteAccessViewer.api.claimed', "This pairing code was already used. Pair again on the Host to add this Viewer.");
		case ViewerApiErrorKind.CodeMismatch:
			return attemptsLeft === 0
				? localize('remoteAccessViewer.api.mismatchRevoked', "The pairing code does not match, and the Host's offer was removed. Pair again on the Host.")
				: localize('remoteAccessViewer.api.mismatch', "The pairing code does not match. Check the code and try again.");
		case ViewerApiErrorKind.NotEnabled:
			return localize('remoteAccessViewer.api.notEnabled', "Remote Access is not available yet.");
		case ViewerApiErrorKind.Network:
			return localize('remoteAccessViewer.api.network', "Cannot reach FlowLeap. Check the network connection and try again.");
		default:
			return localize('remoteAccessViewer.api.other', "Something went wrong on the FlowLeap server. Try again.");
	}
}

function errorKindForStatus(status: number, path: 'list' | 'claim' | 'remove'): ViewerApiErrorKind {
	switch (status) {
		case 401:
			return ViewerApiErrorKind.SignInRequired;
		case 402:
			return ViewerApiErrorKind.SubscriptionRequired;
		case 403:
			return path === 'claim' ? ViewerApiErrorKind.CodeMismatch : ViewerApiErrorKind.SignInRequired;
		case 404:
			return path === 'list' ? ViewerApiErrorKind.NotEnabled : ViewerApiErrorKind.PairNotFound;
		case 409:
			return ViewerApiErrorKind.AlreadyClaimed;
		default:
			return ViewerApiErrorKind.Other;
	}
}

/** The pair-management REST calls the Viewer makes (contract section 5). */
export class RemoteAccessViewerApi {

	constructor(
		private readonly _apiBaseUrl: string,
		private readonly _getToken: () => Promise<string>,
		private readonly _fetch: ViewerFetch,
	) { }

	private async _call(method: string, path: string, kind: 'list' | 'claim' | 'remove', body?: object): Promise<unknown> {
		const token = await this._getToken();
		let response: { status: number; json(): Promise<unknown> };
		try {
			response = await this._fetch(`${this._apiBaseUrl}${path}`, {
				method,
				headers: { 'Authorization': `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
				body: body ? JSON.stringify(body) : undefined,
			});
		} catch {
			throw new ViewerApiError(ViewerApiErrorKind.Network, viewerApiErrorMessage(ViewerApiErrorKind.Network));
		}
		if (response.status === 204) {
			return undefined;
		}
		if (response.status >= 200 && response.status < 300) {
			return response.json();
		}
		const errorKind = errorKindForStatus(response.status, kind);
		let attemptsLeft: number | undefined;
		if (errorKind === ViewerApiErrorKind.CodeMismatch) {
			const errorBody = await response.json().catch(() => undefined) as { error?: { attemptsLeft?: unknown } } | undefined;
			attemptsLeft = typeof errorBody?.error?.attemptsLeft === 'number' ? errorBody.error.attemptsLeft : undefined;
		}
		throw new ViewerApiError(errorKind, viewerApiErrorMessage(errorKind, attemptsLeft), attemptsLeft);
	}

	async listPairs(): Promise<IRemoteAccessPairView[]> {
		return parsePairList(await this._call('GET', '/v1/remote-access/pairs', 'list'));
	}

	async claim(pairId: string, viewerLabel: string, proof: string): Promise<void> {
		await this._call('POST', `/v1/remote-access/pairs/${encodeURIComponent(pairId)}/claim`, 'claim', { viewerLabel, proof });
	}

	/** Removes a pair on the Relay (contract section 5, Lifetime). The Host's key stops working at once. */
	async remove(pairId: string): Promise<void> {
		await this._call('DELETE', `/v1/remote-access/pairs/${encodeURIComponent(pairId)}`, 'remove');
	}
}

export interface IClaimedPair {
	readonly pairId: string;
	readonly hostLabel: string;
	/** The 32-byte pair key. The pair secret is not kept. */
	readonly pairKey: Uint8Array;
}

/**
 * Section 5 steps 3 and 4: find the offer's Host in the caller's pair list
 * (the proof is keyed by `hostId`), claim it with
 * `HMAC-SHA256(pairSecret, hostId)`, then derive the pair key.
 */
export async function claimPairing(api: RemoteAccessViewerApi, code: IRemoteAccessPairingCode, viewerLabel: string): Promise<IClaimedPair> {
	const pairs = await api.listPairs();
	const offer = pairs.find(pair => pair.pairId === code.pairId);
	if (!offer) {
		throw new ViewerApiError(ViewerApiErrorKind.PairNotFound, viewerApiErrorMessage(ViewerApiErrorKind.PairNotFound));
	}
	if (offer.state === 'paired') {
		throw new ViewerApiError(ViewerApiErrorKind.AlreadyClaimed, viewerApiErrorMessage(ViewerApiErrorKind.AlreadyClaimed));
	}
	const proof = await computePairingProof(code.pairSecret, offer.hostId);
	await api.claim(code.pairId, viewerLabel, proof);
	const pairKey = await derivePairKey(code.pairSecret, code.pairId);
	return { pairId: code.pairId, hostLabel: offer.hostLabel, pairKey };
}
