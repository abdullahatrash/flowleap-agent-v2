/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../../nls.js';
import { ChatModeKind } from '../constants.js';

/**
 * Returns the patent-voice chat input placeholder for the given mode when Patent IDE mode is
 * enabled, or `undefined` to fall back to the upstream mode description. Mirrors the per-mode
 * welcome-title override in `ChatWidget` so the input strip speaks the same voice.
 *
 * @param modeKind The kind of the currently active chat mode.
 * @param isPatentMode Whether Patent IDE mode is enabled (from the `patentIdeMode` context key).
 */
export function getPatentModeInputPlaceholder(modeKind: ChatModeKind, isPatentMode: boolean): string | undefined {
	if (!isPatentMode) {
		return undefined;
	}
	switch (modeKind) {
		case ChatModeKind.Ask:
			return localize('patentChatInputPlaceholder.ask', "Ask about patents, claims, or prior art");
		case ChatModeKind.Edit:
			return localize('patentChatInputPlaceholder.edit', "Describe the document changes to make");
		default:
			return localize('patentChatInputPlaceholder.agent', "Describe a patent research task");
	}
}
