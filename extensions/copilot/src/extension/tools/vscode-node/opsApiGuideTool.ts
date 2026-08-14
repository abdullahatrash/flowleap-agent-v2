/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { BaseRegistryGuideTool } from './registryGuideTool';
import { ToolName } from '../common/toolNames';
import { ToolRegistry } from '../common/toolsRegistry';

/**
 * Tool that documents the EPO OPS-backed tools of the FlowLeap tool registry — worldwide search,
 * per-document bibliography, abstract, full text, family, legal status, register events, citations,
 * figures and number conversion.
 *
 * Reference docs come from the backend's versioned `GET /v1/tools` registry through the shared
 * {@link IPatentBackendClient} seam, so the guide inherits the centralized `401 → re-sign-in` /
 * `402 → start-trial` gating and can never describe a tool that no longer exists.
 *
 * This enables the agent to:
 * 1. Learn which tools cover EPO data and what each one returns
 * 2. Read a tool's parameters, examples and input schema before calling it
 * 3. Call the tool directly — there is no separate HTTP path to construct
 */
export class OpsApiGuideTool extends BaseRegistryGuideTool {

	public static readonly toolName = ToolName.OpsApiGuide;

	protected readonly toolFamily = [
		'search_patents',
		'get_search_syntax',
		'get_bibliography',
		'get_abstract',
		'get_claims',
		'get_description',
		'get_fulltext',
		'get_patent_family',
		'get_family',
		'get_legal_status',
		'get_register_events',
		'get_citations',
		'get_patent_image',
		'convert_patent_number',
		'get_patent_summary',
		'get_prosecution_timeline',
		'get_patent_term',
		'compare_patents',
	];
	protected readonly logPrefix = '[OpsApiGuideTool]';
	protected readonly docsErrorLabel = 'EPO OPS tool docs';
	protected readonly fullDocsTitle = '# EPO OPS Tools';
	protected readonly defaultInvocationMessage = 'Getting EPO OPS tool documentation';
	protected readonly listInvocationMessage = 'Listing available EPO OPS tools';
}

ToolRegistry.registerTool(OpsApiGuideTool);
