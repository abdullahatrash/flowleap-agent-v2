/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, test } from 'vitest';
import { ChatFetchResponseType, getErrorDetailsFromChatFetchError, type ChatFetchError } from '../../common/commonTypes';
import { GitHubOutageStatus } from '../../../github/common/githubService';

function makeQuotaExceededError(capiError?: { code?: string; message?: string }): ChatFetchError {
	return {
		type: ChatFetchResponseType.QuotaExceeded,
		reason: 'quota exceeded',
		requestId: 'req-1',
		serverRequestId: 'srv-1',
		retryAfter: undefined,
		capiError,
	};
}

describe('getErrorDetailsFromChatFetchError', () => {
	describe('QuotaExceeded with additional_spend_limit_reached', () => {
		test('returns manage budget link for individual plan', () => {
			const result = getErrorDetailsFromChatFetchError(
				makeQuotaExceededError({ code: 'additional_spend_limit_reached', message: 'Spend limit reached' }),
				'individual',
				GitHubOutageStatus.None,
			);

			expect(result.isQuotaExceeded).toBe(true);
			expect(result.code).toBe('additional_spend_limit_reached');
			expect(result.message).toContain('additional usage limit');
			expect(result.message).toContain('Manage Budget');
			expect(result.message).toContain('https://github.com/settings/copilot/features');
		});

		test('returns contact admin message for business plan', () => {
			const result = getErrorDetailsFromChatFetchError(
				makeQuotaExceededError({ code: 'additional_spend_limit_reached', message: 'Spend limit reached' }),
				'business',
				GitHubOutageStatus.None,
			);

			expect(result.isQuotaExceeded).toBe(true);
			expect(result.code).toBe('additional_spend_limit_reached');
			expect(result.message).toContain('additional usage limit');
			expect(result.message).toContain('contact your admin');
		});

		test('returns contact admin message for enterprise plan', () => {
			const result = getErrorDetailsFromChatFetchError(
				makeQuotaExceededError({ code: 'additional_spend_limit_reached', message: 'Spend limit reached' }),
				'enterprise',
				GitHubOutageStatus.None,
			);

			expect(result.isQuotaExceeded).toBe(true);
			expect(result.code).toBe('additional_spend_limit_reached');
			expect(result.message).toContain('contact your admin');
		});
	});

	describe('QuotaExceeded with quota_exceeded', () => {
		test('returns per-plan message for individual plan', () => {
			const result = getErrorDetailsFromChatFetchError(
				makeQuotaExceededError({ code: 'quota_exceeded', message: 'Quota exceeded' }),
				'individual',
				GitHubOutageStatus.None,
			);

			expect(result.isQuotaExceeded).toBe(true);
			expect(result.message).toContain('premium model quota');
		});

		test('returns per-plan message for free plan', () => {
			const result = getErrorDetailsFromChatFetchError(
				makeQuotaExceededError({ code: 'quota_exceeded', message: 'Quota exceeded' }),
				'free',
				GitHubOutageStatus.None,
			);

			expect(result.isQuotaExceeded).toBe(true);
			expect(result.message).toContain('monthly chat messages quota');
		});
	});

	describe('QuotaExceeded with free_quota_exceeded', () => {
		test('remaps to quota_exceeded and returns per-plan message', () => {
			const result = getErrorDetailsFromChatFetchError(
				makeQuotaExceededError({ code: 'free_quota_exceeded', message: 'Free quota exceeded' }),
				'free',
				GitHubOutageStatus.None,
			);

			expect(result.isQuotaExceeded).toBe(true);
			expect(result.message).toContain('monthly chat messages quota');
		});
	});

	describe('QuotaExceeded with overage_limit_reached', () => {
		test('returns support contact message', () => {
			const result = getErrorDetailsFromChatFetchError(
				makeQuotaExceededError({ code: 'overage_limit_reached', message: 'Overage limit reached' }),
				'individual',
				GitHubOutageStatus.None,
			);

			expect(result.isQuotaExceeded).toBe(true);
			expect(result.message).toContain('GitHub Support');
		});
	});

	describe('QuotaExceeded without CAPI error code', () => {
		test('preserves fetchResult.type as code when no capiError code', () => {
			const result = getErrorDetailsFromChatFetchError(
				makeQuotaExceededError(),
				'individual',
				GitHubOutageStatus.None,
			);

			expect(result.isQuotaExceeded).toBe(true);
			expect(result.code).toBe(ChatFetchResponseType.QuotaExceeded);
		});

		test('preserves fetchResult.type as code when capiError has no code', () => {
			const result = getErrorDetailsFromChatFetchError(
				makeQuotaExceededError({ message: 'Some message' }),
				'individual',
				GitHubOutageStatus.None,
			);

			expect(result.isQuotaExceeded).toBe(true);
			expect(result.code).toBe(ChatFetchResponseType.QuotaExceeded);
		});
	});

	describe('QuotaExceeded with unknown CAPI error code', () => {
		test('shows server error message with unknown code', () => {
			const result = getErrorDetailsFromChatFetchError(
				makeQuotaExceededError({ code: 'unknown_error', message: 'Something went wrong' }),
				'individual',
				GitHubOutageStatus.None,
			);

			expect(result.isQuotaExceeded).toBe(true);
			expect(result.code).toBe('unknown_error');
			expect(result.message).toContain('Something went wrong');
			expect(result.message).toContain('unknown_error');
		});
	});

	describe('ProviderAuthFailed (issue #210)', () => {
		// The literal body OpenRouter returns for an unrecognised key, captured by curl
		// on 2026-08-09: {"error":{"message":"User not found.","code":401}}. chatMLFetcher
		// reads `jsonData.message` off it, so this is verbatim what reaches the renderer.
		const OPENROUTER_INVALID_KEY = 'User not found.';

		function makeProviderAuthFailed(overrides: Partial<Extract<ChatFetchError, { type: ChatFetchResponseType.ProviderAuthFailed }>> = {}): ChatFetchError {
			return {
				type: ChatFetchResponseType.ProviderAuthFailed,
				reason: OPENROUTER_INVALID_KEY,
				requestId: '539216a4-46b0-4172-bfd0-292d3b731cbc',
				serverRequestId: undefined,
				modelProvider: 'OpenRouter',
				credentialSent: true,
				...overrides,
			};
		}

		test('names the key instead of leading with the provider wording', () => {
			const result = getErrorDetailsFromChatFetchError(makeProviderAuthFailed(), undefined, GitHubOutageStatus.None);

			expect({
				// The reported bug: "User not found." was the whole explanation, so a
				// signed-in user read it as their account being gone.
				leadsWithProviderProse: result.message.startsWith(OPENROUTER_INVALID_KEY),
				namesTheKey: result.message.includes('OpenRouter API key was rejected'),
				offersTheFix: result.message.includes('command:workbench.action.chat.manage'),
				keepsProviderTextAsDetail: result.message.includes(`Provider response: ${OPENROUTER_INVALID_KEY}`),
				// The old path used toErrorMessage(e, true), which appended a stack trace.
				leaksStack: /\bat \w+\./.test(result.message),
			}).toEqual({
				leadsWithProviderProse: false,
				namesTheKey: true,
				offersTheFix: true,
				keepsProviderTextAsDetail: true,
				leaksStack: false,
			});
		});

		test('a credential that never reached the wire blames the client, not the key', () => {
			const result = getErrorDetailsFromChatFetchError(
				makeProviderAuthFailed({ credentialSent: false, reason: 'No cookie auth credentials found' }),
				undefined,
				GitHubOutageStatus.None,
			);

			expect(result.message).toContain('No API key was sent to OpenRouter');
			expect(result.message).not.toContain('was rejected');
		});

		test('a message already rendered before the lm boundary is shown as-is', () => {
			const rendered = 'Your OpenRouter API key was rejected.';
			const result = getErrorDetailsFromChatFetchError(
				makeProviderAuthFailed({ reason: rendered, renderedMessage: rendered }),
				undefined,
				GitHubOutageStatus.None,
			);

			expect(result.message).toBe(rendered);
		});
	});
});
