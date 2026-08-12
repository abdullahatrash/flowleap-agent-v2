/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { cloneAndChange } from '../../../util/vs/base/common/objects';

/**
 * Categories for tool grouping in the virtual tools system
 */
export enum ToolCategory {
	JupyterNotebook = 'Jupyter Notebook Tools',
	WebInteraction = 'Web Interaction',
	VSCodeInteraction = 'VS Code Interaction',
	Testing = 'Testing',
	RedundantButSpecific = 'Redundant but Specific',
	// Core tools that should not be grouped
	Core = 'Core'
}

export enum ToolName {
	ApplyPatch = 'apply_patch',
	Codebase = 'semantic_search',
	VSCodeAPI = 'get_vscode_api',
	FindFiles = 'file_search',
	FindTextInFiles = 'grep_search',
	ReadFile = 'read_file',
	ViewImage = 'view_image',
	ListDirectory = 'list_dir',
	GetErrors = 'get_errors',
	GetScmChanges = 'get_changed_files',
	ReadProjectStructure = 'read_project_structure',
	CreateNewWorkspace = 'create_new_workspace',
	CreateNewJupyterNotebook = 'create_new_jupyter_notebook',
	SearchWorkspaceSymbols = 'search_workspace_symbols',
	EditFile = 'insert_edit_into_file',
	CreateFile = 'create_file',
	ReplaceString = 'replace_string_in_file',
	MultiReplaceString = 'multi_replace_string_in_file',
	EditNotebook = 'edit_notebook_file',
	RunNotebookCell = 'run_notebook_cell',
	GetNotebookSummary = 'copilot_getNotebookSummary',
	ReadCellOutput = 'read_notebook_cell_output',
	InstallExtension = 'install_extension',
	FetchWebPage = 'fetch_webpage',
	Memory = 'memory',
	FindTestFiles = 'test_search',
	GithubSemanticRepoSearch = 'github_repo',
	GithubTextSearch = 'github_text_search',
	CreateDirectory = 'create_directory',
	RunVscodeCmd = 'run_vscode_command',
	CoreManageTodoList = 'manage_todo_list',
	CoreRunInTerminal = 'run_in_terminal',
	CoreGetTerminalOutput = 'get_terminal_output',
	CoreSendToTerminal = 'send_to_terminal',
	CoreKillTerminal = 'kill_terminal',
	CoreTerminalSelection = 'terminal_selection',
	CoreTerminalLastCommand = 'terminal_last_command',
	CoreCreateAndRunTask = 'create_and_run_task',
	CoreRunTask = 'run_task',
	CoreGetTaskOutput = 'get_task_output',
	CoreRunTest = 'runTests',
	CoreTestFailure = 'testFailure',
	EditFilesPlaceholder = 'edit_files',
	CoreRunSubagent = 'runSubagent',
	CoreConfirmationTool = 'vscode_get_confirmation',
	CoreConfirmationToolWithOptions = 'vscode_get_confirmation_with_options',
	CoreReviewPlan = 'vscode_reviewPlan',
	CoreTerminalConfirmationTool = 'vscode_get_terminal_confirmation',
	SearchSubagent = 'search_subagent',
	ExploreSubagent = 'explore_subagent',
	CoreAskQuestions = 'vscode_askQuestions',
	SwitchAgent = 'switch_agent',
	ToolSearch = 'tool_search',
	ResolveMemoryFileUri = 'resolve_memory_file_uri',
	ExecutionSubagent = 'execution_subagent',
	Skill = 'skill',
	SessionStoreSql = 'session_store_sql',
	CoreOpenBrowserPage = 'open_browser_page',
	CoreClickElement = 'click_element',
	CoreScreenshotPage = 'screenshot_page',
	CoreNavigatePage = 'navigate_page',
	CoreReadPage = 'read_page',
	CoreHoverElement = 'hover_element',
	CoreDragElement = 'drag_element',
	CoreTypeInPage = 'type_in_page',
	CoreHandleDialog = 'handle_dialog',
	CoreRunPlaywrightCode = 'run_playwright_code',

