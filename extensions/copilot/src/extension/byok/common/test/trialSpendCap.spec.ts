/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { looksLikeSpendCapRejection } from '../trialSpendCap';

describe('looksLikeSpendCapRejection (ADR 0015 cap rendering, #243)', () => {

	it('recognises the typed quota-exceeded classification (HTTP 402)', () => {
		expect(looksLikeSpendCapRejection('ChatQuotaExceeded', 'Quota Exceeded\n\nServer Error: This request requires more credits\nError Code: 402')).toBe(true);
	});

	it('recognises OpenRouter credit/spend wording when the typed name was lost', () => {
		expect(looksLikeSpendCapRejection(undefined, 'Insufficient credits. Add more using https://openrouter.ai/settings/credits')).toBe(true);
		expect(looksLikeSpendCapRejection('Error', 'This request requires more credits, or fewer max_tokens.')).toBe(true);
		expect(looksLikeSpendCapRejection('Error', 'Key limit exceeded')).toBe(true);
	});

	it('leaves every other failure alone (auth rejection, token limits, transport)', () => {
		expect(looksLikeSpendCapRejection('Error', 'User not found.')).toBe(false);
		expect(looksLikeSpendCapRejection('Error', 'Message exceeds token limit.')).toBe(false);
		expect(looksLikeSpendCapRejection(undefined, 'socket hang up')).toBe(false);
		expect(looksLikeSpendCapRejection('ChatRateLimited', 'Rate limit exceeded: free-models-per-min')).toBe(false);
	});
});
