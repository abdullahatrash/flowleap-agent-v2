/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


import type { ApiProvider, ProviderResponse, CallApiContextParams, CallApiOptionsParams } from 'promptfoo';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { readTokenUsage, systemMessage, type ChatCompletionTokenUsage, type ChatCompletionUsage } from './chat-completions';
import { isResponseCacheEnabled, ResponseCache } from './response-cache';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const EVALS_DIR = path.resolve(__dirname, '..');

const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1';
// claude-sonnet-5: the app's primary tested model (2026-08-12) — the eval subject
// should mirror what users actually run. Historical note on the retired default,
// gemini-2.5-pro over -flash: the flash tier disobeys the prompt's explicit
// jurisdiction skip rules (3/40 baseline failures), which would make the
// regression gate fire on model weakness instead of prompt drift.
const DEFAULT_MODEL = 'anthropic/claude-sonnet-5';
// Under evals/output, which .gitignore keeps out of the repo.
const DEFAULT_CACHE_DIR = path.join(EVALS_DIR, 'output', 'response-cache');

function loadSystemPrompt(): string {
	const promptPath = path.join(EVALS_DIR, 'prompts', 'system-prompt.txt');
	return fs.readFileSync(promptPath, 'utf-8');
}

function loadToolDefinitions(): Array<{
	type: string;
	function: { name: string; description: string; parameters: Record<string, unknown> };
}> {
	const toolsPath = path.join(EVALS_DIR, 'prompts', 'tool-definitions.json');
	return JSON.parse(fs.readFileSync(toolsPath, 'utf-8'));
}

// Cached across instances
const systemPrompt = loadSystemPrompt();
const toolDefinitions = loadToolDefinitions();

/** Collaborators promptfoo never supplies — overridden only by tests, so production always gets the real fetch/env. */
export interface PatentAIProviderDeps {
	readonly fetch?: typeof fetch;
	readonly env?: NodeJS.ProcessEnv;
	/** Where the response cache lives. Default: evals/output/response-cache. */
	readonly cacheDir?: string;
}

/** What the response cache stores per request: the output contract and the live usage. */
interface CachedResponse {
	readonly output: string;
	readonly tokenUsage: ChatCompletionTokenUsage;
}

/**
 * Patent AI eval provider.
 *
 * Talks directly to a BYOK-compatible, OpenAI-shaped chat completions endpoint
 * (OpenRouter by default). The retired `${PATENT_API_URL}/v1/chat/completions`
 * backend proxy now returns 410 Gone — inference moved client-side with the
 * BYOK migration, so this provider brings its own key instead of routing
 * through the backend.
 *
 * Configuration (read from the environment at call time):
 *   EVAL_API_BASE_URL  Base URL for the chat completions API. Default: https://openrouter.ai/api/v1
 *   EVAL_API_KEY        API key. Falls back to OPENROUTER_API_KEY. Required — no unauthenticated requests.
 *   EVAL_MODEL          Default model slug when the provider config omits one. Default: anthropic/claude-sonnet-5
 *   EVAL_PROMPT_CACHE   Set to 0 to send the system prompt without an Anthropic cache breakpoint.
 *   PROMPTFOO_CACHE_ENABLED  `false` (what the launcher sets for `--no-cache`) bypasses the
 *                       response cache (see response-cache.ts); every call then reaches the model.
 *
 * Usage in promptfooconfig.yaml:
 *   providers:
 *     - id: file://providers/patent-ai-provider.ts
 *       label: "Claude Sonnet"
 *       config:
 *         model: anthropic/claude-sonnet-4.5
 */
export default class PatentAIProvider implements ApiProvider {
	private readonly configModel: string | undefined;
	private readonly fetchFn: typeof fetch;
	private readonly env: NodeJS.ProcessEnv;
	private readonly cache: ResponseCache;

	constructor(options?: { config?: { model?: string }; id?: string; label?: string }, deps?: PatentAIProviderDeps) {
		this.configModel = options?.config?.model;
		this.fetchFn = deps?.fetch ?? globalThis.fetch;
		this.env = deps?.env ?? process.env;
		this.cache = new ResponseCache(deps?.cacheDir ?? DEFAULT_CACHE_DIR);
	}

	id(): string {
		return this.resolveModel();
	}

	private resolveModel(): string {
		return this.configModel || this.env.EVAL_MODEL || DEFAULT_MODEL;
	}

	private resolveBaseUrl(): string {
		const raw = this.env.EVAL_API_BASE_URL || DEFAULT_BASE_URL;
		return raw.replace(/\/+$/, '');
	}

	private resolveApiKey(): string | undefined {
		return this.env.EVAL_API_KEY || this.env.OPENROUTER_API_KEY;
	}

	async callApi(
		prompt: string,
		context?: CallApiContextParams,
		_options?: CallApiOptionsParams,
	): Promise<ProviderResponse> {
		const apiKey = this.resolveApiKey();
		if (!apiKey) {
			return {
				error: 'No API key configured. Set EVAL_API_KEY or OPENROUTER_API_KEY before running evals.',
			};
		}

		const body: Record<string, unknown> = {
			model: this.resolveModel(),
			messages: [
				systemMessage(systemPrompt, this.env),
				{ role: 'user', content: prompt },
			],
			tools: toolDefinitions,
			tool_choice: 'auto',
			stream: false,
			temperature: 0,
			max_tokens: 4096,
		};

		// The key is the whole body: model, messages, tools and sampling parameters.
		const useCache = isResponseCacheEnabled(this.env, context);
		const replay = useCache ? this.cache.get<CachedResponse>(body) : undefined;
		if (replay) {
			// promptfoo's own convention for a replayed response: all tokens counted as cached, no live prompt/completion.
			return { output: replay.output, tokenUsage: { total: replay.tokenUsage.total, cached: replay.tokenUsage.total }, cached: true };
		}

		try {
			const response = await this.fetchFn(`${this.resolveBaseUrl()}/chat/completions`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Authorization': `Bearer ${apiKey}`,
				},
				body: JSON.stringify(body),
			});

			if (!response.ok) {
				return {
					error: `API returned ${response.status}: ${await response.text()}`,
				};
			}

			const data = await response.json() as {
				choices: Array<{
					message: {
						content?: string;
						tool_calls?: Array<{
							id: string;
							type: string;
							function: { name: string; arguments: string };
						}>;
					};
				}>;
				model?: string;
				usage?: ChatCompletionUsage;
			};

			const choice = data.choices[0];
			if (!choice) {
				return { error: 'No choices in response' };
			}

			// promptfoo requires output to be a string.
			// JSON-stringify a structured object so assertions can JSON.parse it.
			const structured = {
				text: choice.message.content || '',
				tool_calls: choice.message.tool_calls || [],
			};

			const result: CachedResponse = {
				output: JSON.stringify(structured),
				tokenUsage: readTokenUsage(data.usage),
			};
			if (useCache) {
				this.cache.set(body, result);
			}
			return result;
		} catch (err) {
			return {
				error: `Request failed: ${err instanceof Error ? err.message : String(err)}`,
			};
		}
	}
}
