/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { PromptElement, PromptSizing, SystemMessage, UserMessage } from '@vscode/prompt-tsx';
import { GenericBasePromptElementProps } from '../../../context/node/resolvers/genericPanelIntentInvocation';
import { CopilotToolMode } from '../../../tools/common/toolsRegistry';
import { ChatToolCalls } from '../panel/toolCalling';

export interface PatentSearchSubagentPromptProps extends GenericBasePromptElementProps {
	readonly maxSearchTurns: number;
}

/**
 * Prompt for the patent search subagent.
 * Instructs the subagent to search patent databases and academic sources,
 * returning structured patent results.
 */
export class PatentSearchSubagentPrompt extends PromptElement<PatentSearchSubagentPromptProps> {
	async render(_state: void, _sizing: PromptSizing) {
		const { conversation, toolCallRounds, toolCallResults } = this.props.promptContext;

		const searchInstruction = conversation?.turns[0]?.request.message;

		const currentTurn = toolCallRounds?.length ?? 0;
		const isLastTurn = currentTurn >= this.props.maxSearchTurns - 1;

		return (
			<>
				<SystemMessage priority={1000}>
					You are a patent research assistant that uses search tools to find relevant patents and academic literature.<br />
					<br />
					You have access to patent search tools (EPO, USPTO) and academic search tools. Construct queries using the patent-search skill and available search syntax guide.<br />
					<br />
					Search strategy:<br />
					1. Identify essential features, optional embodiments, required combinations and unresolved tracks; construct a targeted CQL query.<br />
					2. Search EPO patents via search_patents tool<br />
					3. Search academic sources via search_academic tool<br />
					4. Use disclosure content and figure evidence actually supplied in your context. When native PDF content or page images are available, inspect them directly. If PDF text is missing or an exact passage needs extraction, use read_pdf with a local file path (it cannot fetch remote URLs). Text extraction alone does not establish that figures were inspected; report missing visual evidence or document-loading failures before relying on that content.<br />
					5. Cover patent and non-patent sources as required by the task; disclose unavailable sources. Target each new query at a gap. When results repeat known documents, synthesize coverage or explain the new track; no universal query count establishes completion.<br />
					<br />
					Once you have thoroughly searched, return a message with ONLY: the &lt;patent_results&gt; tag containing your structured findings.<br />
					<br />
					Example:<br />
					&lt;patent_results&gt;<br />
					## Patents Found<br />
					- EP1234567 - "Title" - Assignee - Highly relevant because...<br />
					- US10123456 - "Title" - Assignee - Relevant because...<br />
					<br />
					## Academic Literature<br />
					- "Paper Title" (2023) - Key finding relevant to...<br />
					<br />
					## Summary<br />
					Key findings, source anchors, essential/optional feature and combination coverage, unresolved gaps, search stopping rationale, and evidence limitations. Retrieval is not passage review. Preserve qualifiers, dependent-claim scope, units and denominators; distinguish candidate relevance from a formal patentability opinion.<br />
					&lt;/patent_results&gt;
				</SystemMessage>
				<UserMessage priority={900}>{searchInstruction}</UserMessage>
				<ChatToolCalls
					priority={899}
					flexGrow={2}
					promptContext={this.props.promptContext}
					toolCallRounds={toolCallRounds}
					toolCallResults={toolCallResults}
					toolCallMode={CopilotToolMode.FullContext}
				/>
				{isLastTurn && (
					<UserMessage priority={900}>
						Your allotted iterations are finished. Disclose any unresolved coverage and that the iteration budget, rather than demonstrated search completeness, ended this run. Produce your patent research findings now, starting and ending with &lt;patent_results&gt;.
					</UserMessage>
				)}
			</>
		);
	}
}
