/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Module-level registry so backend-facing code (the patent backend client and tools)
// can read the current OAuth access token without restructuring the DI graph.
// FlowLeapAuthenticationProvider — the owner of the sign-in flow — registers its accessor
// here on construction.

let _registeredAccessTokenProvider: (() => string | undefined) | undefined;

/**
 * Called by FlowLeapAuthenticationProvider on construction to register the token accessor.
 * Avoids threading the provider through the DI graph to every consumer that is not
 * DI-constructed with auth access.
 */
export function registerPatentAccessTokenProvider(provider: () => string | undefined): void {
	_registeredAccessTokenProvider = provider;
}

/**
 * Returns the current OAuth access token, if one is registered and valid.
 */
export function getPatentAccessToken(): string | undefined {
	return _registeredAccessTokenProvider?.();
}
