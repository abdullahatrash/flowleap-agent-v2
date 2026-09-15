/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { reportedSkillId } from '../../patentai/common/activationTelemetry';
import { getToolName, ToolName } from './toolNames';

/**
 * The activation counter for a tool call, when the call ran a Patent Skill; `undefined` for every
 * other tool and for a skill invocation that carries no name.
 *
 * Returns the REPORTED id — a name FlowLeap itself ships, or the literal `custom` — so the privacy
 * boundary is applied at the point of extraction rather than somewhere downstream. Kept free of the
 * editor API, like `terminalExecutionRecord` beside it, so the mapping is testable on its own.
 */
export function skillRunRecord(name: string, input: unknown): string | undefined {
	if (getToolName(name) !== ToolName.Skill) {
		return undefined;
	}
	const skill = typeof input === 'object' && input !== null && typeof (input as { skill?: unknown }).skill === 'string'
		? (input as { skill: string }).skill
		: '';
	if (!skill.trim()) {
		return undefined;
	}
	return reportedSkillId(skill);
}
