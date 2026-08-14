/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { BaseRegistryGuideTool } from './registryGuideTool';
import { ToolName } from '../common/toolNames';
import { ToolRegistry } from '../common/toolsRegistry';

/**
 * Tool that documents the USPTO Open Data Portal tools of the FlowLeap tool registry — US search,
 * granted-patent and application lookups, continuity, and the file-wrapper tools (transactions,
 * assignments, foreign priority, PTA, attorney of record, IFW documents).
 *
 * Reference docs come from the backend's versioned `GET /v1/tools` registry through the shared
 * {@link IPatentBackendClient} seam, so the guide inherits the centralized `401 → re-sign-in` /
 * `402 → start-trial` gating.
 *
 * This is the single source of truth for the USPTO tools' input shapes: the underlying API migrated
 * from PatentsView to ODP, and the field names live in the registry, not in a prompt. Call this tool
 * before writing a non-trivial Lucene query so guidance never drifts from the backend.
 */
export class USPTOApiGuideTool extends BaseRegistryGuideTool {

	public static readonly toolName = ToolName.USPTOApiGuide;

	protected readonly toolFamily = [
		'search_patents',
		'get_search_syntax',
		'get_us_grant',
		'get_us_application',
		'get_continuity',
		'get_transactions',
		'get_assignments',
		'get_foreign_priority',
		'get_patent_term_adjustment',
		'get_attorney',
		'get_application_documents',
		'read_application_document',
		'search_uspto_portfolio_by_customer_number',
	];
	protected readonly logPrefix = '[USPTOApiGuideTool]';
	protected readonly docsErrorLabel = 'USPTO tool docs';
	protected readonly fullDocsTitle = '# USPTO Open Data Portal Tools';
	protected readonly defaultInvocationMessage = 'Getting USPTO tool documentation';
	protected readonly listInvocationMessage = 'Listing available USPTO tools';
}

ToolRegistry.registerTool(USPTOApiGuideTool);
