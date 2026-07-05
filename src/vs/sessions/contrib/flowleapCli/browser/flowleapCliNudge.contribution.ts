/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../../workbench/common/contributions.js';
import { ISessionsProvidersService } from '../../../services/sessions/browser/sessionsProvidersService.js';
import { ISession } from '../../../services/sessions/common/session.js';
import { ISessionsProvider } from '../../../services/sessions/common/sessionsProvider.js';
import { FlowLeapCliNudge } from './flowleapCliNudge.js';

/**
 * Session type id of Claude sessions, as registered by the Copilot chat
 * sessions provider (`ClaudeCodeSessionType`). Kept as a local constant since
 * import patterns forbid cross-contribution imports.
 */
const CLAUDE_CODE_SESSION_TYPE_ID = 'claude-code';

/**
 * Triggers the {@link FlowLeapCliNudge} the first time a Claude session shows
 * up in the Agents window, regardless of which sessions provider serves it.
 * Claude sessions reach the FlowLeap backend through the `flowleap` CLI, so
 * that is the moment a missing binary becomes relevant.
 *
 * The trigger is one-shot: once the check has run, all listeners are dropped.
 * It observes providers registered now and later, and also considers sessions
 * that already exist when a provider registers (restored sessions).
 */
class FlowLeapCliNudgeContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'sessions.contrib.flowleapCliNudge';

	private readonly _sessionListeners = this._register(new DisposableStore());
	private _triggered = false;

	constructor(
		@ISessionsProvidersService sessionsProvidersService: ISessionsProvidersService,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
	) {
		super();

		const watchProvider = (provider: ISessionsProvider) => {
			if (this._triggered) {
				return;
			}
			if (provider.getSessions().some(isClaudeSession)) {
				this._trigger();
				return;
			}
			this._sessionListeners.add(provider.onDidChangeSessions(e => {
				if (e.added.some(isClaudeSession)) {
					this._trigger();
				}
			}));
		};

		this._sessionListeners.add(sessionsProvidersService.onDidChangeProviders(e => e.added.forEach(watchProvider)));
		sessionsProvidersService.getProviders().forEach(watchProvider);
	}

	private _trigger(): void {
		if (this._triggered) {
			return;
		}
		this._triggered = true;
		this._sessionListeners.clear();

		const cliNudge = this._register(this._instantiationService.createInstance(FlowLeapCliNudge));
		void cliNudge.checkOnce();
	}
}

function isClaudeSession(session: ISession): boolean {
	return session.sessionType === CLAUDE_CODE_SESSION_TYPE_ID;
}

registerWorkbenchContribution2(FlowLeapCliNudgeContribution.ID, FlowLeapCliNudgeContribution, WorkbenchPhase.Eventually);
