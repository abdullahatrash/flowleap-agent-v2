/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { CommandsRegistry, ICommandService } from '../../../../platform/commands/common/commands.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';

/**
 * Command backing the "Search Prior Art..." entry on the patent getting-started walkthrough.
 *
 * The walkthrough contributes the entry by command URI (`command:flowleap.searchPriorArt`), so it
 * needs a registered command to invoke. This opens the panel chat pre-seeded with a prior-art prompt
 * the user can complete, rather than routing through a patent-project concept that does not yet exist
 * (per PRD 0006 the "New/Open Patent Project" entries are out of scope and were removed).
 *
 * The seed is sent as a partial query so the chat input is focused with the prompt filled in and the
 * user finishes describing the invention before sending.
 */
CommandsRegistry.registerCommand('flowleap.searchPriorArt', async (accessor: ServicesAccessor) => {
	const commandService = accessor.get(ICommandService);
	await commandService.executeCommand('workbench.action.chat.open', {
		query: localize('flowleap.searchPriorArt.seededPrompt', "Search prior art for "),
		isPartialQuery: true,
	});
});
