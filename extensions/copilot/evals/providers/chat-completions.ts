/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * The OpenAI-shaped chat-completions call that the trajectory and skill-grounded providers share:
 * the endpoint, the cached system message and the checks on the response.
 */

const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1';

/**
 * A system-message content part carrying an Anthropic prompt-cache breakpoint. OpenRouter
 * forwards `cache_control` to Anthropic models and ignores it for the rest, so the fixed
 * prefix (tool definitions + system prompt, ~31k tokens, resent on every round of every
 * trajectory) is billed at the cache-read rate from the second round on. Measured need: the
 * 2026-09-02 gate spent ~$20 with the prefix at full input price on every round.
 */
export interface CachedTextPart {
	readonly type: 'text';
	readonly text: string;
	readonly cache_control: { readonly type: 'ephemeral' };
}

/** The system message. Prompt caching is on unless EVAL_PROMPT_CACHE=0 (e.g. to measure the uncached cost). */
export function systemMessage(text: string, env: NodeJS.ProcessEnv): { readonly role: 'system'; readonly content: string | readonly CachedTextPart[] } {
	return {
		role: 'system',
		content: env.EVAL_PROMPT_CACHE !== '0' ? [{ type: 'text', text, cache_control: { type: 'ephemeral' } }] : text,
	};
}

/** The `usage` block of a chat-completions response, in the two wire shapes the eval subjects return. */
export interface ChatCompletionUsage {
	readonly prompt_tokens?: number;
	readonly completion_tokens?: number;
	readonly total_tokens?: number;
	/** OpenRouter: the prompt tokens served from the Anthropic prompt cache. */
	readonly prompt_tokens_details?: { readonly cached_tokens?: number };
	/** Anthropic-native: the same count under its own name. */
	readonly cache_read_input_tokens?: number;
}

/** promptfoo's per-response token usage; `cached` is present only when the response reports a prompt-cache read. */
export interface ChatCompletionTokenUsage {
	readonly total: number;
	readonly prompt: number;
	readonly completion: number;
	readonly cached?: number;
}

/**
 * Maps a response `usage` block to promptfoo's token usage, so the output file shows how many
 * prompt tokens the cache breakpoint saved (issue #831: the saving is measured, not assumed).
 */
export function readTokenUsage(usage: ChatCompletionUsage | undefined): ChatCompletionTokenUsage {
	const cached = usage?.prompt_tokens_details?.cached_tokens ?? usage?.cache_read_input_tokens;
	return {
		total: usage?.total_tokens ?? 0,
		prompt: usage?.prompt_tokens ?? 0,
		completion: usage?.completion_tokens ?? 0,
		...(cached === undefined ? {} : { cached }),
	};
}

/** The fields of a response choice that say whether the upstream model failed. */
export interface ChoiceStatus {
	/** OpenRouter reports an upstream failure (e.g. a 429) INSIDE a 200 body, as this pair. */
	readonly finish_reason?: string;
	readonly error?: { readonly code?: number; readonly message?: string };
}

/** A failed chat-completions request: an HTTP error, no choice, or an upstream error in a 200 body. */
export class ChatCompletionError extends Error { }

/** One chat-completions request. */
export interface ChatCompletionRequest {
	readonly fetch: typeof fetch;
	/** Reads EVAL_API_BASE_URL (default: OpenRouter). */
	readonly env: NodeJS.ProcessEnv;
	readonly apiKey: string;
	readonly body: Record<string, unknown>;
}

/**
 * Sends one chat-completions request and returns its first choice. Throws a
 * {@link ChatCompletionError} when the request fails, when the response has no choice, or when
 * the choice carries an upstream error.
 */
export async function requestChatCompletion<TChoice extends ChoiceStatus>(request: ChatCompletionRequest): Promise<TChoice> {
	const baseUrl = (request.env.EVAL_API_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '');
	const response = await request.fetch(`${baseUrl}/chat/completions`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${request.apiKey}` },
		body: JSON.stringify(request.body),
	});
	if (!response.ok) {
		throw new ChatCompletionError(`API returned ${response.status}: ${await response.text()}`);
	}
	const choice = (await response.json() as { choices?: TChoice[] }).choices?.[0];
	if (!choice) {
		throw new ChatCompletionError('No choices in response');
	}
	// An upstream failure arrives as a 200 whose choice carries `finish_reason: 'error'` and a
	// null message. Reading that as "the model answered nothing" would silently score a
	// rate-limited round as a give-up; surface it so promptfoo reports an ERROR, not a verdict.
	if (choice.finish_reason === 'error' || choice.error) {
		throw new ChatCompletionError(`Upstream error in a 200 response (finish_reason=${choice.finish_reason}): ${choice.error?.message ?? 'no detail'}`);
	}
	return choice;
}
