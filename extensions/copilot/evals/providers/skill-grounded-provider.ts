/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ApiProvider, ProviderResponse, CallApiContextParams } from 'promptfoo';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { ChatCompletionError, requestChatCompletion, systemMessage, type CachedTextPart, type ChoiceStatus } from './chat-completions';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const EVALS_DIR = path.resolve(__dirname, '..');

/** Same pin as the other suites: the gate must move with the skill, not with the model. */
const DEFAULT_MODEL = 'anthropic/claude-sonnet-5';
/** The bundled skills, whether or not `chatSkills` registers them — unregistered skills are measured here first. */
const DEFAULT_SKILLS_DIR = path.join(EVALS_DIR, '..', 'assets', 'skills');

const SKILL_FILENAME = 'SKILL.md';
/**
 * Directories the app's skill tool does not list: a copy of `SKILL_SKIP_DIRS` in skillTool.ts,
 * which the evals cannot import. The provider spec fails when the two differ.
 */
export const SKILL_SKIP_DIRS: ReadonlySet<string> = new Set(['.git', 'node_modules', 'dist', 'build', 'out', '.cache', 'coverage', '__pycache__', 'target', 'bin', 'obj', '.venv', 'venv']);

/** The two app tools whose calls the provider replays. Names and argument shapes match the app's. */
const SKILL_TOOLS = [
	{
		type: 'function',
		function: {
			name: 'skill',
			description: 'Invoke a skill to handle a user\'s request with specialized instructions and workflows.',
			parameters: { type: 'object', properties: { skill: { type: 'string', description: 'The skill name.' } }, required: ['skill'] },
		},
	},
	{
		type: 'function',
		function: {
			name: 'read_file',
			description: 'Read the contents of a file.',
			parameters: {
				type: 'object',
				properties: {
					filePath: { type: 'string', description: 'The absolute path of the file to read.' },
					startLine: { type: 'number', description: 'The line number to start reading from, 1-based.' },
					endLine: { type: 'number', description: 'The inclusive line number to end reading at, 1-based.' },
				},
				required: ['filePath', 'startLine', 'endLine'],
			},
		},
	},
];

/** A file of a loaded skill: its path relative to the skill folder, its absolute path, and its text. */
interface SkillFile {
	readonly relativePath: string;
	readonly absolutePath: string;
	readonly content: string;
}

/** A skill folder as the model sees it when the skill runs. */
interface LoadedSkill {
	readonly name: string;
	readonly folder: string;
	readonly skillMd: string;
	/** Every file in the folder except SKILL.md — the "Related files" list of the app's skill tool. */
	readonly folderFiles: readonly SkillFile[];
	/** Files OUTSIDE the folder that a loaded file links to by a relative Markdown link (for example `../upc-filing-prep/references/x.md`). */
	readonly linkedFiles: readonly SkillFile[];
}

