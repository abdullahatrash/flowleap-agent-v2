/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import type * as vscode from 'vscode';
import { ILogService } from '../../../platform/log/common/logService';
import { CancellationToken } from '../../../util/vs/base/common/cancellation';
import { LanguageModelTextPart, LanguageModelToolResult } from '../../../vscodeTypes';
import { IPatentBackendClient, PatentBackendError, patentBackendErrorRecoveryHint } from '../../patentai/vscode-node/patentBackendClient';
import { ToolName } from '../common/toolNames';
import { ICopilotTool, ToolRegistry } from '../common/toolsRegistry';
import { curlToApiRequestHint } from './curlToApiRequest';

interface IOpsApiGuideParams {
	action: 'list' | 'endpoint' | 'workflow' | 'full';
	endpoint?: string;
	workflow?: string;
}

interface EndpointDoc {
	path: string;
	method: string;
	description: string;
	params: Record<string, {
		required: boolean;
		type: string;
		description: string;
		default?: string;
		options?: string[];
		example?: string;
	}>;
	curlExample: string;
	responseShape: string;
	rateLimitNote: string;
}

interface WorkflowStep {
	step: number;
	action: string;
	endpoint: string;
	curlExample: string;
	note?: string;
}

interface WorkflowDoc {
	name: string;
	description: string;
	steps: WorkflowStep[];
}

interface OpsDocsResponse {
	success: boolean;
	data?: {
		baseUrl: string;
		description?: string;
		generalNotes?: string[];
		endpoints?: Record<string, EndpointDoc> | Array<{ name: string; path: string; method: string; description: string }>;
		endpoint?: EndpointDoc;
		workflow?: WorkflowDoc;
		workflows?: Record<string, WorkflowDoc> | string[];
		cqlReference?: {
			fields: Record<string, string>;
			operators?: Record<string, string>;
			examples?: Array<{ query: string; description: string }>;
		};
		cqlFields?: Record<string, string>;
	};
	error?: string;
}

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
class OpsApiGuideTool implements ICopilotTool<IOpsApiGuideParams> {

	public static readonly toolName = ToolName.OpsApiGuide;

	constructor(
		@ILogService private readonly logService: ILogService,
		@IPatentBackendClient private readonly patentBackendClient: IPatentBackendClient,
	) { }

	prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<IOpsApiGuideParams>, _token: CancellationToken): vscode.ProviderResult<vscode.PreparedToolInvocation> {
		const { action, endpoint, workflow } = options.input;
		let message = 'Getting OPS API documentation';

		if (action === 'endpoint' && endpoint) {
			message = `Getting docs for endpoint: ${endpoint}`;
		} else if (action === 'workflow' && workflow) {
			message = `Getting workflow: ${workflow}`;
		} else if (action === 'list') {
			message = 'Listing available OPS endpoints';
		}

		return {
			invocationMessage: l10n.t`${message}`
		};
	}

	async invoke(options: vscode.LanguageModelToolInvocationOptions<IOpsApiGuideParams>, token: CancellationToken): Promise<vscode.LanguageModelToolResult> {
		this.logService.trace('[OpsApiGuideTool] Invoking OPS API guide');

		const { action, endpoint, workflow } = options.input;

		try {
			let path = '/ops/docs';

			// Add query params based on action
			if (action === 'endpoint' && endpoint) {
				path += `?endpoint=${encodeURIComponent(endpoint)}`;
			} else if (action === 'workflow' && workflow) {
				path += `?workflow=${encodeURIComponent(workflow)}`;
			} else if (action === 'list') {
				path += '?format=compact';
			}
			// action === 'full' uses no params for full docs

			this.logService.info(`[OpsApiGuideTool] Fetching docs: ${path}`);

			const result = await this.patentBackendClient.get<OpsDocsResponse>(path, token);

			if (!result.success || !result.data) {
				return new LanguageModelToolResult([
					new LanguageModelTextPart(`Error: ${result.error || 'Invalid response from docs endpoint'}`)
				]);
			}

			// Format the docs for LLM consumption
			const formattedDocs = this.formatDocs(action, result.data);
			this.logService.info(`[OpsApiGuideTool] Formatted docs length: ${formattedDocs.length} chars`);

			return new LanguageModelToolResult([
				new LanguageModelTextPart(formattedDocs)
			]);

		} catch (error) {
			if (error instanceof PatentBackendError) {
				if (error.message === 'Request cancelled.') {
					return new LanguageModelToolResult([new LanguageModelTextPart('Request cancelled.')]);
				}
				this.logService.error(`[OpsApiGuideTool] Backend error ${error.status}: ${error.message}`);
				return new LanguageModelToolResult([
					new LanguageModelTextPart(`Error: Failed to fetch OPS API docs: ${error.status} ${error.message}` + patentBackendErrorRecoveryHint(error))
				]);
			}
			this.logService.error(`[OpsApiGuideTool] Exception: ${error instanceof Error ? error.message : String(error)}`);
			return new LanguageModelToolResult([
				new LanguageModelTextPart(`Error: ${error instanceof Error ? error.message : 'Unknown error occurred'}`)
			]);
		}
	}

	/**
	 * Format docs response for LLM consumption
	 */
	private formatDocs(action: string, data: OpsDocsResponse['data']): string {
		if (!data) {
			return 'No documentation available';
		}

		const lines: string[] = [];
		lines.push(`Base URL: ${data.baseUrl}`);
		lines.push('');

		// Format based on action type
		if (action === 'endpoint' && data.endpoint) {
			return this.formatEndpointDoc(data.baseUrl, data.endpoint);
		}

		if (action === 'workflow' && data.workflow) {
			return this.formatWorkflowDoc(data.workflow);
		}

		if (action === 'list') {
			return this.formatCompactList(data);
		}

		// Full docs
		return this.formatFullDocs(data);
	}

	private formatEndpointDoc(baseUrl: string, endpoint: EndpointDoc): string {
		const lines: string[] = [
			`## ${endpoint.method} ${endpoint.path}`,
			'',
			endpoint.description,
			'',
			'### Parameters:',
		];

		for (const [name, param] of Object.entries(endpoint.params)) {
			const required = param.required ? '(required)' : '(optional)';
			lines.push(`- ${name} ${required}: ${param.description}`);
			if (param.default) {
				lines.push(`  Default: ${param.default}`);
			}
			if (param.options) {
				lines.push(`  Options: ${param.options.join(', ')}`);
			}
			if (param.example) {
				lines.push(`  Example: ${param.example}`);
			}
		}

		lines.push('');
		lines.push('### patent_api_request Example:');
		lines.push('```');
		lines.push(curlToApiRequestHint(endpoint.curlExample));
		lines.push('```');
		lines.push('');
		lines.push('### Response Shape:');
		lines.push('```');
		lines.push(endpoint.responseShape);
		lines.push('```');
		lines.push('');
		lines.push(`**Rate Limit Note:** ${endpoint.rateLimitNote}`);

		return lines.join('\n');
	}

	private formatWorkflowDoc(workflow: WorkflowDoc): string {
		const lines: string[] = [
			`## Workflow: ${workflow.name}`,
			'',
			workflow.description,
			'',
			'### Steps:',
		];

		for (const step of workflow.steps) {
			lines.push(`**Step ${step.step}: ${step.action}**`);
			lines.push(`Endpoint: ${step.endpoint}`);
			lines.push('```');
			lines.push(curlToApiRequestHint(step.curlExample));
			lines.push('```');
			if (step.note) {
				lines.push(`*Note: ${step.note}*`);
			}
			lines.push('');
		}

		return lines.join('\n');
	}

	private formatCompactList(data: OpsDocsResponse['data']): string {
		if (!data) {
			return 'No data available';
		}

		const lines: string[] = [
			`Base URL: ${data.baseUrl}`,
			'',
			'## Available Endpoints:',
		];

		if (Array.isArray(data.endpoints)) {
			for (const ep of data.endpoints) {
				lines.push(`- ${ep.method} ${ep.path} - ${ep.description}`);
			}
		}

		if (Array.isArray(data.workflows) && data.workflows.length > 0) {
			lines.push('');
			lines.push('## Available Workflows:');
			for (const wf of data.workflows) {
				lines.push(`- ${wf}`);
			}
		}

		if (data.cqlFields) {
			lines.push('');
			lines.push('## CQL Query Fields:');
			for (const [field, desc] of Object.entries(data.cqlFields)) {
				lines.push(`- ${field}: ${desc}`);
			}
		}

		lines.push('');
		lines.push('Use action="endpoint" with endpoint name for detailed docs.');
		lines.push('Use action="workflow" with workflow name for step-by-step guides.');

		return lines.join('\n');
	}

	private formatFullDocs(data: OpsDocsResponse['data']): string {
		if (!data) {
			return 'No data available';
		}

		const lines: string[] = [
			'# EPO OPS API Documentation',
			'',
			`Base URL: ${data.baseUrl}`,
			'',
		];

		if (data.description) {
			lines.push(data.description);
			lines.push('');
		}

		if (data.generalNotes && data.generalNotes.length > 0) {
			lines.push('## General Notes:');
			for (const note of data.generalNotes) {
				lines.push(`- ${note}`);
			}
			lines.push('');
		}

		// Endpoints
		if (data.endpoints && !Array.isArray(data.endpoints)) {
			lines.push('## Endpoints:');
			lines.push('');
			for (const [name, endpoint] of Object.entries(data.endpoints)) {
				lines.push(`### ${name}`);
				lines.push(`${endpoint.method} ${endpoint.path}`);
				lines.push(endpoint.description);
				lines.push('');
				lines.push('patent_api_request:');
				lines.push('```');
				lines.push(curlToApiRequestHint(endpoint.curlExample));
				lines.push('```');
				lines.push('');
			}
		}

		// CQL Reference
		if (data.cqlReference) {
			lines.push('## CQL Query Reference:');
			lines.push('');
			lines.push('### Fields:');
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
		}

		// Workflows
		if (data.workflows && !Array.isArray(data.workflows)) {
			lines.push('## Workflows:');
			for (const [name, workflow] of Object.entries(data.workflows)) {
				lines.push(`### ${name}: ${workflow.name}`);
				lines.push(workflow.description);
				lines.push('');
			}
		}

		lines.push('');
		lines.push('---');
		lines.push('Use the patent_api_request tool to execute API calls. It handles authentication automatically.');

		return lines.join('\n');
	}
}

ToolRegistry.registerTool(OpsApiGuideTool);
