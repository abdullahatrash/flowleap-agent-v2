/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { IVSCodeExtensionContext } from '../../../platform/extContext/common/extensionContext';
import { ILogService } from '../../../platform/log/common/logService';
import { INotificationService } from '../../../platform/notification/common/notificationService';
import { createServiceIdentifier } from '../../../util/common/services';
import { CancellationToken } from '../../../util/vs/base/common/cancellation';
import { RunOnceScheduler } from '../../../util/vs/base/common/async';
import { Emitter, Event } from '../../../util/vs/base/common/event';
import { Disposable, IDisposable } from '../../../util/vs/base/common/lifecycle';
import { generateUuid } from '../../../util/vs/base/common/uuid';
import {
	ACTIVATION_CONSENT_STORAGE_KEY,
	ActivationConsentVerdict,
	ActivationEventBody,
	ActivationPlatform,
	ActivationTelemetryEvent,
	buildRequestBody,
	decideFromAnswer,
	decideFromStored,
	FREE_FORM_TEMPLATE_KIND,
	MAX_BATCH,
	reportedPlatform,
	reportedSkillId,
} from '../common/activationTelemetry';
import { getPatentAccessToken } from '../common/patentTokenRegistry';
import { IPatentBackendClient } from './patentBackendClient';

export const IActivationTelemetryService = createServiceIdentifier<IActivationTelemetryService>('IActivationTelemetryService');

/** The backend route, relative to the configured `/v1` base — spelled as every other tool spells it. */
const ACTIVATION_TELEMETRY_PATH = '/telemetry/activation';

/** Flush as soon as this many events are queued, without waiting out the debounce. */
const FLUSH_THRESHOLD = 20;

/** Quiet period after the last event before a partial batch goes out. */
const FLUSH_DEBOUNCE_MS = 15_000;

/**
 * The editor facts an activation event carries, behind a seam.
 *
 * Injected rather than read from the `vscode` namespace at the point of use so a test can drive
 * `isTelemetryEnabled` without stubbing a global — the production default reads the real thing.
 */
export interface IActivationTelemetryEnvironment {
	/** The app version stamped on every event. */
	readonly appVersion: string;
	readonly platform: ActivationPlatform;
	/** The editor's own telemetry switch (`telemetry.telemetryLevel`), read live. */
	isTelemetryEnabled(): boolean;
	/** Fires when that switch changes. */
	onDidChangeTelemetryEnabled(listener: (enabled: boolean) => void): IDisposable;
}

/**
 * The real environment. `vscode.env` is dereferenced lazily inside the accessors so importing this
 * module costs nothing and tests that inject a fake never touch the namespace.
 */
export function vscodeActivationTelemetryEnvironment(): IActivationTelemetryEnvironment {
	return {
		get appVersion(): string { return vscode.version; },
		get platform(): ActivationPlatform { return reportedPlatform(process.platform); },
		isTelemetryEnabled: () => vscode.env.isTelemetryEnabled,
		onDidChangeTelemetryEnabled: listener => vscode.env.onDidChangeTelemetryEnabled(listener),
	};
}

/**
 * The sink for FlowLeap's four activation counters (app launched, skill run completed, report
 * saved, keys added).
 *
 * Opt-in and content-free by construction: nothing is sent until the user answers the one-time
 * prompt with "Send counters", and the only values that can ever be sent are the four event names,
 * a bundled skill id (or the literal `custom`), a report template kind, and two presence booleans.
 *
 * The `record*` methods are synchronous, fire-and-forget, and never throw. A counter must not be
 * able to fail a skill run, a report save, or a sign-in — so every failure path in here ends in a
 * log line.
 */
export interface IActivationTelemetryService {
	readonly _serviceBrand: undefined;

	/** Fires when the verdict changes, so the Privacy settings row can refresh. */
	readonly onDidChangeVerdict: Event<void>;

	/** The remembered verdict, or undefined when undecided (the default — nothing is sent). */
	getVerdict(): ActivationConsentVerdict | undefined;

	/** Set or (with undefined) reset the verdict. Drives the Privacy settings row. */
	setVerdict(verdict: ActivationConsentVerdict | undefined): Promise<void>;

	/** Ask once, on first launch after sign-in. No-op when already decided. */
	promptOnce(): Promise<void>;

	/** The app started for a user who has been signed in at least once. */
	recordAppLaunched(): void;

