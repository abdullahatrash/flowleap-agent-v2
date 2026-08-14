/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { BaseRegistryGuideTool } from './registryGuideTool';
import { ToolName } from '../common/toolNames';
import { ToolRegistry } from '../common/toolsRegistry';

/**
 * Tool that documents the legal-reference tools of the FlowLeap tool registry — hybrid
 * semantic/keyword search over MPEP, EPC, EPO Guidelines and the other reference corpora, plus the
 * jurisdiction listing that names the valid filters for it.
 *
 * Reference docs come from the backend's versioned `GET /v1/tools` registry through the shared
 * {@link IPatentBackendClient} seam. The available jurisdictions and their source documents are a
 * live answer from `get_legal_jurisdictions`, not a hardcoded list here — which is the whole point
 * of that tool existing.
 */
export class LegalSearchGuideTool extends BaseRegistryGuideTool {

	public static readonly toolName = ToolName.LegalSearchGuide;

	protected readonly toolFamily = [
		'reference_search',
		'get_legal_jurisdictions',
	];
	protected readonly logPrefix = '[LegalSearchGuideTool]';
	protected readonly docsErrorLabel = 'legal reference tool docs';
	protected readonly fullDocsTitle = '# Legal Reference Tools';
	protected readonly defaultInvocationMessage = 'Getting legal reference tool documentation';
	protected readonly listInvocationMessage = 'Listing available legal reference tools';

	/**
	 * Point the agent at the typed `search_legal` tool for the common lookup, and remind it on every
	 * other answer that it exists. This guide is the advanced path: source filters, search modes,
	 * weighting and thresholds, plus jurisdiction discovery.
	 */
	protected override decorateBody(action: string, endpointParam: string | undefined, body: string): string {
		if (action === 'endpoint' && endpointParam === 'reference_search') {
			return [
				'⚠️ STOP — Use the `search_legal` tool instead of reading this reference for that case.',
				'',
				'The `search_legal` typed tool covers exactly this case (basic legal search across MPEP/EPC/EPO Guidelines, with optional jurisdiction filter and comprehensive mode). It is faster, more reliable, and gives the user a cleaner result. Read on only if you need specific source filters, semantic-only or keyword-only modes, semantic-weight tuning, or similarity-threshold tuning.',
				'',
				'---',
				'',
			].join('\n') + body;
		}
		return body + '\n\n---\nReminder: for basic legal lookup queries, prefer the `search_legal` tool.'
			+ '\nFor the valid jurisdiction and source filters, call `get_legal_jurisdictions` rather than guessing.';
	}
}

ToolRegistry.registerTool(LegalSearchGuideTool);
