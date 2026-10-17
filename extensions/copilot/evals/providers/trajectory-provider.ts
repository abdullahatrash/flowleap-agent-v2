/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ApiProvider, ProviderResponse, CallApiContextParams, CallApiOptionsParams } from 'promptfoo';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { requestChatCompletion, systemMessage, type CachedTextPart, type ChoiceStatus } from './chat-completions';
import { buildSkillConversation, loadSkillFolder, READ_FILE_TOOL, resolveSkillsDir } from './skill-grounded-provider';
import { createMockScriptState, resolveMock, type MockResponse, type MockScript, type MockScriptState, type MockTag } from './mock-tool-table';
import type { IFileSystemService } from '../../src/platform/filesystem/common/fileSystemService';
import type { IToolCallRound } from '../../src/extension/prompt/common/intents';
import { checkPriorArtReportCompletion, type ReportCompletionTurn } from '../../src/extension/tools/node/priorArtReportCompletion';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const EVALS_DIR = path.resolve(__dirname, '..');

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
/** Output budget per model call. A case whose tool arguments are long (a structured chart save) raises it with `maxTokens`. */
const DEFAULT_MAX_TOKENS = 4096;

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
	/** Present only on a `completionGuard` case: each message the real completion guard blocked a stop with, in order. */
	readonly guardNudges?: readonly string[];
}

/**
 * The extension loop's cap on completion-guard recoveries per turn (`ToolCallingLoop.MAX_REPORT_RECOVERIES`).
 * Past it the product stops nudging and warns; the provider stops nudging.
 */
const MAX_REPORT_RECOVERIES = 2;

/** The user message the extension renders for one blocking reason (`formatHookContext` in toolCallingLoop.ts). */
function hookContextMessage(reason: string): string {
	return `You were about to complete but a hook blocked you with the following message: "${reason}". Please address this requirement before completing.`;
}

/**
 * The guard reads the saved report and its evidence companion back to compare digests. A mock save
 * writes no file, so every read fails with a transient (not a not-found) error, which the guard
 * tolerates by design: it skips the digest check and still decides on the receipt alone.
 */
const unreadableWorkspace: Pick<IFileSystemService, 'readFile'> = {
	readFile: async () => { throw new Error('trajectory-provider: the eval has no workspace files'); },
};

/**
 * Resolve a `read_file` call against the files of the replayed skill, honouring the 1-based line
 * range. A path outside the skill is reported as not found, which is what the model would get for a
 * file the eval's workspace does not hold.
 */
function readSkillFile(files: ReadonlyMap<string, string>, args: Record<string, unknown>): MockResponse {
	const content = typeof args.filePath === 'string' ? files.get(args.filePath) : undefined;
	if (content === undefined) {
		return { tag: 'EMPTY', body: `File not found: ${String(args.filePath)}` };
	}
	const lines = content.split('\n');
	const start = typeof args.startLine === 'number' ? Math.max(1, args.startLine) : 1;
	const end = typeof args.endLine === 'number' ? Math.min(lines.length, args.endLine) : lines.length;
	return { tag: 'OK', body: lines.slice(start - 1, end).join('\n') };
}

/** One tool result the way the guard reads it: text parts carrying a `value`. */
interface GuardToolResult {
	readonly content: ReadonlyArray<{ readonly value: string }>;
}

/** The turn state the completion guard reads, built up as the loop runs. */
interface GuardTurn {
	readonly message: string;
	readonly rounds: IToolCallRound[];
	readonly results: Record<string, GuardToolResult>;
	readonly nudges: string[];
}

/** OpenAI-shaped chat message the loop appends as it runs. */
interface ChatMessage {
	readonly role: 'system' | 'user' | 'assistant' | 'tool';
	readonly content: string | null | readonly CachedTextPart[];
	readonly tool_calls?: ReadonlyArray<{ id: string; type: string; function: { name: string; arguments: string } }>;
	readonly tool_call_id?: string;
}

