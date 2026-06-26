/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import type * as vscode from 'vscode';
import { ILogService } from '../../../platform/log/common/logService';
import { CancellationToken } from '../../../util/vs/base/common/cancellation';
import { LanguageModelTextPart, LanguageModelToolResult } from '../../../vscodeTypes';
import { IPatentBackendClient, PatentBackendError } from '../../patentai/vscode-node/patentBackendClient';
import { ToolName } from '../common/toolNames';
import { ICopilotTool, ToolRegistry } from '../common/toolsRegistry';
import { curlToApiRequestHint } from './curlToApiRequest';

interface ICitationApiGuideParams {
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
	note?: string;
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

interface CitationDocsResponse {
	success: boolean;
	data?: {
		baseUrl: string;
		description?: string;
		generalNotes?: string[];
		endpoints?: Record<string, EndpointDoc> | Array<{ name: string; path: string; method: string; description: string }>;
		endpoint?: EndpointDoc;
		workflow?: WorkflowDoc;
		workflows?: Record<string, WorkflowDoc> | string[];
		categoriesReference?: Record<string, {
			code: string;
			description: string;
			legalBasis?: string;
		}>;
	};
	error?: string;
}

/**
 * Tool that provides USPTO Citation Search API documentation to the LLM agent.
 * The agent can then use the `patent_api_request` tool to make authenticated API calls.
 *
 * This enables the agent to:
 * 1. Learn about office action citation categories (X, Y, A)
 * 2. Get example patent_api_request invocations for citation searches
 * 3. Understand workflows for prior art and impact analysis
 * 4. Use the patent_api_request tool to execute calls without leaking auth tokens
 */
class CitationApiGuideTool implements ICopilotTool<ICitationApiGuideParams> {

	public static readonly toolName = ToolName.CitationApiGuide;

	constructor(
		@ILogService private readonly logService: ILogService,
		@IPatentBackendClient private readonly patentBackendClient: IPatentBackendClient,
	) { }

	prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<ICitationApiGuideParams>, _token: CancellationToken): vscode.ProviderResult<vscode.PreparedToolInvocation> {
		const { action, endpoint, workflow } = options.input;
		let message = 'Getting USPTO Citation Search API documentation';

		if (action === 'endpoint' && endpoint) {
			message = `Getting docs for endpoint: ${endpoint}`;
		} else if (action === 'workflow' && workflow) {
			message = `Getting workflow: ${workflow}`;
		} else if (action === 'list') {
			message = 'Listing available citation endpoints';
		}

		return {
			invocationMessage: l10n.t`${message}`
		};
	}

	async invoke(options: vscode.LanguageModelToolInvocationOptions<ICitationApiGuideParams>, token: CancellationToken): Promise<vscode.LanguageModelToolResult> {
		this.logService.trace('[CitationApiGuideTool] Invoking Citation API guide');

		const { action, endpoint, workflow } = options.input;

		try {
			let path = '/citation-search/docs';

			// Add query params based on action
			if (action === 'endpoint' && endpoint) {
				path += `?endpoint=${encodeURIComponent(endpoint)}`;
			} else if (action === 'workflow' && workflow) {
				path += `?workflow=${encodeURIComponent(workflow)}`;
			} else if (action === 'list') {
				path += '?format=compact';
			}
			// action === 'full' uses no params for full docs

			this.logService.info(`[CitationApiGuideTool] Fetching docs: ${path}`);

			const result = await this.patentBackendClient.get<CitationDocsResponse>(path, token);

			if (!result.success || !result.data) {
				return new LanguageModelToolResult([
					new LanguageModelTextPart(`Error: ${result.error || 'Invalid response from docs endpoint'}`)
				]);
			}

			// Format the docs for LLM consumption
			const formattedDocs = this.formatDocs(action, result.data, endpoint);
			this.logService.info(`[CitationApiGuideTool] Formatted docs length: ${formattedDocs.length} chars`);

			return new LanguageModelToolResult([
				new LanguageModelTextPart(formattedDocs)
			]);

		} catch (error) {
			if (error instanceof PatentBackendError) {
				if (error.message === 'Request cancelled.') {
					return new LanguageModelToolResult([new LanguageModelTextPart('Request cancelled.')]);
				}
				this.logService.error(`[CitationApiGuideTool] Backend error ${error.status}: ${error.message}`);
				return new LanguageModelToolResult([
					new LanguageModelTextPart(`Error: Failed to fetch Citation API docs: ${error.status} ${error.message}`)
				]);
			}
			this.logService.error(`[CitationApiGuideTool] Exception: ${error instanceof Error ? error.message : String(error)}`);
			return new LanguageModelToolResult([
				new LanguageModelTextPart(`Error: ${error instanceof Error ? error.message : 'Unknown error occurred'}`)
			]);
		}
	}

