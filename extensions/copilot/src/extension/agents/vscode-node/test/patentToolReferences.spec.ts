/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { packageJson } from '../../../../platform/env/common/packagejson';
import { ToolName } from '../../../tools/common/toolNames';
import { PatentResearchAgentProvider } from '../patentResearchAgentProvider';

/**
 * Tools that are legitimately available to the model but are NOT contributed through the
 * ToolName registry — Anthropic injects `web_search` server-side (see
 * byok/vscode-node/anthropicProvider.ts), so patent skills may reference it as a fallback.
 */
const EXTERNAL_TOOL_TOKENS = new Set(['web_search']);

const registryToolNames = new Set<string>(Object.values(ToolName));

function isKnownTool(token: string): boolean {
	return registryToolNames.has(token) || EXTERNAL_TOOL_TOKENS.has(token);
}

const SKILLS_DIR = path.resolve(__dirname, '../../../../../assets/skills');
const FIGURES_TOOL_SOURCE = path.resolve(__dirname, '../../../tools/vscode-node/getPatentFiguresTool.ts');

/**
 * The Markdown files of the bundled skills: each skill's SKILL.md, or with `recursive` every .md
 * under every skill (its reference files included).
 */
function skillMarkdownFiles(root: string, { recursive }: { recursive: boolean }): string[] {
	if (recursive) {
		return fs.readdirSync(root, { recursive: true, encoding: 'utf8' })
			.filter(name => name.endsWith('.md'))
			.map(name => path.join(root, name));
	}
	return fs.readdirSync(root)
		.map(name => path.join(root, name, 'SKILL.md'))
		.filter(file => fs.existsSync(file));
}

/**
 * Scans every file for the tokens `tokensOf` yields that `isProblem` flags, and lists them as
 * `<path relative to the skills dir>: <token>`, sorted, so a test asserts one snapshot-style value.
 */
function skillProblems(files: string[], tokensOf: (text: string) => string[], isProblem: (token: string) => boolean): string[] {
	return files.flatMap(file => {
		const text = fs.readFileSync(file, 'utf8');
		return [...new Set(tokensOf(text))]
			.filter(isProblem)
			.map(token => `${path.relative(SKILLS_DIR, file)}: ${token}`);
	}).sort();
}

describe('patent tool references', () => {
	it('resolves every #tool: reference in the PatentResearch agent body to a registered tool name', () => {
		// The patent agent's `#tool:` prose refs use internal snake_case ToolName values (not the
		// toolReferenceName aliases the `tools:` grant array uses). Validating against the ToolName
		// registry is what catches camelCase drift like `#tool:patentApiRequest`, which resolves to
		// nothing — the toolReferenceName namespace would have accepted it and hidden the bug.
		const body = PatentResearchAgentProvider.buildAgentBody();
		const tokens = [...body.matchAll(/#tool:([a-zA-Z0-9_]+)/g)].map(m => m[1]);
		const dangling = [...new Set(tokens)].filter(token => !isKnownTool(token)).sort();
		expect({ referenced: new Set(tokens).size > 0, dangling }).toEqual({ referenced: true, dangling: [] });
	});

	it('resolves every tool token referenced in bundled skill bodies to a registered tool name', () => {
		const skillFiles = skillMarkdownFiles(SKILLS_DIR, { recursive: false });

		// Skills reference tools as snake_case tokens in backticks (e.g. `search_patents`). Requiring
		// an underscore keeps single-word backtick jargon (endpoint names, claim terms) from being
		// mistaken for a tool; every such token must be a real tool or a dead link fails CI.
		const backtickedTokens = (text: string) => [...text.matchAll(/`(?<token>[a-z][a-z0-9]*(?:_[a-z0-9]+)+)`/g)].map(m => m.groups?.token ?? '');
		const problems = skillProblems(skillFiles, backtickedTokens, token => !isKnownTool(token));

		expect({ scannedSkills: skillFiles.length > 0, problems }).toEqual({ scannedSkills: true, problems: [] });
	});

	it('names no retired legal tool in any bundled skill file', () => {
		// ADR 0017: patent law is read from the official page. The two chat tools that reached the
		// FlowLeap copy retire; a skill that still names one would route the agent at a dead end.
		// Scan every file under each skill (SKILL.md and references) so a reference file cannot
		// carry the name either.
		const retiredTools = ['search_legal', 'legal_search_guide'];
		const skillFiles = skillMarkdownFiles(SKILLS_DIR, { recursive: true });
		const problems = skillProblems(skillFiles, text => retiredTools.filter(tool => text.includes(tool)), () => true);

		expect({ scannedSkills: skillFiles.length > 0, problems }).toEqual({ scannedSkills: true, problems: [] });
	});

	it('routes legal-research by a description that names the official page, not the retired search engine', () => {
		// The frontmatter description is the sole routing signal of a skill. ADR 0017: the skill reads
		// patent law from the office's own page; the trigger phrases that follow must stay word for word.
		const text = fs.readFileSync(path.join(SKILLS_DIR, 'legal-research', 'SKILL.md'), 'utf8');
		const description = /^description: (?<description>.+)$/m.exec(text)?.groups?.description ?? '';
		expect({
			namesTheOfficialPage: /official page|office's own page/.test(description),
			namesTheRetiredEngine: /Search the MPEP/.test(description),
			keepsTheTriggers: description.includes('Use for a patent-law or procedure question, the statutory basis for patentability, novelty, obviousness or written description, or when the user names a section such as 35 USC 103 or EPC Art. 54.'),
		}).toEqual({ namesTheOfficialPage: true, namesTheRetiredEngine: false, keepsTheTriggers: true });
	});

	it('enforces the same figures page maximum its input schema documents', () => {
		// The figures tool clamps user-requested pages to a MAX_REQUESTED_PAGES cap that must match the
		// "(max N)" the schema advertises to the model, so the promise and the enforcement never drift.
		const figures = packageJson.contributes.languageModelTools.find(tool => tool.name === 'copilot_getPatentFigures');
		const pagesDescription: string = figures?.inputSchema?.properties?.pages?.description ?? '';
		const schemaMax = Number(/max (\d+)/.exec(pagesDescription)?.[1]);

		const source = fs.readFileSync(FIGURES_TOOL_SOURCE, 'utf8');
		const enforcedMax = Number(/MAX_REQUESTED_PAGES\s*=\s*(\d+)/.exec(source)?.[1]);

		expect(Number.isInteger(schemaMax)).toBe(true);
		expect(enforcedMax).toBe(schemaMax);
	});
});
