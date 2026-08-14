/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { BaseRegistryGuideTool } from './registryGuideTool';
import { ToolName } from '../common/toolNames';
import { ToolRegistry } from '../common/toolsRegistry';

/**
 * Tool that documents the citation tools of the FlowLeap tool registry — examiner-cited prior art
 * from USPTO office actions, forward enriched citations, aggregate citation statistics, and the EPO
 * forward-citation list.
 *
 * Reference docs come from the backend's versioned `GET /v1/tools` registry through the shared
 * {@link IPatentBackendClient} seam.
 *
 * The X/Y/A relevance categories the agent needs (X = novelty-destroying under 35 USC 102,
 * Y = obviousness under 103, A = background) travel in each tool's own description and usage notes,
 * so this guide states them once in its footer rather than maintaining a second copy.
 */
export class CitationApiGuideTool extends BaseRegistryGuideTool {

	public static readonly toolName = ToolName.CitationApiGuide;

	protected readonly toolFamily = [
		'search_office_action_citations',
		'search_enriched_citations',
		'get_citation_stats',
		'get_citations',
	];
	protected readonly logPrefix = '[CitationApiGuideTool]';
	protected readonly docsErrorLabel = 'citation tool docs';
	protected readonly fullDocsTitle = '# Citation Tools';
	protected readonly defaultInvocationMessage = 'Getting citation tool documentation';
	protected readonly listInvocationMessage = 'Listing available citation tools';

	/**
	 * Point the agent at the typed tools for the two common cases — a backward search by application
	 * number and a forward search by cited document — and remind it on every other answer that they
	 * exist. This guide is the advanced path: aggregate statistics and the raw registry reference.
	 */
	protected override decorateBody(action: string, endpointParam: string | undefined, body: string): string {
		const deferral = (typedTool: string, covers: string, fallback: string): string => [
			`⚠️ STOP — Use the \`${typedTool}\` tool instead of reading this reference for that case.`,
			'',
			`The \`${typedTool}\` typed tool covers exactly this case (${covers}). It is faster, more reliable, and gives the user a cleaner result. Read on only if you need ${fallback}.`,
			'',
			'---',
			'',
		].join('\n');

		if (action === 'endpoint' && endpointParam === 'search_office_action_citations') {
			return deferral(
				'search_citations',
				'citation search by USPTO application number, with X/Y/A category, examiner-cited and office-action date-range filters',
				'aggregate citation statistics',
			) + body;
		}
		if (action === 'endpoint' && endpointParam === 'search_enriched_citations') {
			return deferral(
				'search_forward_citations',
				'finding patents that cite a given document, with X/Y/A category and examiner-cited filters',
				'aggregate citation statistics',
			) + body;
		}
		return body + '\n\n---\nCitation categories: X (novelty-destroying, 35 USC 102), Y (obviousness, 103), A (background).'
			+ '\nReminder: for backward citation search use `search_citations`, for forward citations use `search_forward_citations` — prefer these typed tools.';
	}
}

ToolRegistry.registerTool(CitationApiGuideTool);
