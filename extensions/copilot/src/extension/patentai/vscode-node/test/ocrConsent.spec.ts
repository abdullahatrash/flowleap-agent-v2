/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it, vi } from 'vitest';
import type { IVSCodeExtensionContext } from '../../../../platform/extContext/common/extensionContext';
import type { ILogService } from '../../../../platform/log/common/logService';
import type { INotificationService, MessageOptions } from '../../../../platform/notification/common/notificationService';
import {
	buildRefusalMessage,
	decideFromAnswer,
	decideFromStored,
	OCR_CONSENT_COMMAND_ID,
	OCR_CONSENT_STORAGE_KEY,
} from '../../common/ocrConsent';
import { OcrConsentService } from '../ocrConsentService';

function makeLogService(): ILogService {
	return { trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as ILogService;
}

/** In-memory globalState double exposing its backing map for assertions. */
function makeContext(initial: Record<string, unknown> = {}) {
	const state = new Map(Object.entries(initial));
	const context = {
		globalState: {
			get: (key: string) => state.get(key),
			update: async (key: string, value: unknown) => {
				if (value === undefined) { state.delete(key); } else { state.set(key, value); }
			},
		},
	} as unknown as IVSCodeExtensionContext;
	return { context, state };
}

/** Answers the modal from a scripted sequence, recording every prompt shown. */
function makeNotificationService(...answers: (string | undefined)[]) {
	const prompts: { message: string; options: MessageOptions; items: string[] }[] = [];
	let next = 0;
	const notificationService = {
		showInformationMessage: async (message: string, options: MessageOptions, ...items: string[]) => {
			prompts.push({ message, options, items });
			return answers[next++];
		},
	} as unknown as INotificationService;
	return { notificationService, prompts };
}

function makeService(answers: (string | undefined)[] = [], initial: Record<string, unknown> = {}) {
	const { context, state } = makeContext(initial);
	const { notificationService, prompts } = makeNotificationService(...answers);
	return { service: new OcrConsentService(context, notificationService, makeLogService()), state, prompts };
}

describe('OCR consent decisions', () => {

	it('maps a stored verdict to the gate step, asking only when undecided', () => {
		expect([
			decideFromStored(undefined),
			decideFromStored('always'),
			decideFromStored('never'),
		]).toEqual(['ask', 'proceed', 'refuse']);
	});

	it('maps a prompt answer to whether to upload and what to remember', () => {
		expect({
			once: decideFromAnswer('once'),
			always: decideFromAnswer('always'),
			never: decideFromAnswer('never'),
			dismissed: decideFromAnswer('dismissed'),
		}).toEqual({
			// Once authorises this extraction and stores nothing — an answer, not a verdict.
			once: { proceed: true, persist: undefined },
			always: { proceed: true, persist: 'always' },
			never: { proceed: false, persist: 'never' },
			// Dismissing is "not this time": no upload, and no verdict recorded either.
			dismissed: { proceed: false, persist: undefined },
		});
	});

	it('pins the command id that pdf-preview repeats by hand', () => {
		// pdf-preview cannot import this module, so it hardcodes the same string before
		// uploading a document. Changing this without changing
		// `pdf-preview/src/pdfEditorProvider.ts` silently ungates OCR.
		expect(OCR_CONSENT_COMMAND_ID).toBe('flowleap.ocr.requestConsent');
	});

	it('names the processor and the retention in the refusal copy', () => {
		expect(buildRefusalMessage()).toMatchInlineSnapshot(
			`"Text extraction with OCR is turned off. You can change this in FlowLeap Settings under Privacy, or use "Extract text" to read the document on this machine."`
		);
	});
});

describe('OcrConsentService', () => {

	it('prompts when undecided, naming what is uploaded, the processor and the retention', async () => {
		const { service, prompts } = makeService(['Once']);

		const proceed = await service.requestConsent();

		expect(proceed).toBe(true);
		expect(prompts).toEqual([{
			message: 'Extract with OCR uploads this document to FlowLeap, where Mistral reads it.',
			options: {
				modal: true,
				detail: 'This is not your own model key — FlowLeap processes the document on its own account, and the result is cached for 24 hours.'
					+ '\n\nThe "Extract text" button beside it reads the document on this machine and sends nothing.'
					+ '\n\nYou can change this later in FlowLeap Settings under Privacy.',
			},
			items: ['Once', 'Always', 'Never'],
		}]);
	});

	it('remembers Always and stops prompting', async () => {
		const { service, state, prompts } = makeService(['Always']);

		const first = await service.requestConsent();
		const second = await service.requestConsent();

		expect({ first, second, promptCount: prompts.length, stored: state.get(OCR_CONSENT_STORAGE_KEY) })
			.toEqual({ first: true, second: true, promptCount: 1, stored: 'always' });
	});

	it('remembers Never and refuses without prompting again, naming the setting in a toast', async () => {
		const { service, state, prompts } = makeService(['Never']);

		const first = await service.requestConsent();
		const second = await service.requestConsent();

		// The second call refuses from the STORED verdict: no modal, but a non-modal toast that
		// names the user's own setting and where to change it. The toast is the service's job —
		// the pdf-preview caller sees only a boolean and stays silent.
		const modals = prompts.filter(p => p.options?.modal);
		const toasts = prompts.filter(p => !p.options?.modal);
		expect({ first, second, modalCount: modals.length, toastMessages: toasts.map(t => t.message), stored: state.get(OCR_CONSENT_STORAGE_KEY) })
			.toEqual({ first: false, second: false, modalCount: 1, toastMessages: [buildRefusalMessage()], stored: 'never' });
	});

	it('treats Once as an answer and not a verdict, asking again next time', async () => {
		const { service, state, prompts } = makeService(['Once', 'Once']);

		const first = await service.requestConsent();
		const second = await service.requestConsent();

		expect({ first, second, promptCount: prompts.length, stored: state.get(OCR_CONSENT_STORAGE_KEY) })
			.toEqual({ first: true, second: true, promptCount: 2, stored: undefined });
	});

	it('treats a dismissed prompt as "not this time" — no upload, no verdict, and no toast', async () => {
		const { service, state, prompts } = makeService([undefined]);

		const proceed = await service.requestConsent();

		// Dismissal is silent: the user chose nothing, so there is no setting to name. A toast
		// claiming "OCR is turned off" here would announce a policy that was never chosen.
		expect({ proceed, stored: state.get(OCR_CONSENT_STORAGE_KEY), notificationCount: prompts.length })
			.toEqual({ proceed: false, stored: undefined, notificationCount: 1 });
	});

	it('serves concurrent requests from a single prompt', async () => {
		const { service, prompts } = makeService(['Always']);

		// Two PDF views can ask at once; they must not stack dialogs.
		const [a, b] = await Promise.all([service.requestConsent(), service.requestConsent()]);

		expect({ a, b, promptCount: prompts.length }).toEqual({ a: true, b: true, promptCount: 1 });
	});

	it('reads back and resets the verdict for the Privacy settings row', async () => {
		const { service, state } = makeService([], { [OCR_CONSENT_STORAGE_KEY]: 'never' });

		const loaded = service.getVerdict();
		await service.setVerdict('always');
		const changed = service.getVerdict();
		await service.setVerdict(undefined);

		expect({ loaded, changed, reset: service.getVerdict(), stored: state.get(OCR_CONSENT_STORAGE_KEY) })
			.toEqual({ loaded: 'never', changed: 'always', reset: undefined, stored: undefined });
	});

	it('announces every verdict change so the settings row can follow', async () => {
		const { service } = makeService(['Always']);
		let changes = 0;
		service.onDidChangeVerdict(() => changes++);

		await service.requestConsent();
		await service.setVerdict('never');
		await service.setVerdict(undefined);

		expect(changes).toBe(3);
	});

	it('ignores a malformed stored value instead of inheriting a verdict from it', async () => {
		const { service, prompts } = makeService(['Once'], { [OCR_CONSENT_STORAGE_KEY]: 'sometimes' });

		const proceed = await service.requestConsent();

		expect({ proceed, verdict: service.getVerdict(), promptCount: prompts.length })
			.toEqual({ proceed: true, verdict: undefined, promptCount: 1 });
	});
});
