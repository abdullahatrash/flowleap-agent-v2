/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Extracts patent tool definitions from package.json and outputs
 * OpenAI function-calling format to tool-definitions.json
 */

import * as fs from 'fs';
import * as path from 'path';
import {
	ContributedToolName,
	ToolName,
	getContributedToolName,
	getToolName,
	mapContributedToolNamesInSchema,
	mapContributedToolNamesInString,
} from '../../src/extension/tools/common/toolNames';

const ROOT = path.resolve(__dirname, '..', '..');
const OUTPUT = path.join(__dirname, 'tool-definitions.json');

/**
 * The patent tools the model can call directly (patentai overlay), referenced
 * as enum members rather than their string values — a rename or removal in
 * toolNames.ts is caught by the missing-name guard in {@link buildToolDefinitions}
 * instead of silently shrinking the eval tool surface.
 *
 * This is the SINGLE source of the patent surface the evals model:
 * render-system-prompt.tsx feeds the same list to detectPatentTools, so the tools
 * the model is offered and the prompt branches it is offered them under cannot
 * drift apart (they had — #182: the patstat tools reached this list in #159 but
 * never reached the renderer's copy of it).
 */
export const PATENT_TOOL_NAMES: readonly ToolName[] = [
	ToolName.BuildPatentQuery,
	ToolName.BuildUSPTOQuery,
	ToolName.SearchPatents,
	ToolName.GetPatentDetails,
	ToolName.GetPatentFigures,
	ToolName.PatentApiRequest,
	ToolName.SearchCitations,
	ToolName.SearchForwardCitations,
	ToolName.GetContinuity,
	ToolName.GetProsecutionTimeline,
	ToolName.GetLegalStatus,
	ToolName.GetPatentFamily,
	ToolName.GetRegisterEvents,
	ToolName.OpsApiGuide,
	ToolName.USPTOApiGuide,
	ToolName.CitationApiGuide,
	ToolName.SearchLegal,
	ToolName.LegalSearchGuide,
	ToolName.SearchAcademic,
	ToolName.ReadPdf,
	ToolName.WritePatentResults,
	ToolName.PatentSearchSubagent,
	ToolName.AnalyzeClaim,
	ToolName.CompareClaims,
	ToolName.PatentAnalyticsViz,
	ToolName.GetPatentSummary,
	ToolName.GetPatentTerm,
	ToolName.ComparePatents,
	ToolName.PatstatPortfolio,
	ToolName.PatstatQuery,
	ToolName.PatstatGraph,
	ToolName.PatstatApiGuide,
];

/** Core coding tools that patentAIPrompt.tsx references by name. */
const CORE_TOOL_NAMES: readonly ToolName[] = [
	ToolName.CreateFile,
	ToolName.FetchWebPage,
];

/** A single tool definition in OpenAI function-calling format. */
export interface ToolDefinition {
	readonly type: 'function';
	readonly function: {
		readonly name: string;
		readonly description: string;
		readonly parameters: object;
	};
}

/**
 * Synthetic tool definitions for tools patentAIPrompt.tsx references that are not
 * contributed via package.json contributes.languageModelTools: run_in_terminal and
 * vscode_askQuestions are VS Code core tools with no ContributedToolName counterpart,
 * and web_search is Anthropic's native tool, injected by the backend for Claude
 * models under BYOK, with no ToolName entry at all.
 */
