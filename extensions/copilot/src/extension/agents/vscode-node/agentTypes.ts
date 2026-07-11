/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Handoff configuration for agent transitions (e.g., Plan → Agent).
 */
export interface AgentHandoff {
	readonly label: string;
	readonly agent: string;
	readonly prompt: string;
	readonly send?: boolean;
	readonly showContinueOn?: boolean;
	readonly model?: string;
}

/**
 * Agent configuration for building .agent.md content.
 * Shared by PlanAgentProvider, AskAgentProvider, and other custom agents.
 */
export interface AgentConfig {
	readonly name: string;
	readonly description: string;
	readonly icon?: string;
	readonly argumentHint: string;
	readonly tools: string[];
	readonly model?: string | readonly string[];
	readonly target?: string;
	readonly disableModelInvocation?: boolean;
	readonly userInvocable?: boolean;
	readonly agents?: string[];
	readonly handoffs?: AgentHandoff[];
	readonly body: string;
}

/**
 * Default read-only tools shared by Plan, Ask, and other agents.
 * These tools can only inspect the workspace — they never modify it.
 */
export const DEFAULT_READ_TOOLS: readonly string[] = [
	'search',
	'read',
	'web',
	'vscode/memory',
	'github/issue_read',
	'github.vscode-pull-request-github/issue_fetch',
	'github.vscode-pull-request-github/activePullRequest',
	'execute/getTerminalOutput',
	'execute/testFailure'
];

/**
 * Patent-specific tools available to patent agents.
 *
 * The complete research toolset: multi-source search, citation tracking,
 * patent reading (details/figures/PDF), legal lookup, claim assessment,
 * landscape analytics, raw backend access, API guides, and result writing.
 *
 * Excludes `patentSearchSubagent` on purpose — a research agent must not
 * recursively spawn the top-level patent search subagent.
 *
 * NOTE: these are `toolReferenceName`s (the package.json contribution alias),
 * not internal `ToolName` values.
 */
export const PATENT_TOOLS: readonly string[] = [
	// Search & query building
	'patents',
	'academic',
	'buildPatentQuery',
	'buildUSPTOQuery',
	// Citation tracking
	'citations',
	'forwardCitations',
	// US prosecution (continuity chain + legal-event timeline)
	'continuity',
	'prosecutionTimeline',
	// Reading patent content
	'patentSummary',
	'patentDetails',
	'patentFigures',
	'patentTerm',
	'readPdf',
	// Legal status, patent family & register events (known patent number)
	'legalStatus',
	'patentFamily',
	'registerEvents',
	// Legal research
	'legal',
	// Claim assessment & landscape analytics
	'analyzeClaim',
	'compareClaims',
	'comparePatents',
	'patentAnalytics',
	// Raw backend access & API guides
	'patentApiRequest',
	'opsApiGuide',
	'usptoApiGuide',
	'citationApiGuide',
	'legalSearchGuide',
	// Output & web fallback
	'writePatentResults',
	'fetch',
];

/**
 * Builds .agent.md content from a configuration object using string formatting.
 * No YAML library required — generates valid YAML frontmatter via string templates.
 */
export function buildAgentMarkdown(config: AgentConfig): string {
	const lines: string[] = ['---'];

	// Simple scalar fields
	lines.push(`name: ${config.name}`);
	lines.push(`description: ${config.description}`);
	if (config.icon) {
		lines.push(`icon: ${config.icon}`);
	}
	lines.push(`argument-hint: ${config.argumentHint}`);

	// Model (optional) — supports a single string or a priority list of models
	if (config.model) {
		if (Array.isArray(config.model)) {
			const quoted = config.model.map(m => `'${m.replace(/'/g, '\'\'')}'`).join(', ');
			lines.push(`model: [${quoted}]`);
		} else {
			lines.push(`model: ${config.model}`);
		}
	}
	if (config.target) {
		lines.push(`target: ${config.target}`);
	}
	if (config.disableModelInvocation) {
		lines.push(`disable-model-invocation: true`);
	}
	if (config.userInvocable === false) {
		lines.push(`user-invocable: false`);
	}

	// Tools array - flow style for readability
	// Escape single quotes by doubling them (YAML spec)
	if (config.tools.length > 0) {
		const quotedTools = config.tools.map(t => `'${t.replace(/'/g, '\'\'')}'`).join(', ');
		lines.push(`tools: [${quotedTools}]`);
	}

	// Agents array - same format as tools (empty array = no subagents allowed)
	if (config.agents) {
		const quotedAgents = config.agents.map(a => `'${a.replace(/'/g, '\'\'')}'`).join(', ');
		lines.push(`agents: [${quotedAgents}]`);
	}

	// Handoffs - block style for complex nested objects
	// Escape prompts using single quotes (with doubled single quotes for internal quotes)
	if (config.handoffs && config.handoffs.length > 0) {
		lines.push('handoffs:');
		for (const handoff of config.handoffs) {
			lines.push(`  - label: ${handoff.label}`);
			lines.push(`    agent: ${handoff.agent}`);
			lines.push(`    prompt: '${handoff.prompt.replace(/'/g, '\'\'')}'`);
			if (handoff.send !== undefined) {
				lines.push(`    send: ${handoff.send}`);
			}
			if (handoff.showContinueOn !== undefined) {
				lines.push(`    showContinueOn: ${handoff.showContinueOn}`);
			}
			if (handoff.model !== undefined) {
				lines.push(`    model: ${handoff.model}`);
			}
		}
	}

	lines.push('---');
	lines.push(config.body);

	return lines.join('\n');
}
