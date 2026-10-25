/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Patent Agent prompt export + drift gate.
 *
 * agent-v2 is the single owner of the Patent Agent system prompt (`patentAIPrompt.tsx`). The
 * sibling dsh harness (DeepSeek Harness fork) runs the same agent and has no VS Code tools. Its
 * data tools come in two forms (ADR 0019 C2/C6): the office tools run natively in the harness
 * under their plain backend names, and only the paid backend tools arrive over MCP as
 * `mcp__flowleap__<tool>` from the FlowLeap MCP server. This spec renders the prompt with only
 * the typed tools the harness serves, rewrites the paid tool names to their MCP form, keeps the
 * office tool names as they are, and keeps the result committed under
 * `extensions/copilot/assets/prompt-export/`:
 *
 * - `patent-agent.md`   the prompt text only (the harness loads it verbatim as a system-prompt section)
 * - `patent-agent.json` provenance: render inputs, included/excluded tools split into native and
 *                       MCP tools, remaining VS Code-only tool references ("gaps"), word count
 *
 * Two modes:
 * - default: asserts the committed artifacts equal a fresh render (the drift gate)
 * - `PATENT_PROMPT_EXPORT=write`: rewrites both artifacts
 *
 * Refresh from `extensions/copilot`:
 *   PATENT_PROMPT_EXPORT=write npx vitest run src/extension/prompts/node/agent/test/patentPromptExport.spec.tsx
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { Raw } from '@vscode/prompt-tsx';
import { expect, suite, test } from 'vitest';
import type * as vscode from 'vscode';
import { MockEndpoint } from '../../../../../platform/endpoint/test/node/mockEndpoint';
import { IInstantiationService } from '../../../../../util/vs/platform/instantiation/common/instantiation';
import { createExtensionUnitTestingServices } from '../../../../test/node/services';
import { ToolName } from '../../../../tools/common/toolNames';
import { renderPromptElement } from '../../base/promptRenderer';
import { HOST_KEY_STATE_HEADING, PatentAIInstructions } from '../patentAIPrompt';

const REFRESH_COMMAND = 'PATENT_PROMPT_EXPORT=write npx vitest run src/extension/prompts/node/agent/test/patentPromptExport.spec.tsx';
const SOURCE_FILE = 'extensions/copilot/src/extension/prompts/node/agent/patentAIPrompt.tsx';
const MCP_PREFIX = 'mcp__flowleap__';

/** `extensions/copilot/assets/prompt-export`, resolved from this spec's folder. */
const EXPORT_DIR = join(__dirname, '..', '..', '..', '..', '..', '..', 'assets', 'prompt-export');
const MARKDOWN_PATH = join(EXPORT_DIR, 'patent-agent.md');
const JSON_PATH = join(EXPORT_DIR, 'patent-agent.json');

/** Office tools the harness runs natively under their plain backend names; never rewritten. */
const NATIVE_TOOLS: readonly ToolName[] = [
	ToolName.SearchPatents,
	ToolName.SearchRegister,
	ToolName.GetLegalStatus,
	ToolName.GetPatentFamily,
	ToolName.GetRegisterEvents,
	ToolName.GetContinuity,
	ToolName.GetProsecutionTimeline,
	ToolName.SearchAcademic,
	ToolName.SearchNpl,
	ToolName.GetNplWork,
	ToolName.ComparePatents,
	ToolName.GetPatentSummary,
	ToolName.GetPatentTerm,
];

/** Paid backend tools that reach the harness over MCP; rewritten to `mcp__flowleap__<tool>`. */
const MCP_TOOLS: readonly ToolName[] = [
	ToolName.PatstatPortfolio,
	ToolName.PatstatQuery,
];

/** Every typed tool the harness serves, in render order. */
const INCLUDED_TOOLS: readonly ToolName[] = [...NATIVE_TOOLS, ...MCP_TOOLS];