	// Patent AI tools (patentai overlay). The implementations and contributions
	// land in later migration layers; these names are the vocabulary the patent
	// system prompt (patentAIPrompt.tsx) keys off to scope patent guidance.
	SearchPatents = 'search_patents',
	GetPatentDetails = 'get_patent_details',
	GetPatentFigures = 'get_patent_figures',
	GetLegalStatus = 'get_legal_status',
	GetPatentFamily = 'get_patent_family',
	GetRegisterEvents = 'get_register_events',
	PatentApiRequest = 'patent_api_request',
	SearchCitations = 'search_citations',
	SearchForwardCitations = 'search_forward_citations',
	GetContinuity = 'get_continuity',
	GetProsecutionTimeline = 'get_prosecution_timeline',
	OpsApiGuide = 'ops_api_guide',
	USPTOApiGuide = 'uspto_api_guide',
	CitationApiGuide = 'citation_api_guide',
	SearchLegal = 'search_legal',
	LegalSearchGuide = 'legal_search_guide',
	SearchAcademic = 'search_academic',
	ReadPdf = 'read_pdf',
	WritePatentResults = 'write_patent_results',
	PatentSearchSubagent = 'patent_search_subagent',
	CompareClaims = 'compare_claims',
	PatentAnalyticsViz = 'patent_analytics_viz',
	GetPatentTerm = 'get_patent_term',
	GetPatentSummary = 'get_patent_summary',
	ComparePatents = 'compare_patents',
	PatstatPortfolio = 'patstat_portfolio',
	PatstatQuery = 'patstat_query',
	PatstatGraph = 'patstat_graph',
	PatstatApiGuide = 'patstat_api_guide',
}

/**
 * Agentic browser tool IDs that are NOT the open_browser_page tool.
 */
export const agenticBrowserTools = [
	ToolName.CoreClickElement,
	ToolName.CoreScreenshotPage,
	ToolName.CoreNavigatePage,
	ToolName.CoreReadPage,
	ToolName.CoreHoverElement,
	ToolName.CoreDragElement,
	ToolName.CoreTypeInPage,
	ToolName.CoreHandleDialog,
	ToolName.CoreRunPlaywrightCode,
] as const;

export enum ContributedToolName {
	ApplyPatch = 'copilot_applyPatch',
	Codebase = 'copilot_searchCodebase',
	SearchWorkspaceSymbols = 'copilot_searchWorkspaceSymbols',
	VSCodeAPI = 'copilot_getVSCodeAPI',
	/** @deprecated moving to core soon */
	RunTests = 'copilot_runTests1',
	FindFiles = 'copilot_findFiles',
	FindTextInFiles = 'copilot_findTextInFiles',
	ReadFile = 'copilot_readFile',
	ViewImage = 'copilot_viewImage',
	ListDirectory = 'copilot_listDirectory',
	GetErrors = 'copilot_getErrors',
	GetScmChanges = 'copilot_getChangedFiles',
	ReadProjectStructure = 'copilot_readProjectStructure',
	CreateNewWorkspace = 'copilot_createNewWorkspace',
	CreateNewJupyterNotebook = 'copilot_createNewJupyterNotebook',
	EditFile = 'copilot_insertEdit',
	CreateFile = 'copilot_createFile',
	ReplaceString = 'copilot_replaceString',
	MultiReplaceString = 'copilot_multiReplaceString',
	EditNotebook = 'copilot_editNotebook',
	RunNotebookCell = 'copilot_runNotebookCell',
	GetNotebookSummary = 'copilot_getNotebookSummary',
	ReadCellOutput = 'copilot_readNotebookCellOutput',
	InstallExtension = 'copilot_installExtension',
	FetchWebPage = 'copilot_fetchWebPage',
	Memory = 'copilot_memory',
	FindTestFiles = 'copilot_findTestFiles',
	GithubSemanticRepoSearch = 'copilot_githubRepo',
	GithubTextSearch = 'copilot_githubTextSearch',
	CreateAndRunTask = 'copilot_createAndRunTask',
	CreateDirectory = 'copilot_createDirectory',
	RunVscodeCmd = 'copilot_runVscodeCommand',
	EditFilesPlaceholder = 'copilot_editFiles',
	SwitchAgent = 'copilot_switchAgent',
	ResolveMemoryFileUri = 'copilot_resolveMemoryFileUri',
	SessionStoreSql = 'copilot_sessionStoreSql',

