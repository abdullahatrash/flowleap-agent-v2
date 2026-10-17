/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Renderer ↔ agent host contract for the Remote Access Host transport
// (docs/remote-access/RELAY-CONTRACT.md section 7). The renderer owns the FlowLeap
// Session token and the pair keys (secret storage); it pushes them to the
// agent host over the Management IPC channel. The agent host keeps them in
// memory only.

export const enum RemoteAccessHostState {
	/** Remote Access is off on this Host. */
	Stopped = 'stopped',
	Connecting = 'connecting',
	Connected = 'connected',
	/** The Relay is unreachable or closed the socket; the transport retries with backoff. */
	Retrying = 'retrying',
	/** The Relay refused the FlowLeap Session token (4401). Waits for a new token. */
	Unauthorized = 'unauthorized',
	/** The user has no active or trialing subscription (4402). Waits for a new token. */
	SubscriptionRequired = 'subscriptionRequired',
	/** Another socket took this Host id (4409). Waits for a new token. */
	Replaced = 'replaced',
}

export interface IRemoteAccessHostStatus {
	readonly state: RemoteAccessHostState;
	/** Pairs whose Viewer completed the end-to-end handshake. */
	readonly connectedPairIds: readonly string[];
	readonly lastCloseCode?: number;
}

export const REMOTE_ACCESS_STOPPED_STATUS: IRemoteAccessHostStatus = Object.freeze({
	state: RemoteAccessHostState.Stopped,
	connectedPairIds: Object.freeze([]),
});

/** A pair as the transport uses it. */
export interface IRemoteAccessHostPair {
	readonly pairId: string;
	readonly pairKey: Uint8Array;
}

/** A pair as it crosses IPC: the 32-byte pair key in base64. */
export interface IRemoteAccessHostPairConfig {
	readonly pairId: string;
	readonly pairKey: string;
}

/** What the renderer pushes to the agent host to switch the Host on or to refresh it. */
export interface IRemoteAccessHostConfig {
	readonly relayUrl: string;
	/** The FlowLeap Session token. Never written to disk or logs. */
	readonly token: string;
	readonly hostId: string;
	readonly pairs: readonly IRemoteAccessHostPairConfig[];
}