/** Patent tools left out on purpose: not served by the harness, or local-only (files, webviews, subagents). */
const EXCLUDED_TOOLS: readonly ToolName[] = [
	ToolName.GetPatentDetails,
	ToolName.GetPatentFigures,
	ToolName.PatentApiRequest,
	ToolName.SearchCitations,
	ToolName.SearchForwardCitations,
	ToolName.OpsApiGuide,
	ToolName.USPTOApiGuide,
	ToolName.CitationApiGuide,
	ToolName.PatstatApiGuide,
	ToolName.WritePatentResults,
	ToolName.CompareClaims,
	ToolName.PatentAnalyticsViz,
	ToolName.PatstatGraph,
	ToolName.PatentSearchSubagent,
	ToolName.ReadPdf,
	ToolName.ExaminerBaseline,
	ToolName.StartApplicationDraft,
	ToolName.ValidateDraft,
	ToolName.ExportDraftDocx,
	ToolName.RenderFigure,
	ToolName.BuildDrawingSet,
	ToolName.ProposeFigurePart,
	ToolName.RemoveClaim,
	ToolName.InventorQuestions,
];

/** `ToolName` values that are also plain English words in the prompt text; never counted as gaps. */
const PROSE_WORD_TOOL_NAMES: readonly string[] = [ToolName.Skill, ToolName.Memory];

/**
 * Tool names the harness cannot serve: every `ToolName` value outside the included list, plus the
 * backend-injected `web_search` that is not a `ToolName`. Remaining references are reported as gaps.
 */
const GAP_TOOL_NAMES: readonly string[] = [
	...new Set<string>([
		...Object.values(ToolName).filter(name => !INCLUDED_TOOLS.includes(name) && !PROSE_WORD_TOOL_NAMES.includes(name)),
		'web_search',
	]),
].sort();

const RENDER_OPTIONS = {
	webSearchAvailable: false,
	subscriptionStatus: 'unknown',
	hasEpoOpsKey: false,
	hasUsptoOdpKey: false,
	// The harness holds the firm's keys and contributes the live key state as its own section
	// (`dsh-flowleap-connectors`, heading HOST_KEY_STATE_HEADING); the export carries a pointer only.
	keyStateOwner: 'host',
} as const;

interface ToolGap {
	readonly name: string;
	readonly count: number;
}

interface PromptExportManifest {
	readonly sourceFile: string;
	readonly renderedWith: {
		readonly tools: readonly string[];
		readonly webSearchAvailable: boolean;
		readonly subscriptionStatus: string;
		readonly keyStateOwner: string;
	};
	readonly includedTools: readonly string[];
	readonly nativeTools: readonly string[];
	readonly mcpTools: readonly string[];
	readonly excludedTools: readonly string[];
	readonly gaps: readonly ToolGap[];
	readonly wordCount: number;
	readonly generatedBy: string;
}

interface PromptExport {
	readonly markdown: string;
	readonly manifest: PromptExportManifest;
}

