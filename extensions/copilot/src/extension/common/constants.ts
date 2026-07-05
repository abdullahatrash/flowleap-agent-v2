/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ChatLocation } from '../../platform/chat/common/commonTypes';

export const enum Intent {
	Explain = 'explain',
	Fix = 'fix',
	New = 'new',
	notebookEditor = 'notebookEditor',
	InlineChat = 'inlineChat',
	SemanticSearch = 'semanticSearch',
	Terminal = 'terminal',
	Unknown = 'unknown',
	Editor = 'editor',
	Doc = 'doc',
	Edit = 'edit',
	Agent = 'editAgent',
	Generate = 'generate',
	AskAgent = 'askAgent',
}

export const GITHUB_PLATFORM_AGENT = 'github.copilot-dynamic.platform';

// TODO@jrieken THIS IS WEIRD. We should read this from package.json
export const agentsToCommands: Partial<Record<Intent, Record<string, Intent>>> = {
	[Intent.Agent]: {
		'edit': Intent.Edit,
		'semanticSearch': Intent.SemanticSearch,
		'compact': Intent.Agent,
	},
	[Intent.Editor]: {
		'doc': Intent.Doc,
		'edit': Intent.Edit,
	}
};

// TODO@roblourens gotta tighten up the terminology of "commands", "intents", etc...
export function getAgentForIntent(intentId: Intent, location: ChatLocation): { agent: string; command?: string } | undefined {
	if (Object.keys(agentsToCommands).includes(intentId)) {
		return { agent: intentId };
	}

	for (const [agent, commands] of Object.entries(agentsToCommands)) {
		if (location === ChatLocation.Editor && agent !== Intent.Editor) {
			continue;
		}

		if (Object.values(commands).includes(intentId)) {
			return { agent, command: intentId };
		}
	}
}

export const EXTENSION_ID = 'flowleap.patent-ai';
