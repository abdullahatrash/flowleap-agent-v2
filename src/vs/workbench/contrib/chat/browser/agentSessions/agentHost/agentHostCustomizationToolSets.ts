/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from '../../../../../../base/common/codicons.js';
import { IReader } from '../../../../../../base/common/observable.js';
import { localize } from '../../../../../../nls.js';
import { ILanguageModelToolsService, IToolData, IToolSet, ToolDataSource } from '../../../common/tools/languageModelToolsService.js';

/**
 * The single source of truth for which tool sets the Chat Customizations "Tools" section shows.
 * Both the section widget (which renders the sets) and the sidebar/overview counters (via
 * {@link countEnabledCustomizationTools}) build on this list, so their counts cannot diverge — see
 * the "Count Consistency" rule in `vs/sessions/AI_CUSTOMIZATIONS.md`.
 */
export function getCustomizationToolSets(toolsService: ILanguageModelToolsService, reader?: IReader): IToolSet[] {
	const result: IToolSet[] = [];
	for (const toolSet of toolsService.toolSets.read(reader)) {
		if (isCustomizationToolSet(toolSet)) {
			result.push(toolSet);
		}
	}
	// Injected read-only reference sets (e.g. the CLI Agent built-ins) are not registered with the
	// tools service, so append them here to keep the universe consistent for every consumer.
	result.push(...getStaticReadOnlyToolSets());
	return result;
}

/**
 * Whether a registered tool set belongs in the Tools section. MCP server groups are created with a
 * `deprecated` flag upstream (a legacy-grouping marker, not a hide signal); surface them here for
 * parity with the chat tools picker. Every other `deprecated` set is a to-be-removed local-harness
 * grouping and stays hidden.
 */
export function isCustomizationToolSet(toolSet: IToolSet): boolean {
	return !toolSet.deprecated || toolSet.source.type === 'mcp';
}

let staticReadOnlyToolSets: readonly IToolSet[] | undefined;

/** Read-only reference tool sets injected into the section (currently the CLI Agent built-ins). */
export function getStaticReadOnlyToolSets(): readonly IToolSet[] {
	return staticReadOnlyToolSets ??= buildStaticReadOnlyToolSets();
}

function buildStaticReadOnlyToolSets(): readonly IToolSet[] {
	const tools: IToolData[] = COPILOT_CLI_TOOLS.map(t => ({
		id: `copilot-cli:${t.name}`,
		displayName: t.name,
		modelDescription: t.description,
		source: ToolDataSource.Internal,
		canBeReferencedInPrompt: false,
	}));
	const copilotCliSet: IToolSet = {
		id: COPILOT_CLI_TOOL_SET_ID,
		referenceName: 'copilotCli',
		icon: Codicon.robot,
		source: ToolDataSource.Internal,
		description: localize('clientToolSet.copilotCli.description', "CLI Agent"),
		detail: localize('clientToolSet.copilotCli.detail', "Built-in tools the CLI Agent runs inside its own runtime."),
		getTools: () => tools,
	};
	return [copilotCliSet];
}

export const COPILOT_CLI_TOOL_SET_ID = 'copilot-cli';

/**
 * The Copilot CLI's built-in tools, surfaced read-only for reference. Mirrored from the published
 * "Tool availability values" table (the SDK does not expose this list at runtime); keep in sync:
 * https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference#tool-availability-values
 */
const COPILOT_CLI_TOOLS: readonly { readonly name: string; readonly description: string }[] = [
	// Shell tools
	{ name: 'bash / powershell', description: localize('copilotCliTool.shell', "Execute commands") },
	{ name: 'list_bash / list_powershell', description: localize('copilotCliTool.listShell', "List active shell sessions") },
	{ name: 'read_bash / read_powershell', description: localize('copilotCliTool.readShell', "Read output from a shell session") },
	{ name: 'stop_bash / stop_powershell', description: localize('copilotCliTool.stopShell', "Terminate a shell session") },
	{ name: 'write_bash / write_powershell', description: localize('copilotCliTool.writeShell', "Send input to a shell session") },
	// File operation tools
	{ name: 'apply_patch', description: localize('copilotCliTool.applyPatch', "Apply patches (used by some models instead of edit/create)") },
	{ name: 'create', description: localize('copilotCliTool.create', "Create new files") },
	{ name: 'edit', description: localize('copilotCliTool.edit', "Edit files via string replacement") },
	{ name: 'view', description: localize('copilotCliTool.view', "Read files or directories") },
	// Agent and task delegation tools
	{ name: 'list_agents', description: localize('copilotCliTool.listAgents', "List available agents") },
	{ name: 'read_agent', description: localize('copilotCliTool.readAgent', "Check background agent status") },
	{ name: 'task', description: localize('copilotCliTool.task', "Run subagents") },
	// Other tools
	{ name: 'ask_user', description: localize('copilotCliTool.askUser', "Ask the user a question") },
	{ name: 'glob', description: localize('copilotCliTool.glob', "Find files matching patterns") },
	{ name: 'grep (or rg)', description: localize('copilotCliTool.grep', "Search for text in files") },
	{ name: 'skill', description: localize('copilotCliTool.skill', "Invoke custom skills") },
	{ name: 'web_fetch', description: localize('copilotCliTool.webFetch', "Fetch and parse web content") },
];
