/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Remote Access Relay framing (docs/remote-access/RELAY-CONTRACT.md section 3, section 4).
//
// The plaintext envelope around the end-to-end frames of remoteAccessCrypto.ts:
// the payload type byte, the pair id tag the Relay adds or reads, the close
// codes and the control frames. Shared by the Host transport (Node) and the
// Viewer transport (browser), so no Node or DOM imports.

import { bytesToUuid, uuidToBytes } from './remoteAccessCrypto.js';

/** Relay payload frame to or from one pair (section 4). */
export const RELAY_FRAME_PAIR = 0x01;
/** Relay payload frame from the Host to every live Viewer (section 4). AHP does not use it. */
export const RELAY_FRAME_BROADCAST = 0x02;

/** Relay close codes (section 3, section 4). */
export const enum RelayCloseCode {
	Normal = 1000,
	InternalError = 1011,
	Unauthorized = 4401,
	SubscriptionRequired = 4402,
	Forbidden = 4403,
	Idle = 4408,
	Replaced = 4409,
	TooLarge = 4413,
	TooManyViewers = 4429,
}

/** Both ends ping this often; the Relay closes a socket after 60 s without a frame (4408). */
export const RELAY_PING_INTERVAL_MS = 25_000;

/** What the Relay says about the Host in a Viewer's `welcome` and in each `host` control frame. */
export interface IRelayHostPeer {
	readonly online: boolean;
	/** The Host's FlowLeap version, for the Viewer's build pick. Present when online. */
	readonly appVersion?: string;
	/** The AHP versions the Host serves. Present when online. */
	readonly ahp?: readonly (string | number)[];
}

/** Builds the Host → Relay binary `[0x01][pairId 16 bytes][payload]` frame. */
export function encodePairFrame(pairId: string, payload: Uint8Array): Uint8Array {
	const frame = new Uint8Array(1 + 16 + payload.byteLength);
	frame[0] = RELAY_FRAME_PAIR;
	frame.set(uuidToBytes(pairId), 1);
	frame.set(payload, 17);
	return frame;
}

/** Builds the binary `[0x02][payload]` broadcast frame. Unused by AHP; kept for the attention work (B6). */
export function encodeBroadcastFrame(payload: Uint8Array): Uint8Array {
	const frame = new Uint8Array(1 + payload.byteLength);
	frame[0] = RELAY_FRAME_BROADCAST;
	frame.set(payload, 1);
	return frame;
}

/** Parses a Relay → Host `[0x01][pairId 16 bytes][payload]` frame. */
export function decodePairFrame(frame: Uint8Array): { readonly pairId: string; readonly payload: Uint8Array } | undefined {
	if (frame.byteLength < 18 || frame[0] !== RELAY_FRAME_PAIR) {
		return undefined;
	}
	return { pairId: bytesToUuid(frame.subarray(1, 17)), payload: frame.subarray(17) };
}

/** Builds the Viewer → Relay binary `[0x01][payload]` frame. The Relay adds the pair id. */
export function encodeViewerFrame(payload: Uint8Array): Uint8Array<ArrayBuffer> {
	const frame = new Uint8Array(1 + payload.byteLength);
	frame[0] = RELAY_FRAME_PAIR;
	frame.set(payload, 1);
	return frame;
}

/**
 * Parses a Relay → Viewer binary frame: `[0x01][payload]` from the Host to
 * this pair, or `[0x02][payload]` broadcast. `undefined` for anything else.
 */
export function decodeViewerFrame(frame: Uint8Array): { readonly broadcast: boolean; readonly payload: Uint8Array } | undefined {
	if (frame.byteLength < 2) {
		return undefined;
	}
	if (frame[0] === RELAY_FRAME_PAIR) {
		return { broadcast: false, payload: frame.subarray(1) };
	}
	if (frame[0] === RELAY_FRAME_BROADCAST) {
		return { broadcast: true, payload: frame.subarray(1) };
	}
	return undefined;
}

/** The Viewer's first frame (section 3). */
export function createViewerHello(token: string, pairId: string): string {
	return JSON.stringify({ t: 'hello', role: 'viewer', token, pairId });
}

/** A control frame the Viewer acts on. Unknown frames are `undefined` (forward compatible). */
export type RelayViewerControlFrame =
	| { readonly t: 'welcome'; readonly peer: IRelayHostPeer }
	| { readonly t: 'host'; readonly peer: IRelayHostPeer }
	| { readonly t: 'pong' };

function readPeer(value: { online?: unknown; appVersion?: unknown; ahp?: unknown }): IRelayHostPeer {
	return {
		online: value.online === true,
		appVersion: typeof value.appVersion === 'string' ? value.appVersion : undefined,
		ahp: Array.isArray(value.ahp) ? value.ahp.filter((v): v is string | number => typeof v === 'string' || typeof v === 'number') : undefined,
	};
}

/** Parses a Relay → Viewer text frame. */
export function parseViewerControlFrame(text: string): RelayViewerControlFrame | undefined {
	let frame: unknown;
	try {
		frame = JSON.parse(text);
	} catch {
		return undefined;
	}
	if (typeof frame !== 'object' || frame === null || Array.isArray(frame)) {
		return undefined;
	}
	const value = frame as { t?: unknown; peer?: unknown; online?: unknown; appVersion?: unknown; ahp?: unknown };
	switch (value.t) {
		case 'welcome': {
			const peer = typeof value.peer === 'object' && value.peer !== null ? value.peer as { online?: unknown } : { online: false };
			return { t: 'welcome', peer: readPeer(peer) };
		}
		case 'host':
			return { t: 'host', peer: readPeer(value) };
		case 'pong':
			return { t: 'pong' };
		default:
			return undefined;
	}
}