	// Patent AI tools (patentai overlay). The contributed name maps back to its
	// internal ToolName (same enum key), so `search_patents` reaches SearchPatentsTool.
	SearchPatents = 'copilot_searchPatents',
	SearchAcademic = 'copilot_searchAcademic',
	WritePatentResults = 'copilot_writePatentResults',
	PatentSearchSubagent = 'copilot_patentSearchSubagent',
	CompareClaims = 'copilot_compareClaims',
	PatentAnalyticsViz = 'copilot_patentAnalyticsViz',
	GetPatentTerm = 'copilot_getPatentTerm',
	GetPatentSummary = 'copilot_getPatentSummary',
	ComparePatents = 'copilot_comparePatents',
	GetPatentDetails = 'copilot_getPatentDetails',
	GetPatentFigures = 'copilot_getPatentFigures',
	GetLegalStatus = 'copilot_getLegalStatus',
	GetPatentFamily = 'copilot_getPatentFamily',
	GetRegisterEvents = 'copilot_getRegisterEvents',
	ReadPdf = 'copilot_readPdf',
	PatentApiRequest = 'copilot_patentApiRequest',
	OpsApiGuide = 'copilot_opsApiGuide',
	USPTOApiGuide = 'copilot_usptoApiGuide',
	SearchCitations = 'copilot_searchCitations',
	SearchForwardCitations = 'copilot_searchForwardCitations',
	GetContinuity = 'copilot_getContinuity',
	GetProsecutionTimeline = 'copilot_getProsecutionTimeline',
	CitationApiGuide = 'copilot_citationApiGuide',
	SearchLegal = 'copilot_searchLegal',
	LegalSearchGuide = 'copilot_legalSearchGuide',
	PatstatPortfolio = 'copilot_patstatPortfolio',
	PatstatQuery = 'copilot_patstatQuery',
	PatstatGraph = 'copilot_patstatGraph',
	PatstatApiGuide = 'copilot_patstatApiGuide',
}

export const byokEditToolNamesToToolNames = {
	'find-replace': ToolName.ReplaceString,
	'multi-find-replace': ToolName.MultiReplaceString,
	'apply-patch': ToolName.ApplyPatch,
	'code-rewrite': ToolName.EditFile,
} as const;

const toolNameToContributedToolNames = new Map<ToolName, ContributedToolName>();
const contributedToolNameToToolNames = new Map<ContributedToolName, ToolName>();
for (const [contributedNameKey, contributedName] of Object.entries(ContributedToolName)) {
	const toolName = ToolName[contributedNameKey as keyof typeof ToolName];
	if (toolName) {
		toolNameToContributedToolNames.set(toolName, contributedName);
		contributedToolNameToToolNames.set(contributedName, toolName);
	}
}

export function getContributedToolName(name: string | ToolName): string | ContributedToolName {
	return toolNameToContributedToolNames.get(name as ToolName) ?? name;
}

export function getToolName(name: string | ContributedToolName): string | ToolName {
	return contributedToolNameToToolNames.get(name as ContributedToolName) ?? name;
}

export function mapContributedToolNamesInString(str: string): string {
	contributedToolNameToToolNames.forEach((value, key) => {
		const re = new RegExp(`\\b${key}\\b`, 'g');
		str = str.replace(re, value);
	});
	return str;
}

export function mapContributedToolNamesInSchema(inputSchema: object): object {
	return cloneAndChange(inputSchema, value => typeof value === 'string' ? mapContributedToolNamesInString(value) : undefined);
}

/**
 * Type-safe mapping of all ToolName enum values to their categories.
 * This ensures that every tool is properly categorized and provides compile-time safety.
 * When new tools are added to ToolName, they must be added here or TypeScript will error.
 */
