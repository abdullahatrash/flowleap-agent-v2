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
	ToolName.CompareClaims,
	ToolName.ComparePatents,
	ToolName.PatentAnalyticsViz,
	ToolName.PatstatPortfolio,
	ToolName.PatstatQuery,
	ToolName.PatstatGraph,
	ToolName.PatstatApiGuide,
	ToolName.GetPatentSummary,
	ToolName.GetPatentTerm,
	ToolName.PatentSearchSubagent,
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
	'EPO OPS (worldwide bibliographic search; EP/WO full-text document reads)',
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
			epoGated: output.includes('EPO OPS (worldwide bibliographic search; EP/WO full-text document reads): GATED — the user\'s EPO OPS consumer key and secret are NOT set'),
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
			epoLive: output.includes('EPO OPS (worldwide bibliographic search; EP/WO full-text document reads): LIVE'),
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

suite('PatentAIInstructions key-gate doctrine', () => {
	test('classifies a key gate as a user-action stop that the web fallback does not cover', async () => {
		const output = await renderPatentInstructions(ALL_PATENT_TOOLS);
		expect({
			userActionStop: output.includes('A KEY GATE IS NEITHER'),
			neverAnExhaustedRoute: output.includes('not a transient error, not a zero result, and NEVER an exhausted route'),
			webRungExcluded: output.includes('Rung (iii) does NOT apply to a gated office'),
			coversSingleDocumentReads: output.includes('NOT for searches and NOT for single-document reads'),
			namesTheFreeKeyFix: output.includes('the "FlowLeap: Patent Data Keys" command — the office issues the key for free'),
			refusesWebSubstitution: output.includes('never quietly served from Google Patents or freepatentsonline instead'),
		}).toEqual({
			userActionStop: true,
			neverAnExhaustedRoute: true,
			webRungExcluded: true,
			coversSingleDocumentReads: true,
			namesTheFreeKeyFix: true,
			refusesWebSubstitution: true,
		});
	});

	test('leaves the CN/JP/KR and exhausted-route web fallbacks unchanged', async () => {
		const output = await renderPatentInstructions(ALL_PATENT_TOOLS);
		expect({
			carveOutIsScoped: output.includes('the forbid rule covers ONLY an office gated on a missing Patent-Data Key'),
			cnJpKrUnchanged: output.includes('the CN/JP/KR web fallback works exactly as before'),
			exhaustedRouteUnchanged: output.includes('the genuinely-exhausted-route web fallback works exactly as before'),
			persistenceNotWeakened: output.includes('persistence is not weakened'),
			ladderWebRungStillThere: output.includes('**Web fallback** — fetch_webpage'),
		}).toEqual({
			carveOutIsScoped: true,
			cnJpKrUnchanged: true,
			exhaustedRouteUnchanged: true,
			persistenceNotWeakened: true,
			ladderWebRungStillThere: true,
		});
	});

	test('carries proceed-then-ask and forbids silent scope narrowing', async () => {
		const output = await renderPatentInstructions(ALL_PATENT_TOOLS);
		expect({
			proceedThenAsk: output.includes('PROCEED, THEN ASK — never stall the whole task on the ask'),
			completesTheLiveOffice: output.includes('Complete the LIVE office FULLY'),
			namesTheGapAsAKeyGap: output.includes('"EP coverage is missing because your EPO OPS key is not set"'),
			asksAtTheEnd: output.includes('Ask for the missing key ONCE, at the END of the turn'),
			noSilentNarrowing: output.includes('NEVER silently narrow the scope of a prior-art, novelty, patentability, freedom-to-operate, invalidity or landscape task'),
		}).toEqual({
			proceedThenAsk: true,
			completesTheLiveOffice: true,
			namesTheGapAsAKeyGap: true,
			asksAtTheEnd: true,
			noSilentNarrowing: true,
		});
	});

	test('offers the keyless pivot as different data, never as a substitute', async () => {
		const output = await renderPatentInstructions(ALL_PATENT_TOOLS);
		expect({
			pivotOffered: output.includes('KEYLESS PIVOT — offer it as DIFFERENT data, never as a substitute'),
			patstatFramedAsSnapshot: output.includes('PATSTAT analytics — aggregate counts from a twice-yearly SNAPSHOT'),
			legalFramedAsLaw: output.includes('`search_legal` — patent LAW'),
			academicFramedAsLiterature: output.includes('`search_academic` — scholarly LITERATURE'),
			notAStandIn: output.includes('not a stand-in for the gated office\'s live search'),
		}).toEqual({
			pivotOffered: true,
			patstatFramedAsSnapshot: true,
			legalFramedAsLaw: true,
			academicFramedAsLiterature: true,
			notAStandIn: true,
		});
	});

	test('carries the resume rule: re-run only the gated office and merge, no reload', async () => {
		const output = await renderPatentInstructions(ALL_PATENT_TOOLS);
		expect({
			resumeRule: output.includes('RESUME RULE — when the user says they added the missing key'),
			gatedOfficeOnly: output.includes('re-run ONLY the previously gated office and MERGE its results into the deliverable you already produced'),
			doesNotRedoLiveWork: output.includes('Do NOT redo the live office\'s searches, reads or analysis'),
			noReloadNeeded: output.includes('no reload, no restart and no new conversation'),
		}).toEqual({ resumeRule: true, gatedOfficeOnly: true, doesNotRedoLiveWork: true, noReloadNeeded: true });
	});

	test('the doctrine renders in every key state and never on a stock configuration', async () => {
		const [active, trialing, stock] = await Promise.all([
			renderPatentInstructions(ALL_PATENT_TOOLS, { subscriptionStatus: 'active', hasUsptoOdpKey: true }),
			renderPatentInstructions(ALL_PATENT_TOOLS, { subscriptionStatus: 'trialing' }),
			renderPatentInstructions([]),
		]);
		expect({
			active: active.includes('KEY-GATE DOCTRINE'),
			trialing: trialing.includes('KEY-GATE DOCTRINE'),
			stock: stock.includes('KEY-GATE DOCTRINE'),
		}).toEqual({ active: true, trialing: true, stock: false });
	});

	test('omits the keyless-pivot rule when no keyless tool is available', async () => {
		// Every tool that needs no Patent-Data Key — PATSTAT (all four surfaces, graph included),
		// legal search and academic search. A new keyless tool missing here fails this test.
		const keylessTools: readonly ToolName[] = [ToolName.PatstatPortfolio, ToolName.PatstatQuery, ToolName.PatstatGraph, ToolName.PatstatApiGuide, ToolName.SearchLegal, ToolName.SearchAcademic];
		const output = await renderPatentInstructions(ALL_PATENT_TOOLS.filter(t => !keylessTools.includes(t)));
		expect({
			pivotOffered: output.includes('KEYLESS PIVOT'),
			doctrineStillRenders: output.includes('KEY-GATE DOCTRINE'),
			resumeRuleStillRenders: output.includes('RESUME RULE'),
		}).toEqual({ pivotOffered: false, doctrineStillRenders: true, resumeRuleStillRenders: true });
	});
});

