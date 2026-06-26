/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CopilotToken } from '../../../platform/authentication/common/copilotToken';
import { ICopilotTokenManager } from '../../../platform/authentication/common/copilotTokenManager';
import { GitHubLoginFailedError } from '../../../platform/authentication/vscode-node/copilotTokenManager';
import { ILogService } from '../../../platform/log/common/logService';
import { Emitter, Event } from '../../../util/vs/base/common/event';
import { Disposable } from '../../../util/vs/base/common/lifecycle';

/**
 * FlowLeap Patent AI token manager — BYOK-only, CAPI disabled.
 *
 * Registered in place of `VSCodeCopilotTokenManager` so the extension never mints a
 * GitHub Copilot token and therefore never reaches GitHub's CAPI token endpoint
 * (`copilot_internal/v2/token`). Inference is BYO-key only (see
 * {@link PatentAIEndpointProvider}); a chat turn runs entirely against the user's own
 * connected model via {@link ExtensionContributedChatEndpoint} and needs no Copilot
 * token, so none is ever fetched.
 *
 * It deliberately does NOT fabricate a {@link CopilotToken}. Feeding a fake token would
 * silently re-enable CAPI-gated code paths and GitHub entitlement/quota assumptions;
 * instead {@link getCopilotToken} rejects with {@link GitHubLoginFailedError} — the same
 * `GitHubLoginFailed` reason the codebase already treats as the expected BYOK /
 * air-gapped state. Consumers degrade to the supported "no Copilot token" branch (e.g.
 * `ContextKeysContribution` logs at debug rather than error), and the token-derived
 * entitlement/quota surface stays empty, so chat is never gated on a GitHub subscription
 * or quota.
 *
 * Holds no `ICAPIClientService` / `IFetcherService` dependency, so it is structurally
 * incapable of issuing a CAPI network request. The CAPI-backed manager remains in the
 * repo, dormant and unregistered.
 */
export class PatentAICopilotTokenManager extends Disposable implements ICopilotTokenManager {

	declare readonly _serviceBrand: undefined;

	// Never fires: there is no Copilot token to refresh.
	private readonly _onDidCopilotTokenRefresh = this._register(new Emitter<void>());
	readonly onDidCopilotTokenRefresh: Event<void> = this._onDidCopilotTokenRefresh.event;

	constructor(
		@ILogService logService: ILogService,
	) {
		super();
		logService.info('[Patent AI] Copilot token manager initialized (BYOK-only, CAPI disabled)');
	}

	/**
	 * Always rejects: FlowLeap mints no GitHub Copilot token. Throws
	 * {@link GitHubLoginFailedError} (reason `GitHubLoginFailed`) so callers take the
	 * already-supported "no Copilot token / BYOK" path instead of treating it as a server
	 * connection failure. No network request is issued and no token is fabricated.
	 */
	async getCopilotToken(_force?: boolean): Promise<CopilotToken> {
		throw new GitHubLoginFailedError('GitHubLoginFailed');
	}

	/** No-op: no CAPI Copilot token is ever held, so there is nothing to reset. */
	resetCopilotToken(_httpError?: number): void {
		// Intentionally empty.
	}
}
