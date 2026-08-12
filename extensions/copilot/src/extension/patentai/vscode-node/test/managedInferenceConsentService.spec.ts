/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it, vi } from 'vitest';
import type { IVSCodeExtensionContext } from '../../../../platform/extContext/common/extensionContext';
import type { ILogService } from '../../../../platform/log/common/logService';
import type { INotificationService, MessageOptions } from '../../../../platform/notification/common/notificationService';
import { ManagedInferenceConsentService } from '../managedInferenceConsentService';

function makeLogService(): ILogService {
	return { trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as ILogService;
}

/** In-memory globalState double exposing its backing map for assertions. */
function makeContext(initialState: Record<string, unknown> = {}) {
	const state = new Map(Object.entries(initialState));
	const context = {
		globalState: {
			get: (key: string) => state.get(key),
			update: async (key: string, value: unknown) => {
				if (value === undefined) {
					state.delete(key);
				} else {
					state.set(key, value);
				}
			},
		},
	} as unknown as IVSCodeExtensionContext;
	return { context, state };
}

/**
 * A notification service that answers the modal with a scripted sequence of button labels
 * (`undefined` meaning the user dismissed it), recording every prompt it was asked to show.
 */
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

function makeService(answers: (string | undefined)[] = [], initialState: Record<string, unknown> = {}) {
	const { context, state } = makeContext(initialState);
	const { notificationService, prompts } = makeNotificationService(...answers);
	const service = new ManagedInferenceConsentService(context, notificationService, makeLogService());
	return { service, state, prompts };
}

const STORAGE_KEY = 'flowleap.managedInferenceConsent';

describe('ManagedInferenceConsentService', () => {

	it('prompts an undecided subject once, naming what is sent, the processor and the retention', async () => {
		const { service, prompts } = makeService(['Once']);

		const proceed = await service.requestConsent('claim-analysis');

		expect(proceed).toBe(true);
		expect(prompts).toEqual([{
			message: 'Claim Analysis sends the claim text you are analysing to FlowLeap, where Anthropic (OpenAI as fallback) processes it.',
			options: {
				modal: true,
				detail: 'This is not your own model key — FlowLeap processes it on its own account, and the result is cached for 2 hours.\n\nYou can change this later in FlowLeap Settings under Privacy.',
			},
			items: ['Once', 'Always', 'Never'],
		}]);
	});

	it('remembers Always and Never, and stops prompting once a verdict is stored', async () => {
		const { service, state, prompts } = makeService(['Always', 'Never']);

		const firstAllow = await service.requestConsent('query-generation');
		const firstRefuse = await service.requestConsent('document-ocr');
		// Second round: both subjects are decided, so neither may reach the user again.
		const secondAllow = await service.requestConsent('query-generation');
		const secondRefuse = await service.requestConsent('document-ocr');

		expect({
			outcomes: [firstAllow, firstRefuse, secondAllow, secondRefuse],
			promptCount: prompts.length,
			stored: state.get(STORAGE_KEY),
		}).toEqual({
			outcomes: [true, false, true, false],
			promptCount: 2,
			stored: { 'query-generation': 'always', 'document-ocr': 'never' },
		});
	});

	it('treats Once as an answer and not a verdict, asking again on the next call', async () => {
		const { service, state, prompts } = makeService(['Once', 'Once']);

		const first = await service.requestConsent('claim-analysis');
		const second = await service.requestConsent('claim-analysis');

		expect({ first, second, promptCount: prompts.length, stored: state.get(STORAGE_KEY) })
			.toEqual({ first: true, second: true, promptCount: 2, stored: undefined });
	});

	it('treats a dismissed prompt as "not this time" — no transmission and no verdict recorded', async () => {
		const { service, state } = makeService([undefined]);

		const proceed = await service.requestConsent('claim-analysis');

		expect({ proceed, stored: state.get(STORAGE_KEY) }).toEqual({ proceed: false, stored: undefined });
	});

	it('serves concurrent requests for one undecided subject from a single prompt', async () => {
		const { service, prompts } = makeService(['Always']);

		// An agent turn can call the same gated tool twice before the first resolves.
		const [first, second] = await Promise.all([
			service.requestConsent('query-generation'),
			service.requestConsent('query-generation'),
		]);

		expect({ first, second, promptCount: prompts.length }).toEqual({ first: true, second: true, promptCount: 1 });
	});

	it('satisfies both query-generation tools from one decision', async () => {
		const { service, prompts } = makeService(['Always']);

		// build_patent_query and build_uspto_query send the same description down the same path,
		// so they share one subject and must not ask twice.
		const epo = await service.requestConsent('query-generation');
		const uspto = await service.requestConsent('query-generation');

		expect({ epo, uspto, promptCount: prompts.length }).toEqual({ epo: true, uspto: true, promptCount: 1 });
	});

	it('refuses an unrecognised subject without prompting', async () => {
		const { service, prompts } = makeService(['Always']);

		// The id crosses a command boundary from another extension: fail closed rather than
		// prompting for a capability whose disclosure we cannot state.
		const proceed = await service.requestConsent('not-a-subject');

		expect({ proceed, promptCount: prompts.length }).toEqual({ proceed: false, promptCount: 0 });
	});

	it('reads back and resets verdicts for the Privacy settings section', async () => {
		const { service, state } = makeService([], { [STORAGE_KEY]: { 'claim-analysis': 'never' } });

		const loaded = service.getVerdict('claim-analysis');
		await service.setVerdict('claim-analysis', 'always');
		const changed = service.getVerdict('claim-analysis');
		await service.setVerdict('claim-analysis', undefined);

		expect({
			loaded,
			changed,
			reset: service.getVerdict('claim-analysis'),
			undecidedSubject: service.getVerdict('document-ocr'),
			stored: state.get(STORAGE_KEY),
		}).toEqual({
			loaded: 'never',
			changed: 'always',
			reset: undefined,
			undecidedSubject: undefined,
			stored: {},
		});
	});

	it('announces every verdict change so the Privacy settings rows can follow along', async () => {
		const { service } = makeService(['Always']);
		let changes = 0;
		service.onDidChangeVerdicts(() => changes++);

		// A verdict answered at a prompt during a tool call, then one set from the settings page,
		// then a reset — the settings view subscribes to this to stay in step with all three.
		await service.requestConsent('claim-analysis');
		await service.setVerdict('document-ocr', 'never');
		await service.setVerdict('document-ocr', undefined);

		expect(changes).toBe(3);
	});

	it('ignores a malformed stored value instead of inheriting a verdict from it', async () => {
		const { service, prompts } = makeService(['Once'], { [STORAGE_KEY]: { 'claim-analysis': 'sometimes' } });

		const proceed = await service.requestConsent('claim-analysis');

		expect({ proceed, verdict: service.getVerdict('claim-analysis'), promptCount: prompts.length })
			.toEqual({ proceed: true, verdict: undefined, promptCount: 1 });
	});
});
