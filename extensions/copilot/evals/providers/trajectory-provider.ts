/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ApiProvider, ProviderResponse, CallApiContextParams, CallApiOptionsParams } from 'promptfoo';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { createMockScriptState, resolveMock, type MockScript, type MockTag } from './mock-tool-table';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const EVALS_DIR = path.resolve(__dirname, '..');

const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1';
// Same pin as the single-turn suite (patent-ai-provider.ts): gemini-2.5-pro obeys the
// prompt's skip rules where -flash does not. Holding the model fixed is the point — this
// gate must fire on prompt / tool-string / skill drift, not on model choice (H4 §2).
const DEFAULT_MODEL = 'google/gemini-2.5-pro';
/** Loop cap: above the ~6-retry grinds seen in H3, below a runaway (H4 §2). */
const DEFAULT_MAX_ROUNDS = 8;

function loadSystemPrompt(): string {
	return fs.readFileSync(path.join(EVALS_DIR, 'prompts', 'system-prompt.txt'), 'utf-8');
}

interface ToolDefinition {
	readonly type: string;
	readonly function: { readonly name: string; readonly description: string; readonly parameters: Record<string, unknown> };
}

function loadToolDefinitions(): ToolDefinition[] {
	return JSON.parse(fs.readFileSync(path.join(EVALS_DIR, 'prompts', 'tool-definitions.json'), 'utf-8'));
}

// Cached across instances (same pattern as the single-turn provider).
const systemPrompt = loadSystemPrompt();
const toolDefinitions = loadToolDefinitions();

/** One tool call as it appears in the returned trajectory: name, parsed args, and the mock tag of its result. */
interface TrajectoryToolCall {
	readonly name: string;
	readonly args: Record<string, unknown>;
	readonly mockTag: MockTag;
}

/** The structured object assertions JSON.parse — the multi-turn analogue of the single-turn `{text, tool_calls}`. */
interface Trajectory {
	readonly rounds: ReadonlyArray<{ readonly toolCalls: readonly TrajectoryToolCall[] }>;
	readonly finalText: string;
	readonly stoppedReason: 'no_more_tools' | 'max_rounds';
}

/** OpenAI-shaped chat message the loop appends as it runs. */
interface ChatMessage {
	readonly role: 'system' | 'user' | 'assistant' | 'tool';
	readonly content: string | null;
	readonly tool_calls?: ReadonlyArray<{ id: string; type: string; function: { name: string; arguments: string } }>;
	readonly tool_call_id?: string;
}

interface ChatChoice {
	readonly message: {
		readonly content?: string;
		readonly tool_calls?: Array<{ id: string; type: string; function: { name: string; arguments: string } }>;
	};
}

/** Collaborators promptfoo never supplies — overridden only by tests, so production always gets the real fetch/env/loader. */
export interface TrajectoryProviderDeps {
	readonly fetch?: typeof fetch;
	readonly env?: NodeJS.ProcessEnv;
	/** Resolve a mockScript id to a loaded script. Defaults to reading `fixtures/trajectory/<id>.json`. */
	readonly loadScript?: (id: string) => MockScript;
}

function defaultLoadScript(id: string): MockScript {
	const fixturePath = path.join(EVALS_DIR, 'fixtures', 'trajectory', `${id}.json`);
	return JSON.parse(fs.readFileSync(fixturePath, 'utf-8')) as MockScript;
}

function safeParseArgs(raw: string): Record<string, unknown> {
	try {
		const parsed = JSON.parse(raw);
		return parsed && typeof parsed === 'object' ? parsed : {};
	} catch {
		return {};
	}
}

/**
 * Trajectory (multi-turn replay) eval provider — the H4 trajectory gate.
 *
 * Where {@link file://./patent-ai-provider.ts} does ONE round-trip and grades one-shot tool
 * selection, this provider runs the WHOLE agent loop locally against a scripted mock tool
 * table: system prompt + user prompt → model → resolve each tool call against the case's
 * `mockScript` fixture → append the canned result → loop, up to `maxRounds`. It returns a
 * JSON-serialized {@link Trajectory} so `javascript`/`llm-rubric` assertions can inspect the
 * ordered tool-call sequence under scripted EMPTY / 5xx / TRUNCATED failures.
 *
 * The failure bodies are canned fixtures (never live), so at temperature 0 with a fixed model
 * the loop is deterministic. The mockScript id is read from the case's `vars.mockScript`.
 *
 * Configuration (env, read at call time — shared with the single-turn provider):
 *   EVAL_API_BASE_URL  Chat completions base URL. Default https://openrouter.ai/api/v1
 *   EVAL_API_KEY        API key (falls back to OPENROUTER_API_KEY). Required.
 *   EVAL_MODEL          Model slug when config omits one. Default google/gemini-2.5-pro
 *   EVAL_MAX_ROUNDS     Loop cap. Default 8.
 */
export default class TrajectoryProvider implements ApiProvider {
	private readonly configModel: string | undefined;
	private readonly configMaxRounds: number | undefined;
	private readonly fetchFn: typeof fetch;
	private readonly env: NodeJS.ProcessEnv;
	private readonly loadScript: (id: string) => MockScript;

