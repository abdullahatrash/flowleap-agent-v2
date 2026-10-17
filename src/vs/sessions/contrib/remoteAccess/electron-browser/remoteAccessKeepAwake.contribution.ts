/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { observableFromEvent } from '../../../../base/common/observable.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { INativeHostService } from '../../../../platform/native/common/native.js';
import { observableConfigValue } from '../../../../platform/observable/common/platformObservableUtils.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../../workbench/common/contributions.js';
import { IRemoteAccessService, RemoteAccessSettingId } from '../../../../workbench/contrib/chat/common/remoteAccess/remoteAccess.js';
import { ISessionsManagementService } from '../../../services/sessions/common/sessionsManagement.js';
import { RemoteAccessKeepAwakeController } from '../browser/remoteAccessKeepAwake.js';

/**
 * Agents Window only: it is where Agent Sessions run. Holds the main
 * process's `powerSaveBlocker` ('prevent-app-suspension': the display may
 * still sleep) while Remote Access is on and an Agent Session runs.
 */
class RemoteAccessKeepAwakeContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'sessions.contrib.remoteAccessKeepAwake';

	constructor(
		@IRemoteAccessService remoteAccessService: IRemoteAccessService,
		@ISessionsManagementService sessionsManagementService: ISessionsManagementService,
		@INativeHostService nativeHostService: INativeHostService,
		@IConfigurationService configurationService: IConfigurationService,
		@ILogService logService: ILogService,
	) {
		super();
		const sessions = observableFromEvent(this, sessionsManagementService.onDidChangeSessions, () => sessionsManagementService.getSessions());
		this._register(new RemoteAccessKeepAwakeController(
			remoteAccessService.enabled,
			observableConfigValue(RemoteAccessSettingId.KeepAwake, true, configurationService),
			sessions,
			{
				start: () => nativeHostService.startPowerSaveBlocker('prevent-app-suspension'),
				stop: id => nativeHostService.stopPowerSaveBlocker(id),
			},
			logService,
		));
	}
}

registerWorkbenchContribution2(RemoteAccessKeepAwakeContribution.ID, RemoteAccessKeepAwakeContribution, WorkbenchPhase.Eventually);
