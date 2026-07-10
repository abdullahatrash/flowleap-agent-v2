/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


import type { ApiProvider, ProviderResponse, CallApiContextParams, CallApiOptionsParams } from 'promptfoo';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const EVALS_DIR = path.resolve(__dirname, '..');

const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1';
// gemini-2.5-pro over -flash: the flash tier disobeys the prompt's explicit
// jurisdiction skip rules (3/40 baseline failures), which would make the
// regression gate fire on model weakness instead of prompt drift.
const DEFAULT_MODEL = 'google/gemini-2.5-pro';

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
 *   EVAL_MODEL          Default model slug when the provider config omits one. Default: google/gemini-2.5-pro
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

	constructor(options?: { config?: { model?: string }; id?: string; label?: string }, deps?: PatentAIProviderDeps) {
		this.configModel = options?.config?.model;
		this.fetchFn = deps?.fetch ?? globalThis.fetch;
		this.env = deps?.env ?? process.env;
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
		_context?: CallApiContextParams,
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
				{ role: 'system', content: systemPrompt },
				{ role: 'user', content: prompt },
			],
			tools: toolDefinitions,
			tool_choice: 'auto',
			stream: false,
			temperature: 0,
			max_tokens: 4096,
		};

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
				usage?: {
					prompt_tokens?: number;
					completion_tokens?: number;
					total_tokens?: number;
				};
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

			return {
				output: JSON.stringify(structured),
				tokenUsage: {
					total: data.usage?.total_tokens ?? 0,
					prompt: data.usage?.prompt_tokens ?? 0,
					completion: data.usage?.completion_tokens ?? 0,
				},
			};
		} catch (err) {
			return {
				error: `Request failed: ${err instanceof Error ? err.message : String(err)}`,
			};
		}
	}
}
