/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { BaseApiGuideTool, GuideDocsData, GuideEndpointDoc } from './baseApiGuideTool';
import { ToolName } from '../common/toolNames';
import { ToolRegistry } from '../common/toolsRegistry';

/**
 * Tool that provides Legal RAG Search API documentation to the LLM agent.
 * The agent can then use the `patent_api_request` tool to make authenticated API calls.
 *
 * This enables the agent to:
 * 1. Learn about available legal sources (MPEP, EPC, EPO Guidelines)
 * 2. Get example patent_api_request invocations for legal searches
 * 3. Understand workflows for MPEP lookup and EPC research
 * 4. Use the patent_api_request tool to execute calls without leaking auth tokens
 *
 * Fetches the docs through the shared {@link IPatentBackendClient} seam, so it inherits the
 * centralized `401 → re-sign-in` / `402 → start-trial` gating.
 */
class LegalSearchGuideTool extends BaseApiGuideTool {

	public static readonly toolName = ToolName.LegalSearchGuide;

	protected readonly docsRoute = '/legal-search/docs';
	protected readonly logPrefix = '[LegalSearchGuideTool]';
	protected readonly docsErrorLabel = 'Legal Search API docs';
	protected readonly fullDocsTitle = '# Legal RAG Search API Documentation';
	protected readonly defaultInvocationMessage = 'Getting Legal RAG Search API documentation';
	protected readonly listInvocationMessage = 'Listing available legal search endpoints';

	protected override renderEndpointNote(endpoint: GuideEndpointDoc): string[] {
		return endpoint.note ? ['', `**Note:** ${endpoint.note}`] : [];
	}

	protected override renderCompactExtras(data: GuideDocsData): string[] {
		const lines: string[] = [];
		if (data.sourcesReference) {
			lines.push('');
			lines.push('## Available Sources:');
			for (const [code, info] of Object.entries(data.sourcesReference)) {
				lines.push(`- ${code} (${info.jurisdiction}): ${info.name}`);
			}
		}
		if (data.searchModes) {
			lines.push('');
			lines.push('## Search Modes:');
			for (const [mode, description] of Object.entries(data.searchModes)) {
				lines.push(`- ${mode}: ${description}`);
			}
		}
		return lines;
	}

	protected override renderFullDocsBeforeEndpoints(data: GuideDocsData): string[] {
		const lines: string[] = [];
		if (data.sourcesReference) {
			lines.push('## Sources Reference:');
			for (const [code, info] of Object.entries(data.sourcesReference)) {
				lines.push(`### ${code} - ${info.name}`);
				lines.push(`Jurisdiction: ${info.jurisdiction}`);
				lines.push(info.description);
				if (info.sections && info.sections.length > 0) {
					lines.push('Key sections:');
					for (const section of info.sections) {
						lines.push(`  - ${section}`);
					}
				}
				lines.push('');
			}
		}
		if (data.searchModes) {
			lines.push('## Search Modes:');
			for (const [mode, description] of Object.entries(data.searchModes)) {
				lines.push(`- **${mode}**: ${description}`);
			}
			lines.push('');
		}
		return lines;
	}

	protected override renderFullDocsTailExtras(_data: GuideDocsData): string[] {
		return [
			'Sources: MPEP (USPTO), EPC (EPO), EPO Guidelines.',
			'Search modes: hybrid (recommended), semantic, keyword.',
		];
	}

	/**
	 * Inject deferral language pointing the agent at the typed `search_legal` tool for the common case
	 * (basic MPEP/EPC/EPO Guidelines lookup), and a soft reminder on every other response that the
	 * typed tool exists.
	 */
	protected override decorateBody(action: string, endpointParam: string | undefined, body: string): string {
		const isBasicSearchEndpoint = action === 'endpoint' && endpointParam === 'search';
		const strongDeferral = [
			'⚠️ STOP — Use the `search_legal` tool instead of patent_api_request for this case.',
			'',
			'The `search_legal` typed tool covers exactly this case (basic legal search across MPEP/EPC/EPO Guidelines, with optional jurisdiction filter and comprehensive mode). It is faster, more reliable, and gives the user a cleaner result. Only fall back to patent_api_request from this guide if you need: specific source filters, custom search modes (semantic-only, keyword-only), semantic-weight tuning, or similarity threshold tuning.',
			'',
			'---',
			'',
		].join('\n');
		const softFooter = '\n\n---\nReminder: for basic legal lookup queries, prefer the `search_legal` tool over patent_api_request.';

		if (isBasicSearchEndpoint) {
			return strongDeferral + body;
		}
		return body + softFooter;
	}
}

ToolRegistry.registerTool(LegalSearchGuideTool);
