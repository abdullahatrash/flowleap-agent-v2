/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { ILogService } from '../../../platform/log/common/logService';
import { FlowLeapSubscriptionSnapshot, TrialPillDecision, decideTrialPill } from '../common/trialCountdown';
import { SETUP_VIEW_ID } from './patentSetupView';

/** Command that reveals the FlowLeap Setup tree; auto-registered by core for the contributed view. */
const FOCUS_SETUP_COMMAND = `${SETUP_VIEW_ID}.focus`;

/** Internal command the pill invokes: records the click, then focuses the Setup surface. */
const PILL_CLICK_COMMAND = 'flowleap.trialCountdown.focusSetup';

/** Re-check the subscription roughly hourly; the pill also refreshes on auth change and window focus. */
const DEFAULT_REFRESH_INTERVAL_MS = 60 * 60 * 1000;

/**
 * The trialing tooltip: the deadline line, then the ADR 0015 credential disclosure (required
 * copy, #243) — both deadlines named plainly: trial models AND patent data run on FlowLeap's
 * credentials, trial inference runs on FlowLeap-supplied models via OpenRouter, and the user can
 * switch to their own key at any time. Exported pure so the copy is unit-tested without vscode.
 */
export function trialPillTooltip(daysRemaining: number | null): string {
	let deadline: string;
	if (daysRemaining === null) {
		deadline = l10n.t('Your FlowLeap trial is active.');
	} else if (daysRemaining <= 0) {
		deadline = l10n.t('Your FlowLeap trial ends today.');
	} else if (daysRemaining === 1) {
		deadline = l10n.t('Your FlowLeap trial ends in 1 day.');
	} else {
		deadline = l10n.t('Your FlowLeap trial ends in {0} days.', daysRemaining);
	}
	const disclosure = l10n.t('During the trial, your trial models and patent data both run on FlowLeap\'s credentials: chat uses FlowLeap-supplied trial models via OpenRouter, and you can switch to your own key at any time. Add your own LLM API key and your EPO/USPTO data keys before the trial ends.');
	return `${deadline}\n\n${disclosure}\n\n${l10n.t('Click to review your setup.')}`;
}

/** Telemetry sink for the pill's two funnel signals. Injected so it can be a no-op / fake in tests. */
export interface TrialPillTelemetry {
	/** Fired at most once per session, the first time the pill becomes visible. */
	pillShown(daysRemaining: number | null): void;
	/** Fired each time the user clicks the pill. */
	pillClicked(): void;
}

/**
 * Status-bar "Trial · N days left" pill (issue #79, P2). Visible only while the subscription is
 * `trialing`; hidden for paid, no-subscription, signed-out, and inconclusive states — the pure
 * {@link decideTrialPill} owns that rule. Clicking it reveals the FlowLeap Setup surface so the
 * trial user lands on the checklist that turns the trial into a configured install.
 *
 * It refreshes on FlowLeap auth-session changes, on window focus, and on an hourly timer (no
 * aggressive polling). The day-count and visibility logic are extracted pure in
 * `common/trialCountdown.ts`; this class is the vscode glue that renders the decision.
 */
export class TrialCountdownStatusBar implements vscode.Disposable {

	private readonly _item: vscode.StatusBarItem;
	private readonly _disposables: vscode.Disposable[] = [];
	private readonly _now: () => number;
	private readonly _refreshIntervalMs: number;
	private _interval: ReturnType<typeof setInterval> | undefined;

	// Guards against overlapping async refreshes racing to set the item's text.
	private _refreshInFlight = false;
	private _refreshQueued = false;

	// "Shown" telemetry is a once-per-session signal; latch it so a hide/show cycle doesn't re-fire.
	private _shownReported = false;

	constructor(
		private readonly _getSnapshot: () => Promise<FlowLeapSubscriptionSnapshot>,
		onDidChangeSessions: vscode.Event<unknown>,
		private readonly _telemetry: TrialPillTelemetry,
		private readonly _logService: ILogService,
		options?: { now?: () => number; refreshIntervalMs?: number },
	) {
		this._now = options?.now ?? Date.now;
		this._refreshIntervalMs = options?.refreshIntervalMs ?? DEFAULT_REFRESH_INTERVAL_MS;

		this._item = vscode.window.createStatusBarItem('flowleap.trialCountdown', vscode.StatusBarAlignment.Right, 100);
		this._item.name = 'FlowLeap Trial';
		this._item.command = PILL_CLICK_COMMAND;
		this._disposables.push(this._item);

		// The click routes through our command so we can record it before revealing the Setup view.
		this._disposables.push(vscode.commands.registerCommand(PILL_CLICK_COMMAND, async () => {
			this._telemetry.pillClicked();
			try {
				await vscode.commands.executeCommand(FOCUS_SETUP_COMMAND);
			} catch (error) {
				this._logService.warn(`[Patent AI] Trial pill: could not focus Setup view: ${error}`);
			}
		}));

		// Refresh triggers: auth session changes, window focus, and an hourly timer.
		this._disposables.push(onDidChangeSessions(() => this._scheduleRefresh()));
		this._disposables.push(vscode.window.onDidChangeWindowState(state => {
			if (state.focused) {
				this._scheduleRefresh();
			}
		}));
		this._interval = setInterval(() => this._scheduleRefresh(), this._refreshIntervalMs);

		// Initial paint.
		this._scheduleRefresh();
	}

	/** Force a re-read now (e.g. after sign-in completes elsewhere). Public for callers/tests. */
	refresh(): void {
		this._scheduleRefresh();
	}

	private _scheduleRefresh(): void {
		// Coalesce: if a refresh is running, mark that one more is wanted and let the current finish.
		if (this._refreshInFlight) {
			this._refreshQueued = true;
			return;
		}
		void this._runRefresh();
	}

	private async _runRefresh(): Promise<void> {
		this._refreshInFlight = true;
		try {
			const snapshot = await this._getSnapshot();
			this._render(decideTrialPill(snapshot, this._now()));
		} catch (error) {
			// A failed read must not leave a stale count showing; treat it as "no trial to show".
			this._logService.warn(`[Patent AI] Trial pill: subscription read failed: ${error}`);
			this._item.hide();
		} finally {
			this._refreshInFlight = false;
			if (this._refreshQueued) {
				this._refreshQueued = false;
				void this._runRefresh();
			}
		}
	}

	private _render(decision: TrialPillDecision): void {
		if (!decision.visible) {
			this._item.hide();
			return;
		}

		this._item.text = `$(watch) ${this._pillLabel(decision.daysRemaining)}`;
		this._item.tooltip = trialPillTooltip(decision.daysRemaining);
		this._item.show();

		if (!this._shownReported) {
			this._shownReported = true;
			this._telemetry.pillShown(decision.daysRemaining);
		}
	}

	private _pillLabel(daysRemaining: number | null): string {
		if (daysRemaining === null) {
			return l10n.t('Trial');
		}
		if (daysRemaining <= 0) {
			return l10n.t('Trial · Ends today');
		}
		if (daysRemaining === 1) {
			return l10n.t('Trial · 1 day left');
		}
		return l10n.t('Trial · {0} days left', daysRemaining);
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
