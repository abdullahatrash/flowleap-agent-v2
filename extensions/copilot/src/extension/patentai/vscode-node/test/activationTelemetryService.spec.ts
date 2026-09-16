/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IVSCodeExtensionContext } from '../../../../platform/extContext/common/extensionContext';
import type { ILogService } from '../../../../platform/log/common/logService';
import type { INotificationService, MessageOptions } from '../../../../platform/notification/common/notificationService';
import { Emitter } from '../../../../util/vs/base/common/event';
import { ACTIVATION_CONSENT_STORAGE_KEY, MAX_BATCH } from '../../common/activationTelemetry';
import { registerPatentAccessTokenProvider } from '../../common/patentTokenRegistry';
import { ActivationTelemetryService, IActivationTelemetryEnvironment } from '../activationTelemetryService';
import type { IPatentBackendClient } from '../patentBackendClient';

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

/** Captures every `(path, body)` the service posts; `fail` makes the next posts reject. */
function makeBackendClient(fail = false) {
	const posts: { path: string; body: unknown }[] = [];
	const backendClient = {
		post: async (path: string, body: unknown) => {
			posts.push({ path, body });
			if (fail) {
				throw new Error('backend said no');
			}
			return { success: true };
		},
	} as unknown as IPatentBackendClient;
	return { backendClient, posts };
}

/** Answers the prompt from a scripted sequence, recording every notification shown. */
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

/** The editor facts, under the test's control — no global is stubbed. */
function makeEnvironment(enabled = true) {
	const onEnabledChanged = new Emitter<boolean>();
	let isEnabled = enabled;
	const environment: IActivationTelemetryEnvironment = {
		appVersion: '1.2.3',
		platform: 'darwin',
		isTelemetryEnabled: () => isEnabled,
		onDidChangeTelemetryEnabled: listener => onEnabledChanged.event(listener),
	};
	return {
		environment,
		setEnabled: (value: boolean) => { isEnabled = value; onEnabledChanged.fire(value); },
	};
}

interface ServiceHarnessOptions {
	readonly verdict?: string;
	readonly signedIn?: boolean;
	readonly telemetryEnabled?: boolean;
	readonly failPosts?: boolean;
	readonly answers?: (string | undefined)[];
}

function makeService(options: ServiceHarnessOptions = {}) {
	const { context, state } = makeContext(options.verdict ? { [ACTIVATION_CONSENT_STORAGE_KEY]: options.verdict } : {});
	const { backendClient, posts } = makeBackendClient(options.failPosts);
	const { notificationService, prompts } = makeNotificationService(...(options.answers ?? []));
	const { environment, setEnabled } = makeEnvironment(options.telemetryEnabled ?? true);
	const log = makeLogService();
	registerPatentAccessTokenProvider(() => (options.signedIn ?? true) ? 'token' : undefined);
	const service = new ActivationTelemetryService(environment, context, backendClient, notificationService, log);
	return { service, posts, prompts, state, setEnabled, log };
}

beforeEach(() => {
	vi.useFakeTimers();
	registerPatentAccessTokenProvider(() => undefined);
});

afterEach(() => {
	vi.useRealTimers();
});

describe('ActivationTelemetryService gating', () => {

	it('sends nothing while the verdict is undecided', async () => {
		const { service, posts } = makeService();

		service.recordAppLaunched();
		await vi.advanceTimersByTimeAsync(20_000);

		expect(posts).toEqual([]);
		service.dispose();
	});

	it('sends nothing when the verdict is never', async () => {
		const { service, posts } = makeService({ verdict: 'never' });

		service.recordAppLaunched();
		await vi.advanceTimersByTimeAsync(20_000);

		expect(posts).toEqual([]);
		service.dispose();
	});

	it('sends on always, after the debounce', async () => {
		const { service, posts } = makeService({ verdict: 'always' });

		service.recordAppLaunched();
		expect(posts).toEqual([]);
		await vi.advanceTimersByTimeAsync(20_000);

		expect(posts.map(p => p.path)).toEqual(['/telemetry/activation']);
		service.dispose();
	});

	it('sends nothing when the editor telemetry setting is off, and clears the queue when it goes off', async () => {
		const off = makeService({ verdict: 'always', telemetryEnabled: false });
		off.service.recordAppLaunched();
		await vi.advanceTimersByTimeAsync(20_000);
		expect(off.posts).toEqual([]);
		off.service.dispose();

		const on = makeService({ verdict: 'always' });
		on.service.recordAppLaunched();
		on.setEnabled(false);
		await vi.advanceTimersByTimeAsync(20_000);

		expect(on.posts).toEqual([]);
		on.service.dispose();
	});

	it('drops events while signed out instead of replaying them after a later sign-in', async () => {
		let token: string | undefined = undefined;
		const { context } = makeContext({ [ACTIVATION_CONSENT_STORAGE_KEY]: 'always' });
		const { backendClient, posts } = makeBackendClient();
		const { notificationService } = makeNotificationService();
		const { environment } = makeEnvironment();
		registerPatentAccessTokenProvider(() => token);
		const service = new ActivationTelemetryService(environment, context, backendClient, notificationService, makeLogService());

		service.recordAppLaunched();
		service.recordReportSaved('fto-memo');
		token = 'token-after-sign-in';
		await vi.advanceTimersByTimeAsync(20_000);

		expect(posts).toEqual([]);
		service.dispose();
	});

	it('drops a waiting batch when the verdict turns away from always', async () => {
		const { service, posts } = makeService({ verdict: 'always' });

		service.recordAppLaunched();
		await service.setVerdict('never');
		await vi.advanceTimersByTimeAsync(20_000);

		expect(posts).toEqual([]);
		service.dispose();
	});
});

