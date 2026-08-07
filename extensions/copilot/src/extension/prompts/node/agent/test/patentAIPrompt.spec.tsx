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
import type { FlowLeapSubscriptionStatus } from '../../../../patentai/common/trialCountdown';
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
	ToolName.PatstatPortfolio,
	ToolName.PatstatQuery,
	ToolName.PatstatApiGuide,
	ToolName.GetPatentSummary,
	ToolName.GetPatentTerm,
];

function toolInfo(name: string): vscode.LanguageModelToolInformation {
	return { name, description: '', source: undefined, inputSchema: { type: 'object', properties: {} }, tags: [] };
}

/** The key state a render is exercised with; omitted fields render the never-read defaults. */
interface KeyStateOptions {
	readonly subscriptionStatus?: FlowLeapSubscriptionStatus;
	readonly hasEpoOpsKey?: boolean;
	readonly hasUsptoOdpKey?: boolean;
}

async function renderPatentInstructions(toolNames: readonly ToolName[], keyState: KeyStateOptions = {}): Promise<string> {
	const services = createExtensionUnitTestingServices();
	const accessor = services.createTestingAccessor();
	try {
		const instantiationService = accessor.get(IInstantiationService);
		const endpoint = instantiationService.createInstance(MockEndpoint, undefined);
		const { messages } = await renderPromptElement(instantiationService, endpoint, PatentAIInstructions, {
			availableTools: toolNames.map(toolInfo),
			webSearchAvailable: true,
			...keyState,
		});
		return messages.map(m => messageToMarkdown(m)).join('\n\n');
	} finally {
		accessor.dispose();
	}
}

/** Text that only ever appears when the prompt commits to an office being reachable or gated. */
const OFFICE_AVAILABILITY_CLAIMS: readonly string[] = [
	'EPO OPS (EP/WO search and document reads)',
	'USPTO ODP (US search, prosecution and citation routes)',
	'EVERY patent-data office is live',
	'LIVE — the user',
	'GATED — the user',
];

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
			'patstat_portfolio',
			'patstat_api_guide',
			'COUNTING SEMANTICS',
			'SNAPSHOT RULE',
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
		[ToolName.PatentAnalyticsViz, 'technology/topic analytics by KEYWORDS', undefined],
		[ToolName.PatstatPortfolio, 'NAMED company\'s/applicant\'s aggregate portfolio', undefined],
		[ToolName.PatstatQuery, 'any OTHER PATSTAT aggregate', undefined],
		[ToolName.PatstatApiGuide, 'section="semantic-model" BEFORE writing SQL', undefined],
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

