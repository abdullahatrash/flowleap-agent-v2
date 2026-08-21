/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * The `Error.name` the language-model wrapper assigns when a chat request failed with
 * `ChatFetchResponseType.QuotaExceeded` (an HTTP 402 from the provider) — see
 * `languageModelAccess.ts`. For a FlowLeap Trial model this is OpenRouter rejecting the
 * backend-provisioned key because the daily spend cap is exhausted (ADR 0015).
 */
export const QUOTA_EXCEEDED_ERROR_NAME = 'ChatQuotaExceeded';

/**
 * OpenRouter's spend/credit-cap rejection wording, matched as a fallback for the cases where the
 * typed `ChatQuotaExceeded` name was lost on the way up (e.g. the reason was flattened into a
 * plain error message). Deliberately narrow: phrases OpenRouter uses for credit/spend exhaustion
 * ("Insufficient credits", "This request requires more credits", key/spend limits) plus the
 * wrapper's own "Quota Exceeded" rendering — never a bare "limit", which would also match
 * unrelated token-limit errors.
 */
const CAP_MESSAGE_PATTERN = /insufficient credits|requires? more credits|credit limit|key limit|spend(?:ing)? (?:limit|cap)|quota exceeded/i;

/**
 * Whether a chat-request failure looks like the trial key's daily spend cap being exhausted
 * (ADR 0015 cap rendering, #243). Pure so the shape is unit-testable without a provider.
 */
export function looksLikeSpendCapRejection(errorName: string | undefined, message: string): boolean {
	if (errorName === QUOTA_EXCEEDED_ERROR_NAME) {
		return true;
	}
	return CAP_MESSAGE_PATTERN.test(message);
}
