/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ILogService } from '../../../platform/log/common/logService';
import { LanguageModelTextPart, LanguageModelToolResult } from '../../../vscodeTypes';
import { PatentBackendError, patentBackendErrorRecoveryHint } from '../../patentai/vscode-node/patentBackendClient';

/**
 * Shared `catch` handler for every patent tool that reaches the backend through the
 * {@link IPatentBackendClient} seam. The tools had an identical block: return `Request cancelled.`
 * on cancellation, otherwise log the failure and surface a tool-specific message with the
 * model-facing recovery hint appended (`401 → sign in`, `402 → start trial`, `400 → data keys`,
 * `429 → wait and retry`), falling back to a generic message for non-backend exceptions.
 *
 * Centralising it keeps the typed-error UX ({@link patentBackendErrorRecoveryHint}) identical across
 * tools. Each tool supplies only the parts that differ:
 * - `logPrefix` — the tool's log tag, e.g. `[SearchCitationsTool]`.
 * - `formatBackendError` — the user-facing lead-in for a {@link PatentBackendError} (status/message
 *   are on the error), rendered before the recovery hint.
 * - `trailingHint` — optional extra text appended *after* the recovery hint (e.g. a 404 fallback
 *   note), preserving the exact ordering the tool had before.
 */
export function handlePatentToolError(
	error: unknown,
	logService: ILogService,
	logPrefix: string,
	formatBackendError: (error: PatentBackendError) => string,
	trailingHint?: (error: PatentBackendError) => string,
): LanguageModelToolResult {
	if (error instanceof PatentBackendError) {
		if (error.message === 'Request cancelled.') {
			return new LanguageModelToolResult([new LanguageModelTextPart('Request cancelled.')]);
		}
		logService.error(`${logPrefix} Backend error ${error.status}: ${error.message}`);
		const tail = trailingHint ? trailingHint(error) : '';
		return new LanguageModelToolResult([
			new LanguageModelTextPart(formatBackendError(error) + patentBackendErrorRecoveryHint(error) + tail)
		]);
	}
	logService.error(`${logPrefix} Exception: ${error instanceof Error ? error.message : String(error)}`);
	return new LanguageModelToolResult([
		new LanguageModelTextPart(`Error: ${error instanceof Error ? error.message : 'Unknown error occurred'}`)
	]);
}
