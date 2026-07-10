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
					You have access to patent search tools (EPO, USPTO) and academic search tools. Use query builder tools to construct optimized queries before searching.<br />
					<br />
					Search strategy:<br />
					1. Build optimized CQL queries using the query builder tools<br />
					2. Search EPO patents via search_patents tool<br />
					3. Search academic sources via search_academic tool<br />
					4. When the user has attached or referenced a local PDF file, read it with the read_pdf tool for deeper analysis (read_pdf only accepts a local file path — it cannot fetch remote URLs)<br />
					5. ALWAYS search both patents AND academic sources<br />
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
					Key findings and relevance assessment.<br />
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
						Your allotted iterations are finished — you must produce your patent research findings now, starting and ending with &lt;patent_results&gt;.
					</UserMessage>
				)}
			</>
		);
	}
}
