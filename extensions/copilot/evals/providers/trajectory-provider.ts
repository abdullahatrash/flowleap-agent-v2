/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ApiProvider, ProviderResponse, CallApiContextParams, CallApiOptionsParams } from 'promptfoo';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { createMockScriptState, resolveMock, type MockScript, type MockScriptState, type MockTag } from './mock-tool-table';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const EVALS_DIR = path.resolve(__dirname, '..');

const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1';
// Same pin as the single-turn suite (patent-ai-provider.ts): claude-sonnet-5, the app's
// primary tested model. (Historical: gemini-2.5-pro obeyed the
// prompt's skip rules where -flash does not. Holding the model fixed is the point — this
// gate must fire on prompt / tool-string / skill drift, not on model choice (H4 §2).
const DEFAULT_MODEL = 'anthropic/claude-sonnet-5';
/**
 * Loop cap: above the ~6-retry grinds seen in H3, below a runaway (H4 §2). Deliberately kept
 * at 8 on sonnet-5 (#263): raising it to 12 changed case semantics — t7_bounded_engagement's
 * ≤16-call cap is calibrated to 8 rounds, and T3a's eventual success drowned in the extra
 * rounds. Sonnet-5 hits this cap routinely; the wrap-up nudge below is what turns a capped
 * run into a gradeable narration, not more rounds.
 */
const DEFAULT_MAX_ROUNDS = 8;

function loadSystemPrompt(): string {
	return fs.readFileSync(path.join(EVALS_DIR, 'prompts', 'system-prompt.txt'), 'utf-8');
}

/**
 * Load a key-state prompt variant (`prompts/key-state/<id>.txt`, written by
 * prompts/render-system-prompt.tsx). The key-state blocks render from props, so a case that
 * grades key-gate behavior must be run against the snapshot for ITS state, not the default one.
 */
