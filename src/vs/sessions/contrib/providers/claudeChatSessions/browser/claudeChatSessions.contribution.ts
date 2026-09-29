/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../../base/common/lifecycle.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../../../workbench/common/contributions.js';
import { ISessionsProvidersService } from '../../../../services/sessions/browser/sessionsProvidersService.js';
import { ClaudeChatSessionsProvider } from './claudeChatSessionsProvider.js';

/**
 * FlowLeap: registers the extension-host Claude sessions provider, the only
 * session type the Agents window offers besides the Local session.
 */
class ClaudeSessionsProviderContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'sessions.claudeSessionsProvider';

	constructor(
		@IInstantiationService instantiationService: IInstantiationService,
		@ISessionsProvidersService sessionsProvidersService: ISessionsProvidersService,
	) {
		super();
		const provider = this._register(instantiationService.createInstance(ClaudeChatSessionsProvider));
		this._register(sessionsProvidersService.registerProvider(provider));
	}
}

registerWorkbenchContribution2(ClaudeSessionsProviderContribution.ID, ClaudeSessionsProviderContribution, WorkbenchPhase.AfterRestored);