	constructor(options?: { config?: { model?: string; maxRounds?: number }; id?: string; label?: string }, deps?: TrajectoryProviderDeps) {
		this.configModel = options?.config?.model;
		this.configMaxRounds = options?.config?.maxRounds;
		this.fetchFn = deps?.fetch ?? globalThis.fetch;
		this.env = deps?.env ?? process.env;
		this.loadScript = deps?.loadScript ?? defaultLoadScript;
	}

	id(): string {
		return `trajectory:${this.resolveModel()}`;
	}

	private resolveModel(): string {
		return this.configModel || this.env.EVAL_MODEL || DEFAULT_MODEL;
	}

	private resolveMaxRounds(): number {
		const fromEnv = this.env.EVAL_MAX_ROUNDS ? Number(this.env.EVAL_MAX_ROUNDS) : undefined;
		return this.configMaxRounds ?? (Number.isFinite(fromEnv) ? fromEnv! : DEFAULT_MAX_ROUNDS);
	}

	private resolveBaseUrl(): string {
		return (this.env.EVAL_API_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '');
	}

	private resolveApiKey(): string | undefined {
		return this.env.EVAL_API_KEY || this.env.OPENROUTER_API_KEY;
	}

	private async chat(apiKey: string, messages: readonly ChatMessage[], withTools: boolean): Promise<ChatChoice> {
		const body: Record<string, unknown> = {
			model: this.resolveModel(),
			messages,
			stream: false,
			temperature: 0,
			max_tokens: 4096,
		};
		if (withTools) {
			body.tools = toolDefinitions;
			body.tool_choice = 'auto';
		}
		const response = await this.fetchFn(`${this.resolveBaseUrl()}/chat/completions`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
			body: JSON.stringify(body),
		});
		if (!response.ok) {
			throw new Error(`API returned ${response.status}: ${await response.text()}`);
		}
		const data = await response.json() as { choices: ChatChoice[] };
		const choice = data.choices?.[0];
		if (!choice) {
			throw new Error('No choices in response');
		}
		return choice;
	}

	async callApi(
		prompt: string,
		context?: CallApiContextParams,
		_options?: CallApiOptionsParams,
	): Promise<ProviderResponse> {
		const apiKey = this.resolveApiKey();
		if (!apiKey) {
			return { error: 'No API key configured. Set EVAL_API_KEY or OPENROUTER_API_KEY before running the trajectory gate.' };
		}

		const scriptId = context?.vars?.mockScript;
		if (typeof scriptId !== 'string' || !scriptId) {
			return { error: 'Trajectory case is missing a `mockScript` var naming a fixture under fixtures/trajectory/.' };
		}
		let script: MockScript;
		try {
			script = this.loadScript(scriptId);
		} catch (err) {
			return { error: `Failed to load mockScript "${scriptId}": ${err instanceof Error ? err.message : String(err)}` };
		}
		const scriptState = createMockScriptState(script);
		const maxRounds = this.resolveMaxRounds();

		const messages: ChatMessage[] = [
			{ role: 'system', content: systemPrompt },
			{ role: 'user', content: prompt },
		];
		const rounds: Array<{ toolCalls: TrajectoryToolCall[] }> = [];
		let finalText = '';
		let stoppedReason: Trajectory['stoppedReason'] = 'max_rounds';

		try {
			for (let round = 0; round < maxRounds; round++) {
				const choice = await this.chat(apiKey, messages, /*withTools*/ true);
				const toolCalls = choice.message.tool_calls ?? [];
				if (toolCalls.length === 0) {
					finalText = choice.message.content ?? '';
					stoppedReason = 'no_more_tools';
					break;
				}

				// Record the assistant turn so the model sees its own calls on the next round.
				messages.push({ role: 'assistant', content: choice.message.content ?? '', tool_calls: toolCalls });

				const roundCalls: TrajectoryToolCall[] = [];
				for (const tc of toolCalls) {
					const args = safeParseArgs(tc.function.arguments);
					const mock = resolveMock(script, scriptState, tc.function.name, args);
					roundCalls.push({ name: tc.function.name, args, mockTag: mock.tag });
					messages.push({ role: 'tool', tool_call_id: tc.id, content: mock.body });
				}
				rounds.push({ toolCalls: roundCalls });
			}

			// Loop ran to the cap without a clean stop: take one final no-tools turn so the
			// judge has the model's actual give-up/summary narration to grade.
			if (stoppedReason === 'max_rounds') {
				try {
					const wrap = await this.chat(apiKey, messages, /*withTools*/ false);
					finalText = wrap.message.content ?? '';
				} catch {
					finalText = '';
				}
			}
		} catch (err) {
			return { error: `Trajectory run failed: ${err instanceof Error ? err.message : String(err)}` };
		}

		const trajectory: Trajectory = { rounds, finalText, stoppedReason };
		return { output: JSON.stringify(trajectory) };
	}
}
