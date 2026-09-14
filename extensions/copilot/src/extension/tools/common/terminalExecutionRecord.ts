/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { getToolName, ToolName } from './toolNames';

/** What the patent execution audit keeps of one terminal run: the command and what it printed. */
export interface TerminalExecutionRecord {
	readonly kind: 'analytics';
	readonly status: 'succeeded' | 'failed';
	readonly tool: 'run_in_terminal';
	/** The command as the model wrote it. */
	readonly request: string;
	/** The text the tool returned, which is the command's output as the model saw it. */
	readonly resultText?: string;
}

/**
 * The audit record for a tool call, when the call ran a terminal command; `undefined` for every
 * other tool. A figure the model computes with its own script — a share counted over a dataset it
 * downloaded, a total it summed in Python — reaches the report only through the terminal, and a
 * provenance check that never saw the terminal's output reports that figure as unsourced.
 *
 * The result is read structurally: every part with a string `value` is output text. That keeps
 * this module free of the editor API, and the tool's own text parts are exactly those.
 */
export function terminalExecutionRecord(name: string, input: unknown, content: readonly unknown[] | undefined, failed = false): TerminalExecutionRecord | undefined {
	if (getToolName(name) !== ToolName.CoreRunInTerminal) {
		return undefined;
	}
	const command = typeof input === 'object' && input !== null && typeof (input as { command?: unknown }).command === 'string'
		? (input as { command: string }).command
		: '';
	if (!command.trim()) {
		return undefined;
	}
	if (failed) {
		return { kind: 'analytics', status: 'failed', tool: 'run_in_terminal', request: command };
	}
	const output = (content ?? [])
		.map(part => typeof part === 'object' && part !== null && typeof (part as { value?: unknown }).value === 'string' ? (part as { value: string }).value : '')
		.filter(Boolean)
		.join('\n');
	return { kind: 'analytics', status: 'succeeded', tool: 'run_in_terminal', request: command, resultText: output };
}
