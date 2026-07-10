/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Response envelope returned by the FlowLeap agent-first `/v1/tools/<name>` facade endpoints. Every
 * facade tool answers with this uniform shape, unwrapping `data` to the tool's own payload. Errors
 * (invalid input, unknown tool, upstream failures) surface as non-2xx and are thrown by the shared
 * {@link IPatentBackendClient} seam before this shape is inspected, so `success:false` here only
 * covers the soft-failure case where a `200` still carried a tool-level error.
 */
export interface FacadeToolEnvelope<T> {
	readonly success: boolean;
	readonly tool?: string;
	readonly data?: T;
	readonly executionTimeMs?: number;
	readonly error?: { readonly code?: string; readonly message?: string };
}