function listFolderFiles(baseDir: string, currentDir: string, depth = 0): string[] {
	if (depth > 5) {
		return [];
	}
	const files: string[] = [];
	for (const entry of fs.readdirSync(currentDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
		const entryPath = path.join(currentDir, entry.name);
		if (entry.isDirectory()) {
			if (!SKILL_SKIP_DIRS.has(entry.name)) {
				files.push(...listFolderFiles(baseDir, entryPath, depth + 1));
			}
		} else if (entry.isFile() && entry.name.toLowerCase() !== SKILL_FILENAME.toLowerCase()) {
			files.push(path.relative(baseDir, entryPath).split(path.sep).join('/'));
		}
	}
	return files;
}

/** Relative Markdown link targets in `text`, without anchors. Absolute URLs are not links to files. */
function relativeLinkTargets(text: string): string[] {
	return [...text.matchAll(/\]\((?<target>[^)\s#]+)(?:#[^)]*)?\)/g)]
		.map(match => match.groups!.target)
		.filter(target => !/^[a-z][a-z0-9+.-]*:/i.test(target) && !target.startsWith('/'));
}

/**
 * Load a named skill folder: SKILL.md, every other file in the folder, and the files outside the
 * folder that SKILL.md or a folder file links to (one hop — the pattern by which one skill reads
 * another skill's reference files).
 */
export function loadSkillFolder(skillsDir: string, name: string): LoadedSkill {
	const folder = path.join(skillsDir, name);
	const skillMdPath = path.join(folder, SKILL_FILENAME);
	if (!fs.existsSync(skillMdPath)) {
		throw new Error(`Skill "${name}" not found: no ${SKILL_FILENAME} in ${folder}`);
	}
	const skillMd = fs.readFileSync(skillMdPath, 'utf-8');
	const folderFiles = listFolderFiles(folder, folder).map(relativePath => {
		const absolutePath = path.join(folder, relativePath);
		return { relativePath, absolutePath, content: fs.readFileSync(absolutePath, 'utf-8') };
	});

	const linkedFiles: SkillFile[] = [];
	const seen = new Set<string>();
	for (const source of [{ absolutePath: skillMdPath, content: skillMd }, ...folderFiles]) {
		for (const target of relativeLinkTargets(source.content)) {
			const absolutePath = path.resolve(path.dirname(source.absolutePath), target);
			const insideFolder = !path.relative(folder, absolutePath).startsWith('..');
			if (insideFolder || seen.has(absolutePath) || !fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
				continue;
			}
			seen.add(absolutePath);
			linkedFiles.push({ relativePath: path.relative(folder, absolutePath).split(path.sep).join('/'), absolutePath, content: fs.readFileSync(absolutePath, 'utf-8') });
		}
	}
	return { name, folder, skillMd, folderFiles, linkedFiles };
}

/** The skill tool's result text, byte for byte the shape of `SkillTool.invokeInline` in the app (the provider spec checks it). */
function renderSkillContext(skill: LoadedSkill): string {
	const relatedFiles = skill.folderFiles.map(file => file.relativePath);
	const relatedFilesSection = relatedFiles.length > 0
		? `\nRelated files (use read_file tool to read):\n${relatedFiles.map(f => `  - ${f}`).join('\n')}\n`
		: '';
	return `<skill-context name="${skill.name}">
Base directory: ${skill.folder}
${relatedFilesSection}
${skill.skillMd}
</skill-context>`;
}

/**
 * An instruction file as the app attaches it when its `applyTo` matches (`applyTo: '**'` matches
 * every request): `CustomInstructions` in the extension reads the WHOLE file (front matter included),
 * trims it, wraps it in an `<attachment filePath=...>` tag inside one `<instructions>` tag, and the
 * agent prompt puts that block in a system message after the main system prompt
 * (`chat.customInstructionsInSystemMessage`, default true). The provider spec checks the app source.
 */
export function renderInstructionsAttachment(files: readonly { readonly absolutePath: string; readonly content: string }[]): string {
	const attachments = files.map(file => `<attachment filePath=${JSON.stringify(file.absolutePath)}>\n${file.content.trim()}\n</attachment>`);
	return `<instructions>\n${attachments.join('\n')}\n</instructions>`;
}

/** Instruction files named by a case (`vars.instructions`, comma-separated paths relative to evals/). */
function loadInstructionFiles(value: unknown): { absolutePath: string; content: string }[] {
	if (typeof value !== 'string' || !value.trim()) {
		return [];
	}
	return value.split(',').map(entry => entry.trim()).filter(Boolean).map(entry => {
		const absolutePath = path.resolve(EVALS_DIR, entry);
		if (!fs.existsSync(absolutePath)) {
			throw new Error(`Instruction file not found: ${entry}`);
		}
		return { absolutePath, content: fs.readFileSync(absolutePath, 'utf-8') };
	});
}

interface ToolCall {
	readonly id: string;
	readonly type: 'function';
	readonly function: { readonly name: string; readonly arguments: string };
}

interface ChatMessage {
	readonly role: 'system' | 'user' | 'assistant' | 'tool';
	readonly content: string | null | readonly CachedTextPart[];
	readonly tool_calls?: readonly ToolCall[];
	readonly tool_call_id?: string;
}

/**
 * The conversation up to the moment the model answers: the user asked, the model ran the skill,
 * then read every file the skill lists or links. These are the calls a model makes in the app when
 * it follows the skill; replaying them makes every case start from the same, complete context.
 */
function buildSkillConversation(skill: LoadedSkill, userPrompt: string): ChatMessage[] {
	const messages: ChatMessage[] = [
		{ role: 'user', content: userPrompt },
		{ role: 'assistant', content: '', tool_calls: [{ id: 'skill_0', type: 'function', function: { name: 'skill', arguments: JSON.stringify({ skill: skill.name }) } }] },
		{ role: 'tool', tool_call_id: 'skill_0', content: renderSkillContext(skill) },
	];
	const reads = [...skill.folderFiles, ...skill.linkedFiles];
	if (reads.length > 0) {
		const calls: ToolCall[] = reads.map((file, i) => ({
			id: `read_${i}`,
			type: 'function',
			function: { name: 'read_file', arguments: JSON.stringify({ filePath: file.absolutePath, startLine: 1, endLine: file.content.split('\n').length }) },
		}));
		messages.push({ role: 'assistant', content: '', tool_calls: calls });
		reads.forEach((file, i) => messages.push({ role: 'tool', tool_call_id: calls[i].id, content: file.content }));
	}
	return messages;
}

/** Collaborators promptfoo never supplies — overridden only by tests. */
export interface SkillGroundedProviderDeps {
	readonly fetch?: typeof fetch;
	readonly env?: NodeJS.ProcessEnv;
}

interface ChatChoice extends ChoiceStatus {
	readonly message: { readonly content?: string | null };
}

/**
 * Skill-grounded eval provider (#569, PRD 0021 U6).
 *
 * Measures a skill's CONTENT, before the skill is registered in `chatSkills`. Each case names a
 * skill folder in `vars.skill`; the provider replays the app's skill run — a `skill` tool call
 * whose result is the app's `<skill-context>` block, then a `read_file` call for each file the
 * skill lists or links — and asks the model for its answer with `tool_choice: 'none'`, so the
 * answer rests on the skill text alone. Routing (does the model pick the skill?) is out of scope:
 * the live acceptance run checks that.
 *
 * A case may also name instruction files in `vars.instructions` (#577): the provider attaches them
 * the way the app attaches an `applyTo: '**'` instruction file, next to the skill.
 *
 * Returns a JSON string `{ skill, loadedFiles, finalText }`.
 *
 * Configuration: `config.skillsDir` (default: the bundled `assets/skills`), `config.model`, and the
 * env vars the other providers read — EVAL_API_BASE_URL, EVAL_API_KEY (falls back to
 * OPENROUTER_API_KEY), EVAL_MODEL, EVAL_PROMPT_CACHE=0 to send the system prompt uncached.
 */
export default class SkillGroundedProvider implements ApiProvider {
	private readonly configModel: string | undefined;
	private readonly skillsDir: string;
	private readonly fetchFn: typeof fetch;
	private readonly env: NodeJS.ProcessEnv;

	constructor(options?: { config?: { model?: string; skillsDir?: string }; id?: string; label?: string }, deps?: SkillGroundedProviderDeps) {
		this.configModel = options?.config?.model;
		this.skillsDir = options?.config?.skillsDir ? path.resolve(EVALS_DIR, options.config.skillsDir) : DEFAULT_SKILLS_DIR;
		this.fetchFn = deps?.fetch ?? globalThis.fetch;
		this.env = deps?.env ?? process.env;
	}

	id(): string {
		return `skill-grounded:${this.resolveModel()}`;
	}

	private resolveModel(): string {
		return this.configModel || this.env.EVAL_MODEL || DEFAULT_MODEL;
	}

	async callApi(prompt: string, context?: CallApiContextParams): Promise<ProviderResponse> {
		const apiKey = this.env.EVAL_API_KEY || this.env.OPENROUTER_API_KEY;
		if (!apiKey) {
			return { error: 'No API key configured. Set EVAL_API_KEY or OPENROUTER_API_KEY before running the skill-grounded suite.' };
		}
		const skillName = context?.vars?.skill;
		if (typeof skillName !== 'string' || !skillName) {
			return { error: 'Skill-grounded case is missing a `skill` var naming a folder under the skills directory.' };
		}
		let skill: LoadedSkill;
		let instructionFiles: { absolutePath: string; content: string }[];
		try {
			skill = loadSkillFolder(this.skillsDir, skillName);
			instructionFiles = loadInstructionFiles(context?.vars?.instructions);
		} catch (err) {
			return { error: err instanceof Error ? err.message : String(err) };
		}

		const systemText = fs.readFileSync(path.join(EVALS_DIR, 'prompts', 'system-prompt.txt'), 'utf-8');
		const messages: ChatMessage[] = [
			systemMessage(systemText, this.env),
			...(instructionFiles.length > 0 ? [{ role: 'system' as const, content: renderInstructionsAttachment(instructionFiles) }] : []),
			...buildSkillConversation(skill, prompt),
		];

		try {
			const choice = await requestChatCompletion<ChatChoice>({
				fetch: this.fetchFn,
				env: this.env,
				apiKey,
				body: { model: this.resolveModel(), messages, tools: SKILL_TOOLS, tool_choice: 'none', stream: false, temperature: 0, max_tokens: 8192 },
			});
			const loadedFiles = [SKILL_FILENAME, ...skill.folderFiles.map(file => file.relativePath), ...skill.linkedFiles.map(file => file.relativePath)];
			return { output: JSON.stringify({ skill: skill.name, loadedFiles, finalText: choice.message.content ?? '' }) };
		} catch (err) {
			if (err instanceof ChatCompletionError) {
				return { error: err.message };
			}
			return { error: `Skill-grounded run failed: ${err instanceof Error ? err.message : String(err)}` };
		}
	}
}
