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
		const skillFiles = fs.readdirSync(SKILLS_DIR)
			.map(name => path.join(SKILLS_DIR, name, 'SKILL.md'))
			.filter(file => fs.existsSync(file));

		// Skills reference tools as snake_case tokens in backticks (e.g. `search_patents`). Requiring
		// an underscore keeps single-word backtick jargon (endpoint names, claim terms) from being
		// mistaken for a tool; every such token must be a real tool or a dead link fails CI.
		const problems = skillFiles.flatMap(file => {
			const text = fs.readFileSync(file, 'utf8');
			const tokens = [...text.matchAll(/`([a-z][a-z0-9]*(?:_[a-z0-9]+)+)`/g)].map(m => m[1]);
			return [...new Set(tokens)]
				.filter(token => !isKnownTool(token))
				.map(token => `${path.basename(path.dirname(file))}: ${token}`);
		}).sort();

		expect({ scannedSkills: skillFiles.length > 0, problems }).toEqual({ scannedSkills: true, problems: [] });
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
