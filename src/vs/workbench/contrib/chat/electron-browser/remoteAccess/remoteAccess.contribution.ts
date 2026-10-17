/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../../nls.js';
import { ConfigurationScope, Extensions as ConfigurationExtensions, IConfigurationRegistry } from '../../../../../platform/configuration/common/configurationRegistry.js';
import { InstantiationType, registerSingleton } from '../../../../../platform/instantiation/common/extensions.js';
import { Registry } from '../../../../../platform/registry/common/platform.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../../common/contributions.js';
import { RemoteAccessService } from '../../browser/remoteAccess/remoteAccessService.js';
import { IRemoteAccessService, REMOTE_ACCESS_DEFAULT_RELAY_URL, RemoteAccessSettingId } from '../../common/remoteAccess/remoteAccess.js';

// Desktop only: the Host transport runs in the local agent host process.
registerSingleton(IRemoteAccessService, RemoteAccessService, InstantiationType.Delayed);

Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).registerConfiguration({
	id: 'flowleap.remoteAccess',
	title: localize('remoteAccess.configurationTitle', "Remote Access"),
	type: 'object',
	properties: {
		[RemoteAccessSettingId.RelayUrl]: {
			type: 'string',
			default: REMOTE_ACCESS_DEFAULT_RELAY_URL,
			scope: ConfigurationScope.APPLICATION,
			markdownDescription: localize('remoteAccess.relayUrl', "The Relay this Host connects to for Remote Access. Must be a `wss://` URL."),
		},
		[RemoteAccessSettingId.KeepAwake]: {
			type: 'boolean',
			default: true,
			scope: ConfigurationScope.APPLICATION,
			markdownDescription: localize('remoteAccess.keepAwake', "Keep this computer awake while Remote Access is on and an Agent Session runs, so paired Viewers can follow it."),
		},
	},
});

/**
 * Creates the Remote Access service at startup so that a Host switched on in
 * an earlier run reconnects to the Relay without the user opening any UI.
 */
class RemoteAccessStartupContribution implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.remoteAccessStartup';

	constructor(@IRemoteAccessService _remoteAccessService: IRemoteAccessService) { }
}

registerWorkbenchContribution2(RemoteAccessStartupContribution.ID, RemoteAccessStartupContribution, WorkbenchPhase.Eventually);