export const toolCategories: Record<ToolName, ToolCategory> = {
	// Core tools (not grouped - expanded by default)
	[ToolName.Codebase]: ToolCategory.Core,
	[ToolName.FindTextInFiles]: ToolCategory.Core,
	[ToolName.ReadFile]: ToolCategory.Core,
	[ToolName.ViewImage]: ToolCategory.Core,
	[ToolName.CreateFile]: ToolCategory.Core,
	[ToolName.ApplyPatch]: ToolCategory.Core,
	[ToolName.ReplaceString]: ToolCategory.Core,
	[ToolName.EditFile]: ToolCategory.Core,
	[ToolName.CoreRunInTerminal]: ToolCategory.Core,
	[ToolName.ListDirectory]: ToolCategory.Core,
	[ToolName.CoreGetTerminalOutput]: ToolCategory.Core,
	[ToolName.CoreSendToTerminal]: ToolCategory.Core,
	[ToolName.CoreKillTerminal]: ToolCategory.Core,
	[ToolName.CoreManageTodoList]: ToolCategory.Core,
	[ToolName.MultiReplaceString]: ToolCategory.Core,
	[ToolName.FindFiles]: ToolCategory.Core,
	[ToolName.CreateDirectory]: ToolCategory.Core,
	[ToolName.ReadProjectStructure]: ToolCategory.Core,
	[ToolName.CoreRunSubagent]: ToolCategory.Core,
	[ToolName.SearchSubagent]: ToolCategory.Core,
	[ToolName.ExploreSubagent]: ToolCategory.Core,
	[ToolName.ExecutionSubagent]: ToolCategory.Core,

	// already enabled only when tasks are enabled
	[ToolName.CoreRunTask]: ToolCategory.Core,
	[ToolName.CoreGetTaskOutput]: ToolCategory.Core,
	// never enabled, so it doesn't matter where it's categorized
	[ToolName.EditFilesPlaceholder]: ToolCategory.Core,

	// Jupyter Notebook Tools
	[ToolName.CreateNewJupyterNotebook]: ToolCategory.JupyterNotebook,
	[ToolName.EditNotebook]: ToolCategory.JupyterNotebook,
	[ToolName.RunNotebookCell]: ToolCategory.JupyterNotebook,
	[ToolName.GetNotebookSummary]: ToolCategory.JupyterNotebook,
	[ToolName.ReadCellOutput]: ToolCategory.JupyterNotebook,

	// Web Interaction
	[ToolName.FetchWebPage]: ToolCategory.WebInteraction,
	[ToolName.GithubSemanticRepoSearch]: ToolCategory.WebInteraction,
	[ToolName.GithubTextSearch]: ToolCategory.WebInteraction,
	[ToolName.CoreOpenBrowserPage]: ToolCategory.WebInteraction,
	[ToolName.CoreClickElement]: ToolCategory.WebInteraction,
	[ToolName.CoreScreenshotPage]: ToolCategory.WebInteraction,
	[ToolName.CoreNavigatePage]: ToolCategory.WebInteraction,
	[ToolName.CoreReadPage]: ToolCategory.WebInteraction,
	[ToolName.CoreHoverElement]: ToolCategory.WebInteraction,
	[ToolName.CoreDragElement]: ToolCategory.WebInteraction,
	[ToolName.CoreTypeInPage]: ToolCategory.WebInteraction,
	[ToolName.CoreHandleDialog]: ToolCategory.WebInteraction,
	[ToolName.CoreRunPlaywrightCode]: ToolCategory.WebInteraction,

	// VS Code Interaction
	[ToolName.SearchWorkspaceSymbols]: ToolCategory.VSCodeInteraction,
	[ToolName.GetErrors]: ToolCategory.VSCodeInteraction,
	[ToolName.VSCodeAPI]: ToolCategory.VSCodeInteraction,
	[ToolName.GetScmChanges]: ToolCategory.VSCodeInteraction,
	[ToolName.CreateNewWorkspace]: ToolCategory.VSCodeInteraction,
	[ToolName.InstallExtension]: ToolCategory.VSCodeInteraction,
	[ToolName.CoreCreateAndRunTask]: ToolCategory.VSCodeInteraction,
	[ToolName.RunVscodeCmd]: ToolCategory.VSCodeInteraction,
	[ToolName.CoreTerminalSelection]: ToolCategory.VSCodeInteraction,
	[ToolName.CoreTerminalLastCommand]: ToolCategory.VSCodeInteraction,

	// Testing
	[ToolName.FindTestFiles]: ToolCategory.Testing,
	[ToolName.CoreRunTest]: ToolCategory.Testing,
	[ToolName.CoreTestFailure]: ToolCategory.Testing,

	// Other tools - categorize appropriately
	[ToolName.CoreConfirmationTool]: ToolCategory.VSCodeInteraction,
	[ToolName.CoreConfirmationToolWithOptions]: ToolCategory.VSCodeInteraction,
	[ToolName.CoreReviewPlan]: ToolCategory.VSCodeInteraction,
	[ToolName.CoreTerminalConfirmationTool]: ToolCategory.VSCodeInteraction,
	[ToolName.CoreAskQuestions]: ToolCategory.VSCodeInteraction,
	[ToolName.SwitchAgent]: ToolCategory.VSCodeInteraction,
	[ToolName.Memory]: ToolCategory.VSCodeInteraction,
	[ToolName.ToolSearch]: ToolCategory.Core,
	[ToolName.ResolveMemoryFileUri]: ToolCategory.Core,
	[ToolName.Skill]: ToolCategory.Core,
	[ToolName.SessionStoreSql]: ToolCategory.Core,

	// Patent AI tools (patentai overlay)
	[ToolName.SearchPatents]: ToolCategory.WebInteraction,
	[ToolName.GetPatentDetails]: ToolCategory.WebInteraction,
	[ToolName.GetPatentFigures]: ToolCategory.WebInteraction,
	[ToolName.GetLegalStatus]: ToolCategory.WebInteraction,
	[ToolName.GetPatentFamily]: ToolCategory.WebInteraction,
	[ToolName.GetRegisterEvents]: ToolCategory.WebInteraction,
	[ToolName.PatentApiRequest]: ToolCategory.WebInteraction,
	[ToolName.SearchCitations]: ToolCategory.WebInteraction,
	[ToolName.SearchForwardCitations]: ToolCategory.WebInteraction,
	[ToolName.GetContinuity]: ToolCategory.WebInteraction,
	[ToolName.GetProsecutionTimeline]: ToolCategory.WebInteraction,
	[ToolName.OpsApiGuide]: ToolCategory.WebInteraction,
	[ToolName.USPTOApiGuide]: ToolCategory.WebInteraction,
	[ToolName.CitationApiGuide]: ToolCategory.WebInteraction,
	[ToolName.SearchLegal]: ToolCategory.WebInteraction,
	[ToolName.LegalSearchGuide]: ToolCategory.WebInteraction,
	[ToolName.SearchAcademic]: ToolCategory.WebInteraction,
	[ToolName.ReadPdf]: ToolCategory.Core,
	[ToolName.WritePatentResults]: ToolCategory.Core,
	[ToolName.PatentSearchSubagent]: ToolCategory.Core,
	[ToolName.CompareClaims]: ToolCategory.WebInteraction,
	[ToolName.PatentAnalyticsViz]: ToolCategory.WebInteraction,
	[ToolName.GetPatentTerm]: ToolCategory.WebInteraction,
	[ToolName.GetPatentSummary]: ToolCategory.WebInteraction,
	[ToolName.ComparePatents]: ToolCategory.WebInteraction,
	[ToolName.PatstatPortfolio]: ToolCategory.WebInteraction,
	[ToolName.PatstatQuery]: ToolCategory.WebInteraction,
	[ToolName.PatstatGraph]: ToolCategory.WebInteraction,
	[ToolName.PatstatApiGuide]: ToolCategory.WebInteraction,
} as const;



/**
 * Get the category for a tool, checking both ToolName enum and external tools.
 */
export function getToolCategory(toolName: string): ToolCategory | undefined {
	return toolCategories.hasOwnProperty(toolName) ? toolCategories[toolName as ToolName] : undefined;
}

/**
 * Get all tools for a specific category.
 */
export function getToolsForCategory(category: ToolCategory): string[] {
	const result: string[] = [];

	// Add tools from ToolName enum
	for (const [toolName, toolCategory] of Object.entries(toolCategories)) {
		if (toolCategory === category) {
			result.push(toolName);
		}
	}

	return result;
}
