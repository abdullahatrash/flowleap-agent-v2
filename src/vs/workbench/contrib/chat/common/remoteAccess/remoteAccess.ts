/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Remote Access on the Host (PRD 0018 B3; docs/remote-access/RELAY-CONTRACT.md section 5).
// Vocabulary from CONTEXT.md → Remote Access: Host, Viewer, Pairing, Relay.
// This service is reachable from the editor window and the Agents Window, so
// editor-chat publishing (slice C) can follow the same switch.

import { IObservable } from '../../../../../base/common/observable.js';
import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';
import { RawContextKey } from '../../../../../platform/contextkey/common/contextkey.js';
import { IRemoteAccessHostStatus } from '../../../../../platform/agentHost/common/remoteAccessHost.js';

export const enum RemoteAccessSettingId {
	/** The Relay's Host socket. The pair management REST URL derives from it. */
	RelayUrl = 'flowleap.remoteAccess.relayUrl',
	/** Keep this computer awake while Remote Access is on and an Agent Session runs. */
	KeepAwake = 'flowleap.remoteAccess.keepAwake',
}

export const REMOTE_ACCESS_DEFAULT_RELAY_URL = 'wss://api.flowleap.co/v1/remote-access/host';

/** Machine-local (application scope, machine target) storage keys. */
export const enum RemoteAccessStorageKey {
	Enabled = 'flowleap.remoteAccess.enabled',
	HostId = 'flowleap.remoteAccess.hostId',
	Pairs = 'flowleap.remoteAccess.pairs',
	PairKeyIds = 'flowleap.remoteAccess.pairKeyIds',
}

/** Secret storage key prefix for a pair key; the pair id follows. */
export const REMOTE_ACCESS_PAIR_KEY_SECRET_PREFIX = 'flowleap.remoteAccess.pairKey.';

export const FLOWLEAP_AUTHENTICATION_PROVIDER_ID = 'flowleap';

/** How long the Relay keeps an unclaimed Pairing offer (section 5 step 1). */
export const REMOTE_ACCESS_OFFER_TTL_MS = 10 * 60 * 1000;

export const RemoteAccessEnabledContext = new RawContextKey<boolean>('flowleap.remoteAccessEnabled', false);

/**
 * The pair management REST base for a Relay Host socket URL:
 * `wss://h/v1/remote-access/host` → `https://h/v1/remote-access/pairs`.
 */
export function getRemoteAccessPairsUrl(relayUrl: string): string {
	const url = new URL(relayUrl);
	url.protocol = url.protocol === 'ws:' ? 'http:' : 'https:';
	url.pathname = url.pathname.replace(/\/host\/?$/, '') + '/pairs';
	url.search = '';
	url.hash = '';
	return url.toString();
}

/** A pair as `GET /v1/remote-access/pairs` lists it. Never a key. */
export interface IRemoteAccessPair {
	readonly pairId: string;
	readonly hostId: string;
	readonly hostLabel?: string;
	readonly viewerLabel?: string;
	readonly state?: string;
	readonly createdAt?: string | number;
	readonly lastSeenAt?: string | number;
}

/** What the Pairing dialog shows once. The secret is in `code` and `url` only. */
export interface IRemoteAccessPairingOffer {
	readonly pairId: string;
	/** `<pairId>.<pairSecret base32>`, for a second computer without a camera. */
	readonly code: string;
	/** `https://remote.flowleap.co/pair#<code>`, for the QR code. */
	readonly url: string;
}

export const enum RemoteAccessErrorKind {
	NotSignedIn = 'notSignedIn',
	SubscriptionRequired = 'subscriptionRequired',
	RequestFailed = 'requestFailed',
}

export class RemoteAccessError extends Error {
	constructor(readonly kind: RemoteAccessErrorKind, message: string, readonly statusCode?: number) {
		super(message);
		this.name = 'RemoteAccessError';
	}
}

export const IRemoteAccessService = createDecorator<IRemoteAccessService>('remoteAccessService');

export interface IRemoteAccessService {
	readonly _serviceBrand: undefined;

	/** Whether Remote Access is switched on for this Host. Persisted, machine-local. */
	readonly enabled: IObservable<boolean>;
	/** `true` while a FlowLeap Session exists. */
	readonly signedIn: IObservable<boolean>;
	/** This install's Host id (UUID v4, created once, machine-local). */
	readonly hostId: string;
	/** This Host's pairs, from the Relay and the local cache. */
	readonly pairs: IObservable<readonly IRemoteAccessPair[]>;
	/** The agent host's Relay transport status. */
	readonly hostStatus: IObservable<IRemoteAccessHostStatus>;

	setEnabled(enabled: boolean): Promise<void>;
	refreshPairs(): Promise<void>;
	/** Offers a Pairing to the Relay. The returned code is the only copy of the secret. */
	startPairing(): Promise<IRemoteAccessPairingOffer>;
	removePair(pairId: string): Promise<void>;
	/** Removes every pair of this Host on the Relay and locally (sign-out). */
	revokeAll(): Promise<void>;
}
