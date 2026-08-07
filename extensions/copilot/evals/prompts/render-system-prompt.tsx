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
 * KEY-STATE VARIANTS:
 * The patent-data key blocks (`patentDataKeyState`, the carousel annotations, and the
 * `keyGateDoctrine` steer) render from props — subscription status plus per-provider key
 * presence — so one snapshot cannot cover them. Alongside the default snapshot this script
 * writes one variant per entry in {@link KEY_STATE_VARIANTS} to `prompts/key-state/<id>.txt`.
 * The key-gate eval suite (promptfooconfig.key-gate.yaml) picks a variant per case with the
 * `systemPromptVariant` var, so the model is graded on the prompt a real user in that state
 * would get. The default snapshot leaves the key props unset, i.e. `unknown` — unchanged.
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
import { PatentAIInstructions, PatentAIPromptProps } from '../../src/extension/prompts/node/agent/patentAIPrompt';
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
	ToolName.ReadPdf,
	ToolName.WritePatentResults,
	ToolName.PatentSearchSubagent,
	ToolName.AnalyzeClaim,
	ToolName.CompareClaims,
	ToolName.PatentAnalyticsViz,
	ToolName.GetPatentSummary,
	ToolName.GetPatentTerm,
	ToolName.ComparePatents,
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

/** The per-turn key state a variant snapshot is rendered under. */
type KeyStateProps = Pick<PatentAIPromptProps, 'subscriptionStatus' | 'hasEpoOpsKey' | 'hasUsptoOdpKey'>;

/**
 * Key-state prompt variants written to `prompts/key-state/<id>.txt`.
 *
 * `active-epo-missing` is the state the key-gate doctrine describes: a paying user with one
 * office live and one gated. It is the strictest single state to grade under — both the
 * forbid rule and the fallbacks it must NOT suppress are in play at once.
 */
const KEY_STATE_VARIANTS: ReadonlyArray<{ readonly id: string; readonly props: KeyStateProps }> = [
	{ id: 'active-epo-missing', props: { subscriptionStatus: 'active', hasEpoOpsKey: false, hasUsptoOdpKey: true } },
];

/** Renders PatentAIInstructions alone and returns its system-role text. */
export async function renderPatentSystemPrompt(keyState?: KeyStateProps): Promise<string> {
	const services = createExtensionUnitTestingServices();
	const accessor = services.createTestingAccessor();
	try {
		const instantiationService = accessor.get(IInstantiationService);
		const endpoint = instantiationService.createInstance(MockEndpoint, 'test');
		const renderer = PromptRenderer.create(instantiationService, endpoint, PatentAIInstructions, {
			availableTools: buildSyntheticTools(),
			webSearchAvailable: true,
			...keyState,
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

/** Renders one snapshot and writes it, guarding against an empty (tool-less) render. */
async function writeSnapshot(outPath: string, keyState?: KeyStateProps): Promise<void> {
	const text = await renderPatentSystemPrompt(keyState);
	if (!text.trim()) {
		throw new Error('render-system-prompt: rendered an empty system prompt — detectPatentTools likely returned no tools');
	}
	fs.mkdirSync(path.dirname(outPath), { recursive: true });
	fs.writeFileSync(outPath, text.endsWith('\n') ? text : `${text}\n`);
	console.log(`render-system-prompt: wrote ${text.split('\n').length} lines to ${outPath}`);
}

async function main(): Promise<void> {
	await writeSnapshot(path.join(__dirname, 'system-prompt.txt'));
	for (const variant of KEY_STATE_VARIANTS) {
		await writeSnapshot(path.join(__dirname, 'key-state', `${variant.id}.txt`), variant.props);
	}
}

if (typeof require !== 'undefined' && require.main === module) {
	main().then(() => process.exit(0), err => {
		console.error(err);
		process.exit(1);
	});
}
