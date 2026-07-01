/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Shared handling for a BYOK provider rejecting the user's API key.
 *
 * Inference is BYOK-only (ADR 0004), so a rejected key is a first-class user state, not a
 * server hiccup — yet the provider SDKs surface it as an untyped error string. This module
 * centralises (a) recognising those strings across the Anthropic/Gemini/OpenAI-compatible
 * error shapes and (b) the "update your key" UX, so the model-listing path (silent, key
 * silently absent from the picker) and the mid-turn path (raw SDK dump in chat) both resolve
 * to the same actionable prompt.
 */

import * as vscode from 'vscode';

const MANAGE_MODELS_COMMAND = 'workbench.action.chat.manage';
const UPDATE_KEY_ACTION = 'Manage Models';

/**
 * Message-shape heuristics for "the provider rejected this API key". There is no typed error
 * across the LM-provider boundary (core collapses provider throws to strings), so matching the
 * known SDK message shapes is the only cross-vendor signal:
 *  - OpenAI-compatible via chatMLFetcher: `token expired or invalid: 401` / `Incorrect API key provided`
 *  - Anthropic SDK: `401 {"type":"error","error":{"type":"authentication_error",…}}`
 *  - Gemini: `API key not valid. Please pass a valid API key.`
 */
const KEY_REJECTION_RE = /\b40[13]\b|unauthorized|authentication[\s_-]?error|incorrect api key|invalid[\s_-]*(?:api[\s_-]*)?key|api key not valid|invalid x-api-key|token expired or invalid|permission[\s_-]?denied/i;

export function looksLikeByokKeyRejection(message: string): boolean {
	return KEY_REJECTION_RE.test(message);
}

/**
 * The mid-turn replacement for a raw provider auth error. The `command:` link is clickable in
 * the chat error renderer (which trusts exactly the manage-models command) and still reads
 * sensibly as plain text elsewhere.
 */
export function byokKeyRejectionReason(providerName: string, detail: string): string {
	const firstLine = detail.split('\n', 1)[0];
	const truncated = firstLine.length > 200 ? firstLine.substring(0, 200) + '…' : firstLine;
	return `Your ${providerName} API key was rejected by the provider (${truncated}). Update the key, then retry: [${UPDATE_KEY_ACTION}](command:${MANAGE_MODELS_COMMAND})`;
}

export interface IByokKeyRejectionNotifierDeps {
	showWarningMessage(message: string, ...items: string[]): Thenable<string | undefined>;
	executeCommand(command: string): Thenable<unknown>;
	now(): number;
}

/** Re-notify for the same provider at most once per interval — listing retries and multi-call turns would otherwise stack toasts. */
const RENOTIFY_INTERVAL_MS = 60_000;

/**
 * Shows the "API key rejected → Manage Models" warning toast, debounced per provider.
 * Dependencies are injected so tests never stub globals; production uses {@link notifyByokKeyRejected}.
 */
export class ByokKeyRejectionNotifier {
	private readonly _lastNotified = new Map<string, number>();

	constructor(private readonly _deps: IByokKeyRejectionNotifierDeps) { }

	/** Fire-and-forget: a failing prompt must never mask the underlying provider error. */
	notify(providerName: string): void {
		const now = this._deps.now();
		const last = this._lastNotified.get(providerName);
		if (last !== undefined && now - last < RENOTIFY_INTERVAL_MS) {
			return;
		}
		this._lastNotified.set(providerName, now);
		Promise.resolve(this._deps.showWarningMessage(
			`Your ${providerName} API key was rejected by the provider. Update it in Manage Language Models.`,
			UPDATE_KEY_ACTION
		)).then(choice => {
			if (choice === UPDATE_KEY_ACTION) {
				return this._deps.executeCommand(MANAGE_MODELS_COMMAND);
			}
			return undefined;
		}).then(undefined, () => undefined);
	}
}

let defaultNotifier: ByokKeyRejectionNotifier | undefined;

/** Production entry point: notify with the real VS Code window/commands (constructed lazily so importing this module has no vscode side effects). */
export function notifyByokKeyRejected(providerName: string): void {
	defaultNotifier ??= new ByokKeyRejectionNotifier({
		showWarningMessage: (message, ...items) => vscode.window.showWarningMessage(message, ...items),
		executeCommand: command => vscode.commands.executeCommand(command),
		now: () => Date.now(),
	});
	defaultNotifier.notify(providerName);
}
