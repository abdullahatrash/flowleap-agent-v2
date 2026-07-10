/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Regenerates evals/prompts/system-prompt.txt from the shipping patent prompt source.
 *
 * SCOPING DECISION — overlay only:
 * The prompt actually sent to the model is the model-family base prompt PLUS the
 * {@link PatentAIInstructions} block appended once via agentPrompt.tsx#getSystemPrompt.
 * Rendering the full base prompt requires the live extension host (workspace, git,
 * tools discovery, endpoint negotiation) which we deliberately do NOT spin up here.
 * ALL patent-specific behavior — identity, tool-selection gate, citation/evidence
 * rules, search strategy — lives in PatentAIInstructions, so this snapshot renders
 * that element ALONE. The snapshot is therefore an overlay of the patent instructions,
 * not the byte-for-byte full system prompt.
 *
 * PatentAIInstructions renders nothing unless detectPatentTools() finds >=1 patent
 * tool, so we feed it a synthetic tool list whose names are the 20 snake_case patent
 * ToolName values, plus webSearchAvailable:true (matches the eval tool surface, which
 * includes a synthetic web_search tool).
 *
 * Rendering needs the @vscode/prompt-tsx renderer + a tokenizer + the IPromptEndpoint
 * DI seam (InstructionMessage reads endpoint.family). We use the same minimal unit-test
 * service graph the tool render tests use (createExtensionUnitTestingServices +
 * MockEndpoint), NOT the extension host.
 *
 * Run (cwd = extensions/copilot):
 *   npx tsx evals/prompts/render-system-prompt.tsx
 */

import { Raw } from '@vscode/prompt-tsx';
import * as fs from 'fs';
import * as path from 'path';
import type { LanguageModelToolInformation } from 'vscode';
import { getTextPart } from '../../src/platform/chat/common/globalStringUtils';
import { MockEndpoint } from '../../src/platform/endpoint/test/node/mockEndpoint';
import { PatentAIInstructions } from '../../src/extension/prompts/node/agent/patentAIPrompt';
import { PromptRenderer } from '../../src/extension/prompts/node/base/promptRenderer';
import { createExtensionUnitTestingServices } from '../../src/extension/test/node/services';
import { ToolName } from '../../src/extension/tools/common/toolNames';
import { IInstantiationService } from '../../src/util/vs/platform/instantiation/common/instantiation';

/** The 20 patent ToolName values whose presence turns the patent prompt block on. */
const PATENT_TOOL_NAMES: readonly ToolName[] = [
	ToolName.BuildPatentQuery,
	ToolName.BuildUSPTOQuery,
	ToolName.SearchPatents,
	ToolName.GetPatentDetails,
	ToolName.GetPatentFigures,
	ToolName.PatentApiRequest,
	ToolName.SearchCitations,
	ToolName.SearchForwardCitations,
	ToolName.OpsApiGuide,
	ToolName.USPTOApiGuide,
	ToolName.CitationApiGuide,
	ToolName.SearchLegal,
	ToolName.LegalSearchGuide,
	ToolName.SearchAcademic,
	ToolName.ReadPdf,
	ToolName.WritePatentResults,
	ToolName.PatentSearchSubagent,
	ToolName.AnalyzeClaim,
	ToolName.CompareClaims,
	ToolName.PatentAnalyticsViz,
];

/** Builds the synthetic tool surface that activates PatentAIInstructions. */
function buildSyntheticTools(): readonly LanguageModelToolInformation[] {
	return PATENT_TOOL_NAMES.map((name): LanguageModelToolInformation => ({
		name,
		description: '',
		inputSchema: undefined,
		tags: [],
	}));
}

/** Renders PatentAIInstructions alone and returns its system-role text. */
export async function renderPatentSystemPrompt(): Promise<string> {
	const services = createExtensionUnitTestingServices();
	const accessor = services.createTestingAccessor();
	try {
		const instantiationService = accessor.get(IInstantiationService);
		const endpoint = instantiationService.createInstance(MockEndpoint, 'test');
		const renderer = PromptRenderer.create(instantiationService, endpoint, PatentAIInstructions, {
			availableTools: buildSyntheticTools(),
			webSearchAvailable: true,
		});
		const result = await renderer.render();
		return result.messages
			.filter(m => m.role === Raw.ChatRole.System)
			.map(m => getTextPart(m.content))
			.join('\n');
	} finally {
		accessor.dispose();
	}
}

async function main(): Promise<void> {
	const text = await renderPatentSystemPrompt();
	if (!text.trim()) {
		throw new Error('render-system-prompt: rendered an empty system prompt — detectPatentTools likely returned no tools');
	}
	const outPath = path.join(__dirname, 'system-prompt.txt');
	fs.writeFileSync(outPath, text.endsWith('\n') ? text : `${text}\n`);
	console.log(`render-system-prompt: wrote ${text.split('\n').length} lines to ${outPath}`);
}

if (typeof require !== 'undefined' && require.main === module) {
	main().then(() => process.exit(0), err => {
		console.error(err);
		process.exit(1);
	});
}
