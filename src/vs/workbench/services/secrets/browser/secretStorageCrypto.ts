/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { mainWindow } from '../../../../base/browser/window.js';
import { VSBuffer, decodeBase64, encodeBase64 } from '../../../../base/common/buffer.js';

/**
 * Seals and unseals the serialized secrets of a web secret storage.
 */
export interface ISecretStorageCrypto {
	seal(data: string): Promise<string>;
	unseal(data: string): Promise<string>;
}

/**
 * No encryption: used when the browser has no `crypto.subtle` or no server key is offered.
 */
export class TransparentCrypto implements ISecretStorageCrypto {

	async seal(data: string): Promise<string> {
		return data;
	}

	async unseal(data: string): Promise<string> {
		return data;
	}
}

const enum AESConstants {
	ALGORITHM = 'AES-GCM',
	KEY_LENGTH = 256,
	IV_LENGTH = 12,
}

/**
 * The server key could not be fetched. Callers must not discard data on this error.
 */
export class NetworkError extends Error {

	constructor(inner: Error) {
		super(inner.message);
		this.name = inner.name;
		this.stack = inner.stack;
	}
}

/**
 * AES-GCM with a key that is `clientKey XOR serverKey`. The server key is fetched with a
 * `POST` to `authEndpoint` (the `vscode-secret-key-path` protocol); the client key and the IV
 * are stored next to the ciphertext.
 */
export class ServerKeyedAESCrypto implements ISecretStorageCrypto {

	private serverKey: Uint8Array | undefined;

	/**
	 * Gets whether the algorithm is supported; requires a secure context
	 */
	static supported() {
		return !!crypto.subtle;
	}

	constructor(private readonly authEndpoint: string) { }

	async seal(data: string): Promise<string> {
		// Get a new key and IV on every change, to avoid the risk of reusing the same key and IV pair with AES-GCM
		// (see also: https://developer.mozilla.org/en-US/docs/Web/API/AesGcmParams#properties)
		const iv = mainWindow.crypto.getRandomValues(new Uint8Array(AESConstants.IV_LENGTH));
		// crypto.getRandomValues isn't a good-enough PRNG to generate crypto keys, so we need to use crypto.subtle.generateKey and export the key instead
		const clientKeyObj = await mainWindow.crypto.subtle.generateKey(
			{ name: AESConstants.ALGORITHM as const, length: AESConstants.KEY_LENGTH as const },
			true,
			['encrypt', 'decrypt']
		);

		const clientKey = new Uint8Array(await mainWindow.crypto.subtle.exportKey('raw', clientKeyObj));
		const key = await this.getKey(clientKey);
		const dataUint8Array = new TextEncoder().encode(data);
		const cipherText: ArrayBuffer = await mainWindow.crypto.subtle.encrypt(
			{ name: AESConstants.ALGORITHM as const, iv },
			key,
			dataUint8Array
		);

		// Base64 encode the result and store the ciphertext, the key, and the IV in localStorage
		// Note that the clientKey and IV don't need to be secret
		const result = new Uint8Array([...clientKey, ...iv, ...new Uint8Array(cipherText)]);
		return encodeBase64(VSBuffer.wrap(result));
	}

	async unseal(data: string): Promise<string> {
		// encrypted should contain, in order: the key (32-byte), the IV for AES-GCM (12-byte) and the ciphertext (which has the GCM auth tag at the end)
		// Minimum length must be 44 (key+IV length) + 16 bytes (1 block encrypted with AES - regardless of key size)
		const dataUint8Array = decodeBase64(data);

		if (dataUint8Array.byteLength < 60) {
			throw Error('Invalid length for the value for credentials.crypto');
		}

		const keyLength = AESConstants.KEY_LENGTH / 8;
		const clientKey = dataUint8Array.slice(0, keyLength);
		const iv = dataUint8Array.slice(keyLength, keyLength + AESConstants.IV_LENGTH);
		const cipherText = dataUint8Array.slice(keyLength + AESConstants.IV_LENGTH);

		// Do the decryption and parse the result as JSON
		const key = await this.getKey(clientKey.buffer);
		const decrypted = await mainWindow.crypto.subtle.decrypt(
			{ name: AESConstants.ALGORITHM as const, iv: iv.buffer as Uint8Array<ArrayBuffer> },
			key,
			cipherText.buffer as Uint8Array<ArrayBuffer>
		);

		return new TextDecoder().decode(new Uint8Array(decrypted));
	}

	/**
	 * Given a clientKey, returns the CryptoKey object that is used to encrypt/decrypt the data.
	 * The actual key is (clientKey XOR serverKey)
	 */
	private async getKey(clientKey: Uint8Array): Promise<CryptoKey> {
		if (!clientKey || clientKey.byteLength !== AESConstants.KEY_LENGTH / 8) {
			throw Error('Invalid length for clientKey');
		}

		const serverKey = await this.getServerKeyPart();
		const keyData = new Uint8Array(AESConstants.KEY_LENGTH / 8);

		for (let i = 0; i < keyData.byteLength; i++) {
			keyData[i] = clientKey[i] ^ serverKey[i];
		}

		return mainWindow.crypto.subtle.importKey(
			'raw',
			keyData,
			{
				name: AESConstants.ALGORITHM as const,
				length: AESConstants.KEY_LENGTH as const,
			},
			true,
			['encrypt', 'decrypt']
		);
	}

	private async getServerKeyPart(): Promise<Uint8Array> {
		if (this.serverKey) {
			return this.serverKey;
		}

		let attempt = 0;
		let lastError: Error | undefined;

		while (attempt <= 3) {
			try {
				const res = await fetch(this.authEndpoint, { credentials: 'include', method: 'POST' });
				if (!res.ok) {
					throw new Error(res.statusText);
				}

				const serverKey = new Uint8Array(await res.arrayBuffer());
				if (serverKey.byteLength !== AESConstants.KEY_LENGTH / 8) {
					throw Error(`The key retrieved by the server is not ${AESConstants.KEY_LENGTH} bit long.`);
				}

				this.serverKey = serverKey;

				return this.serverKey;
			} catch (e) {
				lastError = e instanceof Error ? e : new Error(String(e));
				attempt++;

				// exponential backoff
				await new Promise(resolve => setTimeout(resolve, attempt * attempt * 100));
			}
		}

		if (lastError) {
			throw new NetworkError(lastError);
		}

		throw new Error('Unknown error');
	}
}
