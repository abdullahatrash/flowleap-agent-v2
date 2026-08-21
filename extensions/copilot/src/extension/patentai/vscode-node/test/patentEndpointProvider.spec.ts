/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LanguageModelChat } from 'vscode';

// The endpoint provider enumerates models through `lm.selectChatModels`; script it per test so the
// selection rules (BYOK allowlist, NON_BYOK denylist, trial vendor) are observable without a host.
const { selectChatModelsMock } = vi.hoisted(() => ({
	selectChatModelsMock: vi.fn(async (_selector?: { vendor?: string; id?: string }): Promise<LanguageModelChat[]> => []),
}));
vi.mock('vscode', async importOriginal => {
	const merged: Record<string, unknown> = {
		...(await importOriginal<Record<string, unknown>>()),
		lm: { selectChatModels: selectChatModelsMock },
	};
	// The real test shim serves `undefined` for the many vscode exports it does not define; a plain
	// mock object would make vitest throw on those instead. Mirror the shim's permissiveness.
	return new Proxy(merged, {
		has: () => true,
		get: (target, prop) => (typeof prop === 'string' ? target[prop] : undefined),
	});
});

import type { IConfigurationService } from '../../../../platform/configuration/common/configurationService';
import { ExtensionContributedChatEndpoint } from '../../../../platform/endpoint/vscode-node/extChatEndpoint';
import type { ILogService } from '../../../../platform/log/common/logService';
import type { IInstantiationService } from '../../../../util/vs/platform/instantiation/common/instantiation';
import { PatentAIEndpointProvider } from '../patentEndpointProvider';

/** A minimal model object; the provider only reads vendor/id/family off it. */
function makeModel(vendor: string, id: string): LanguageModelChat {
	return { vendor, id, family: id, name: id, version: '1.0.0' } as unknown as LanguageModelChat;
}

const TRIAL_MODELS = [
	makeModel('flowleap-trial', 'deepseek/deepseek-v4-flash-0731'),
	makeModel('flowleap-trial', 'google/gemini-3.7-flash'),
	makeModel('flowleap-trial', 'openai/gpt-5.6-luna'),
];

/** Serve `models` through the mocked `lm.selectChatModels`, filtered by the requested selector. */
function serveModels(models: LanguageModelChat[]): void {
	selectChatModelsMock.mockImplementation(async selector =>
		models.filter(m => (!selector?.vendor || m.vendor === selector.vendor) && (!selector?.id || m.id === selector.id)));
}

function makeLogService(): ILogService {
	return { trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as ILogService;
}

/** Records `createInstance` calls so tests can assert which endpoint wraps which model. */
function makeInstantiationService() {
	const createInstance = vi.fn((_ctor: unknown, ...args: unknown[]) => ({ args }));
	return { service: { createInstance } as unknown as IInstantiationService, createInstance };
}

function makeConfigurationService(): IConfigurationService {
	return { getNonExtensionConfig: () => undefined } as unknown as IConfigurationService;
}

describe('PatentAIEndpointProvider selection — FlowLeap Trial models (#241)', () => {

	let insta: ReturnType<typeof makeInstantiationService>;
	let provider: PatentAIEndpointProvider;

	beforeEach(() => {
		insta = makeInstantiationService();
		provider = new PatentAIEndpointProvider(makeLogService(), insta.service, makeConfigurationService());
	});

	afterEach(() => {
		selectChatModelsMock.mockReset();
		vi.restoreAllMocks();
	});

	it('counts trial models as connected BYOK models (the onboarding gate passes with zero user keys)', async () => {
		serveModels(TRIAL_MODELS);

		await expect(provider.hasByokModel()).resolves.toBe(true);
	});

	it('routes an explicitly selected trial model through the standard client-side endpoint path', async () => {
		serveModels(TRIAL_MODELS);

		await provider.getChatEndpoint(TRIAL_MODELS[0]);

		// Same path as every BYO-key model: wrapped in ExtensionContributedChatEndpoint, no special case.
		expect(insta.createInstance).toHaveBeenCalledWith(ExtensionContributedChatEndpoint, TRIAL_MODELS[0]);
	});

	it('resolves the default trial model when no model is specified and only trial models exist', async () => {
		serveModels(TRIAL_MODELS);

		await provider.getChatEndpoint();

		// The backend list is ordered default-first, so the first enumerated trial model wins.
		expect(insta.createInstance).toHaveBeenCalledWith(ExtensionContributedChatEndpoint, TRIAL_MODELS[0]);
	});

	it('still excludes the retired flowleap pseudo-vendor: not a connected model, and no endpoint for it', async () => {
		serveModels([makeModel('flowleap', 'patent-pseudo-model')]);

		await expect(provider.hasByokModel()).resolves.toBe(false);
		await expect(provider.getChatEndpoint()).rejects.toThrow('No connected model');
	});

	// ── BYO-key precedence (#242): the user's own model wins as default ─────────────────────────

	it('resolves the user\'s own model as the default when both user and trial models exist', async () => {
		const userModel = makeModel('openrouter', 'anthropic/claude-sonnet-4.6');
		// Trial models first in the fake's pool: the user-first outcome must come from the
		// provider's enumeration order, not from the ordering of this array.
		serveModels([...TRIAL_MODELS, userModel]);

		await provider.getChatEndpoint();

		expect(insta.createInstance).toHaveBeenCalledWith(ExtensionContributedChatEndpoint, userModel);
	});

	it('prefers the user\'s model over a trial model serving the SAME model id', async () => {
		const userModel = makeModel('openrouter', 'google/gemini-3.7-flash');
		serveModels([...TRIAL_MODELS, userModel]);

		await provider.getChatEndpoint('google/gemini-3.7-flash');

		expect(insta.createInstance).toHaveBeenCalledWith(ExtensionContributedChatEndpoint, userModel);
	});

	it('keeps an explicitly selected trial model routable while the user has their own models', async () => {
		serveModels([...TRIAL_MODELS, makeModel('openrouter', 'anthropic/claude-sonnet-4.6')]);

		await provider.getChatEndpoint(TRIAL_MODELS[1]);

		expect(insta.createInstance).toHaveBeenCalledWith(ExtensionContributedChatEndpoint, TRIAL_MODELS[1]);
	});
});
