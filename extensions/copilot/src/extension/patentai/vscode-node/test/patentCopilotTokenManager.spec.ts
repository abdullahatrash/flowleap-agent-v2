/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GitHubLoginFailedError } from '../../../../platform/authentication/vscode-node/copilotTokenManager';
import { IFetcherService } from '../../../../platform/networking/common/fetcherService';
import { createPlatformServices, ITestingServicesAccessor } from '../../../../platform/test/node/services';
import { DisposableStore } from '../../../../util/vs/base/common/lifecycle';
import { IInstantiationService } from '../../../../util/vs/platform/instantiation/common/instantiation';
import { PatentAICopilotTokenManager } from '../patentCopilotTokenManager';

describe('PatentAICopilotTokenManager (BYOK-only, CAPI disabled)', () => {
	let store: DisposableStore;
	let accessor: ITestingServicesAccessor;

	beforeEach(() => {
		store = new DisposableStore();
		accessor = store.add(createPlatformServices().createTestingAccessor());
	});

	afterEach(() => {
		store.dispose();
	});

	it('mints no Copilot token, fabricates nothing, and issues zero GitHub Copilot requests at the fetch seam', async () => {
		// Observe the single choke point through which every HTTP request flows.
		const githubHostFetches: string[] = [];
		store.add(accessor.get(IFetcherService).onDidCompleteFetch(e => {
			if (e.hostname.includes('github')) {
				githubHostFetches.push(`${e.callSite} -> ${e.hostname}`);
			}
		}));

		const manager = store.add(accessor.get(IInstantiationService).createInstance(PatentAICopilotTokenManager));

		// Rejects with the blessed BYOK / air-gapped reason rather than returning a
		// fabricated token — so callers degrade to the supported "no Copilot token" path.
		await expect(manager.getCopilotToken()).rejects.toThrowError(GitHubLoginFailedError);
		await expect(manager.getCopilotToken(true)).rejects.toThrowError('GitHubLoginFailed');

		// Resetting is a no-op (no token is ever held) and must not reach the network either.
		expect(() => manager.resetCopilotToken(401)).not.toThrow();

		// No request ever left for a GitHub Copilot endpoint.
		expect(githubHostFetches).toEqual([]);
	});
});
