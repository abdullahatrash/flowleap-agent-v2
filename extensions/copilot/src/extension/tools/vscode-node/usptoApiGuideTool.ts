/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { BaseApiGuideTool, GuideDocsData, GuideEndpointDoc } from './baseApiGuideTool';
import { ToolName } from '../common/toolNames';
import { ToolRegistry } from '../common/toolsRegistry';

/**
 * Tool that provides USPTO Open Data Portal API documentation to the LLM agent. The agent can then
 * use the `patent_api_request` tool to make authenticated API calls. Docs are fetched from the
 * FlowLeap backend through the shared {@link IPatentBackendClient} seam, so it inherits the
 * centralized `401 → re-sign-in` / `402 → start-trial` gating.
 *
 * This enables the agent to:
 * 1. Learn available endpoints and their current parameters
 * 2. Get example patent_api_request invocations for US patent searches
 * 3. Understand workflows for common USPTO patent tasks
 * 4. Use the patent_api_request tool to execute calls without leaking auth tokens
 *
 * This tool is the single source of truth for the USPTO route's request shape.
 * Prompts and skills should not hardcode parameter names — call this tool
 * at runtime so guidance never drifts from the backend.
 */
class USPTOApiGuideTool extends BaseApiGuideTool {

	public static readonly toolName = ToolName.USPTOApiGuide;

	protected readonly docsRoute = '/patent-search-uspto/docs';
	protected readonly logPrefix = '[USPTOApiGuideTool]';
	protected readonly docsErrorLabel = 'USPTO API docs';
	protected readonly fullDocsTitle = '# USPTO Open Data Portal API Documentation';
	protected readonly defaultInvocationMessage = 'Getting USPTO Open Data Portal API documentation';
	protected readonly listInvocationMessage = 'Listing available USPTO endpoints';

	protected override renderEndpointNote(endpoint: GuideEndpointDoc): string[] {
		return endpoint.rateLimitNote ? ['', `**Rate Limit Note:** ${endpoint.rateLimitNote}`] : [];
	}

	protected override renderCompactExtras(data: GuideDocsData): string[] {
		if (!data.searchParams) {
			return [];
		}
		const lines = ['', '## Search Parameters:'];
		for (const [param, info] of Object.entries(data.searchParams)) {
			const req = info.required ? '(required)' : '';
			lines.push(`- ${param} ${req}: ${info.description}`);
		}
		return lines;
	}
}

ToolRegistry.registerTool(USPTOApiGuideTool);
