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

describe('bundled skill references', () => {
	const skillDirs = fs.readdirSync(SKILLS_DIR, { withFileTypes: true })
		.filter(entry => entry.isDirectory() && fs.existsSync(path.join(SKILLS_DIR, entry.name, 'SKILL.md')))
		.map(entry => entry.name);

	it('resolves every reference file a skill body points at', () => {
		// A context pointer to a file that does not exist teaches the agent to look for
		// material it can never load, and nothing else in the build notices: skills are
		// assets, so a dead link survives compilation and ships.
		const dangling = skillDirs.flatMap(name => {
			const body = fs.readFileSync(path.join(SKILLS_DIR, name, 'SKILL.md'), 'utf8');
			return [...body.matchAll(/\]\((references\/[^)#]+)\)/g)]
				.map(match => match[1])
				.filter(target => !fs.existsSync(path.join(SKILLS_DIR, name, target)))
				.map(target => `${name}: ${target}`);
		}).sort();
		expect({ scanned: skillDirs.length > 0, dangling }).toEqual({ scanned: true, dangling: [] });
	});

	it('keeps the decision-row example parseable as the format it teaches', () => {
		// The investigation record's worked rows ARE the format spec: an agent copies their
		// shape. A row with the wrong column count or an unknown status teaches that instead.
		const reference = fs.readFileSync(path.join(SKILLS_DIR, 'investigation-record', 'references', 'row-format.md'), 'utf8');
		const rows = reference.split('\n').filter(line => line.includes('\t'));
		const header = rows[0]?.split('\t');
		const problems = rows.slice(1).flatMap(row => {
			const cells = row.split('\t');
			const status = cells[4] ?? '';
			const known = status === 'settled' || status === 'unresolved' || status.startsWith('superseded by ');
			return [
				...(cells.length === header.length ? [] : [`${cells.length} cells, expected ${header.length}: ${cells[1]}`]),
				...(known ? [] : [`unknown status "${status}": ${cells[1]}`]),
			];
		});
		expect({ header, hasRows: rows.length > 1, problems })
			.toEqual({ header: ['when', 'call', 'why', 'evidence', 'status'], hasRows: true, problems: [] });
	});
});
