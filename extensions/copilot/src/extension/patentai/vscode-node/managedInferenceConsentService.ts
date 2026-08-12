/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IVSCodeExtensionContext } from '../../../platform/extContext/common/extensionContext';
import { ILogService } from '../../../platform/log/common/logService';
import { INotificationService } from '../../../platform/notification/common/notificationService';
import { createServiceIdentifier } from '../../../util/common/services';
import { Emitter, Event } from '../../../util/vs/base/common/event';
import {
	ConsentVerdict,
	decideFromAnswer,
	decideFromStored,
	getManagedInferenceSubject,
	ManagedInferenceSubject,
	ManagedInferenceSubjectId,
} from '../common/managedInferenceConsent';

export const IManagedInferenceConsentService = createServiceIdentifier<IManagedInferenceConsentService>('IManagedInferenceConsentService');

/**
 * The single authority on whether user content may be sent to FlowLeap-Managed Inference (#213).
 *
 * Deliberately NOT built on the chat tool-confirmation affordance. A session on blanket
 * auto-approve skips tool confirmations before a tool's own confirmation is consulted, and the
 * core "cannot be auto-approved" list is not honored for local panel sessions — so a gate living
 * there would be defeated by a permission mode the user turned on to speed up file edits. This
 * service is consulted inside the operation instead, which holds under every permission mode and
 * for both entry points (the gated tools, and the PDF viewer via the consent command).
 */
export interface IManagedInferenceConsentService {
	readonly _serviceBrand: undefined;

	/** Fires when any verdict changes, so the Privacy settings section can refresh. */
	readonly onDidChangeVerdicts: Event<void>;

	/**
	 * Whether this call may transmit content for `subjectId`. Prompts the user when the subject is
	 * undecided, and resolves false for an unrecognised subject. Concurrent calls for one
	 * undecided subject share a single prompt.
	 */
	requestConsent(subjectId: string): Promise<boolean>;

	/** The remembered verdict, or undefined when the subject is undecided. */
	getVerdict(subjectId: ManagedInferenceSubjectId): ConsentVerdict | undefined;

	/** Set or (with undefined) reset a verdict. Drives the Privacy settings section. */
	setVerdict(subjectId: ManagedInferenceSubjectId, verdict: ConsentVerdict | undefined): Promise<void>;
}

/** globalState key. Global rather than workspace-scoped: a privacy posture belongs to the person. */
const CONSENT_STORAGE_KEY = 'flowleap.managedInferenceConsent';

const ONCE_ACTION = 'Once';
const ALWAYS_ACTION = 'Always';
const NEVER_ACTION = 'Never';

/** The persisted shape: subject id → verdict. Absent entries are undecided. */
type StoredVerdicts = Partial<Record<ManagedInferenceSubjectId, ConsentVerdict>>;

function isConsentVerdict(value: unknown): value is ConsentVerdict {
	return value === 'always' || value === 'never';
}

export class ManagedInferenceConsentService implements IManagedInferenceConsentService {
	readonly _serviceBrand: undefined;

	private readonly _onDidChangeVerdicts = new Emitter<void>();
	readonly onDidChangeVerdicts: Event<void> = this._onDidChangeVerdicts.event;

	/**
	 * Prompts currently on screen, keyed by subject. An agent turn can call a gated tool twice
	 * before the first resolves; both must resolve against one prompt rather than stacking dialogs.
	 */
	private readonly _pending = new Map<ManagedInferenceSubjectId, Promise<boolean>>();

	constructor(
		@IVSCodeExtensionContext private readonly _context: IVSCodeExtensionContext,
		@INotificationService private readonly _notificationService: INotificationService,
		@ILogService private readonly _logService: ILogService,
	) { }

	async requestConsent(subjectId: string): Promise<boolean> {
		const subject = getManagedInferenceSubject(subjectId);
		if (!subject) {
			// The id arrives as a string from the consent command, so an unknown value is possible.
			// Fail closed: never transmit for a capability whose disclosure we cannot state.
			this._logService.warn(`[Patent AI] Consent requested for unknown managed-inference subject '${subjectId}' — refusing`);
			return false;
		}

		const step = decideFromStored(this.getVerdict(subject.id));
		if (step !== 'ask') {
			return step === 'proceed';
		}

		const pending = this._pending.get(subject.id);
		if (pending) {
			return pending;
		}

		const prompt = this._prompt(subject).finally(() => this._pending.delete(subject.id));
		this._pending.set(subject.id, prompt);
		return prompt;
	}

	getVerdict(subjectId: ManagedInferenceSubjectId): ConsentVerdict | undefined {
		const stored = this._read()[subjectId];
		// A hand-edited or stale globalState entry must not be read as a verdict — an
		// unrecognised value falls back to undecided, which prompts rather than assuming.
		return isConsentVerdict(stored) ? stored : undefined;
	}

	async setVerdict(subjectId: ManagedInferenceSubjectId, verdict: ConsentVerdict | undefined): Promise<void> {
		const verdicts = { ...this._read() };
		if (verdict) {
			verdicts[subjectId] = verdict;
		} else {
			delete verdicts[subjectId];
		}
		await this._context.globalState.update(CONSENT_STORAGE_KEY, verdicts);
		this._logService.info(`[Patent AI] Managed-inference consent for '${subjectId}' set to '${verdict ?? 'ask'}'`);
		this._onDidChangeVerdicts.fire();
	}

	/** Ask the user, persist any verdict the answer carries, and report whether to proceed. */
	private async _prompt(subject: ManagedInferenceSubject): Promise<boolean> {
		const answer = await this._notificationService.showInformationMessage(
			`${subject.displayName} sends ${subject.sends} to FlowLeap, where ${subject.processor} processes it.`,
			{
				modal: true,
				detail: `This is not your own model key — FlowLeap processes it on its own account, and the result is ${subject.retention}.`
					+ '\n\nYou can change this later in FlowLeap Settings under Privacy.',
			},
			ONCE_ACTION, ALWAYS_ACTION, NEVER_ACTION,
		);

		const outcome = decideFromAnswer(
			answer === ONCE_ACTION ? 'once'
				: answer === ALWAYS_ACTION ? 'always'
					: answer === NEVER_ACTION ? 'never'
						: 'dismissed',
		);

		if (outcome.persist) {
			await this.setVerdict(subject.id, outcome.persist);
		}
		return outcome.proceed;
	}

	private _read(): StoredVerdicts {
		return this._context.globalState.get<StoredVerdicts>(CONSENT_STORAGE_KEY) ?? {};
	}
}