	/**
	 * Format docs response for LLM consumption.
	 * Injects deferral language pointing the agent at the typed `search_citations`
	 * tool for the common case (basic application-number search), and a soft
	 * reminder on every other response that the typed tool exists.
	 */
	private formatDocs(action: string, data: CitationDocsResponse['data'], endpointParam?: string): string {
		if (!data) {
			return 'No documentation available';
		}

		const isBasicSearchEndpoint = action === 'endpoint' && endpointParam === 'search';
		const isForwardEndpoint = action === 'endpoint' && endpointParam === 'forward';
		const strongDeferralForBasic = [
			'⚠️ STOP — Use the `search_citations` tool instead of patent_api_request for this case.',
			'',
			'The `search_citations` typed tool covers exactly this case (basic citation search by USPTO application number, with X/Y/A category filter and examiner-cited filter). It is faster, more reliable, and gives the user a cleaner result. Only fall back to patent_api_request from this guide if you need: citation statistics, novelty-only convenience endpoint, or date-range filtering.',
			'',
			'---',
			'',
		].join('\n');
		const strongDeferralForForward = [
			'⚠️ STOP — Use the `search_forward_citations` tool instead of patent_api_request for this case.',
			'',
			'The `search_forward_citations` typed tool covers exactly this case (finding patents that cite a given document, with X/Y/A category filter and examiner-cited filter). It is faster, more reliable, and gives the user a cleaner result. Only fall back to patent_api_request from this guide if you need: citation statistics or date-range filtering.',
			'',
			'---',
			'',
		].join('\n');
		const softFooter = '\n\n---\nReminder: for basic citation search use `search_citations`, for forward citations use `search_forward_citations` — prefer these typed tools over patent_api_request.';

		let body: string;
		if (action === 'endpoint' && data.endpoint) {
			body = this.formatEndpointDoc(data.baseUrl, data.endpoint);
		} else if (action === 'workflow' && data.workflow) {
			body = this.formatWorkflowDoc(data.workflow);
		} else if (action === 'list') {
			body = this.formatCompactList(data);
		} else {
			body = this.formatFullDocs(data);
		}

		if (isBasicSearchEndpoint) {
			return strongDeferralForBasic + body;
		}
		if (isForwardEndpoint) {
			return strongDeferralForForward + body;
		}
		return body + softFooter;
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

		if (endpoint.note) {
			lines.push('');
			lines.push(`**Note:** ${endpoint.note}`);
		}

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

	private formatCompactList(data: CitationDocsResponse['data']): string {
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

		if (data.categoriesReference) {
			lines.push('');
			lines.push('## Citation Categories:');
			for (const [code, info] of Object.entries(data.categoriesReference)) {
				lines.push(`- ${code}: ${info.description}`);
				if (info.legalBasis) {
					lines.push(`  Legal basis: ${info.legalBasis}`);
				}
			}
		}

		lines.push('');
		lines.push('Use action="endpoint" with endpoint name for detailed docs.');
		lines.push('Use action="workflow" with workflow name for step-by-step guides.');

		return lines.join('\n');
	}

	private formatFullDocs(data: CitationDocsResponse['data']): string {
		if (!data) {
			return 'No data available';
		}

		const lines: string[] = [
			'# USPTO Citation Search API Documentation',
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

		// Citation categories reference
		if (data.categoriesReference) {
			lines.push('## Citation Categories Reference:');
			for (const [code, info] of Object.entries(data.categoriesReference)) {
				lines.push(`### ${code} - ${info.description}`);
				if (info.legalBasis) {
					lines.push(`Legal basis: ${info.legalBasis}`);
				}
				lines.push('');
			}
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
		lines.push('Citation categories: X (novelty-destroying), Y (obviousness), A (background).');

		return lines.join('\n');
	}
}

ToolRegistry.registerTool(CitationApiGuideTool);
