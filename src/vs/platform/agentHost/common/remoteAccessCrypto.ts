/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Remote Access end-to-end crypto (docs/remote-access/RELAY-CONTRACT.md §5, §6).
//
// Shared by the Host (agent host process, Node) and the Viewer (browser), so it
// uses WebCrypto (`globalThis.crypto.subtle`) only: X25519, HMAC-SHA256,
// HKDF-SHA256 and AES-256-GCM. No Node or DOM imports.
//
// Byte layout (contract §6.1):
//   Pairing proof   hex(HMAC-SHA256(key = pairSecret (16 raw bytes), msg = UTF-8 hostId))
//   Pair key        HKDF-SHA256(ikm = pairSecret, salt = pairId (16 raw bytes), info = PAIR_KEY_INFO), 32 bytes
//   Handshake frame [0x01][version 0x01][role 0x01 host | 0x02 viewer][X25519 public key, 32][tag, 32]
//                   tag = HMAC-SHA256(pairKey, publicKey ‖ UTF-8 role name)
//   Session key     HKDF-SHA256(ikm = X25519 shared secret, salt = pairId, info = SESSION_KEY_INFO)
//   Data frame      [0x02][counter, 8 bytes big-endian][AES-256-GCM ciphertext ‖ tag]
//                   nonce = [direction, 4 bytes big-endian: 1 host→viewer, 2 viewer→host][counter, 8]
//                   aad = pairId (16 raw bytes)
//                   plaintext = [flags][chunk]; flags bit 0 = last chunk of one AHP message
// The Viewer sends its handshake first; the Host answers each Viewer handshake
// with a fresh ephemeral key. Counters start at 0 per direction per handshake and
// must arrive in order (the Relay keeps WebSocket order), so a replayed or
// reordered frame fails.

export const enum RemoteAccessRole {
	Host = 'host',
	Viewer = 'viewer',
}

export const REMOTE_ACCESS_PAIR_SECRET_BYTES = 16;
export const REMOTE_ACCESS_PAIR_KEY_INFO = 'flowleap-remote-access-pair-v1';
export const REMOTE_ACCESS_SESSION_KEY_INFO = 'flowleap-remote-access-session-v1';
/** The Viewer page that claims a Pairing. The pairing code follows the `#`. */
export const REMOTE_ACCESS_PAIR_URL_PREFIX = 'https://remote.flowleap.co/pair#';

export const enum RemoteAccessE2EFrameKind {
	Handshake = 0x01,
	Data = 0x02,
}

const HANDSHAKE_VERSION = 0x01;
const HANDSHAKE_LENGTH = 3 + 32 + 32;
const COUNTER_LENGTH = 8;
const DIRECTION_HOST_TO_VIEWER = 1;
const DIRECTION_VIEWER_TO_HOST = 2;
const FLAG_LAST_CHUNK = 0x01;
/**
 * Largest plaintext chunk per data frame. The Relay closes on a payload frame
 * over 1 MiB (§4); this leaves room for the Relay header, the frame header and
 * the GCM tag.
 */
export const REMOTE_ACCESS_MAX_CHUNK_BYTES = 1_000_000;
/** Upper bound for one reassembled AHP message, so a peer cannot grow memory without limit. */
export const REMOTE_ACCESS_MAX_MESSAGE_BYTES = 64 * 1024 * 1024;

export class RemoteAccessCryptoError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'RemoteAccessCryptoError';
	}
}

function subtle(): SubtleCrypto {
	const value = globalThis.crypto?.subtle;
	if (!value) {
		throw new RemoteAccessCryptoError('WebCrypto is not available.');
	}
	return value;
}

function utf8(text: string): Uint8Array<ArrayBuffer> {
	return new TextEncoder().encode(text);
}

function concat(...parts: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
	let length = 0;
	for (const part of parts) {
		length += part.byteLength;
	}
	const result = new Uint8Array(length);
	let offset = 0;
	for (const part of parts) {
		result.set(part, offset);
		offset += part.byteLength;
	}
	return result;
}

function copy(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
	return new Uint8Array(bytes);
}

/** Constant-time comparison of two byte arrays. */
export function constantTimeEquals(a: Uint8Array, b: Uint8Array): boolean {
	if (a.byteLength !== b.byteLength) {
		return false;
	}
	let diff = 0;
	for (let i = 0; i < a.byteLength; i++) {
		diff |= a[i] ^ b[i];
	}
	return diff === 0;
}

// ---- Encodings ----------------------------------------------------------------

const BASE32_ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';

