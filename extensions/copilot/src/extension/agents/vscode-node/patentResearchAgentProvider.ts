/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { IConfigurationService } from '../../../platform/configuration/common/configurationService';
import { AGENT_FILE_EXTENSION } from '../../../platform/customInstructions/common/promptTypes';
import { IVSCodeExtensionContext } from '../../../platform/extContext/common/extensionContext';
import { IFileSystemService } from '../../../platform/filesystem/common/fileSystemService';
import { ILogService } from '../../../platform/log/common/logService';
import { Disposable } from '../../../util/vs/base/common/lifecycle';
import { AgentConfig, AgentHandoff, buildAgentMarkdown, DEFAULT_READ_TOOLS, PATENT_TOOLS } from './agentTypes';

/**
 * Base PatentResearch agent configuration.
 * User-invocable agent for comprehensive patent research with subagent delegation.
 */
const BASE_PATENT_RESEARCH_AGENT_CONFIG: AgentConfig = {
	name: 'PatentResearch',
	description: 'Comprehensive patent research agent for prior art, landscape analysis, and citation tracking across EPO, USPTO, and academic sources',
	argumentHint: 'Describe the invention or technology to research',
	target: 'vscode',
	agents: ['Explore'],
	tools: [
		...DEFAULT_READ_TOOLS,
		...PATENT_TOOLS,
		'agent',
		'vscode/askQuestions',
	],
	handoffs: [],
	body: ''
};

/**
 * Provides the PatentResearch agent dynamically with settings-based customization.
 *
 * Comprehensive patent research agent that combines multi-source searching
 * with Explore subagent delegation for parallel research tasks.
 */
export class PatentResearchAgentProvider extends Disposable implements vscode.ChatCustomAgentProvider {
	readonly label = vscode.l10n.t('Patent Research Agent');

	private static readonly CACHE_DIR = 'patent-research-agent';
	private static readonly AGENT_FILENAME = `PatentResearch${AGENT_FILE_EXTENSION}`;

	private readonly _onDidChangeCustomAgents = this._register(new vscode.EventEmitter<void>());
	readonly onDidChangeCustomAgents = this._onDidChangeCustomAgents.event;

