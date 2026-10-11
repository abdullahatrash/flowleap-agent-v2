/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Raw } from '@vscode/prompt-tsx';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { expect, suite, test } from 'vitest';
import type * as vscode from 'vscode';
import { MockEndpoint } from '../../../../../platform/endpoint/test/node/mockEndpoint';
import { IInstantiationService } from '../../../../../util/vs/platform/instantiation/common/instantiation';
import { createExtensionUnitTestingServices } from '../../../../test/node/services';
import { getToolName } from '../../../../tools/common/toolNames';
import { renderPromptElement } from '../../base/promptRenderer';
import { PatentAIInstructions } from '../patentAIPrompt';

/**
 * The Patent AI custom agent (`assets/agents/patent-ai.agent.md`) carries the Patent Agent's
 * system prompt into Claude sessions in the Agents Window, which run on the Claude Agent SDK
 * instead of this extension's prompt renderer. The file is generated from {@link PatentAIInstructions}
 * so it cannot drift from the editor prompt: run `npx vitest -u patentAIAgentFile` to regenerate it.
 */

const AGENT_FILE = fileURLToPath(new URL('../../../../../../assets/agents/patent-ai.agent.md', import.meta.url));
const PACKAGE_JSON = fileURLToPath(new URL('../../../../../../package.json', import.meta.url));
const CORE_TOOL_SET = fileURLToPath(new URL('../../../../../../../../src/vs/workbench/contrib/chat/common/tools/patentChatToolReferenceNames.ts', import.meta.url));

/** Claude sees each client tool as `mcp__client__<toolReferenceName>` (claudeClientToolMcpServer.ts). */
const CLAUDE_CLIENT_TOOL_PREFIX = 'mcp__client__';

/** Editor tool names in the Patent AI prompt and the Claude Code built-in that replaces each. */
const CLAUDE_BUILTIN_TOOL_NAMES: readonly (readonly [string, string])[] = [
	['fetch_webpage', 'WebFetch'],
	['web_search', 'WebSearch'],
	['vscode_askQuestions', 'AskUserQuestion'],
	['read_file', 'Read'],
	['run_in_terminal', 'Bash'],
];

/** Replaces each whole-word tool name in `text`, longest names first. */
function renameTools(text: string, names: ReadonlyMap<string, string>): string {
	const sorted = [...names.keys()].sort((a, b) => b.length - a.length);
	const pattern = new RegExp(`(?<![\\w])(${sorted.join('|')})(?![\\w])`, 'g');
	return text.replace(pattern, name => names.get(name) ?? name);
}

interface ContributedTool {
	readonly name: string;
	readonly toolReferenceName: string;
}

/** The Patent Agent's patent-data tools, as contributed in `package.json`. */
function contributedPatentTools(): readonly ContributedTool[] {
	const manifest = JSON.parse(readFileSync(PACKAGE_JSON, 'utf8')) as { contributes: { languageModelTools: (ContributedTool & object)[] } };
	return manifest.contributes.languageModelTools.filter(tool => /patent/i.test(JSON.stringify(tool)));
}

function toolInfo(name: string): vscode.LanguageModelToolInformation {
	return { name, description: '', source: undefined, inputSchema: { type: 'object', properties: {} }, tags: [] };
}

async function renderForClaudeSession(modelToolNames: readonly string[]): Promise<string> {
	const services = createExtensionUnitTestingServices();
	const accessor = services.createTestingAccessor();
	try {
		const instantiationService = accessor.get(IInstantiationService);
		const endpoint = instantiationService.createInstance(MockEndpoint, undefined);
		// Claude sessions have no per-turn FlowLeap key state, so the subscription status stays
		// unknown: the prompt then claims nothing about which patent-data offices are reachable.
		const { messages } = await renderPromptElement(instantiationService, endpoint, PatentAIInstructions, {
			availableTools: modelToolNames.map(toolInfo),
			webSearchAvailable: false,
		});
		return messages
			.flatMap(message => Array.isArray(message.content) ? message.content : [])
			.map(part => part.type === Raw.ChatCompletionContentPartKind.Text ? part.text : '')
			.join('\n')
			.trim();
	} finally {
		accessor.dispose();
	}
}

suite('Patent AI agent for Claude sessions', () => {

	test('assets/agents/patent-ai.agent.md matches the rendered Patent AI prompt', async () => {
		const tools = contributedPatentTools();
		const modelToolNames = tools.map(tool => getToolName(tool.name));
		const prompt = await renderForClaudeSession(modelToolNames);

		// Name every tool exactly as Claude sees it in this session. The editor names
		// (`search_patents`, ...) match a FlowLeap MCP connector a user may also have
		// connected to their Claude account, and Claude then calls that connector
		// instead of the client tools, bypassing the user's keys and working record.
		const sessionNames = new Map<string, string>(CLAUDE_BUILTIN_TOOL_NAMES);
		tools.forEach((tool, i) => sessionNames.set(modelToolNames[i], `${CLAUDE_CLIENT_TOOL_PREFIX}${tool.toolReferenceName}`));
		const promptWithSessionNames = renameTools(prompt, sessionNames);
		// Skills and recipes are shared with the editor chat and keep the editor names.
		const skillNameMap = [...sessionNames].map(([editorName, sessionName]) => `- \`${editorName}\` → \`${sessionName}\``).join('\n');

		const content = [
			'---',
			'name: Patent AI',
			'description: FlowLeap\'s patent intelligence agent, with the Patent Agent\'s patent-data tools and system prompt.',
			'---',
			'',
			'<!-- Generated from extensions/copilot/src/extension/prompts/node/agent/patentAIPrompt.tsx by patentAIAgentFile.spec.tsx. Do not edit by hand; run `npx vitest -u patentAIAgentFile` to regenerate. -->',
			'',
			'<patentDataSource>',
			`Patent data comes ONLY from this session's \`${CLAUDE_CLIENT_TOOL_PREFIX}\` tools. If other MCP servers offer patent tools (for example a FlowLeap connector on the user's Claude account), do not call them, even when their tool names look like the ones you need: they bypass the user's Patent-Data Keys and the project's working record.`,
			'',
			'Skills and recipes name tools as the FlowLeap editor chat does. In this session, call them by these names:',
			'',
			skillNameMap,
			'</patentDataSource>',
			'',
			promptWithSessionNames,
			'',
		].join('\n');

		await expect(content).toMatchFileSnapshot(AGENT_FILE);
	});

	test('the core patent tool set lists exactly the contributed patent tools', () => {
		const coreSource = readFileSync(CORE_TOOL_SET, 'utf8');
		const listed = Array.from(coreSource.matchAll(/^\t'([A-Za-z]+)',$/gm), match => match[1]);
		expect(listed).toEqual(contributedPatentTools().map(tool => tool.toolReferenceName));
	});
});
