/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Module-level registry so the patent backend client can read the user's BYO patent-data
// keys without restructuring the DI graph — the exact pattern of patentTokenRegistry.ts.
// PatentDataKeysStore — the SecretStorage owner — registers its accessor here on construction.
// Keys are forwarded per request to the FlowLeap backend (issue #30 wire contract, ADR 0005)
// and must never be logged.

/** The #30 wire-contract header names (backend does exact, case-insensitive matches). */
export const EPO_OPS_KEY_HEADER = 'X-EPO-OPS-Key';
export const EPO_OPS_SECRET_HEADER = 'X-EPO-OPS-Secret';
export const USPTO_ODP_KEY_HEADER = 'X-USPTO-ODP-Key';

export interface PatentEpoCredentials {
	readonly key: string;
	readonly secret: string;
}

/** Partial configurations are first-class: EPO-only and USPTO-only are valid states. */
export interface PatentDataKeys {
	readonly epo?: PatentEpoCredentials;
	readonly usptoOdp?: string;
}

let _registeredDataKeysProvider: (() => PatentDataKeys | undefined) | undefined;

/**
 * Called by PatentDataKeysStore on construction to register the keys accessor. Must be
 * synchronous and side-effect free — it runs on every backend request's header assembly.
 */
export function registerPatentDataKeysProvider(provider: () => PatentDataKeys | undefined): void {
	_registeredDataKeysProvider = provider;
}

/** The user's configured patent-data keys, if a store is registered and has any. */
export function getPatentDataKeys(): PatentDataKeys | undefined {
	return _registeredDataKeysProvider?.();
}