function loadSystemPromptVariant(id: string): string {
	return fs.readFileSync(path.join(EVALS_DIR, 'prompts', 'key-state', `${id}.txt`), 'utf-8');
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
/** Key-state variants are loaded on first use — most cases never ask for one. */
const systemPromptVariants = new Map<string, string>();

/** One tool call as it appears in the returned trajectory: name, parsed args, the mock tag of its result, and the result body. */
interface TrajectoryToolCall {
	readonly name: string;
	readonly args: Record<string, unknown>;
	readonly mockTag: MockTag;
	/**
	 * The canned result body the model was handed for this call — the exact text the tool
	 * layer returned. Recorded so a grader can check the final answer against what actually
	 * came back rather than against which tools ran (#185): fabrication is invisible to the
	 * tag alone, since an OK web fetch that returns an elided stub and an OK web fetch that
	 * returns full claim text carry the same tag. Fixture bodies are small and canned, so
	 * this costs a few hundred bytes per call.
	 */
	readonly resultBody: string;
}

/**
 * The structured object assertions JSON.parse — the multi-turn analogue of the single-turn
 * `{text, tool_calls}`. `turn` is 0 for the whole run unless the case supplies a `followUpPrompt`,
 * in which case the rounds driven by that second user message carry `turn: 1` — how a resume case
 * tells "work done before the user spoke again" from "work done after".
 */
interface Trajectory {
	readonly rounds: ReadonlyArray<{ readonly turn: number; readonly toolCalls: readonly TrajectoryToolCall[] }>;
	/** The model's final message of the LAST turn. */
	readonly finalText: string;
	/** Final message per turn, in order — a resume case grades the pre-resume answer too. */
	readonly turnTexts: readonly string[];
	readonly stoppedReason: 'no_more_tools' | 'max_rounds';
}

/**
 * A system-message content part carrying an Anthropic prompt-cache breakpoint. OpenRouter
 * forwards `cache_control` to Anthropic models and ignores it for the rest, so the fixed
 * prefix (tool definitions + system prompt, ~31k tokens, resent on every round of every
 * trajectory) is billed at the cache-read rate from the second round on. Measured need: the
 * 2026-09-02 gate spent ~$20 with the prefix at full input price on every round.
 */
interface CachedTextPart {
	readonly type: 'text';
	readonly text: string;
	readonly cache_control: { readonly type: 'ephemeral' };
}

/** OpenAI-shaped chat message the loop appends as it runs. */
interface ChatMessage {
	readonly role: 'system' | 'user' | 'assistant' | 'tool';
	readonly content: string | null | readonly CachedTextPart[];
	readonly tool_calls?: ReadonlyArray<{ id: string; type: string; function: { name: string; arguments: string } }>;
	readonly tool_call_id?: string;
}

interface ChatChoice {
	readonly message: {
		readonly content?: string;
		readonly tool_calls?: Array<{ id: string; type: string; function: { name: string; arguments: string } }>;
	};
	/** OpenRouter reports an upstream failure (e.g. a 429) INSIDE a 200 body, as this pair. */
	readonly finish_reason?: string;
	readonly error?: { readonly code?: number; readonly message?: string };
}

/** Collaborators promptfoo never supplies — overridden only by tests, so production always gets the real fetch/env/loader. */
export interface TrajectoryProviderDeps {
	readonly fetch?: typeof fetch;
	readonly env?: NodeJS.ProcessEnv;
	/** Resolve a mockScript id to a loaded script. Defaults to reading `fixtures/<fixtureDir>/<id>.json`. */
	readonly loadScript?: (id: string) => MockScript;
}

/** Fixture folder a config that does not name one reads from — the original trajectory gate's. */
const DEFAULT_FIXTURE_DIR = 'trajectory';

function defaultLoadScript(fixtureDir: string, id: string): MockScript {
	const fixturePath = path.join(EVALS_DIR, 'fixtures', fixtureDir, `${id}.json`);
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
 * Two OPT-IN case vars extend the loop for the key-gate suite (promptfooconfig.key-gate.yaml);
 * a case that omits them behaves exactly as before:
 *   `systemPromptVariant`  Render the run against `prompts/key-state/<id>.txt` instead of the
 *                          default snapshot — the key-state blocks depend on props, so a case
 *                          about a gated office must see the prompt that user would get.
 *   `followUpPrompt`       A SECOND user message, sent once the first turn settles (e.g. "I added
 *                          the key"). Its rounds carry `turn: 1`, so a resume case can assert on
 *                          post-resume work alone.
 *
 * Configuration (env, read at call time — shared with the single-turn provider):
 *   EVAL_API_BASE_URL  Chat completions base URL. Default https://openrouter.ai/api/v1
 *   EVAL_API_KEY        API key (falls back to OPENROUTER_API_KEY). Required.
 *   EVAL_MODEL          Model slug when config omits one. Default anthropic/claude-sonnet-5
 *   EVAL_MAX_ROUNDS     Loop cap. Default 8.
 *   EVAL_PROMPT_CACHE   Set to 0 to send the system prompt without an Anthropic cache
 *                       breakpoint (full input price every round). Default: cached.
 */
export default class TrajectoryProvider implements ApiProvider {
	private readonly configModel: string | undefined;
	private readonly configMaxRounds: number | undefined;
	private readonly fetchFn: typeof fetch;
	private readonly env: NodeJS.ProcessEnv;
	private readonly loadScript: (id: string) => MockScript;

	constructor(options?: { config?: { model?: string; maxRounds?: number; fixtureDir?: string }; id?: string; label?: string }, deps?: TrajectoryProviderDeps) {
		this.configModel = options?.config?.model;
		this.configMaxRounds = options?.config?.maxRounds;
		this.fetchFn = deps?.fetch ?? globalThis.fetch;
		this.env = deps?.env ?? process.env;
		const fixtureDir = options?.config?.fixtureDir ?? DEFAULT_FIXTURE_DIR;
		this.loadScript = deps?.loadScript ?? (id => defaultLoadScript(fixtureDir, id));
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
		// An upstream failure arrives as a 200 whose choice carries `finish_reason: 'error'` and a
		// null message. Reading that as "the model answered nothing" would silently score a
		// rate-limited round as a give-up; surface it so promptfoo reports an ERROR, not a verdict.
		if (choice.finish_reason === 'error' || choice.error) {
			const detail = choice.error?.message ?? 'no detail';
			throw new Error(`Upstream error in a 200 response (finish_reason=${choice.finish_reason}): ${detail}`);
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
			return { error: 'Trajectory case is missing a `mockScript` var naming a fixture under the provider\'s fixture folder.' };
		}
		let script: MockScript;
		try {
			script = this.loadScript(scriptId);
		} catch (err) {
			return { error: `Failed to load mockScript "${scriptId}": ${err instanceof Error ? err.message : String(err)}` };
		}
		const scriptState = createMockScriptState(script);

		const variantId = context?.vars?.systemPromptVariant;
		let systemText = systemPrompt;
		if (typeof variantId === 'string' && variantId) {
			try {
				let cached = systemPromptVariants.get(variantId);
				if (cached === undefined) {
					cached = loadSystemPromptVariant(variantId);
					systemPromptVariants.set(variantId, cached);
				}
				systemText = cached;
			} catch (err) {
				return { error: `Failed to load systemPromptVariant "${variantId}": ${err instanceof Error ? err.message : String(err)}` };
			}
		}

		const followUp = context?.vars?.followUpPrompt;
		const userTurns = [prompt, ...(typeof followUp === 'string' && followUp ? [followUp] : [])];

		// Prompt caching is on unless EVAL_PROMPT_CACHE=0 (e.g. to measure the uncached cost).
		const cachePrefix = this.env.EVAL_PROMPT_CACHE !== '0';
		const messages: ChatMessage[] = [{
			role: 'system',
			content: cachePrefix ? [{ type: 'text', text: systemText, cache_control: { type: 'ephemeral' } }] : systemText,
		}];
		const rounds: Array<{ turn: number; toolCalls: TrajectoryToolCall[] }> = [];
		const turnTexts: string[] = [];
		let stoppedReason: Trajectory['stoppedReason'] = 'max_rounds';

		try {
			for (let turn = 0; turn < userTurns.length; turn++) {
				messages.push({ role: 'user', content: userTurns[turn] });
				const settled = await this.runTurn(apiKey, messages, script, scriptState, turn, rounds);
				turnTexts.push(settled.finalText);
				stoppedReason = settled.stoppedReason;
				// Carry the answer into the next turn so a follow-up ("I added the key") is read
				// against what the agent already delivered — the resume rule is about not redoing it.
				if (turn + 1 < userTurns.length) {
					messages.push({ role: 'assistant', content: settled.finalText });
				}
			}
		} catch (err) {
			return { error: `Trajectory run failed: ${err instanceof Error ? err.message : String(err)}` };
		}

		const trajectory: Trajectory = { rounds, finalText: turnTexts[turnTexts.length - 1] ?? '', turnTexts, stoppedReason };
		return { output: JSON.stringify(trajectory) };
	}

	/** Runs the agent loop for ONE user turn, appending its rounds to `rounds` and its messages to `messages`. */
	private async runTurn(
		apiKey: string,
		messages: ChatMessage[],
		script: MockScript,
		scriptState: MockScriptState,
		turn: number,
		rounds: Array<{ turn: number; toolCalls: TrajectoryToolCall[] }>,
	): Promise<{ finalText: string; stoppedReason: Trajectory['stoppedReason'] }> {
		const maxRounds = this.resolveMaxRounds();
		let finalText = '';
		let stoppedReason: Trajectory['stoppedReason'] = 'max_rounds';

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
				roundCalls.push({ name: tc.function.name, args, mockTag: mock.tag, resultBody: mock.body });
				messages.push({ role: 'tool', tool_call_id: tc.id, content: mock.body });
			}
			rounds.push({ turn, toolCalls: roundCalls });
		}

		// Loop ran to the cap without a clean stop: take one final no-tools turn so the
		// judge has the model's actual give-up/summary narration to grade. Sonnet-class models
		// answer a bare tools-stripped continuation with EMPTY content almost every time (#263),
		// so the wrap-up carries an explicit user nudge, and an empty or failed attempt is
		// retried once and logged instead of being silently accepted as a give-up.
		if (stoppedReason === 'max_rounds') {
			messages.push({
				role: 'user',
				content: 'You have used the available tool budget. Based on what the tools returned above, give your final answer to the original request now, without calling any more tools. If something could not be retrieved, state exactly what you tried and what is missing.',
			});
			for (let attempt = 1; attempt <= 2 && finalText === ''; attempt++) {
				try {
					const wrap = await this.chat(apiKey, messages, /*withTools*/ false);
					finalText = wrap.message.content ?? '';
					if (finalText === '') {
						console.error(`trajectory-provider: wrap-up attempt ${attempt} returned empty content`);
					}
				} catch (err) {
					console.error(`trajectory-provider: wrap-up attempt ${attempt} failed: ${err instanceof Error ? err.message : String(err)}`);
				}
			}
		}
		return { finalText, stoppedReason };
	}
}
