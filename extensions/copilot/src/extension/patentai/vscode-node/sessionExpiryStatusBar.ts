/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { ILogService } from '../../../platform/log/common/logService';
import { SessionExpiryDecision, decideSessionExpiry } from '../common/sessionExpiry';

/** The canonical FlowLeap sign-in command the nudge invokes on click (owned by the auth provider). */
const SIGN_IN_COMMAND = 'flowleap.signIn';

/** Re-check expiry roughly hourly; the nudge also refreshes on auth change and window focus. */
const DEFAULT_REFRESH_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Status-bar "FlowLeap session expires in N days" nudge (issue #121, P2). The 30-day session token
 * otherwise dies silently and the user discovers it via a random 401; this surfaces the last few days
 * (and the expired state) with a one-click path back into sign-in. Visible only when a signed-in
 * session has ≤3 days remaining — the pure {@link decideSessionExpiry} owns that rule; this class is
 * the vscode glue. No modal, no toast.
 *
 * It refreshes on FlowLeap auth-session changes, on window focus, and on an hourly timer. Expiry is
 * time-based (no event fires as the clock crosses it), so the timer/focus refreshes are what flip the
 * label from a countdown to "expired". Reading the expiry is synchronous and side-effect free.
 */
export class SessionExpiryStatusBar implements vscode.Disposable {

	private readonly _item: vscode.StatusBarItem;
	private readonly _disposables: vscode.Disposable[] = [];
	private readonly _now: () => number;
	private readonly _refreshIntervalMs: number;
	private _interval: ReturnType<typeof setInterval> | undefined;

	constructor(
		private readonly _getExpiry: () => number | undefined,
		onDidChangeSessions: vscode.Event<unknown>,
		private readonly _logService: ILogService,
		options?: { now?: () => number; refreshIntervalMs?: number },
	) {
		this._now = options?.now ?? Date.now;
		this._refreshIntervalMs = options?.refreshIntervalMs ?? DEFAULT_REFRESH_INTERVAL_MS;

		this._item = vscode.window.createStatusBarItem('flowleap.sessionExpiry', vscode.StatusBarAlignment.Right, 99);
		this._item.name = l10n.t('FlowLeap Session');
		// Click routes straight into the existing sign-in flow, which mints a fresh token and clears the nudge.
		this._item.command = SIGN_IN_COMMAND;
		this._disposables.push(this._item);

		// Refresh triggers: auth session changes (sign-in/out), window focus, and an hourly timer.
		this._disposables.push(onDidChangeSessions(() => this._render()));
		this._disposables.push(vscode.window.onDidChangeWindowState(state => {
			if (state.focused) {
				this._render();
			}
		}));
		this._interval = setInterval(() => this._render(), this._refreshIntervalMs);

		// Initial paint.
		this._render();
	}

	/** Force a re-read now (e.g. after sign-in completes elsewhere). Public for callers/tests. */
	refresh(): void {
		this._render();
	}

	private _render(): void {
		let decision: SessionExpiryDecision;
		try {
			decision = decideSessionExpiry(this._getExpiry(), this._now());
		} catch (error) {
			// A failed read must not leave a stale nudge showing.
			this._logService.warn(`[Patent AI] Session-expiry nudge: read failed: ${error}`);
			this._item.hide();
			return;
		}

		if (!decision.visible) {
			this._item.hide();
			return;
		}

		if (decision.expired) {
			this._item.text = `$(warning) ${l10n.t('FlowLeap session expired — sign in')}`;
			this._item.tooltip = l10n.t('Your FlowLeap session has expired. Click to sign in again.');
			this._item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
		} else {
			this._item.text = `$(key) ${this._expiryLabel(decision.daysRemaining)}`;
			this._item.tooltip = this._expiryTooltip(decision.daysRemaining);
			this._item.backgroundColor = undefined;
		}
		this._item.show();
	}

	private _expiryLabel(daysRemaining: number): string {
		if (daysRemaining === 1) {
			return l10n.t('FlowLeap session expires in 1 day');
		}
		return l10n.t('FlowLeap session expires in {0} days', daysRemaining);
	}

	private _expiryTooltip(daysRemaining: number): string {
		if (daysRemaining === 1) {
			return l10n.t('Your FlowLeap session expires in 1 day. Click to sign in again and refresh it.');
		}
		return l10n.t('Your FlowLeap session expires in {0} days. Click to sign in again and refresh it.', daysRemaining);
	}

	dispose(): void {
		if (this._interval) {
			clearInterval(this._interval);
			this._interval = undefined;
		}
		for (const d of this._disposables) {
			d.dispose();
		}
		this._disposables.length = 0;
	}
}
