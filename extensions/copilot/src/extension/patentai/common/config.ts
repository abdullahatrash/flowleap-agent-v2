/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Auth-surface configuration for the FlowLeap (Patent AI) backend.
 *
 * Deliberately scoped to what the Clerk template-token sign-in flow needs — the
 * retired backend's model/api-key fields are not carried over (ADR 0002, ADR 0004).
 */
export interface PatentAIConfig {
	/** Backend API base URL, including the `/v1` suffix (e.g. `https://api.flowleap.co/v1`). */
	apiUrl: string;
	/** OAuth client id sent to the authorize endpoint. */
	clientId: string;
	/** Authorize URL the system browser opens for Clerk sign-in (derived from {@link apiUrl}). */
	authUrl: string;
	/**
	 * Deep link the backend redirects to with the Clerk token. Its authority MUST be the
	 * id of the extension that registers the `flowleap://` URI handler, so VS Code routes
	 * the callback back to us (see `configService.getPatentAIConfig`).
	 */
	redirectUri: string;
	/** Frontend URL for dashboard / pricing links (separate from the API host). */
	frontendUrl: string;
}