interface ChatChoice extends ChoiceStatus {
	readonly message: {
		readonly content?: string;
		readonly tool_calls?: Array<{ id: string; type: string; function: { name: string; arguments: string } }>;
	};
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
 *   `completionGuard`      Run the extension's real prior-art completion guard
 *                          (`checkPriorArtReportCompletion`) whenever the model stops, as the
 *                          tool-calling loop does: a blocking reason goes back to the model as the
 *                          same user message the loop renders, and the loop continues (at most
 *                          {@link MAX_REPORT_RECOVERIES} times per turn). The reasons are recorded
 *                          in `guardNudges`.
 *   `skill`                Start the first turn the way the app does when the model runs that
 *                          skill: the `skill` call and its `<skill-context>`, then a `read_file`
 *                          per file the skill lists or links (the skill-grounded suite's replay,
 *                          from the bundled `assets/skills`). The model works from the skill text.
 *                          The case is also offered `read_file`, answered from the skill's files.
 *   `maxRounds`            Loop cap for this case only, for a workflow that cannot fit the default.
 *   `maxTokens`            Output budget per model call for this case only (default
 *                          {@link DEFAULT_MAX_TOKENS}); a structured chart save is one long tool call.
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

	private resolveMaxRounds(caseMaxRounds?: unknown): number {
		if (typeof caseMaxRounds === 'number' && Number.isFinite(caseMaxRounds)) {
			return caseMaxRounds;
		}
		const fromEnv = this.env.EVAL_MAX_ROUNDS ? Number(this.env.EVAL_MAX_ROUNDS) : undefined;
		return this.configMaxRounds ?? (Number.isFinite(fromEnv) ? fromEnv! : DEFAULT_MAX_ROUNDS);
	}

	private resolveApiKey(): string | undefined {
		return this.env.EVAL_API_KEY || this.env.OPENROUTER_API_KEY;
	}

