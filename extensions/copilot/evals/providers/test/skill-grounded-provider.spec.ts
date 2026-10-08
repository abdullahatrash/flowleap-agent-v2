/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import SkillGroundedProvider, { renderInstructionsAttachment, SKILL_SKIP_DIRS } from '../skill-grounded-provider';

/** A skills folder on disk with two skills: one links to a reference file of the other. */
let skillsDir: string;

function writeFile(relativePath: string, content: string): void {
	const file = path.join(skillsDir, relativePath);
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, content);
}

beforeAll(() => {
	skillsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-grounded-'));
	writeFile('demo/SKILL.md', '---\nname: demo\n---\n# Demo\nSee [the table](references/table.md) and [the map](../other/references/map.md).\n');
	writeFile('demo/references/table.md', 'TABLE BODY');
	writeFile('other/SKILL.md', '---\nname: other\n---\n');
	writeFile('other/references/map.md', 'MAP BODY');
});

afterAll(() => {
	fs.rmSync(skillsDir, { recursive: true, force: true });
});

function jsonResponse(body: unknown): Response {
	return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

interface SentMessage {
	readonly role: string;
	readonly content: unknown;
	readonly tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
	readonly tool_call_id?: string;
}

/** Runs one case and returns what the provider sent and what it returned. */
async function runCase(vars: Record<string, string>, env: NodeJS.ProcessEnv = { OPENROUTER_API_KEY: 'k' }, responseBody: unknown = { choices: [{ finish_reason: 'stop', message: { content: 'the answer' } }] }) {
	const bodies: Array<{ messages: SentMessage[]; tools?: Array<{ function: { name: string } }>; tool_choice?: string }> = [];
	const provider = new SkillGroundedProvider({ config: { skillsDir } }, {
		fetch: async (_url, init) => {
			bodies.push(JSON.parse(String(init?.body)));
			return jsonResponse(responseBody);
		},
		env,
	});
	const result = await provider.callApi('which division?', { vars, prompt: { raw: '', label: '' } });
	return { bodies, result };
}

describe('SkillGroundedProvider', () => {
	it('puts the skill into context the way the app skill tool does, then the files it lists and links', async () => {
		const { bodies, result } = await runCase({ skill: 'demo' });

		const messages = bodies[0].messages;
		const folder = path.join(skillsDir, 'demo');
		const skillCall = messages[2].tool_calls![0];
		const readCalls = messages[4].tool_calls!;
		expect({
			requests: bodies.length,
			roles: messages.map(message => message.role),
			user: messages[1].content,
			skillCall: { name: skillCall.function.name, args: JSON.parse(skillCall.function.arguments) },
			skillResult: messages[3].content,
			reads: readCalls.map(call => ({ name: call.function.name, filePath: JSON.parse(call.function.arguments).filePath })),
			readResults: messages.slice(5).map((message, index) => [message.tool_call_id === readCalls[index].id, message.content]),
			tools: bodies[0].tools!.map(tool => tool.function.name),
			toolChoice: bodies[0].tool_choice,
			output: JSON.parse(String(result.output)),
		}).toEqual({
			requests: 1,
			roles: ['system', 'user', 'assistant', 'tool', 'assistant', 'tool', 'tool'],
			user: 'which division?',
			skillCall: { name: 'skill', args: { skill: 'demo' } },
			skillResult: `<skill-context name="demo">\nBase directory: ${folder}\n\nRelated files (use read_file tool to read):\n  - references/table.md\n\n${fs.readFileSync(path.join(folder, 'SKILL.md'), 'utf-8')}\n</skill-context>`,
			reads: [
				{ name: 'read_file', filePath: path.join(folder, 'references', 'table.md') },
				{ name: 'read_file', filePath: path.join(skillsDir, 'other', 'references', 'map.md') },
			],
			readResults: [[true, 'TABLE BODY'], [true, 'MAP BODY']],
			tools: ['skill', 'read_file'],
			toolChoice: 'none',
			output: { skill: 'demo', loadedFiles: ['SKILL.md', 'references/table.md', '../other/references/map.md'], finalText: 'the answer' },
		});
	});

	it('attaches the instruction files of a case in a system message after the main system prompt, the way the app does', async () => {
		const instructionsFile = path.join(skillsDir, 'firm.instructions.md');
		fs.writeFileSync(instructionsFile, '---\napplyTo: \'**\'\n---\nAlso search DE utility models.\n');
		const { bodies } = await runCase({ skill: 'demo', instructions: instructionsFile });
		const missing = await runCase({ skill: 'demo', instructions: 'no-such.instructions.md' });
		const messages = bodies[0].messages;
		expect({
			roles: messages.slice(0, 3).map(message => message.role),
			instructions: messages[1].content,
			missingError: /Instruction file not found/.test(String(missing.result.error)),
		}).toEqual({
			roles: ['system', 'system', 'user'],
			instructions: `<instructions>\n<attachment filePath=${JSON.stringify(instructionsFile)}>\n---\napplyTo: '**'\n---\nAlso search DE utility models.\n</attachment>\n</instructions>`,
			missingError: true,
		});
	});

	it('reports a missing skill or key as a provider error, not as an answer', async () => {
		const missingSkill = await runCase({ skill: 'no-such-skill' });
		const noSkillVar = await runCase({});
		const noKey = await runCase({ skill: 'demo' }, {});
		expect({
			missingSkill: /no-such-skill/.test(String(missingSkill.result.error)),
			noSkillVar: /`skill` var/.test(String(noSkillVar.result.error)),
			noKey: /API key/.test(String(noKey.result.error)),
			requests: missingSkill.bodies.length + noSkillVar.bodies.length + noKey.bodies.length,
		}).toEqual({ missingSkill: true, noSkillVar: true, noKey: true, requests: 0 });
	});

	it('reports an upstream error carried in a 200 body as a provider error, with the message the trajectory provider gives', async () => {
		const { result } = await runCase({ skill: 'demo' }, undefined, {
			choices: [{ finish_reason: 'error', error: { code: 429, message: 'rate-limited upstream' }, message: { content: null } }],
		});
		expect({ output: result.output, error: result.error }).toEqual({
			output: undefined,
			error: 'Upstream error in a 200 response (finish_reason=error): rate-limited upstream',
		});
	});
});

/**
 * The provider copies two things from the app's skill tool, because the evals cannot import
 * `skillTool.ts` (it needs the `vscode` module): the folders it skips and the `<skill-context>`
 * text of `SkillTool.invokeInline`. These checks read the app source and fail when the copies drift.
 */
describe('SkillGroundedProvider matches the app skill tool', () => {
	const appSource = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'src', 'extension', 'tools', 'node', 'skillTool.ts'), 'utf-8');
	const providerSource = fs.readFileSync(path.join(__dirname, '..', 'skill-grounded-provider.ts'), 'utf-8');

	/** The template literals from `relatedFilesSection` to `</skill-context>`, with each interpolation replaced by `${}`. */
	function skillContextTemplates(source: string): string[] {
		const start = source.indexOf('const relatedFilesSection');
		const end = source.indexOf('</skill-context>`', start) + '</skill-context>`'.length;
		let region = source.slice(start, end);
		for (let previous = ''; previous !== region;) {
			previous = region;
			region = region.replace(/\$\{[^{}]*\}/g, '<interpolation>');
		}
		return [...region.matchAll(/`[^`]*`/g)].map(match => match[0].replaceAll('<interpolation>', '${}'));
	}

	it('skips the same folders as SKILL_SKIP_DIRS in skillTool.ts', () => {
		const literal = /const SKILL_SKIP_DIRS = new Set\(\[(?<entries>[^\]]*)\]\)/.exec(appSource)?.groups?.entries ?? '';
		const appDirs = [...literal.matchAll(/'(?<name>[^']+)'/g)].map(match => match.groups!.name);
		expect([...SKILL_SKIP_DIRS].sort()).toEqual(appDirs.sort());
	});

	it('attaches instructions in the shape of CustomInstructions in a system message', () => {
		const extensionSrc = path.join(__dirname, '..', '..', '..', 'src');
		const customInstructions = fs.readFileSync(path.join(extensionSrc, 'extension', 'prompts', 'node', 'panel', 'customInstructions.tsx'), 'utf-8');
		const configuration = fs.readFileSync(path.join(extensionSrc, 'platform', 'configuration', 'common', 'configurationService.ts'), 'utf-8');
		expect({
			instructionsTag: customInstructions.includes('<Tag name=\'instructions\'>'),
			attachmentTag: customInstructions.includes('<Tag name=\'attachment\' attrs={attrs}>'),
			filePathAttr: customInstructions.includes('const attrs: Record<string, string> = { filePath:'),
			wholeFileTrimmed: customInstructions.includes('content = content.trim();'),
			inSystemMessageByDefault: /CustomInstructionsInSystemMessage = defineSetting<boolean>\('chat\.customInstructionsInSystemMessage', ConfigType\.Simple, true\)/.test(configuration),
			rendered: renderInstructionsAttachment([{ absolutePath: '/w/a.instructions.md', content: ' A \n' }]),
		}).toEqual({
			instructionsTag: true,
			attachmentTag: true,
			filePathAttr: true,
			wholeFileTrimmed: true,
			inSystemMessageByDefault: true,
			rendered: '<instructions>\n<attachment filePath="/w/a.instructions.md">\nA\n</attachment>\n</instructions>',
		});
	});

	it('renders the same <skill-context> text as SkillTool.invokeInline', () => {
		const appTemplates = skillContextTemplates(appSource);
		expect({ count: appTemplates.length, provider: skillContextTemplates(providerSource) }).toEqual({ count: 2, provider: appTemplates });
	});
});