	/** A Patent Skill finished. Only FlowLeap's own skill names are reported; see `reportedSkillId`. */
	recordSkillRunCompleted(skill: string): void;

	/** A report reached disk. Only the template kind is reported, never the path or the content. */
	recordReportSaved(templateKind: string): void;

	/** Patent-data keys went from absent to present. Presence booleans only, never key material. */
	recordKeysAdded(epo: boolean, uspto: boolean): void;
}

function isActivationConsentVerdict(value: unknown): value is ActivationConsentVerdict {
	return value === 'always' || value === 'never';
}

export class ActivationTelemetryService extends Disposable implements IActivationTelemetryService {
	readonly _serviceBrand: undefined;

	private readonly _onDidChangeVerdict = this._register(new Emitter<void>());
	readonly onDidChangeVerdict: Event<void> = this._onDidChangeVerdict.event;

	private readonly _queue: ActivationTelemetryEvent[] = [];

	private readonly _flushScheduler: RunOnceScheduler;

	/** A prompt currently on screen. Startup and a sign-in transition can both ask; both share one. */
	private _pendingPrompt: Promise<void> | undefined;

	constructor(
		private readonly _environment: IActivationTelemetryEnvironment = vscodeActivationTelemetryEnvironment(),
		@IVSCodeExtensionContext private readonly _context: IVSCodeExtensionContext,
		@IPatentBackendClient private readonly _backendClient: IPatentBackendClient,
		@INotificationService private readonly _notificationService: INotificationService,
		@ILogService private readonly _logService: ILogService,
	) {
		super();
		this._flushScheduler = this._register(new RunOnceScheduler(() => void this._flush(), FLUSH_DEBOUNCE_MS));
		// Turning the editor's telemetry off is an instruction about events already queued, not only
		// about future ones, so the queue goes with it.
		this._register(this._environment.onDidChangeTelemetryEnabled(enabled => {
			if (!enabled) {
				this._dropQueue('the editor telemetry setting was turned off');
			}
		}));
	}

	override dispose(): void {
		// Last chance for a partial batch: the window is closing, and the debounce will not fire.
		void this._flush();
		super.dispose();
	}

	getVerdict(): ActivationConsentVerdict | undefined {
		const stored = this._context.globalState.get<unknown>(ACTIVATION_CONSENT_STORAGE_KEY);
		// A hand-edited or stale globalState entry must not read as consent — anything unrecognised
		// falls back to undecided, which sends nothing.
		return isActivationConsentVerdict(stored) ? stored : undefined;
	}

	async setVerdict(verdict: ActivationConsentVerdict | undefined): Promise<void> {
		await this._context.globalState.update(ACTIVATION_CONSENT_STORAGE_KEY, verdict);
		this._logService.info(`[Patent AI] Activation counters set to '${verdict ?? 'ask'}'`);
		if (verdict !== 'always') {
			this._dropQueue(`the verdict became '${verdict ?? 'ask'}'`);
		}
		this._onDidChangeVerdict.fire();
	}

	async promptOnce(): Promise<void> {
		if (decideFromStored(this.getVerdict()) !== 'ask') {
			return;
		}
		if (this._pendingPrompt) {
			return this._pendingPrompt;
		}
		const prompt = this._prompt().finally(() => { this._pendingPrompt = undefined; });
		this._pendingPrompt = prompt;
		return prompt;
	}

	recordAppLaunched(): void {
		this._enqueue({ name: 'app_launched', props: {} });
	}

	recordSkillRunCompleted(skill: string): void {
		// Applied here as well as at the extraction seam: this is the last point before the value is
		// queued, and `reportedSkillId` is idempotent, so the boundary holds wherever a caller comes
		// from.
		this._enqueue({ name: 'skill_run_completed', props: { skillId: reportedSkillId(skill) } });
	}

	recordReportSaved(templateKind: string): void {
		this._enqueue({ name: 'report_saved', props: { templateKind: templateKind || FREE_FORM_TEMPLATE_KIND } });
	}

	recordKeysAdded(epo: boolean, uspto: boolean): void {
		this._enqueue({ name: 'keys_added', props: { epo, uspto } });
	}

