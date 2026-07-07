/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { BaseApiGuideTool, GuideDocsData, GuideEndpointDoc } from './baseApiGuideTool';
import { ToolName } from '../common/toolNames';
import { ToolRegistry } from '../common/toolsRegistry';

/**
 * Tool that provides EPO OPS API documentation to the LLM agent. The agent can then use the
 * `patent_api_request` tool to make authenticated API calls. Docs are fetched from the FlowLeap
 * backend through the shared {@link IPatentBackendClient} seam, so it inherits the centralized
 * `401 → re-sign-in` / `402 → start-trial` gating.
 *
 * This enables the agent to:
 * 1. Learn available endpoints and their parameters
 * 2. Get example patent_api_request invocations
 * 3. Understand workflows for common patent tasks
 * 4. Use the patent_api_request tool to execute calls without leaking auth tokens
 */
class OpsApiGuideTool extends BaseApiGuideTool {

	public static readonly toolName = ToolName.OpsApiGuide;

	protected readonly docsRoute = '/ops/docs';
	protected readonly logPrefix = '[OpsApiGuideTool]';
	protected readonly docsErrorLabel = 'OPS API docs';
	protected readonly fullDocsTitle = '# EPO OPS API Documentation';
	protected readonly defaultInvocationMessage = 'Getting OPS API documentation';
	protected readonly listInvocationMessage = 'Listing available OPS endpoints';

	protected override renderEndpointNote(endpoint: GuideEndpointDoc): string[] {
		return ['', `**Rate Limit Note:** ${endpoint.rateLimitNote}`];
	}

	protected override renderCompactExtras(data: GuideDocsData): string[] {
		if (!data.cqlFields) {
			return [];
		}
		const lines = ['', '## CQL Query Fields:'];
		for (const [field, desc] of Object.entries(data.cqlFields)) {
			lines.push(`- ${field}: ${desc}`);
		}
		return lines;
	}

	protected override renderFullDocsAfterEndpoints(data: GuideDocsData): string[] {
		if (!data.cqlReference) {
			return [];
		}
		const lines: string[] = ['## CQL Query Reference:', '', '### Fields:'];
		for (const [field, desc] of Object.entries(data.cqlReference.fields)) {
			lines.push(`- ${field}: ${desc}`);
		}
		lines.push('');

		if (data.cqlReference.operators) {
			lines.push('### Operators:');
			for (const [op, desc] of Object.entries(data.cqlReference.operators)) {
				lines.push(`- ${op}: ${desc}`);
			}
			lines.push('');
		}

		if (data.cqlReference.examples && data.cqlReference.examples.length > 0) {
			lines.push('### Examples:');
			for (const ex of data.cqlReference.examples) {
				lines.push(`- \`${ex.query}\` - ${ex.description}`);
			}
			lines.push('');
		}

		return lines;
	}
}

ToolRegistry.registerTool(OpsApiGuideTool);
