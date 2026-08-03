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
import { curlToApiRequestHint } from './curlToApiRequest';
import { handlePatentToolError } from './patentToolError';

/**
 * Parameters shared by every API guide tool. The agent asks for a compact endpoint list, a single
 * endpoint's docs, a workflow, or the full documentation.
 */
export interface IGuideApiParams {
	action: 'list' | 'endpoint' | 'workflow' | 'full' | 'section';
	endpoint?: string;
	workflow?: string;
	/** Served-section name when action='section' (routes that serve data sections, e.g. PATSTAT's 'semantic-model'/'examples'). */
	section?: string;
}

/** One documented endpoint. `rateLimitNote`/`note` are route-specific and rendered by the subclass. */
export interface GuideEndpointDoc {
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
	rateLimitNote?: string;
	note?: string;
}

/** One step of a documented workflow. */
export interface GuideWorkflowStep {
	step: number;
	action: string;
	endpoint: string;
	curlExample: string;
	note?: string;
}

/** A documented multi-step workflow. */
export interface GuideWorkflowDoc {
	name: string;
	description: string;
	steps: GuideWorkflowStep[];
}

/**
 * The `data` payload of a `/docs` response. Every route reuses the shared endpoint/workflow shape;
 * the route-specific reference sections (CQL fields, search params, citation categories, legal
 * sources, …) are all optional and rendered by the owning subclass.
 */
export interface GuideDocsData {
	baseUrl: string;
	description?: string;
	generalNotes?: string[];
	endpoints?: Record<string, GuideEndpointDoc> | Array<{ name: string; path: string; method: string; description: string }>;
	endpoint?: GuideEndpointDoc;
	workflow?: GuideWorkflowDoc;
	workflows?: Record<string, GuideWorkflowDoc> | string[];
	cqlReference?: {
		fields: Record<string, string>;
		operators?: Record<string, string>;
		examples?: Array<{ query: string; description: string }>;
	};
	cqlFields?: Record<string, string>;
	searchParams?: Record<string, {
		type: string;
		required?: boolean;
		description: string;
		default?: string;
		options?: string[];
		example?: string;
	}>;
	categoriesReference?: Record<string, {
		code: string;
		description: string;
		legalBasis?: string;
	}>;
	sourcesReference?: Record<string, {
		name: string;
		jurisdiction: string;
		description: string;
		sections?: string[];
	}>;
	searchModes?: Record<string, string>;
	/** Served sections (PATSTAT): compact lists names; full docs carries pointer objects. */
	sections?: string[] | Record<string, { description: string; url: string }>;
	/** `?section=semantic-model` payload: the loaded edition + the semantic model YAML, verbatim. */
	data_edition?: string;
	yaml?: string;
	/** `?section=examples` payload: verified question→SQL pairs. */
	examples?: { question: string; logical_sql: string; promoted_to?: string }[];
}

/** Envelope for a `/docs` response. */
export interface GuideDocsResponse {
	success: boolean;
	data?: GuideDocsData;
	error?: string;
}

/**
 * Base for the API guide tools (OPS, USPTO, citation, legal). Each fetches route documentation from
 * the FlowLeap backend through the shared {@link IPatentBackendClient} seam (inheriting the
 * centralized `401 → re-sign-in` / `402 → start-trial` gating) and formats it for the agent, which
 * then makes the real calls through the `patent_api_request` tool without leaking auth tokens.
 *
 * The four tools were ~85% identical; this base owns the fetch/format skeleton and exposes hooks for
 * the parts that differ: the docs route, log tag and messages, the endpoint note field, the
 * route-specific reference sections in the compact list and full docs, and the typed-tool deferral
 * banner (citation/legal). Subclasses supply configuration and unique reference sections only.
 */
export abstract class BaseApiGuideTool implements ICopilotTool<IGuideApiParams> {

	constructor(
		@ILogService protected readonly logService: ILogService,
		@IPatentBackendClient protected readonly patentBackendClient: IPatentBackendClient,
	) { }

	/** Backend docs route, e.g. `/ops/docs`. Query params are appended per action. */
	protected abstract readonly docsRoute: string;
	/** Log tag, e.g. `[OpsApiGuideTool]`. */
	protected abstract readonly logPrefix: string;
	/** Human label used in the fetch-failure message, e.g. `OPS API docs`. */
	protected abstract readonly docsErrorLabel: string;
	/** Heading of the full-docs output, e.g. `# EPO OPS API Documentation`. */
	protected abstract readonly fullDocsTitle: string;
	/** Default progress message shown while fetching (no action-specific override applies). */
	protected abstract readonly defaultInvocationMessage: string;
	/** Progress message shown for `action === 'list'`. */
	protected abstract readonly listInvocationMessage: string;

	prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<IGuideApiParams>, _token: CancellationToken): vscode.ProviderResult<vscode.PreparedToolInvocation> {
		const { action, endpoint, workflow, section } = options.input;
		let message = this.defaultInvocationMessage;

		if (action === 'endpoint' && endpoint) {
			message = `Getting docs for endpoint: ${endpoint}`;
		} else if (action === 'workflow' && workflow) {
			message = `Getting workflow: ${workflow}`;
		} else if (action === 'section' && section) {
			message = `Fetching section: ${section}`;
		} else if (action === 'list') {
			message = this.listInvocationMessage;
		}

		return {
			invocationMessage: l10n.t`${message}`
		};
	}

	async invoke(options: vscode.LanguageModelToolInvocationOptions<IGuideApiParams>, token: CancellationToken): Promise<vscode.LanguageModelToolResult> {
		this.logService.trace(`${this.logPrefix} Invoking API guide`);

		const { action, endpoint, workflow, section } = options.input;

		try {
			let path = this.docsRoute;

			// Add query params based on action
			if (action === 'endpoint' && endpoint) {
				path += `?endpoint=${encodeURIComponent(endpoint)}`;
			} else if (action === 'workflow' && workflow) {
				path += `?workflow=${encodeURIComponent(workflow)}`;
			} else if (action === 'section' && section) {
				path += `?section=${encodeURIComponent(section)}`;
			} else if (action === 'list') {
				path += '?format=compact';
			}
			// action === 'full' uses no params for full docs

			this.logService.info(`${this.logPrefix} Fetching docs: ${path}`);

			const result = await this.patentBackendClient.get<GuideDocsResponse>(path, token);

			if (!result.success || !result.data) {
				return new LanguageModelToolResult([
					new LanguageModelTextPart(`Error: ${result.error || 'Invalid response from docs endpoint'}`)
				]);
			}

			// Format the docs for LLM consumption
			const formattedDocs = this.formatDocs(action, result.data, endpoint, section);
			this.logService.info(`${this.logPrefix} Formatted docs length: ${formattedDocs.length} chars`);

			return new LanguageModelToolResult([
				new LanguageModelTextPart(formattedDocs)
			]);

		} catch (error) {
			return handlePatentToolError(error, this.logService, this.logPrefix, err => `Error: Failed to fetch ${this.docsErrorLabel}: ${err.status} ${err.message}`);
		}
	}

	/**
	 * Format the docs response for LLM consumption, dispatching on `action` and letting the subclass
	 * decorate the body (e.g. with a typed-tool deferral banner).
	 */
	protected formatDocs(action: string, data: GuideDocsData | undefined, endpointParam?: string, sectionParam?: string): string {
		if (!data) {
			return 'No documentation available';
		}

		let body: string;
		if (action === 'endpoint' && data.endpoint) {
			body = this.formatEndpointDoc(data.baseUrl, data.endpoint);
		} else if (action === 'workflow' && data.workflow) {
			body = this.formatWorkflowDoc(data.workflow);
		} else if (action === 'section') {
			body = this.formatSectionDoc(data, sectionParam);
		} else if (action === 'list') {
			body = this.formatCompactList(data);
		} else {
			body = this.formatFullDocs(data);
		}

		return this.decorateBody(action, endpointParam, body);
	}

	/**
	 * Render a served data section (`?section=…`). Generic JSON fallback — routes that serve
	 * sections (PATSTAT) override with a purpose-built rendering.
	 */
	protected formatSectionDoc(data: GuideDocsData, sectionParam?: string): string {
		return `## Section: ${sectionParam ?? 'unknown'}\n\n\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\``;
	}

	protected formatEndpointDoc(baseUrl: string, endpoint: GuideEndpointDoc): string {
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

		lines.push(...this.renderEndpointNote(endpoint));

		return lines.join('\n');
	}

	protected formatWorkflowDoc(workflow: GuideWorkflowDoc): string {
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

	protected formatCompactList(data: GuideDocsData): string {
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

		if (Array.isArray(data.sections) && data.sections.length > 0) {
			lines.push('');
			lines.push('## Available Sections (action="section"):');
			for (const sectionName of data.sections) {
				lines.push(`- ${sectionName}`);
			}
		}

		lines.push(...this.renderCompactExtras(data));

		lines.push('');
		lines.push('Use action="endpoint" with endpoint name for detailed docs.');
		lines.push('Use action="workflow" with workflow name for step-by-step guides.');

		return lines.join('\n');
	}

	protected formatFullDocs(data: GuideDocsData): string {
		const lines: string[] = [
			this.fullDocsTitle,
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

		lines.push(...this.renderFullDocsBeforeEndpoints(data));

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

		lines.push(...this.renderFullDocsAfterEndpoints(data));

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
		lines.push(...this.renderFullDocsTailExtras(data));

		return lines.join('\n');
	}

	/** Route-specific note appended to a single endpoint's docs (rate-limit note, general note, …). */
	protected renderEndpointNote(_endpoint: GuideEndpointDoc): string[] {
		return [];
	}

	/** Route-specific reference section appended to the compact list before its trailing hints. */
	protected renderCompactExtras(_data: GuideDocsData): string[] {
		return [];
	}

	/** Route-specific reference section rendered in full docs before the endpoints section. */
	protected renderFullDocsBeforeEndpoints(_data: GuideDocsData): string[] {
		return [];
	}

	/** Route-specific reference section rendered in full docs after the endpoints section. */
	protected renderFullDocsAfterEndpoints(_data: GuideDocsData): string[] {
		return [];
	}

	/** Route-specific trailing lines appended after the full-docs footer. */
	protected renderFullDocsTailExtras(_data: GuideDocsData): string[] {
		return [];
	}

	/** Wrap or annotate the formatted body (e.g. a typed-tool deferral banner). Identity by default. */
	protected decorateBody(_action: string, _endpointParam: string | undefined, body: string): string {
		return body;
	}
}