/** RFC 4648 base32, lowercase, no padding. */
export function encodeBase32(bytes: Uint8Array): string {
	let out = '';
	let buffer = 0;
	let bits = 0;
	for (const byte of bytes) {
		buffer = (buffer << 8) | byte;
		bits += 8;
		while (bits >= 5) {
			out += BASE32_ALPHABET[(buffer >>> (bits - 5)) & 31];
			bits -= 5;
		}
	}
	if (bits > 0) {
		out += BASE32_ALPHABET[(buffer << (5 - bits)) & 31];
	}
	return out;
}

/** Decodes {@link encodeBase32} output. Case-insensitive; `undefined` for invalid input. */
export function decodeBase32(text: string): Uint8Array<ArrayBuffer> | undefined {
	const clean = text.trim().toLowerCase().replace(/=+$/, '');
	const out: number[] = [];
	let buffer = 0;
	let bits = 0;
	for (const char of clean) {
		const value = BASE32_ALPHABET.indexOf(char);
		if (value < 0) {
			return undefined;
		}
		buffer = ((buffer << 5) | value) & 0xffff;
		bits += 5;
		if (bits >= 8) {
			out.push((buffer >>> (bits - 8)) & 0xff);
			bits -= 8;
		}
	}
	return new Uint8Array(out);
}

export function toHex(bytes: Uint8Array): string {
	let out = '';
	for (const byte of bytes) {
		out += byte.toString(16).padStart(2, '0');
	}
	return out;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
	return UUID_PATTERN.test(value);
}

/** The 16 raw bytes of a UUID string. Throws on a malformed UUID. */
export function uuidToBytes(uuid: string): Uint8Array<ArrayBuffer> {
	if (!isUuid(uuid)) {
		throw new RemoteAccessCryptoError('Malformed pair id.');
	}
	const hex = uuid.replace(/-/g, '');
	const bytes = new Uint8Array(16);
	for (let i = 0; i < 16; i++) {
		bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
	}
	return bytes;
}

