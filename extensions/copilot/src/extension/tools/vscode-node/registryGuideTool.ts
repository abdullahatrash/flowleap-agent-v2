/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import type * as vscode from 'vscode';
import { ILogService } from '../../../platform/log/common/logService';
import { CancellationToken } from '../../../util/vs/base/common/cancellation';
import { LanguageModelTextPart, LanguageModelToolResult } from '../../../vscodeTypes';
import { IPatentBackendClient } from '../../patentai/vscode-node/patentBackendClient';
import { ICopilotTool } from '../common/toolsRegistry';
import { IGuideApiParams } from './baseApiGuideTool';
import { handlePatentToolError } from './patentToolError';

/**
 * One example invocation of a tool, from the backend's registry docs payload.
 */
export interface IRegistryToolExample {
	readonly description: string;
	/** A valid input body for the tool — the backend schema-checks these, so they are copyable as-is. */
	readonly input: Record<string, unknown>;
}

/** A named multi-step or single-call pattern worth reproducing exactly. */
export interface IRegistryToolRecipe {
	readonly name: string;
	readonly description: string;
	readonly input?: Record<string, unknown>;
}

/** Per-tool reference documentation carried inside the registry payload. */
export interface IRegistryToolDocs {
	readonly usage: string;
	readonly params?: Record<string, string>;
	readonly examples?: readonly IRegistryToolExample[];
	readonly recipes?: readonly IRegistryToolRecipe[];
}

/** One entry of the `GET /v1/tools` listing. */
export interface IRegistryTool {
	readonly name: string;
	readonly description: string;
	readonly inputSchema?: unknown;
	readonly docs?: IRegistryToolDocs;
}

/**
 * The `GET /v1/tools` payload: the backend's own capability listing, versioned so schema evolution is
 * detectable at runtime. `apiVersion` is the server build; `docsVersion`/`lastModified` version the
 * documentation payload itself.
 */
export interface IRegistryListing {
	readonly success?: boolean;
	readonly apiVersion?: string;
	readonly docsVersion?: string;
	readonly lastModified?: string;
	readonly tools?: readonly IRegistryTool[];
}

/** The registry path, relative to the configured api base (which already ends in `/v1`). */
const REGISTRY_PATH = '/tools';

/**
 * Base for the family API guide tools (EPO OPS, USPTO, citations, legal reference).
 *
 * Each guide is a VIEW over one versioned source — the backend's `GET /v1/tools` registry, which
 * carries every tool's description, JSON input schema, usage notes, parameter guidance, examples and
 * recipes. Documentation therefore cannot drift from the tools it documents: there is one payload, it
 * is generated from the registry the tools are defined in, and it stamps its own version.
 *
 * A guide narrows that registry to the tools of its family and renders them. The actions the agent
 * already knows keep their meaning:
 *  - `list` — the family's tools with one-line descriptions,
 *  - `endpoint` (the tool name) — that tool's full reference: usage, parameters, examples, schema,
 *  - `workflow` — the family's named recipes, optionally narrowed to one by name,
 *  - `full` — every family tool with its reference docs.
 *
 * Unlike the retired per-family docs manifests, the answers name TOOLS to call, not HTTP paths: every
 * capability here is invoked as a tool, so a guide never teaches a route.
 */
export abstract class BaseRegistryGuideTool implements ICopilotTool<IGuideApiParams> {

	constructor(
		@ILogService protected readonly logService: ILogService,
		@IPatentBackendClient protected readonly patentBackendClient: IPatentBackendClient,
	) { }

	/** The facade tool names this guide documents, in the order they should be presented. */
	protected abstract readonly toolFamily: readonly string[];
	/** Log tag, e.g. `[OpsApiGuideTool]`. */
	protected abstract readonly logPrefix: string;
	/** Human label used in the fetch-failure message, e.g. `EPO OPS tool docs`. */
	protected abstract readonly docsErrorLabel: string;
	/** Heading of the full-docs output, e.g. `# EPO OPS Tools`. */
	protected abstract readonly fullDocsTitle: string;
	/** Default progress message shown while fetching (no action-specific override applies). */
	protected abstract readonly defaultInvocationMessage: string;
	/** Progress message shown for `action === 'list'`. */
	protected abstract readonly listInvocationMessage: string;

	prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<IGuideApiParams>, _token: CancellationToken): vscode.ProviderResult<vscode.PreparedToolInvocation> {
		const { action, endpoint, workflow } = options.input;
		let message = this.defaultInvocationMessage;

		if (action === 'endpoint' && endpoint) {
			message = `Getting docs for tool: ${endpoint}`;
		} else if (action === 'workflow' && workflow) {
			message = `Getting workflow: ${workflow}`;
		} else if (action === 'list') {
			message = this.listInvocationMessage;
		}

		return {
			invocationMessage: l10n.t`${message}`
		};
	}

	async invoke(options: vscode.LanguageModelToolInvocationOptions<IGuideApiParams>, token: CancellationToken): Promise<vscode.LanguageModelToolResult> {
		this.logService.trace(`${this.logPrefix} Invoking tool guide`);

		const { action, endpoint, workflow } = options.input;

		try {
			const listing = await this.patentBackendClient.get<IRegistryListing>(REGISTRY_PATH, token);
			const tools = listing.tools ?? [];
			if (tools.length === 0) {
				return new LanguageModelToolResult([
					new LanguageModelTextPart(`Error: the FlowLeap tool registry returned no tools (${this.docsErrorLabel}).`)
				]);
			}

			const body = this.formatDocs(action, listing, tools, endpoint, workflow);
			this.logService.info(`${this.logPrefix} Formatted docs length: ${body.length} chars`);

			return new LanguageModelToolResult([
				new LanguageModelTextPart(this.decorateBody(action, endpoint, body))
			]);

		} catch (error) {
			return handlePatentToolError(error, this.logService, this.logPrefix, err => `Error: Failed to fetch ${this.docsErrorLabel}: ${err.status} ${err.message}`);
		}
	}

	/** Dispatch on `action` and render the matching view of the registry. */
	protected formatDocs(action: string, listing: IRegistryListing, tools: readonly IRegistryTool[], endpointParam?: string, workflowParam?: string): string {
		const family = this.toolFamily
			.map(name => tools.find(t => t.name === name))
			.filter((t): t is IRegistryTool => t !== undefined);

		if (action === 'endpoint' && endpointParam) {
			// An agent may name any tool, in or out of this family — answer from the whole registry
			// rather than pretending a real tool does not exist.
			const tool = tools.find(t => t.name === endpointParam);
			return tool
				? this.formatToolDoc(tool, listing)
				: `No tool named "${endpointParam}". Tools in this family: ${family.map(t => t.name).join(', ') || '(none)'}. Use action="list" for the full family.`;
		}
		if (action === 'workflow') {
			return this.formatRecipes(family, workflowParam, listing);
		}
		if (action === 'list') {
			return this.formatCompactList(family, listing);
		}
		return this.formatFullDocs(family, listing);
	}

	/** One tool's full reference: description, usage, parameters, examples, recipes and input schema. */
	protected formatToolDoc(tool: IRegistryTool, listing: IRegistryListing): string {
		const lines: string[] = [
			`## Tool: ${tool.name}`,
			'',
			tool.description,
		];

		if (tool.docs?.usage) {
			lines.push('', '### Usage', tool.docs.usage);
		}

		if (tool.docs?.params && Object.keys(tool.docs.params).length > 0) {
			lines.push('', '### Parameters');
			for (const [name, guidance] of Object.entries(tool.docs.params)) {
				lines.push(`- ${name}: ${guidance}`);
			}
		}

		lines.push(...this.renderExamples(tool));
		lines.push(...this.renderToolRecipes(tool));

		if (tool.inputSchema !== undefined) {
			lines.push('', '### Input Schema', '```json', JSON.stringify(tool.inputSchema, null, 2), '```');
		}

		lines.push('', this.versionFooter(listing));
		return lines.join('\n');
	}

	protected formatCompactList(family: readonly IRegistryTool[], listing: IRegistryListing): string {
		const lines: string[] = [`## Tools: ${this.fullDocsTitle.replace(/^#+\s*/, '')}`, ''];
		for (const tool of family) {
			lines.push(`- **${tool.name}** — ${firstSentence(tool.description)}`);
		}

		const recipeNames = family.flatMap(t => (t.docs?.recipes ?? []).map(r => r.name));
		if (recipeNames.length > 0) {
			lines.push('', '## Recipes (action="workflow"):');
			for (const name of recipeNames) {
				lines.push(`- ${name}`);
			}
		}

		lines.push('');
		lines.push('Call these tools directly — each is a FlowLeap tool, not an HTTP endpoint.');
		lines.push('Use action="endpoint" with a tool name for its full reference (usage, parameters, examples, input schema).');
		lines.push(this.versionFooter(listing));
		return lines.join('\n');
	}

	protected formatFullDocs(family: readonly IRegistryTool[], listing: IRegistryListing): string {
		const lines: string[] = [this.fullDocsTitle, ''];
		for (const tool of family) {
			lines.push(`### ${tool.name}`);
			lines.push(tool.description);
			if (tool.docs?.usage) {
				lines.push('', tool.docs.usage);
			}
			lines.push(...this.renderExamples(tool));
			lines.push('');
		}
		lines.push('---');
		lines.push('Call these tools directly. For one tool\'s parameters and input schema, use action="endpoint" with its name.');
		lines.push(this.versionFooter(listing));
		return lines.join('\n');
	}

	/** The family's named recipes, or the single one whose name matches `workflowParam`. */
	protected formatRecipes(family: readonly IRegistryTool[], workflowParam: string | undefined, listing: IRegistryListing): string {
		const all = family.flatMap(tool => (tool.docs?.recipes ?? []).map(recipe => ({ tool, recipe })));
		const wanted = workflowParam
			? all.filter(({ recipe }) => recipe.name.toLowerCase() === workflowParam.toLowerCase())
			: all;

		if (wanted.length === 0) {
			const available = all.map(({ recipe }) => recipe.name).join(', ');
			return workflowParam
				? `No recipe named "${workflowParam}" in this family.${available ? ` Available: ${available}.` : ''}`
				: 'This tool family documents no named recipes. Use action="list" for its tools, or action="endpoint" for one tool\'s examples.';
		}

		const lines: string[] = ['## Recipes', ''];
		for (const { tool, recipe } of wanted) {
			lines.push(`### ${recipe.name} (${tool.name})`);
			lines.push(recipe.description);
			if (recipe.input) {
				lines.push('```json', JSON.stringify(recipe.input, null, 2), '```');
			}
			lines.push('');
		}
		lines.push(this.versionFooter(listing));
		return lines.join('\n');
	}

	private renderExamples(tool: IRegistryTool): string[] {
		const examples = tool.docs?.examples ?? [];
		if (examples.length === 0) {
			return [];
		}
		const lines = ['', '### Examples'];
		for (const example of examples) {
			lines.push(`- ${example.description}:`);
			lines.push('```json', JSON.stringify(example.input, null, 2), '```');
		}
		return lines;
	}

	private renderToolRecipes(tool: IRegistryTool): string[] {
		const recipes = tool.docs?.recipes ?? [];
		if (recipes.length === 0) {
			return [];
		}
		const lines = ['', '### Recipes'];
		for (const recipe of recipes) {
			lines.push(`- **${recipe.name}** — ${recipe.description}`);
			if (recipe.input) {
				lines.push('```json', JSON.stringify(recipe.input, null, 2), '```');
			}
		}
		return lines;
	}

	/**
	 * The registry's own version stamp, carried on every answer. Two guide answers pulled weeks apart
	 * are told apart by this line, and a docs version that moved is the signal that guidance changed.
	 */
	protected versionFooter(listing: IRegistryListing): string {
		const parts = [
			listing.docsVersion ? `docs ${listing.docsVersion}` : undefined,
			listing.lastModified ? `updated ${listing.lastModified}` : undefined,
			listing.apiVersion ? `backend ${listing.apiVersion}` : undefined,
		].filter((p): p is string => p !== undefined);
		return parts.length > 0 ? `_Tool registry: ${parts.join(', ')}._` : '';
	}

	/** Wrap or annotate the formatted body (e.g. a typed-tool deferral banner). Identity by default. */
	protected decorateBody(_action: string, _endpointParam: string | undefined, body: string): string {
		return body;
	}
}

/** First sentence of a long tool description, for the compact list. */
function firstSentence(description: string): string {
	const end = description.indexOf('. ');
	return end > 0 ? description.substring(0, end + 1) : description;
}