	private async chat(apiKey: string, messages: readonly ChatMessage[], tools: readonly object[] | undefined, maxTokens: number): Promise<ChatChoice> {
		const body: Record<string, unknown> = {
			model: this.resolveModel(),
			messages,
			stream: false,
			temperature: 0,
			max_tokens: maxTokens,
		};
		if (tools) {
			body.tools = tools;
			body.tool_choice = 'auto';
		}
		return requestChatCompletion<ChatChoice>({ fetch: this.fetchFn, env: this.env, apiKey, body });
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

		const skillName = context?.vars?.skill;
		let skillPreamble: ChatMessage[] = [];
		let skillFiles: Map<string, string> | undefined;
		if (typeof skillName === 'string' && skillName) {
			try {
				const skill = loadSkillFolder(resolveSkillsDir(undefined, this.env), skillName);
				skillPreamble = buildSkillConversation(skill, prompt);
				skillFiles = new Map([[path.join(skill.folder, 'SKILL.md'), skill.skillMd], ...[...skill.folderFiles, ...skill.linkedFiles].map(file => [file.absolutePath, file.content] as const)]);
			} catch (err) {
				return { error: `Failed to load skill "${skillName}": ${err instanceof Error ? err.message : String(err)}` };
			}
		}
		const guarded = context?.vars?.completionGuard === true;
		const maxRounds = this.resolveMaxRounds(context?.vars?.maxRounds);
		const caseMaxTokens = context?.vars?.maxTokens;
		const maxTokens = typeof caseMaxTokens === 'number' && Number.isFinite(caseMaxTokens) ? caseMaxTokens : DEFAULT_MAX_TOKENS;
		const guardNudges: string[] = [];

		const followUp = context?.vars?.followUpPrompt;
		const userTurns = [prompt, ...(typeof followUp === 'string' && followUp ? [followUp] : [])];

		const messages: ChatMessage[] = [systemMessage(systemText, this.env)];
		const rounds: Array<{ turn: number; toolCalls: TrajectoryToolCall[] }> = [];
		const turnTexts: string[] = [];
		let stoppedReason: Trajectory['stoppedReason'] = 'max_rounds';

		try {
			for (let turn = 0; turn < userTurns.length; turn++) {
				if (turn === 0 && skillPreamble.length > 0) {
					// The preamble opens with this same user message, then the replayed skill run.
					messages.push(...skillPreamble);
				} else {
					messages.push({ role: 'user', content: userTurns[turn] });
				}
				const guard: GuardTurn | undefined = guarded ? { message: userTurns[turn], rounds: [], results: {}, nudges: guardNudges } : undefined;
				const settled = await this.runTurn(apiKey, messages, script, scriptState, turn, rounds, { maxRounds, maxTokens, skillFiles }, guard);
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

		const trajectory: Trajectory = { rounds, finalText: turnTexts[turnTexts.length - 1] ?? '', turnTexts, stoppedReason, ...(guarded ? { guardNudges } : {}) };
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
		{ maxRounds, maxTokens, skillFiles }: { readonly maxRounds: number; readonly maxTokens: number; readonly skillFiles?: ReadonlyMap<string, string> },
		guard: GuardTurn | undefined,
	): Promise<{ finalText: string; stoppedReason: Trajectory['stoppedReason'] }> {
		let finalText = '';
		let recoveries = 0;
		const tools = skillFiles ? [...toolDefinitions, READ_FILE_TOOL] : toolDefinitions;
		let stoppedReason: Trajectory['stoppedReason'] = 'max_rounds';

		for (let round = 0; round < maxRounds; round++) {
			const choice = await this.chat(apiKey, messages, tools, maxTokens);
			const toolCalls = choice.message.tool_calls ?? [];
			if (toolCalls.length === 0) {
				const issue = guard && recoveries < MAX_REPORT_RECOVERIES ? await this.checkCompletion(guard) : undefined;
				if (guard && issue) {
					recoveries++;
					guard.nudges.push(issue);
					const response = choice.message.content ?? '';
					guard.rounds.push({ id: `guard-${round}`, response, toolInputRetry: 0, toolCalls: [], hookContext: hookContextMessage(issue) });
					if (response) {
						messages.push({ role: 'assistant', content: response });
					}
					messages.push({ role: 'user', content: hookContextMessage(issue) });
					continue;
				}
				finalText = choice.message.content ?? '';
				stoppedReason = 'no_more_tools';
				break;
			}

			// Record the assistant turn so the model sees its own calls on the next round.
			messages.push({ role: 'assistant', content: choice.message.content ?? '', tool_calls: toolCalls });

			const roundCalls: TrajectoryToolCall[] = [];
			for (const tc of toolCalls) {
				const args = safeParseArgs(tc.function.arguments);
				const mock = skillFiles && tc.function.name === READ_FILE_TOOL.function.name ? readSkillFile(skillFiles, args) : resolveMock(script, scriptState, tc.function.name, args);
				roundCalls.push({ name: tc.function.name, args, mockTag: mock.tag, resultBody: mock.body });
				messages.push({ role: 'tool', tool_call_id: tc.id, content: mock.body });
				if (guard) {
					guard.results[tc.id] = { content: [{ value: mock.body }] };
				}
			}
			rounds.push({ turn, toolCalls: roundCalls });
			guard?.rounds.push({ id: `round-${round}`, response: choice.message.content ?? '', toolInputRetry: 0, toolCalls: toolCalls.map(tc => ({ id: tc.id, name: tc.function.name, arguments: tc.function.arguments })) });
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
					const wrap = await this.chat(apiKey, messages, undefined, maxTokens);
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

	/** Ask the extension's completion guard whether the model may stop now; a string is the reason it may not. */
	private checkCompletion(guard: GuardTurn): Promise<string | undefined> {
		// The guard types its results as vscode's LanguageModelToolResult, a class the eval cannot
		// construct outside the extension host; it reads only text parts with a `value`. The extra
		// `nudges` field is not part of the guard's turn and it never reads it.
		return checkPriorArtReportCompletion([], guard as unknown as ReportCompletionTurn, unreadableWorkspace as IFileSystemService);
	}
}
