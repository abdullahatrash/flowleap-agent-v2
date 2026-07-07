/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { BaseApiGuideTool, GuideDocsData, GuideEndpointDoc } from './baseApiGuideTool';
import { ToolName } from '../common/toolNames';
import { ToolRegistry } from '../common/toolsRegistry';

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
class CitationApiGuideTool extends BaseApiGuideTool {

	public static readonly toolName = ToolName.CitationApiGuide;

	protected readonly docsRoute = '/citation-search/docs';
	protected readonly logPrefix = '[CitationApiGuideTool]';
	protected readonly docsErrorLabel = 'Citation API docs';
	protected readonly fullDocsTitle = '# USPTO Citation Search API Documentation';
	protected readonly defaultInvocationMessage = 'Getting USPTO Citation Search API documentation';
	protected readonly listInvocationMessage = 'Listing available citation endpoints';

	protected override renderEndpointNote(endpoint: GuideEndpointDoc): string[] {
		return endpoint.note ? ['', `**Note:** ${endpoint.note}`] : [];
	}

	protected override renderCompactExtras(data: GuideDocsData): string[] {
		if (!data.categoriesReference) {
			return [];
		}
		const lines = ['', '## Citation Categories:'];
		for (const [code, info] of Object.entries(data.categoriesReference)) {
			lines.push(`- ${code}: ${info.description}`);
			if (info.legalBasis) {
				lines.push(`  Legal basis: ${info.legalBasis}`);
			}
		}
		return lines;
	}

	protected override renderFullDocsBeforeEndpoints(data: GuideDocsData): string[] {
		if (!data.categoriesReference) {
			return [];
		}
		const lines = ['## Citation Categories Reference:'];
		for (const [code, info] of Object.entries(data.categoriesReference)) {
			lines.push(`### ${code} - ${info.description}`);
			if (info.legalBasis) {
				lines.push(`Legal basis: ${info.legalBasis}`);
			}
			lines.push('');
		}
		return lines;
	}

	protected override renderFullDocsTailExtras(_data: GuideDocsData): string[] {
		return ['Citation categories: X (novelty-destroying), Y (obviousness), A (background).'];
	}

	/**
	 * Inject deferral language pointing the agent at the typed `search_citations` tool for the common
	 * case (basic application-number search), the `search_forward_citations` tool for forward
	 * citations, and a soft reminder on every other response that the typed tools exist.
	 */
	protected override decorateBody(action: string, endpointParam: string | undefined, body: string): string {
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

		if (isBasicSearchEndpoint) {
			return strongDeferralForBasic + body;
		}
		if (isForwardEndpoint) {
			return strongDeferralForForward + body;
		}
		return body + softFooter;
	}
}

ToolRegistry.registerTool(CitationApiGuideTool);