/** The lowercase UUID string of 16 raw bytes. */
export function bytesToUuid(bytes: Uint8Array): string {
	if (bytes.byteLength !== 16) {
		throw new RemoteAccessCryptoError('A pair id has 16 bytes.');
	}
	const hex = toHex(bytes);
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// ---- Pairing (§5) -------------------------------------------------------------

export function generatePairSecret(): Uint8Array<ArrayBuffer> {
	const secret = new Uint8Array(REMOTE_ACCESS_PAIR_SECRET_BYTES);
	globalThis.crypto.getRandomValues(secret);
	return secret;
}

export interface IRemoteAccessPairingCode {
	readonly pairId: string;
	readonly pairSecret: Uint8Array<ArrayBuffer>;
}

/** The pasteable pairing code: `<pairId>.<pairSecret base32>`. */
export function formatPairingCode(pairId: string, pairSecret: Uint8Array): string {
	return `${pairId.toLowerCase()}.${encodeBase32(pairSecret)}`;
}

/** The URL the QR code encodes. */
export function formatPairingUrl(pairId: string, pairSecret: Uint8Array): string {
	return REMOTE_ACCESS_PAIR_URL_PREFIX + formatPairingCode(pairId, pairSecret);
}

/** Parses a pairing code or the full pairing URL. `undefined` when it is not one. */
export function parsePairingCode(input: string): IRemoteAccessPairingCode | undefined {
	let code = input.trim();
	const hash = code.lastIndexOf('#');
	if (hash >= 0) {
		code = code.slice(hash + 1);
	}
	const dot = code.indexOf('.');
	if (dot < 0) {
		return undefined;
	}
	const pairId = code.slice(0, dot).toLowerCase();
	const pairSecret = decodeBase32(code.slice(dot + 1));
	if (!isUuid(pairId) || !pairSecret || pairSecret.byteLength !== REMOTE_ACCESS_PAIR_SECRET_BYTES) {
		return undefined;
	}
	return { pairId, pairSecret };
}

async function hmacSha256(key: Uint8Array, message: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
	const cryptoKey = await subtle().importKey('raw', copy(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
	return new Uint8Array(await subtle().sign('HMAC', cryptoKey, copy(message)));
}

async function hkdfSha256(ikm: Uint8Array, salt: Uint8Array, info: string, lengthBytes: number): Promise<Uint8Array<ArrayBuffer>> {
	const key = await subtle().importKey('raw', copy(ikm), 'HKDF', false, ['deriveBits']);
	const bits = await subtle().deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: copy(salt), info: utf8(info) }, key, lengthBytes * 8);
	return new Uint8Array(bits);
}

/** `proof = HMAC-SHA256(pairSecret, hostId)`, lowercase hex. The Relay compares it; it never sees the secret. */
export async function computePairingProof(pairSecret: Uint8Array, hostId: string): Promise<string> {
	return toHex(await hmacSha256(pairSecret, utf8(hostId)));
}

/** `pairKey = HKDF-SHA256(pairSecret, salt = pairId, info = "flowleap-remote-access-pair-v1")`, 32 bytes. */
export function derivePairKey(pairSecret: Uint8Array, pairId: string): Promise<Uint8Array<ArrayBuffer>> {
	if (pairSecret.byteLength !== REMOTE_ACCESS_PAIR_SECRET_BYTES) {
		throw new RemoteAccessCryptoError('A pair secret has 16 bytes.');
	}
	return hkdfSha256(pairSecret, uuidToBytes(pairId), REMOTE_ACCESS_PAIR_KEY_INFO, 32);
}

// ---- Handshake and channel (§6) -----------------------------------------------

function roleByte(role: RemoteAccessRole): number {
	return role === RemoteAccessRole.Host ? 0x01 : 0x02;
}

function roleFromByte(value: number): RemoteAccessRole | undefined {
	return value === 0x01 ? RemoteAccessRole.Host : value === 0x02 ? RemoteAccessRole.Viewer : undefined;
}

/** The kind of an end-to-end frame, or `undefined` for an empty frame. */
export function getRemoteAccessFrameKind(frame: Uint8Array): RemoteAccessE2EFrameKind | undefined {
	if (frame.byteLength === 0) {
		return undefined;
	}
	return frame[0] === RemoteAccessE2EFrameKind.Handshake ? RemoteAccessE2EFrameKind.Handshake
		: frame[0] === RemoteAccessE2EFrameKind.Data ? RemoteAccessE2EFrameKind.Data
			: undefined;
}

/**
 * One side of the per-connection key exchange. Create it, send
 * {@link message} to the peer inside a payload frame, then call
 * {@link complete} with the peer's handshake frame.
 */
export class RemoteAccessHandshake {

	static async create(role: RemoteAccessRole, pairKey: Uint8Array, pairId: string): Promise<RemoteAccessHandshake> {
		const pairIdBytes = uuidToBytes(pairId);
		const keyPair = await subtle().generateKey({ name: 'X25519' }, false, ['deriveBits']) as CryptoKeyPair;
		const publicKey = new Uint8Array(await subtle().exportKey('raw', keyPair.publicKey));
		const tag = await hmacSha256(pairKey, concat(publicKey, utf8(role)));
		const message = concat(new Uint8Array([RemoteAccessE2EFrameKind.Handshake, HANDSHAKE_VERSION, roleByte(role)]), publicKey, tag);
		return new RemoteAccessHandshake(role, copy(pairKey), pairIdBytes, keyPair.privateKey, message);
	}

	private constructor(
		readonly role: RemoteAccessRole,
		private readonly _pairKey: Uint8Array<ArrayBuffer>,
		private readonly _pairId: Uint8Array<ArrayBuffer>,
		private readonly _privateKey: CryptoKey,
		/** The handshake frame to send to the peer. */
		readonly message: Uint8Array<ArrayBuffer>,
	) { }

	/**
	 * Verifies the peer's handshake frame against the pair key and derives
	 * the session cipher. Throws {@link RemoteAccessCryptoError} when the
	 * frame is malformed, comes from the same role, or fails its tag.
	 */
	async complete(peerMessage: Uint8Array): Promise<RemoteAccessChannelCipher> {
		if (peerMessage.byteLength !== HANDSHAKE_LENGTH || peerMessage[0] !== RemoteAccessE2EFrameKind.Handshake || peerMessage[1] !== HANDSHAKE_VERSION) {
			throw new RemoteAccessCryptoError('Malformed handshake frame.');
		}
		const peerRole = roleFromByte(peerMessage[2]);
		if (!peerRole || peerRole === this.role) {
			throw new RemoteAccessCryptoError('Handshake from an unexpected role.');
		}
		const peerPublicKey = copy(peerMessage.subarray(3, 35));
		const peerTag = peerMessage.subarray(35, 67);
		const expectedTag = await hmacSha256(this._pairKey, concat(peerPublicKey, utf8(peerRole)));
		if (!constantTimeEquals(peerTag, expectedTag)) {
			throw new RemoteAccessCryptoError('Handshake tag does not match the pair key.');
		}
		const peerKey = await subtle().importKey('raw', peerPublicKey, { name: 'X25519' }, false, []);
		const shared = new Uint8Array(await subtle().deriveBits({ name: 'X25519', public: peerKey }, this._privateKey, 256));
		const sessionKeyBytes = await hkdfSha256(shared, this._pairId, REMOTE_ACCESS_SESSION_KEY_INFO, 32);
		const sessionKey = await subtle().importKey('raw', sessionKeyBytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
		return new RemoteAccessChannelCipher(this.role, sessionKey, this._pairId);
	}
}

function nonce(direction: number, counter: number): Uint8Array<ArrayBuffer> {
	const bytes = new Uint8Array(12);
	const view = new DataView(bytes.buffer);
	view.setUint32(0, direction);
	view.setBigUint64(4, BigInt(counter));
	return bytes;
}

/**
 * The AES-256-GCM channel after a handshake. Not reentrant: callers
 * serialize {@link seal} calls and {@link open} calls (each direction
 * keeps a strict counter).
 */
export class RemoteAccessChannelCipher {

	private _sendCounter = 0;
	private _receiveCounter = 0;
	private readonly _sendDirection: number;
	private readonly _receiveDirection: number;
	private _pending: Uint8Array[] = [];
	private _pendingBytes = 0;

	constructor(
		role: RemoteAccessRole,
		private readonly _key: CryptoKey,
		private readonly _pairId: Uint8Array<ArrayBuffer>,
	) {
		this._sendDirection = role === RemoteAccessRole.Host ? DIRECTION_HOST_TO_VIEWER : DIRECTION_VIEWER_TO_HOST;
		this._receiveDirection = role === RemoteAccessRole.Host ? DIRECTION_VIEWER_TO_HOST : DIRECTION_HOST_TO_VIEWER;
	}

	/** Encrypts one AHP message into one or more data frames, in send order. */
	async seal(text: string): Promise<Uint8Array<ArrayBuffer>[]> {
		const bytes = utf8(text);
		const frames: Uint8Array<ArrayBuffer>[] = [];
		let offset = 0;
		do {
			const end = Math.min(offset + REMOTE_ACCESS_MAX_CHUNK_BYTES, bytes.byteLength);
			const last = end === bytes.byteLength;
			const plaintext = concat(new Uint8Array([last ? FLAG_LAST_CHUNK : 0]), bytes.subarray(offset, end));
			const counter = this._sendCounter++;
			const ciphertext = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv: nonce(this._sendDirection, counter), additionalData: this._pairId }, this._key, plaintext));
			const header = new Uint8Array(1 + COUNTER_LENGTH);
			header[0] = RemoteAccessE2EFrameKind.Data;
			new DataView(header.buffer).setBigUint64(1, BigInt(counter));
			frames.push(concat(header, ciphertext));
			offset = end;
		} while (offset < bytes.byteLength);
		return frames;
	}

	/**
	 * Decrypts one data frame. Returns the AHP message text when the frame
	 * completes one, `undefined` while chunks are still arriving. Throws
	 * {@link RemoteAccessCryptoError} on a bad frame, a counter out of order
	 * or a failed tag; the channel is then unusable.
	 */
	async open(frame: Uint8Array): Promise<string | undefined> {
		if (frame.byteLength < 1 + COUNTER_LENGTH + 16 || frame[0] !== RemoteAccessE2EFrameKind.Data) {
			throw new RemoteAccessCryptoError('Malformed data frame.');
		}
		const counter = Number(new DataView(frame.buffer, frame.byteOffset, frame.byteLength).getBigUint64(1));
		if (counter !== this._receiveCounter) {
			throw new RemoteAccessCryptoError('Data frame out of order.');
		}
		this._receiveCounter++;
		let plaintext: Uint8Array;
		try {
			plaintext = new Uint8Array(await subtle().decrypt(
				{ name: 'AES-GCM', iv: nonce(this._receiveDirection, counter), additionalData: this._pairId },
				this._key,
				copy(frame.subarray(1 + COUNTER_LENGTH)),
			));
		} catch {
			throw new RemoteAccessCryptoError('Data frame failed authentication.');
		}
		if (plaintext.byteLength < 1) {
			throw new RemoteAccessCryptoError('Malformed data frame.');
		}
		const chunk = plaintext.subarray(1);
		this._pendingBytes += chunk.byteLength;
		if (this._pendingBytes > REMOTE_ACCESS_MAX_MESSAGE_BYTES) {
			throw new RemoteAccessCryptoError('Message is too large.');
		}
		this._pending.push(chunk);
		if ((plaintext[0] & FLAG_LAST_CHUNK) === 0) {
			return undefined;
		}
		const message = this._pending.length === 1 ? this._pending[0] : concat(...this._pending);
		this._pending = [];
		this._pendingBytes = 0;
		return new TextDecoder().decode(message);
	}
}
