/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { beforeEach, describe, expect, it, vi } from 'vitest';

// The `vscode` test alias points at a types shim; the import chain (copilotTokenManager) reads a
// few named members, so provide harmless stand-ins. The null-object service itself touches none.
vi.mock('vscode', () => ({
	Uri: { parse: (value: string) => value },
	window: {},
	env: {},
}));

import { PatentAIAuthService } from '../patentAuthService';
import type { ILogService } from '../../../../platform/log/common/logService';

/** Stub ILogService that ignores all calls. */
function makeLogService(): ILogService {
	return {
		trace: vi.fn(),
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	} as unknown as ILogService;
}

// After the auth-ownership flip (ADR 0002), the sign-in flow lives in
// FlowLeapAuthenticationProvider (see flowleapAuthProvider.spec.ts). PatentAIAuthService is now a
// stateless GitHub-bypass null object at the IAuthenticationService seam; these tests pin the four
// hard constraints that keep BYOK enabled and the FlowLeap JWT off this seam.
describe('PatentAIAuthService GitHub bypass (null object)', () => {
	let service: PatentAIAuthService;

	beforeEach(() => {
		service = new PatentAIAuthService(makeLogService());
	});

	it('reports signed-out GitHub state and never mints a Copilot token (keeps BYOK enabled)', async () => {
		expect(service.isMinimalMode).toBe(false);
		expect(service.hasCopilotTokenSource).toBe(false);
		expect(service.anyGitHubSession).toBeUndefined();
		expect(service.permissiveGitHubSession).toBeUndefined();
		expect(service.copilotToken).toBeUndefined();
		expect(await service.getGitHubSession('any', { silent: true })).toBeUndefined();
		expect(await service.getAdoAccessTokenBase64()).toBeUndefined();

		// CAPI stays off: token consumers must take the "no Copilot token / BYOK" branch.
		await expect(service.getCopilotToken()).rejects.toThrow('GitHubLoginFailed');
	});

	it('fires onDidAuthenticationChange when the provider notifies a session change', () => {
		const listener = vi.fn();
		const sub = service.onDidAuthenticationChange(listener);

		service.notifyAuthenticationChanged();

		expect(listener).toHaveBeenCalledTimes(1);
		sub.dispose();
	});
});
