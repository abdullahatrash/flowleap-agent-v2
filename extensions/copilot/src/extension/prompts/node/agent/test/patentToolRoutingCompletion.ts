/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** A saved report or tool-turn commentary cannot substitute for a terminal model response. */
export function completedEvaluationText(message: { content?: string | null; tool_calls?: readonly unknown[] } | undefined): string {
	if (!message || message.tool_calls?.length) {
		throw new Error('Live evaluation exhausted its round budget without a terminal response.');
	}
	if (!message.content?.trim()) {
		throw new Error('Live evaluation ended with an empty terminal response.');
	}
	return message.content;
}