// The four sentences #189 added, each against the measured fault it exists to close, plus the
// rules they must not have displaced — the prompt's history is that individually-fine blocks
// interact (#183), so the carve-outs are pinned alongside the additions.
suite('PatentAIInstructions prompt-debt fixes', () => {
	test('branch C draws a document-vs-aggregate boundary without gutting C3', async () => {
		const output = await renderPatentInstructions(ALL_PATENT_TOOLS);
		expect({
			// Measured: the boundary only holds when it precedes the branch list. As a trailing
			// exception inside branch C it lost to C's own keyword lure (0/3, then 1/4).
			classificationLeadsTheTree: output.includes('FIRST, CLASSIFY THE DELIVERABLE — DOCUMENTS or NUMBERS ABOUT A CORPUS?'),
			analyticsCannotReturnDocuments: output.includes('CANNOT answer "which patents…"'),
			entryTestLeadsTheBranch: output.includes('ENTRY TEST — WHAT IS THE DELIVERABLE?'),
			rankingIsNotAggregation: output.includes('Ranking is not aggregation.'),
			branchBClaimsRankedLists: output.includes('a RANKED LIST of documents is still a search'),
			documentBoundary: output.includes('NOT analytics — DOCUMENTS vs AGGREGATES'),
			aggregateNeverSatisfiesDocuments: output.includes('An aggregate answer NEVER satisfies a request for documents'),
			statisticalRankingIsStillASearch: output.includes('take the search path even though the RANKING criterion is itself a statistic'),
			c3KeepsItsAggregateScope: output.includes('any OTHER PATSTAT aggregate'),
			c3SendsNamedDocumentsToSearch: output.includes('naming the most-cited DOCUMENTS is branch B, not this'),
			c1AndC2Unchanged: output.includes('technology/topic analytics by KEYWORDS') && output.includes('NAMED company\'s/applicant\'s aggregate portfolio'),
		}).toEqual({
			classificationLeadsTheTree: true,
			analyticsCannotReturnDocuments: true,
			entryTestLeadsTheBranch: true,
			rankingIsNotAggregation: true,
			branchBClaimsRankedLists: true,
			documentBoundary: true,
			aggregateNeverSatisfiesDocuments: true,
			statisticalRankingIsStillASearch: true,
			c3KeepsItsAggregateScope: true,
			c3SendsNamedDocumentsToSearch: true,
			c1AndC2Unchanged: true,
		});
	});

	test('the subagent may not replace the mandated office search paths', async () => {
		const output = await renderPatentInstructions(ALL_PATENT_TOOLS);
		expect({
			delegationLimit: output.includes('DELEGATION LIMIT: `patent_search_subagent` is NOT one of those paths'),
			reasonIsWhatTheAgentWouldNotSee: output.includes('every data_keys_required gate reaches YOU'),
			neverTheComprehensiveSearch: output.includes('never as your only search call and never as the search for a comprehensive, prior-art or multi-office request'),
			dualOfficeMandateStands: output.includes('run BOTH search paths'),
		}).toEqual({
			delegationLimit: true,
			reasonIsWhatTheAgentWouldNotSee: true,
			neverTheComprehensiveSearch: true,
			dualOfficeMandateStands: true,
		});
	});

	test('omits the delegation limit when the subagent tool is unavailable', async () => {
		const output = await renderPatentInstructions(ALL_PATENT_TOOLS.filter(t => t !== ToolName.PatentSearchSubagent));
		expect({
			delegationLimit: output.includes('DELEGATION LIMIT'),
			decisionTreeStillRenders: output.includes('PATENT TOOL DECISION TREE'),
		}).toEqual({ delegationLimit: false, decisionTreeStillRenders: true });
	});

	// A retrieval-warrant block ("a result asserting the text was retrieved is not the text",
	// "recalled claim language is not retrieval") was written for T5 and REMOVED after
	// measurement: with it, T1's web-fallback persistence fell to 1/4 and T5 stayed 0/4; without
	// it T1 is 4/4. What the prompt carries against fabrication is the #183 layer below, which
	// this pass leaves exactly as it found it — the assertion exists so a future attempt at that
	// block starts from the fact that the ground it would stand on is unmoved.
	//
	// #195 measured five further arms against T5 and T1 together and shipped NONE of them, so
	// this layer is still exactly as #183 left it. What was tried, and what it cost, is recorded
	// in T5's entry in evals/output/trajectory-baseline.json — read that before writing a sixth
	// composition-time rule, because composition-time wording now stands at 1 pass in 20 samples.
	test('the inherited grounding rules are untouched by this pass', async () => {
		const output = await renderPatentInstructions(ALL_PATENT_TOOLS);
		expect({
			truncationRuleUnchanged: output.includes('AN EMPTY OR TRUNCATED PAYLOAD IS NOT CONTENT'),
			elisionRuleUnchanged: output.includes('quote it as the partial it is instead of completing it'),
			finalAnswerSweepUnchanged: output.includes('FINAL-ANSWER GROUNDING'),
			noRetrievalWarrantBlock: output.includes('A STATEMENT ABOUT DATA IS NOT THE DATA') || output.includes('CLAIM TEXT IS THE HARDEST CASE'),
		}).toEqual({
			truncationRuleUnchanged: true,
			elisionRuleUnchanged: true,
			finalAnswerSweepUnchanged: true,
			noRetrievalWarrantBlock: false,
		});
	});

	// #168 widened branch C's entry test from documents-vs-aggregates to the three-way
	// criteria-shape test (CONTEXT.md, ADR 0007). The shipped boundary is asserted alongside the
	// addition because the prompt's history is that individually-fine blocks interact (#183, #191):
	// a traversal engine that could swallow "the 5 most cited EP patents — search for them" would
	// re-open exactly the T3a regression #189/#194 closed.
	test('branch C routes the three engines by criteria shape without re-opening the document boundary', async () => {
		const output = await renderPatentInstructions(ALL_PATENT_TOOLS);
		expect({
			criteriaShapeRouter: output.includes('THEN PICK THE ENGINE BY CRITERIA SHAPE'),
			freeTextGoesToC1: output.includes('FREE-TEXT KEYWORDS over a corpus ("trends in quantum computing") → C1'),
			structuredCriteriaGoToC2C3: output.includes('STRUCTURED CRITERIA aggregated over a corpus'),
			namedNodeGoesToC4: output.includes('A NAMED NODE AND ITS RELATIONSHIPS'),
			c4Rendered: output.includes('**C4 — a NAMED NODE and the relationships around it**'),
			resolveFirst: output.includes('START with operation="resolve"'),
			ambiguityIsAnInteractionStep: output.includes('AMBIGUITY IS AN INTERACTION STEP'),
			// The anti-regression: a traversal answers a question about a NAMED node; it never
			// discovers documents by subject, and the shipped search boundary still owns that case.
			scopeLimitStated: output.includes('it never DISCOVERS documents by subject'),
			namedSubjectIsStillASearch: output.includes('names a SUBJECT, not a node: that is branch B'),
			traversalDoesNotSatisfyDocuments: output.includes('the edges around one node you picked yourself are not a subject search'),
			// And the boundary the shipped prompt already held, unmoved.
			documentBoundaryUnchanged: output.includes('NOT analytics — DOCUMENTS vs AGGREGATES'),
			rankingIsNotAggregationUnchanged: output.includes('Ranking is not aggregation.'),
			c3StillOwnsCorpusAggregates: output.includes('any OTHER PATSTAT aggregate'),
			c3SendsTraversalsToC4: output.includes('the citations or family of ONE named patent are C4, not this'),
			// Two citation universes, so the model can exhaust both rather than read one silence as absence.
			citationUniversesSplit: output.includes('TWO CITATION UNIVERSES, neither a superset of the other'),
			exhaustBothOnEp: output.includes('EXHAUST BOTH rather than reporting the first one\'s silence as absence'),
		}).toEqual({
			criteriaShapeRouter: true,
			freeTextGoesToC1: true,
			structuredCriteriaGoToC2C3: true,
			namedNodeGoesToC4: true,
			c4Rendered: true,
			resolveFirst: true,
			ambiguityIsAnInteractionStep: true,
			scopeLimitStated: true,
			namedSubjectIsStillASearch: true,
			traversalDoesNotSatisfyDocuments: true,
			documentBoundaryUnchanged: true,
			rankingIsNotAggregationUnchanged: true,
			c3StillOwnsCorpusAggregates: true,
			c3SendsTraversalsToC4: true,
			citationUniversesSplit: true,
			exhaustBothOnEp: true,
		});
	});

	test('the graph routing disappears with the tool, leaving the shipped two-engine prompt intact', async () => {
		const output = await renderPatentInstructions(ALL_PATENT_TOOLS.filter(t => t !== ToolName.PatstatGraph));
		expect({
			criteriaShapeRouter: output.includes('THEN PICK THE ENGINE BY CRITERIA SHAPE'),
			c4Rendered: output.includes('**C4 —'),
			graphNamedAnywhere: output.includes('patstat_graph'),
			branchCStillRenders: output.includes('ENTRY TEST — WHAT IS THE DELIVERABLE?'),
			documentBoundaryStillRenders: output.includes('NOT analytics — DOCUMENTS vs AGGREGATES'),
			c3StillRenders: output.includes('any OTHER PATSTAT aggregate'),
		}).toEqual({
			criteriaShapeRouter: false,
			c4Rendered: false,
			graphNamedAnywhere: false,
			branchCStillRenders: true,
			documentBoundaryStillRenders: true,
			c3StillRenders: true,
		});
	});

	test('a file write never substitutes for answering, and a gap is reported not filled', async () => {
		const output = await renderPatentInstructions(ALL_PATENT_TOOLS);
		expect({
			answerCarriesTheResult: output.includes('THE ANSWER ITSELF CARRIES THE RESULT'),
			emptyMessagePlusFileIsNotAnAnswer: output.includes('pointing at a file you created has not answered'),
			noSmugglingIntoTheFile: output.includes('must not be written into the file either'),
			toolOffloadCarveOutKept: output.includes('where a TOOL offloaded an oversized record to a path, you still read that path and hand it back'),
			gapDisclosedOnlyAfterTheLadder: output.includes('the gap is disclosed only after the ladder is exhausted'),
			// Measured interaction: the anti-fabrication pressure bought honesty by SKIPPING the
			// web rung and offering it instead, so the honest report is bound to the ladder here.
			honestyDoesNotBuyOutThePersistence: output.includes('never shorten the work to avoid the risk of writing something you cannot source'),
			droppedRecordStillOwesTheWebRung: output.includes('A record DROPPED in transit leaves rung (iii) untried'),
			offeringARungIsNotEmittingIt: output.includes('a rung you OFFER ("shall I check Google Patents?") rather than emit is a rung you did not try'),
			verbatimCompletenessUnchanged: output.includes('VERBATIM-COMPLETENESS'),
			// The completeness demand is where the pull to invent comes from, so the bound
			// lives inside that same rule rather than only in a rule further down.
			completenessIsBoundedByRetrieval: output.includes('Completeness is bounded by what you actually received'),
		}).toEqual({
			answerCarriesTheResult: true,
			emptyMessagePlusFileIsNotAnAnswer: true,
			noSmugglingIntoTheFile: true,
			toolOffloadCarveOutKept: true,
			gapDisclosedOnlyAfterTheLadder: true,
			honestyDoesNotBuyOutThePersistence: true,
			droppedRecordStillOwesTheWebRung: true,
			offeringARungIsNotEmittingIt: true,
			verbatimCompletenessUnchanged: true,
			completenessIsBoundedByRetrieval: true,
		});
	});
});

