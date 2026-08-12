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
	buildConsentPrompt,
	buildRefusalMessage,
	ConsentVerdict,
	decideFromAnswer,
	decideFromStored,
	OCR_CONSENT_STORAGE_KEY,
} from '../common/ocrConsent';

export const IOcrConsentService = createServiceIdentifier<IOcrConsentService>('IOcrConsentService');

/**
 * The authority on whether a document may be uploaded for OCR (#213).
 *
 * Consulted inside the operation, not through the chat tool-confirmation affordance. A session
 * on blanket auto-approve skips tool confirmations before a tool's own confirmation is
 * consulted, and core's "cannot be auto-approved" list is not honored for local panel
 * sessions — so a gate living there would be defeated by a permission mode the user turned on
 * to speed up file edits. (OCR is human-triggered from the PDF viewer rather than agent-called,
 * so this is belt-and-braces; the reasoning is recorded because it is why the shape is what it
 * is.)
 */
export interface IOcrConsentService {
	readonly _serviceBrand: undefined;

	/** Fires when the verdict changes, so the Privacy settings row can refresh. */
	readonly onDidChangeVerdict: Event<void>;

	/**
	 * Whether this extraction may upload the document. Prompts when undecided. Concurrent
	 * requests share a single prompt.
	 */
	requestConsent(): Promise<boolean>;

	/** The remembered verdict, or undefined when undecided. */
	getVerdict(): ConsentVerdict | undefined;

	/** Set or (with undefined) reset the verdict. Drives the Privacy settings row. */
	setVerdict(verdict: ConsentVerdict | undefined): Promise<void>;
}

const ONCE_ACTION = 'Once';
const ALWAYS_ACTION = 'Always';
const NEVER_ACTION = 'Never';

function isConsentVerdict(value: unknown): value is ConsentVerdict {
	return value === 'always' || value === 'never';
}

export class OcrConsentService implements IOcrConsentService {
	readonly _serviceBrand: undefined;

	private readonly _onDidChangeVerdict = new Emitter<void>();
	readonly onDidChangeVerdict: Event<void> = this._onDidChangeVerdict.event;

	/**
	 * A prompt currently on screen. Two PDF views can ask at once; both must resolve against one
	 * dialog rather than stacking.
	 */
	private _pending: Promise<boolean> | undefined;

	constructor(
		@IVSCodeExtensionContext private readonly _context: IVSCodeExtensionContext,
		@INotificationService private readonly _notificationService: INotificationService,
		@ILogService private readonly _logService: ILogService,
	) { }

	async requestConsent(): Promise<boolean> {
		const step = decideFromStored(this.getVerdict());
		if (step === 'proceed') {
			return true;
		}
		if (step === 'refuse') {
			// The verdict's owner explains the refusal. Only this service can tell a stored
			// Never (a setting worth naming, with where to change it) from a dismissed dialog
			// (silence — "not this time" needs no toast), and the caller across the command
			// boundary sees only a boolean. Fire-and-forget, non-modal.
			void this._notificationService.showInformationMessage(buildRefusalMessage());
			return false;
		}
		if (this._pending) {
			return this._pending;
		}
		const prompt = this._prompt().finally(() => { this._pending = undefined; });
		this._pending = prompt;
		return prompt;
	}

	getVerdict(): ConsentVerdict | undefined {
		const stored = this._context.globalState.get<unknown>(OCR_CONSENT_STORAGE_KEY);
		// A hand-edited or stale globalState entry must not read as a verdict — an unrecognised
		// value falls back to undecided, which prompts rather than assuming.
		return isConsentVerdict(stored) ? stored : undefined;
	}

	async setVerdict(verdict: ConsentVerdict | undefined): Promise<void> {
		await this._context.globalState.update(OCR_CONSENT_STORAGE_KEY, verdict);
		this._logService.info(`[Patent AI] OCR consent set to '${verdict ?? 'ask'}'`);
		this._onDidChangeVerdict.fire();
	}

	/** Ask, persist any verdict the answer carries, and report whether to proceed. */
	private async _prompt(): Promise<boolean> {
		const { message, detail } = buildConsentPrompt();
		const answer = await this._notificationService.showInformationMessage(
			message,
			{ modal: true, detail },
			ONCE_ACTION, ALWAYS_ACTION, NEVER_ACTION,
		);

		const outcome = decideFromAnswer(
			answer === ONCE_ACTION ? 'once'
				: answer === ALWAYS_ACTION ? 'always'
					: answer === NEVER_ACTION ? 'never'
						: 'dismissed',
		);

		if (outcome.persist) {
			await this.setVerdict(outcome.persist);
		}
		return outcome.proceed;
	}
}
