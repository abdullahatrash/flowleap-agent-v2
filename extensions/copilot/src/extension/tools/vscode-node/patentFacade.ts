/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../util/vs/base/common/cancellation';
import { IPatentBackendClient, PatentBackendError } from '../../patentai/vscode-node/patentBackendClient';
import { FacadeToolEnvelope } from './patentFacadeTypes';

/**
 * Call a compound `/v1/tools/{toolName}` facade endpoint through the shared {@link IPatentBackendClient}
 * seam and unwrap the `data` payload. So every facade tool inherits the centralized
 * `401 → re-sign-in` / `402 → start-trial` / `429 → wait` gating.
 *
 * The backend reports a tool-execution failure two ways: as a non-2xx status (the seam throws a
 * {@link PatentBackendError} whose message is the raw JSON body) or, less commonly, as a `200` with
 * `{ success: false }`. {@link normalizeFacadeError} folds the first form's raw-JSON body back into a
 * clean human message, and the `success` guard below covers the second — so callers see one tidy
 * error message either way.
 */
export async function callFacadeTool<T>(client: IPatentBackendClient, toolName: string, input: unknown, token: CancellationToken): Promise<T> {
	let envelope: FacadeToolEnvelope<T>;
	try {
		// config.apiUrl already ends in `/v1` (existing tools call `/ops/...`, not `/v1/ops/...`), so the
		// facade path is `/tools/{name}` here — prefixing `/v1` again resolves to `.../v1/v1/tools/...` (404).
		envelope = await client.post<FacadeToolEnvelope<T>>(`/tools/${toolName}`, input, token);
	} catch (error) {
		throw normalizeFacadeError(error);
	}
	if (!envelope.success || envelope.data === undefined) {
		throw new PatentBackendError(422, envelope.error?.message || `Tool ${toolName} returned no data.`);
	}
	return envelope.data;
}

/**
 * When the seam threw a generic {@link PatentBackendError} carrying the facade's raw JSON error body
 * (`{ error: { code, message }, status, success: false }`), replace the message with the backend's own
 * `error.message` so the tool surfaces a clean sentence instead of a JSON blob. The typed gating errors
 * (auth/subscription/data-key/rate-limit) already hold clean messages that never start with `{`, so
 * they pass through untouched.
 */
function normalizeFacadeError(error: unknown): unknown {
	if (error instanceof PatentBackendError && error.message.trimStart().startsWith('{')) {
		try {
			const parsed = JSON.parse(error.message) as { error?: { message?: string } };
			if (parsed?.error?.message) {
				return new PatentBackendError(error.status, parsed.error.message);
			}
		} catch {
			// Not the facade error shape — leave the original error untouched.
		}
	}
	return error;
}