suite('PatentAIInstructions key state', () => {
	test('trialing with no keys declares every office live and never nags about keys', async () => {
		const output = await renderPatentInstructions(ALL_PATENT_TOOLS, { subscriptionStatus: 'trialing' });
		expect({
			allOfficesLive: output.includes('EVERY patent-data office is live on FlowLeap\'s shared keys'),
			keysNotNeeded: output.includes('Patent-Data Keys are NOT needed'),
			nagsAboutAMissingKey: output.includes('GATED — the user'),
			annotatesTheCarousel: output.includes('needs your EPO OPS key (not set)') || output.includes('needs your USPTO ODP key (not set)'),
		}).toEqual({ allOfficesLive: true, keysNotNeeded: true, nagsAboutAMissingKey: false, annotatesTheCarousel: false });
	});

	test('active with only the USPTO key marks USPTO live, EPO gated, and annotates the EP carousel option', async () => {
		const output = await renderPatentInstructions(ALL_PATENT_TOOLS, { subscriptionStatus: 'active', hasUsptoOdpKey: true });
		expect({
			epoGated: output.includes('EPO OPS (EP/WO search and document reads): GATED — the user\'s EPO OPS consumer key and secret are NOT set'),
			namesTheKeysCommand: output.includes('"FlowLeap: Patent Data Keys" command'),
			usptoLive: output.includes('USPTO ODP (US search, prosecution and citation routes): LIVE'),
			keylessRoutesNamed: output.includes('Keyless routes need no Patent-Data Key and stay live'),
			epCarouselAnnotated: output.includes('"European/International (EP/WO) — needs your EPO OPS key (not set)"'),
			usCarouselAnnotated: output.includes('needs your USPTO ODP key (not set)'),
			bothStillRecommended: output.includes('{"label": "Both (comprehensive)", "recommended": true}'),
		}).toEqual({
			epoGated: true,
			namesTheKeysCommand: true,
			usptoLive: true,
			keylessRoutesNamed: true,
			epCarouselAnnotated: true,
			usCarouselAnnotated: false,
			bothStillRecommended: true,
		});
	});

	test('active with only the EPO key mirrors it: EPO live, USPTO gated and annotated', async () => {
		const output = await renderPatentInstructions(ALL_PATENT_TOOLS, { subscriptionStatus: 'active', hasEpoOpsKey: true });
		expect({
			epoLive: output.includes('EPO OPS (EP/WO search and document reads): LIVE'),
			usptoGated: output.includes('USPTO ODP (US search, prosecution and citation routes): GATED — the user\'s USPTO ODP API key is NOT set'),
			usCarouselAnnotated: output.includes('"US patents only (USPTO) — needs your USPTO ODP key (not set)"'),
			epCarouselAnnotated: output.includes('needs your EPO OPS key (not set)'),
			bothStillRecommended: output.includes('{"label": "Both (comprehensive)", "recommended": true}'),
		}).toEqual({
			epoLive: true,
			usptoGated: true,
			usCarouselAnnotated: true,
			epCarouselAnnotated: false,
			bothStillRecommended: true,
		});
	});

	test('inactive states the subscription requirement and makes no per-office claim', async () => {
		const output = await renderPatentInstructions(ALL_PATENT_TOOLS, { subscriptionStatus: 'inactive' });
		expect({
			subscriptionLine: output.includes('patent-data routes require a subscription and answer 402'),
			officeClaims: OFFICE_AVAILABILITY_CLAIMS.filter(claim => output.includes(claim)),
			carouselAnnotations: output.includes('(not set)'),
			bothStillRecommended: output.includes('{"label": "Both (comprehensive)", "recommended": true}'),
		}).toEqual({ subscriptionLine: true, officeClaims: [], carouselAnnotations: false, bothStillRecommended: true });
	});

	test('unknown renders key presence only and claims nothing about office availability', async () => {
		const output = await renderPatentInstructions(ALL_PATENT_TOOLS, { subscriptionStatus: 'unknown', hasUsptoOdpKey: true });
		expect({
			refusesAvailabilityClaims: output.includes('State NOTHING about which patent-data offices you can reach'),
			epoKeyPresence: output.includes('EPO OPS key is not set'),
			usptoKeyPresence: output.includes('USPTO ODP key is set'),
			officeClaims: OFFICE_AVAILABILITY_CLAIMS.filter(claim => output.includes(claim)),
			carouselAnnotations: output.includes('(not set)'),
		}).toEqual({ refusesAvailabilityClaims: true, epoKeyPresence: true, usptoKeyPresence: true, officeClaims: [], carouselAnnotations: false });
	});

	test('an unread subscription falls back to the unknown row and keeps tools callable', async () => {
		const output = await renderPatentInstructions(ALL_PATENT_TOOLS);
		expect({
			unknownRow: output.includes('The subscription status could not be read this turn'),
			toolsStayCallable: output.includes('Every patent tool stays callable in every state'),
			officeClaims: OFFICE_AVAILABILITY_CLAIMS.filter(claim => output.includes(claim)),
		}).toEqual({ unknownRow: true, toolsStayCallable: true, officeClaims: [] });
	});

	test('renders no key-state block when no patent tool is available', async () => {
		const output = await renderPatentInstructions([], { subscriptionStatus: 'active' });
		expect(output.includes('PATENT-DATA KEY STATE')).toBe(false);
	});
});