function toolInfo(name: string): vscode.LanguageModelToolInformation {
	return { name, description: '', source: undefined, inputSchema: { type: 'object', properties: {} }, tags: [] };
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function wholeWordPattern(names: readonly string[]): RegExp {
	return new RegExp(`\\b(?<tool>${names.map(escapeRegExp).join('|')})\\b`, 'g');
}

/** Renders the prompt and returns the plain text of every message's text parts. */
async function renderPromptText(): Promise<string> {
	const services = createExtensionUnitTestingServices();
	const accessor = services.createTestingAccessor();
	try {
		const instantiationService = accessor.get(IInstantiationService);
		const endpoint = instantiationService.createInstance(MockEndpoint, undefined);
		const { messages } = await renderPromptElement(instantiationService, endpoint, PatentAIInstructions, {
			availableTools: INCLUDED_TOOLS.map(toolInfo),
			...RENDER_OPTIONS,
		});
		return messages
			.map(message => message.content
				.filter((part): part is Raw.ChatCompletionContentPartText => part.type === Raw.ChatCompletionContentPartKind.Text)
				.map(part => part.text)
				.join('\n'))
			.join('\n\n');
	} finally {
		accessor.dispose();
	}
}

function mcpToolName(name: ToolName): string {
	return `${MCP_PREFIX}${name}`;
}

/** Rewrites only the paid (MCP) tool names; the native office tool names stay as rendered. */
function rewriteToolNames(text: string): string {
	return text.replace(wholeWordPattern(MCP_TOOLS), `${MCP_PREFIX}$<tool>`);
}

function countGaps(text: string): ToolGap[] {
	const counts = new Map<string, number>();
	for (const match of text.matchAll(wholeWordPattern(GAP_TOOL_NAMES))) {
		const name = match.groups!.tool;
		counts.set(name, (counts.get(name) ?? 0) + 1);
	}
	return [...counts.entries()]
		.map(([name, count]) => ({ name, count }))
		.sort((a, b) => a.name.localeCompare(b.name));
}

async function buildPromptExport(): Promise<PromptExport> {
	const rendered = await renderPromptText();
	const rewritten = rewriteToolNames(rendered).trimEnd();
	const markdown = `${rewritten}\n`;
	const manifest: PromptExportManifest = {
		sourceFile: SOURCE_FILE,
		renderedWith: {
			tools: [...INCLUDED_TOOLS],
			webSearchAvailable: RENDER_OPTIONS.webSearchAvailable,
			subscriptionStatus: RENDER_OPTIONS.subscriptionStatus,
			keyStateOwner: RENDER_OPTIONS.keyStateOwner,
		},
		includedTools: [...NATIVE_TOOLS, ...MCP_TOOLS.map(mcpToolName)],
		nativeTools: [...NATIVE_TOOLS],
		mcpTools: MCP_TOOLS.map(mcpToolName),
		excludedTools: [...EXCLUDED_TOOLS],
		gaps: countGaps(rewritten),
		wordCount: rewritten.split(/\s+/).filter(Boolean).length,
		generatedBy: `extensions/copilot: ${REFRESH_COMMAND}`,
	};
	return { markdown, manifest };
}

function serializeManifest(manifest: PromptExportManifest): string {
	return `${JSON.stringify(manifest, undefined, '\t')}\n`;
}

suite('Patent Agent prompt export', () => {
	const writeMode = process.env.PATENT_PROMPT_EXPORT === 'write';

	test('paid tool names carry the MCP prefix, native tool names stay bare, and the prompt still carries the patent role', async () => {
		const { markdown } = await buildPromptExport();
		expect(markdown).toContain('<patentAIIdentity>');
		expect(markdown).toContain('search_patents');
		expect(markdown).toContain(`${MCP_PREFIX}patstat_query`);
		// No bare paid name survives (`\b` never matches inside `mcp__flowleap__<tool>`, so every match is bare).
		const barePaid = [...markdown.matchAll(wholeWordPattern(MCP_TOOLS))];
		expect(barePaid.map(match => match[0])).toEqual([]);
		// No native name was rewritten: the harness serves these under their plain names.
		const prefixedNative = [...markdown.matchAll(new RegExp(`${MCP_PREFIX}(?<tool>${NATIVE_TOOLS.map(escapeRegExp).join('|')})\\b`, 'g'))];
		expect(prefixedNative.map(match => match[0])).toEqual([]);
	});

	test('the export carries no key claim of its own: it points at the host-owned key-state section', async () => {
		const { markdown } = await buildPromptExport();
		expect(markdown).toContain(`under the heading "${HOST_KEY_STATE_HEADING}"`);
		// The static per-turn line of the `unknown` branch ("Key presence only: EPO OPS key is not set; …") must not ship.
		expect(markdown).not.toContain('Key presence only:');
		expect(markdown).not.toContain('The subscription status could not be read this turn');
	});

	test(writeMode ? 'writes the committed artifacts' : 'committed artifacts match a fresh render', async () => {
		const { markdown, manifest } = await buildPromptExport();
		const manifestText = serializeManifest(manifest);

		if (writeMode) {
			mkdirSync(EXPORT_DIR, { recursive: true });
			writeFileSync(MARKDOWN_PATH, markdown);
			writeFileSync(JSON_PATH, manifestText);
			return;
		}

		const stale = `The committed Patent Agent prompt export is stale. Refresh it from extensions/copilot with:\n  ${REFRESH_COMMAND}`;
		expect(existsSync(MARKDOWN_PATH) && existsSync(JSON_PATH), `${stale}\n(missing ${MARKDOWN_PATH} or ${JSON_PATH})`).toBe(true);
		expect(readFileSync(MARKDOWN_PATH, 'utf8'), stale).toBe(markdown);
		expect(JSON.parse(readFileSync(JSON_PATH, 'utf8')), stale).toEqual(JSON.parse(manifestText));
	});
});
