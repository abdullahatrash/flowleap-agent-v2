/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Remote Access Viewer contract between the Viewer boot page and the web
// Agents Window it boots (docs/remote-access/RELAY-CONTRACT.md section 8,
// docs/remote-access/VIEWER.md). The boot page signs in, picks a pair and
// passes these options as `IWorkbenchConstructionOptions.remoteAccessViewer`.
// The boot page of one build can boot the workbench of another kept build,
// so this shape only grows: add optional fields, never change one.

import { localize } from '../../../nls.js';
import { RelayCloseCode } from './remoteAccessRelayProtocol.js';

/** The pair the Viewer follows, and how the Viewer transport reaches it. */
export interface IRemoteAccessViewerOptions {
	/** `wss://api.flowleap.co/v1/remote-access/viewer` */
	readonly relayUrl: string;
	readonly pairId: string;
	/** The 32-byte pair key (contract section 5 step 4). Kept in memory and in the page's IndexedDB only. */
	readonly pairKey: Uint8Array;
	/** The Host's label, from the pair list. */
	readonly hostLabel: string;
	/** The FlowLeap version of the loaded Viewer build (the folder the page loaded from). */
	readonly buildVersion: string;
	/** A fresh FlowLeap Session token for the `hello` frame. Called for each socket. */
	getToken(): Promise<string>;
	/** The page shows the Viewer state outside the workbench (for example "Host offline"). */
	onDidChangeStatus?(status: IRemoteAccessViewerStatus): void;
}

export const enum RemoteAccessViewerState {
	/** The socket is opening or the end-to-end handshake runs. */
	Connecting = 'connecting',
	/** The Relay accepted the Viewer, but the Host is not connected. A page state, not an error. */
	HostOffline = 'hostOffline',
	Connected = 'connected',
	/** The Relay refused the Viewer (4401, 4402, 4403, 4409, 4429). Retrying does not help. */
	Refused = 'refused',
	/** The socket closed for another reason. The Agents Window reconnects. */
	Disconnected = 'disconnected',
}

export interface IRemoteAccessViewerStatus {
	readonly state: RemoteAccessViewerState;
	/** The Relay close code, for `Refused` and `Disconnected`. */
	readonly closeCode?: number;
	/** A localized sentence for the page, for `Refused` and `Disconnected`. */
	readonly message?: string;
	/** The Host's FlowLeap version, when the Relay told it. */
	readonly hostAppVersion?: string;
}

/**
 * Close codes after which the Viewer stops: the same identity gets the same
 * answer. 4409 means another tab opened the same pair; retrying would make the
 * two tabs replace each other without end.
 */
export function isRemoteAccessViewerRefusal(code: number | undefined): boolean {
	return code === RelayCloseCode.Unauthorized
		|| code === RelayCloseCode.SubscriptionRequired
		|| code === RelayCloseCode.Forbidden
		|| code === RelayCloseCode.Replaced
		|| code === RelayCloseCode.TooManyViewers;
}

/** The localized sentence the Viewer page shows for a Relay close code. */
export function getRemoteAccessViewerCloseMessage(code: number | undefined): string {
	switch (code) {
		case RelayCloseCode.Unauthorized:
			return localize('remoteAccessViewer.close.unauthorized', "The Relay did not accept your FlowLeap sign-in. Sign in again.");
		case RelayCloseCode.SubscriptionRequired:
			return localize('remoteAccessViewer.close.subscriptionRequired', "Remote Access needs an active FlowLeap subscription or trial.");
		case RelayCloseCode.Forbidden:
			return localize('remoteAccessViewer.close.forbidden', "This pairing was removed. Pair this Viewer again on the Host.");
		case RelayCloseCode.Idle:
			return localize('remoteAccessViewer.close.idle', "The connection to the Relay was idle for too long. Connecting again.");
		case RelayCloseCode.Replaced:
			return localize('remoteAccessViewer.close.replaced', "This pairing opened in another tab. This tab stopped following the Host. Reload to follow it here.");
		case RelayCloseCode.TooLarge:
			return localize('remoteAccessViewer.close.tooLarge', "A message was too large for the Relay. Connecting again.");
		case RelayCloseCode.TooManyViewers:
			return localize('remoteAccessViewer.close.tooManyViewers', "Five Viewers already follow this Host. Close one, then try again.");
		default:
			return localize('remoteAccessViewer.close.other', "The connection to the Relay closed. Connecting again.");
	}
}
