/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it, vi } from 'vitest';
import { ByokKeyRejectionNotifier, byokKeyRejectionReason, looksLikeByokKeyRejection } from '../byokKeyRejection';

describe('looksLikeByokKeyRejection', () => {

	it('matches the known provider auth-error shapes and rejects unrelated errors', () => {
		expect([
			// OpenAI-compatible via chatMLFetcher
			looksLikeByokKeyRejection('token expired or invalid: 401'),
			looksLikeByokKeyRejection('Incorrect API key provided: sk-or-v1***. You can find your API key at https://platform.openai.com.'),
			// Anthropic SDK
			looksLikeByokKeyRejection('401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}'),
			// Gemini
			looksLikeByokKeyRejection('API key not valid. Please pass a valid API key.'),
			looksLikeByokKeyRejection('403 PERMISSION_DENIED'),
			// unrelated errors must not be misclassified
			looksLikeByokKeyRejection('Message exceeds token limit.'),
			looksLikeByokKeyRejection('Response contained no choices.'),
			looksLikeByokKeyRejection('Request timed out after 30000 ms.'),
			looksLikeByokKeyRejection('500 Internal Server Error'),
		]).toEqual([true, true, true, true, true, false, false, false, false]);
	});
});

describe('byokKeyRejectionReason', () => {

	it('names the provider, keeps a truncated first line of detail, and carries the manage-models command link', () => {
		const reason = byokKeyRejectionReason('openrouter', 'Incorrect API key provided\nstack line one\nstack line two');
		expect(reason).toBe('Your openrouter API key was rejected by the provider (Incorrect API key provided). Update the key, then retry: [Manage Models](command:workbench.action.chat.manage)');

		const long = byokKeyRejectionReason('openai', 'x'.repeat(300));
		expect(long).toContain('x'.repeat(200) + '…');
	});
});

describe('ByokKeyRejectionNotifier', () => {

	function makeNotifier(choice: string | undefined, start = 1_000) {
		let now = start;
		const showWarningMessage = vi.fn(async () => choice);
		const executeCommand = vi.fn(async () => undefined);
		const notifier = new ByokKeyRejectionNotifier({ showWarningMessage, executeCommand, now: () => now });
		return { notifier, showWarningMessage, executeCommand, advance: (ms: number) => { now += ms; } };
	}

	it('opens Manage Models when the action is accepted', async () => {
		const { notifier, showWarningMessage, executeCommand } = makeNotifier('Manage Models');

		notifier.notify('OpenRouter');
		await new Promise(resolve => setImmediate(resolve));

		expect(showWarningMessage).toHaveBeenCalledWith(expect.stringContaining('OpenRouter'), 'Manage Models');
		expect(executeCommand).toHaveBeenCalledWith('workbench.action.chat.manage');
	});

	it('debounces per provider, re-notifies after the interval, and never runs the command when dismissed', async () => {
		const { notifier, showWarningMessage, executeCommand, advance } = makeNotifier(undefined);

		notifier.notify('Gemini');
		notifier.notify('Gemini');       // debounced
		notifier.notify('Anthropic');    // different provider — not debounced
		advance(61_000);
		notifier.notify('Gemini');       // past the interval — notifies again
		await new Promise(resolve => setImmediate(resolve));

		expect(showWarningMessage).toHaveBeenCalledTimes(3);
		expect(executeCommand).not.toHaveBeenCalled();
	});
});
