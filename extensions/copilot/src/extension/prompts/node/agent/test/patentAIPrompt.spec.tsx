/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect, suite, test } from 'vitest';
import type * as vscode from 'vscode';
import { MockEndpoint } from '../../../../../platform/endpoint/test/node/mockEndpoint';
import { messageToMarkdown } from '../../../../../platform/log/common/messageStringify';
import { IInstantiationService } from '../../../../../util/vs/platform/instantiation/common/instantiation';
import { createExtensionUnitTestingServices } from '../../../../test/node/services';
import { ToolName } from '../../../../tools/common/toolNames';
import { renderPromptElement } from '../../base/promptRenderer';
import { PatentAIInstructions } from '../patentAIPrompt';

/** The full patent tool surface that activates every decision-tree branch. */
const ALL_PATENT_TOOLS: readonly ToolName[] = [
	ToolName.BuildPatentQuery,
	ToolName.BuildUSPTOQuery,
	ToolName.SearchPatents,
	ToolName.GetPatentDetails,
	ToolName.GetPatentFigures,
	ToolName.PatentApiRequest,
	ToolName.SearchCitations,
	ToolName.SearchForwardCitations,
	ToolName.GetContinuity,
	ToolName.GetProsecutionTimeline,
	ToolName.GetLegalStatus,
	ToolName.GetPatentFamily,
	ToolName.GetRegisterEvents,
	ToolName.OpsApiGuide,
	ToolName.USPTOApiGuide,
	ToolName.CitationApiGuide,
	ToolName.SearchLegal,
	ToolName.LegalSearchGuide,
	ToolName.SearchAcademic,
	ToolName.WritePatentResults,
	ToolName.AnalyzeClaim,
	ToolName.CompareClaims,
	ToolName.ComparePatents,
	ToolName.PatentAnalyticsViz,
	ToolName.GetPatentSummary,
	ToolName.GetPatentTerm,
];

function toolInfo(name: string): vscode.LanguageModelToolInformation {
	return { name, description: '', source: undefined, inputSchema: { type: 'object', properties: {} }, tags: [] };
}

async function renderPatentInstructions(toolNames: readonly ToolName[]): Promise<string> {
	const services = createExtensionUnitTestingServices();
	const accessor = services.createTestingAccessor();
	try {
		const instantiationService = accessor.get(IInstantiationService);
		const endpoint = instantiationService.createInstance(MockEndpoint, undefined);
		const { messages } = await renderPromptElement(instantiationService, endpoint, PatentAIInstructions, {
			availableTools: toolNames.map(toolInfo),
			webSearchAvailable: true,
		});
		return messages.map(m => messageToMarkdown(m)).join('\n\n');
	} finally {
		accessor.dispose();
	}
}

suite('PatentAIInstructions', () => {
	test('renders nothing when no patent tool is available', async () => {
		const output = await renderPatentInstructions([]);
		expect(output.includes('PATENT TOOL DECISION TREE')).toBe(false);
	});

	test('full tool surface renders every decision-tree branch and typed tool route', async () => {
		const output = await renderPatentInstructions(ALL_PATENT_TOOLS);
		const expectedFragments = [
			'TRENDS / LANDSCAPE / MARKET ANALYTICS',
			'patent_analytics_viz',
			'COMPARE — pick the tool by WHAT is being compared',
			'compare_claims',
			'compare_patents',
			'DEFAULT for an OVERVIEW',
			'get_patent_summary',
			'EXPIRY / TERM',
			'get_patent_term',
			'the FIGURES or DRAWINGS',
			'get_patent_figures',
			'one call returns biblio, abstract, full claims and description',
			'analyze_claim',
			'write_patent_results',
			'US PROSECUTION HISTORY',
			'get_continuity',
			'get_prosecution_timeline',
			'LEGAL STATUS in depth',
			'get_legal_status',
			'PATENT FAMILY in depth',
			'get_patent_family',
			'EP REGISTER EVENTS',
			'get_register_events',
		];
		expect(expectedFragments.filter(f => !output.includes(f))).toEqual([]);
	});

	// Each optional typed tool gates exactly its own branch/route; when the tool is
	// absent the branch text disappears (and, for the claim/details tools, the manual
	// fallback appears instead) so the prompt never advertises a tool it can't call.
	const gatedSignatures: readonly [ToolName, string, string | undefined][] = [
		[ToolName.PatentAnalyticsViz, 'TRENDS / LANDSCAPE / MARKET ANALYTICS', undefined],
		[ToolName.CompareClaims, 'The USER\'s OWN DRAFTED claim text vs specific patents', undefined],
		[ToolName.ComparePatents, 'TWO OR MORE PUBLISHED patents vs each other', undefined],
		[ToolName.GetPatentSummary, 'DEFAULT for an OVERVIEW', undefined],
		[ToolName.GetPatentTerm, 'EXPIRY / TERM', undefined],
		[ToolName.GetPatentFigures, 'the FIGURES or DRAWINGS', undefined],
		[ToolName.GetPatentDetails, 'one call returns biblio, abstract, full claims and description', undefined],
		[ToolName.AnalyzeClaim, 'analyze_claim', 'analyze the claim yourself'],
		[ToolName.GetContinuity, 'CONTINUITY (parent/child family)', undefined],
		[ToolName.GetProsecutionTimeline, 'PROSECUTION / LEGAL-EVENT TIMELINE', undefined],
		[ToolName.GetLegalStatus, 'LEGAL STATUS in depth', undefined],
		[ToolName.GetPatentFamily, 'PATENT FAMILY in depth', undefined],
		[ToolName.GetRegisterEvents, 'EP REGISTER EVENTS', undefined],
	];

	for (const [tool, signature, fallback] of gatedSignatures) {
		test(`omits the ${tool} branch/route when the tool is unavailable`, async () => {
			const output = await renderPatentInstructions(ALL_PATENT_TOOLS.filter(t => t !== tool));
			expect(output.includes(signature), `expected "${signature}" to be absent`).toBe(false);
			// The decision tree still renders — only the gated fragment is gone.
			expect(output.includes('PATENT TOOL DECISION TREE')).toBe(true);
			if (fallback) {
				expect(output.includes(fallback), `expected fallback "${fallback}" to be present`).toBe(true);
			}
		});
	}
});