const SYNTHETIC_TOOLS: readonly ToolDefinition[] = [
	{
		type: 'function',
		function: {
			name: ToolName.CoreAskQuestions,
			description: 'Present interactive questions to the user via a carousel UI. Use for jurisdiction clarification before patent searches.',
			parameters: {
				type: 'object',
				properties: {
					questions: {
						type: 'array',
						description: 'List of questions to ask the user. Order is preserved.',
						items: {
							type: 'object',
							properties: {
								header: { type: 'string', description: 'Short identifier for the question. Must be unique so answers can be mapped back to the question. Maximum 50 characters.', maxLength: 50 },
								question: { type: 'string', description: 'The question text to display to the user. Keep it concise, ideally one sentence. Maximum 200 characters.', maxLength: 200 },
								multiSelect: { type: 'boolean', description: 'Allow selecting multiple options when options are provided.' },
								allowFreeformInput: { type: 'boolean', description: 'Allow freeform text answers in addition to option selection. Defaults to true; set to false to restrict to predefined options only.' },
								message: { type: 'string', description: 'Optional markdown message to display below the question text, providing additional context or details.' },
								options: {
									type: 'array',
									description: 'Optional list of selectable answers. If omitted, the question is free text.',
									items: {
										type: 'object',
										properties: {
											label: { type: 'string', description: 'Display label and value for the option.' },
											description: { type: 'string', description: 'Optional secondary text shown with the option.' },
											recommended: { type: 'boolean', description: 'Mark this option as the recommended default.' },
										},
										required: ['label'],
									},
								},
							},
							required: ['header', 'question'],
						},
						minItems: 1,
					},
				},
				required: ['questions'],
			},
		},
	},
	{
		type: 'function',
		function: {
			name: ToolName.CoreRunInTerminal,
			description: 'Execute a shell command in the terminal. Do not use this to call the patent backend — use patent_api_request instead.',
			parameters: {
				type: 'object',
				properties: {
					command: { type: 'string', description: 'Shell command to execute' },
				},
				required: ['command'],
			},
		},
	},
	{
		type: 'function',
		function: {
			// Not in ToolName: Anthropic's native web_search tool has no VS Code-side name.
			name: 'web_search',
			description: 'Search the web (Anthropic native tool, injected by the backend for Claude models). Use for CN/JP/KR patents and academic papers not covered by dedicated tools.',
			parameters: {
				type: 'object',
				properties: {
					query: { type: 'string', description: 'Search query' },
				},
				required: ['query'],
			},
		},
	},
];

interface PackageToolDef {
	readonly name: string;
	readonly modelDescription?: string;
	readonly inputSchema?: Record<string, unknown>;
}

/**
 * Builds the eval tool surface (patent tools + referenced core tools + synthetic
 * tools) from package.json's contributes.languageModelTools entries. Returns any
 * expected contributed names that were not found, so callers can fail loudly
 * instead of silently shipping a shrunken tool surface.
 */
export function buildToolDefinitions(allTools: readonly PackageToolDef[]): { definitions: ToolDefinition[]; missing: string[] } {
	const includedContributedNames = new Set(
		[...PATENT_TOOL_NAMES, ...CORE_TOOL_NAMES].map(name => getContributedToolName(name)),
	);

	const fromPackageJson = allTools
		.filter(t => includedContributedNames.has(t.name as ContributedToolName))
		.map((t): ToolDefinition => ({
			type: 'function',
			function: {
				name: getToolName(t.name) as string,
				description: t.modelDescription ? mapContributedToolNamesInString(t.modelDescription) : '',
				parameters: t.inputSchema ? mapContributedToolNamesInSchema(t.inputSchema) : { type: 'object', properties: {} },
			},
		}));

	const definitions = [...fromPackageJson, ...SYNTHETIC_TOOLS];

	// Guard: every expected tool must have a package.json match — a silent miss
	// would shrink the eval tool surface without anyone noticing.
	const foundContributedNames = new Set(allTools.map(t => t.name));
	const missing = [...includedContributedNames].filter(name => !foundContributedNames.has(name));

	return { definitions, missing };
}

function main(): void {
	const pkgPath = path.join(ROOT, 'package.json');
	const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
	const allTools: PackageToolDef[] = pkg.contributes?.languageModelTools ?? [];

	const { definitions, missing } = buildToolDefinitions(allTools);
	if (missing.length > 0) {
		console.error(`extract-tools: missing from package.json contributes.languageModelTools: ${missing.join(', ')}`);
		process.exit(1);
	}

	fs.writeFileSync(OUTPUT, JSON.stringify(definitions, null, 2));
	console.log(`Wrote ${definitions.length} tool definitions to ${OUTPUT}`);
}

if (require.main === module) {
	main();
}
