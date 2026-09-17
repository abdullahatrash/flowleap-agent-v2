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

const OPEN_SETTINGS_COMMAND = 'workbench.action.openSettings';
const OPEN_SETTINGS_ACTION = 'Open Settings';
const DATA_REGION_SETTING = 'patent.openRouter.dataRegion';

/**
 * A data-region guardrail refuses the request on the wrong host, before inference, and it does it
 * with a 403 — indistinguishable from a bad key by status alone. Telling the two apart matters:
 * the key is fine here, the host is wrong, and sending the user to re-enter a working key wastes
 * their time. Only the provider naming a region or a guardrail is treated as that case, so an
 * ordinary 403 still reads as a key rejection.
 */
const DATA_REGION_HINT_RE = /data[\s_-]?regions?|allowed[\s_-]?data[\s_-]?regions|guardrail/i;

export function looksLikeDataRegionRejection(message: string): boolean {
	return /\b403\b|forbidden/i.test(message) && DATA_REGION_HINT_RE.test(message);
}

/** The mid-turn replacement for a data-region refusal: names the setting that actually fixes it. */
export function dataRegionRejectionReason(providerName: string, detail: string): string {
	const firstLine = detail.split('\n', 1)[0];
	const truncated = firstLine.length > 200 ? firstLine.substring(0, 200) + '\u2026' : firstLine;
	return `${providerName} refused this request because the key is restricted to a data region (${truncated}). Your key is fine \u2014 the request went to the wrong host. Set \`${DATA_REGION_SETTING}\` to the matching region, then retry.`;
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
	executeCommand(command: string, ...args: readonly unknown[]): Thenable<unknown>;
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

	/**
	 * Fire-and-forget: a failing prompt must never mask the underlying provider error.
	 *
	 * `detail` is the provider's own message, when the caller has it. A data-region refusal hides
	 * inside the same 403 as a bad key, so without it the user is sent to replace a key that works.
	 */
	notify(providerName: string, detail?: string): void {
		const now = this._deps.now();
		const last = this._lastNotified.get(providerName);
		if (last !== undefined && now - last < RENOTIFY_INTERVAL_MS) {
			return;
		}
		this._lastNotified.set(providerName, now);

		const isDataRegion = detail !== undefined && looksLikeDataRegionRejection(detail);
		const message = isDataRegion
			? `${providerName} refused the request because the key is restricted to a data region. Your key is fine — the request went to the wrong host. Change the region in Settings.`
			: `Your ${providerName} API key was rejected by the provider. Update it in Manage Language Models.`;
		const action = isDataRegion ? OPEN_SETTINGS_ACTION : UPDATE_KEY_ACTION;

		Promise.resolve(this._deps.showWarningMessage(message, action)).then(choice => {
			if (choice !== action) {
				return undefined;
			}
			return isDataRegion
				? this._deps.executeCommand(OPEN_SETTINGS_COMMAND, DATA_REGION_SETTING)
				: this._deps.executeCommand(MANAGE_MODELS_COMMAND);
		}).then(undefined, () => undefined);
	}
}

let defaultNotifier: ByokKeyRejectionNotifier | undefined;

/** Production entry point: notify with the real VS Code window/commands (constructed lazily so importing this module has no vscode side effects). */
export function notifyByokKeyRejected(providerName: string, detail?: string): void {
	defaultNotifier ??= new ByokKeyRejectionNotifier({
		showWarningMessage: (message, ...items) => vscode.window.showWarningMessage(message, ...items),
		executeCommand: (command, ...args) => vscode.commands.executeCommand(command, ...args),
		now: () => Date.now(),
	});
	defaultNotifier.notify(providerName, detail);
}
