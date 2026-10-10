/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Tool reference names of the Patent Agent's patent-data tools, contributed by the built-in
 * `extensions/copilot` extension (`contributes.languageModelTools`).
 *
 * FlowLeap: the `patent` client tool set groups these so agent-host sessions (Claude in the
 * Agents Window) receive them as client tools. Agent hosts only receive tools that belong to a
 * non-deprecated tool set, and tool sets contributed by the default chat extension are marked
 * deprecated, so the set lives here in core. `patentChatToolReferenceNames.spec.ts` in the
 * copilot extension keeps this list in step with its `package.json`.
 */
export const patentChatToolReferenceNames: readonly string[] = [
	'patents',
	'compareClaims',
	'patstatPortfolio',
	'patstatQuery',
	'patstatGraph',
	'patstatApiGuide',
	'patentAnalytics',
	'patentSummary',
	'examinerBaseline',
	'exportDraftDocx',
	'patentTerm',
	'comparePatents',
	'patentDetails',
	'patentFigures',
	'legalStatus',
	'patentFamily',
	'registerEvents',
	'readPdf',
	'citations',
	'forwardCitations',
	'continuity',
	'prosecutionTimeline',
	'citationApiGuide',
	'patentApiRequest',
	'opsApiGuide',
	'usptoApiGuide',
	'legal',
	'legalSearchGuide',
	'nplWork',
	'npl',
	'academic',
	'writePatentResults',
	'patentSearchSubagent',
];