describe('ActivationTelemetryService batching', () => {

	it('flushes a full batch of 20 without waiting for the debounce', async () => {
		const { service, posts } = makeService({ verdict: 'always' });

		for (let i = 0; i < 20; i++) {
			service.recordSkillRunCompleted('prior-art');
		}
		await vi.advanceTimersByTimeAsync(0);

		expect(posts.map(p => (p.body as { events: unknown[] }).events.length)).toEqual([20]);
		service.dispose();
	});

	it('never posts a batch over the cap, however large the burst', async () => {
		const { service, posts } = makeService({ verdict: 'always', failPosts: true });

		for (let i = 0; i < MAX_BATCH + 30; i++) {
			service.recordAppLaunched();
		}
		await vi.advanceTimersByTimeAsync(20_000);

		const sizes = posts.map(p => (p.body as { events: unknown[] }).events.length);
		expect({ sizes, overCap: sizes.filter(size => size > MAX_BATCH) }).toEqual({ sizes: [20, 20, 20, 20], overCap: [] });
		service.dispose();
	});

	it('swallows a backend rejection instead of surfacing it to the caller', async () => {
		const { service, posts } = makeService({ verdict: 'always', failPosts: true });

		expect(() => service.recordReportSaved('prior-art-report')).not.toThrow();
		await vi.advanceTimersByTimeAsync(20_000);

		expect(posts.length).toBe(1);
		service.dispose();
	});
});

describe('ActivationTelemetryService payloads', () => {

	it('posts exactly the wire contract, one event per kind, with no content field', async () => {
		const { service, posts } = makeService({ verdict: 'always' });

		service.recordAppLaunched();
		service.recordSkillRunCompleted('acme-v-widgetco-invalidity');
		service.recordReportSaved('fto-memo');
		service.recordKeysAdded(true, false);
		await vi.advanceTimersByTimeAsync(20_000);

		const body = posts[0].body as { events: { id: string; at: string }[] };
		expect({
			path: posts[0].path,
			events: body.events.map(event => ({ ...event, id: '<id>', at: '<at>' })),
			idsWellFormed: body.events.every(event => /^[A-Za-z0-9_-]{8,64}$/.test(event.id)),
			timestampsWellFormed: body.events.every(event => !Number.isNaN(Date.parse(event.at))),
		}).toEqual({
			path: '/telemetry/activation',
			events: [
				{ id: '<id>', name: 'app_launched', at: '<at>', appVersion: '1.2.3', platform: 'darwin', props: {} },
				{ id: '<id>', name: 'skill_run_completed', at: '<at>', appVersion: '1.2.3', platform: 'darwin', props: { skillId: 'custom' } },
				{ id: '<id>', name: 'report_saved', at: '<at>', appVersion: '1.2.3', platform: 'darwin', props: { templateKind: 'fto-memo' } },
				{ id: '<id>', name: 'keys_added', at: '<at>', appVersion: '1.2.3', platform: 'darwin', props: { epo: true, uspto: false } },
			],
			idsWellFormed: true,
			timestampsWellFormed: true,
		});
		service.dispose();
	});
});

describe('ActivationTelemetryService prompt', () => {

	it('asks once, persists the answer, and never asks again', async () => {
		const { service, prompts, state } = makeService({ answers: ['Send counters'] });

		await service.promptOnce();
		await service.promptOnce();

		expect({
			asked: prompts.length,
			modal: prompts[0].options.modal,
			message: prompts[0].message,
			items: prompts[0].items,
			stored: state.get(ACTIVATION_CONSENT_STORAGE_KEY),
		}).toEqual({
			asked: 1,
			modal: false,
			message: 'Help count what works? FlowLeap can send four counters: app launched, skill run completed (skill name only), report saved (template kind only), keys added (yes/no per office). Never a file, a query, a matter, or model output. You can change this any time in Settings › Privacy. See what leaves your machine: flowleap.co/data-handling',
			items: ['Send counters', 'Don\'t send'],
			stored: 'always',
		});
		service.dispose();
	});

	it('records nothing when the prompt is dismissed, and shares one prompt between concurrent callers', async () => {
		const { service, prompts, state } = makeService({ answers: [undefined] });

		await Promise.all([service.promptOnce(), service.promptOnce()]);

		expect({ asked: prompts.length, stored: state.get(ACTIVATION_CONSENT_STORAGE_KEY), verdict: service.getVerdict() })
			.toEqual({ asked: 1, stored: undefined, verdict: undefined });
		service.dispose();
	});
});