suite('PatentAIInstructions source attribution', () => {
	test('the answer names the source beside the fact and marks reproduced words as a quotation', async () => {
		const output = await renderPatentInstructions(ALL_PATENT_TOOLS);
		expect({
			nameTheSource: output.includes('NAME THE SOURCE BESIDE THE FACT'),
			markQuotations: output.includes('MARK REPRODUCED WORDS AS A QUOTATION'),
			organizeByQuestion: output.includes('ORGANIZE BY THE QUESTION, NOT BY THE DOCUMENT'),
			verbatimCarveOutKept: output.includes('governed by VERBATIM-COMPLETENESS'),
			// The example is a template: templated calls to a real tool, then a rationale.
			exampleUsesRealTool: output.includes('[get_patent_details: EP3477840B1]'),
			exampleHasRationale: output.includes('<rationale>CORRECT:'),
			examplePlaceholdersDisarmed: output.includes('illustrative placeholders, not retrieved data'),
			// The grounding rules the block builds on stay in place.
			groundingSweepUnchanged: output.includes('FINAL-ANSWER GROUNDING'),
		}).toEqual({
			nameTheSource: true,
			markQuotations: true,
			organizeByQuestion: true,
			verbatimCarveOutKept: true,
			exampleUsesRealTool: true,
			exampleHasRationale: true,
			examplePlaceholdersDisarmed: true,
			groundingSweepUnchanged: true,
		});
	});

	test('the example never shows a tool the model cannot call', async () => {
		const withoutDetails = await renderPatentInstructions(ALL_PATENT_TOOLS.filter(t => t !== ToolName.GetPatentDetails));
		const searchOnly = await renderPatentInstructions([ToolName.SearchPatents]);
		expect({
			fallsBackToSummary: withoutDetails.includes('[get_patent_summary: EP3477840B1]') && !withoutDetails.includes('[get_patent_details:'),
			rulesWithoutExampleWhenNoLookupTool: searchOnly.includes('NAME THE SOURCE BESIDE THE FACT') && !searchOnly.includes('<example>'),
		}).toEqual({
			fallsBackToSummary: true,
			rulesWithoutExampleWhenNoLookupTool: true,
		});
	});

	test('tool identifiers are declared internal and list counts must match the rows', async () => {
		// 2026-09-02: the agent asked the user "Would you like me to pull full claims (get_patent_details)…"
		// and headed a 7-row table "5 total". The prompt names tools in backticks everywhere, so it
		// has to say, once, that those names never reach the user.
		const output = await renderPatentInstructions(ALL_PATENT_TOOLS);
		expect({
			toolNamesInternal: output.includes('TOOL NAMES ARE INTERNAL'),
			countsMatchTable: output.includes('COUNTS MUST MATCH THE TABLE'),
		}).toEqual({ toolNamesInternal: true, countsMatchTable: true });
	});

	test('renders no attribution block on a stock configuration', async () => {
		const output = await renderPatentInstructions([]);
		expect(output.includes('SOURCE ATTRIBUTION AND QUOTING')).toBe(false);
	});
});