	/**
	 * Ask, and persist whatever verdict the answer carries.
	 *
	 * Non-modal: this interrupts nothing (unlike the OCR gate, which blocks an operation the user
	 * asked for), and a modal dialog on first launch would be a poor greeting. The disclosure rides
	 * in the message rather than in `detail` because VS Code renders `detail` only for modal
	 * dialogs — a consent prompt whose disclosure the user cannot read is not consent.
	 */
	private async _prompt(): Promise<void> {
		// The copy lives here, inline, because `l10n.t()` extracts only literal arguments: a builder
		// in `common/` would keep the strings out of every translation bundle.
		const title = l10n.t('Help count what works?');
		const body = l10n.t('FlowLeap can send four counters: app launched, skill run completed (skill name only), report saved (template kind only), keys added (yes/no per office). Never a file, a query, a matter, or model output. You can change this any time in Settings › Privacy. See what leaves your machine: flowleap.co/data-handling');
		const sendAction = l10n.t('Send counters');
		const dontSendAction = l10n.t('Don\'t send');

		const answer = await this._notificationService.showInformationMessage(
			`${title} ${body}`,
			{ modal: false },
			sendAction, dontSendAction,
		);

		const outcome = decideFromAnswer(
			answer === sendAction ? 'always'
				: answer === dontSendAction ? 'never'
					: 'dismissed',
		);
		if (outcome.persist) {
			await this.setVerdict(outcome.persist);
		}
	}

	/**
	 * Stamp and queue one event, gated. Swallows everything: the callers are a tool result path, a
	 * file write and a sign-in, and none of them may fail over a counter.
	 */
	private _enqueue(body: ActivationEventBody): void {
		try {
			if (!this._isSendable()) {
				return;
			}
			this._queue.push({
				id: generateUuid(),
				at: new Date().toISOString(),
				appVersion: this._environment.appVersion,
				platform: this._environment.platform,
				...body,
			});
			if (this._queue.length > MAX_BATCH) {
				const dropped = this._queue.splice(0, this._queue.length - MAX_BATCH).length;
				this._logService.debug(`[Patent AI] Activation counters: dropped ${dropped} queued event(s) over the ${MAX_BATCH} cap`);
			}
			if (this._queue.length >= FLUSH_THRESHOLD) {
				this._flushScheduler.cancel();
				void this._flush();
				return;
			}
			this._flushScheduler.schedule();
		} catch (error) {
			this._logService.debug(`[Patent AI] Activation counters: could not queue an event: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	/**
	 * The gate, in order: the editor's telemetry switch, the user's verdict, then sign-in. Checked
	 * at enqueue time AND again at flush time, because all three can change while a batch waits.
	 *
	 * A signed-out event is DROPPED rather than held. Holding it would mean a user who signs in
	 * later silently ships counters from a session they were never asked about.
	 */
	private _isSendable(): boolean {
		if (!this._environment.isTelemetryEnabled()) {
			this._dropQueue('the editor telemetry setting is off');
			return false;
		}
		if (decideFromStored(this.getVerdict()) !== 'send') {
			return false;
		}
		if (!getPatentAccessToken()) {
			this._logService.debug('[Patent AI] Activation counters: dropping an event, not signed in');
			return false;
		}
		return true;
	}

	private _dropQueue(reason: string): void {
		if (this._queue.length > 0) {
			this._logService.debug(`[Patent AI] Activation counters: dropping ${this._queue.length} queued event(s) because ${reason}`);
			this._queue.length = 0;
		}
		this._flushScheduler.cancel();
	}

	/**
	 * Send what is queued. One attempt, never retried here: a lost counter is a lost counter, and
	 * the backend-client seam already absorbs the transient failures worth absorbing. Every failure
	 * is logged and swallowed — a telemetry error is never a notification.
	 */
	private async _flush(): Promise<void> {
		if (this._queue.length === 0) {
			return;
		}
		if (!this._isSendable()) {
			// Re-gated: a verdict or sign-in that changed under a waiting batch drops it.
			this._queue.length = 0;
			return;
		}
		const batch = this._queue.splice(0, MAX_BATCH);
		try {
			await this._backendClient.post<unknown>(ACTIVATION_TELEMETRY_PATH, buildRequestBody(batch), CancellationToken.None);
		} catch (error) {
			this._logService.debug(`[Patent AI] Activation counters: ${batch.length} event(s) not delivered: ${error instanceof Error ? error.message : String(error)}`);
		}
	}
}