	constructor(
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@IVSCodeExtensionContext private readonly _extensionContext: IVSCodeExtensionContext,
		@IFileSystemService private readonly _fileSystemService: IFileSystemService,
		@ILogService private readonly _logService: ILogService,
	) {
		super();

		this._register(this._configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('patent.researchAgent.defaultModel')) {
				this._onDidChangeCustomAgents.fire();
			}
		}));
	}

	async provideCustomAgents(
		_context: unknown,
		_token: vscode.CancellationToken
	): Promise<vscode.ChatResource[]> {
		const config = this._buildCustomizedConfig();
		const content = buildAgentMarkdown(config);
		const fileUri = await this._writeCacheFile(content);
		return [{ uri: fileUri, sessionTypes: ['local'] }];
	}

	private async _writeCacheFile(content: string): Promise<vscode.Uri> {
		const cacheDir = vscode.Uri.joinPath(
			this._extensionContext.globalStorageUri,
			PatentResearchAgentProvider.CACHE_DIR
		);

		try {
			await this._fileSystemService.stat(cacheDir);
		} catch {
			await this._fileSystemService.createDirectory(cacheDir);
		}

		const fileUri = vscode.Uri.joinPath(cacheDir, PatentResearchAgentProvider.AGENT_FILENAME);
		await this._fileSystemService.writeFile(fileUri, new TextEncoder().encode(content));
		this._logService.trace(`[PatentResearchAgentProvider] Wrote agent file: ${fileUri.toString()}`);
		return fileUri;
	}

	static buildAgentBody(): string {
		return `You are a PATENT RESEARCH AGENT specializing in comprehensive prior art searches, patent landscape analysis, and citation tracking.

## Core Capabilities

1. **Prior Art Search** — Multi-source search across EPO, USPTO, and academic databases
2. **Landscape Analysis** — Map competitive patent landscapes by assignee, technology, and jurisdiction
3. **Citation Tracking** — Trace forward/backward citation networks to find related art
4. **Freedom-to-Operate** — Assess infringement risk against active patents
5. **Legal Research** — Search case law, prosecution history, and patent status

## Workflow

### 1. Understand the Invention
- Ask clarifying questions about the technology, key features, and scope
- Identify relevant IPC/CPC classification codes
- Determine target jurisdictions

### 2. Build Search Strategy
- When the user describes their OWN invention or claim, run #tool:analyze_claim first to extract keywords, synonyms, and IPC/CPC codes
- Use #tool:build_patent_query for optimized EPO CQL queries
- Use #tool:build_uspto_query for USPTO-specific queries
- Plan keyword variations, synonyms, and classification codes
- For complex searches, launch **Explore subagents in parallel** for different angles

### 3. Execute Multi-Source Search
**ALWAYS search BOTH patents AND academic sources unless explicitly told otherwise.**

- Search EPO via #tool:search_patents with CQL queries
- Search USPTO via #tool:build_uspto_query, executed with #tool:patentApiRequest (endpoint shapes from #tool:usptoApiGuide)
- Search academic via #tool:search_academic for papers and non-patent literature
- Use #tool:fetch for web-based sources when needed

### 4. Analyze & Synthesize
- Assess relevance of each result to the target invention
- Read full text via #tool:get_patent_details (claims + description) and inspect drawings via #tool:get_patent_figures
- Identify key claims and potential overlaps
- Assess the user's claim against prior art with #tool:compare_claims (HIGH/MEDIUM/LOW overlap)
- Track citations: #tool:search_citations for prior art cited against an application (X = 102 novelty, Y = 103 obviousness, A = background) and #tool:search_forward_citations to gauge a document's impact (who cites it)
- Ground legal assessments in patent law via #tool:search_legal (MPEP, EPC, EPO Guidelines)
- For landscape/competitive analysis, generate filing trends, top assignees, and geographic distribution via #tool:patent_analytics_viz
- Map citation relationships between results
- Highlight gaps in coverage that need additional searching

### 5. Present Findings
Structure results as:
- **Most Relevant Patents** — Top hits with patent numbers, titles, abstracts, relevance assessment
- **Academic Literature** — Key papers with findings
- **Landscape Summary** — Key players, technology trends, white spaces
- **Recommendations** — Next steps, areas needing deeper analysis

## Rules
- ALWAYS build optimized queries before searching — don't use raw keywords
- Search multiple jurisdictions (EP, US, WO at minimum)
- Include academic/NPL sources in every search
- Save comprehensive results via #tool:writePatentResults
- Use Explore subagents for parallel research when spanning multiple technology areas`;
	}

	private _buildCustomizedConfig(): AgentConfig {
		const defaultModel = this._configurationService.getNonExtensionConfig<string>('patent.researchAgent.defaultModel');

		const deepAnalysisHandoff: AgentHandoff = {
			label: 'Deep Analysis',
			agent: 'agent',
			prompt: 'Perform deep analysis on the patent research findings',
			send: true,
		};

		const saveResultsHandoff: AgentHandoff = {
			label: 'Save Results',
			agent: 'agent',
			prompt: 'Save patent research results to files',
			send: true,
		};

		const planHandoff: AgentHandoff = {
			label: 'Create Plan',
			agent: 'Plan',
			prompt: 'Create an analysis plan based on the research findings',
			send: true,
		};

		return {
			...BASE_PATENT_RESEARCH_AGENT_CONFIG,
			handoffs: [deepAnalysisHandoff, saveResultsHandoff, planHandoff],
			body: PatentResearchAgentProvider.buildAgentBody(),
			...(defaultModel ? { model: defaultModel } : {}),
		};
	}
}
