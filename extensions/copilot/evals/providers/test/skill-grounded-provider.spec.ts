/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import SkillGroundedProvider from '../skill-grounded-provider';

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
async function runCase(vars: Record<string, string>, env: NodeJS.ProcessEnv = { OPENROUTER_API_KEY: 'k' }) {
	const bodies: Array<{ messages: SentMessage[]; tools?: Array<{ function: { name: string } }>; tool_choice?: string }> = [];
	const provider = new SkillGroundedProvider({ config: { skillsDir } }, {
		fetch: async (_url, init) => {
			bodies.push(JSON.parse(String(init?.body)));
			return jsonResponse({ choices: [{ finish_reason: 'stop', message: { content: 'the answer' } }] });
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
			roles: messages.map(m => m.role),
			user: messages[1].content,
			skillCall: { name: skillCall.function.name, args: JSON.parse(skillCall.function.arguments) },
			skillResult: messages[3].content,
			reads: readCalls.map(c => ({ name: c.function.name, filePath: JSON.parse(c.function.arguments).filePath })),
			readResults: messages.slice(5).map(m => [m.tool_call_id === readCalls[messages.indexOf(m) - 5].id, m.content]),
			tools: bodies[0].tools!.map(t => t.function.name),
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
});
