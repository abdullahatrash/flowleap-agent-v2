/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Remote Access Viewer registrations (PRD 0018 B4). Imported only by the
// Viewer entry `sessions.viewer.main.ts`; the desktop and the plain web entries
// do not load it. It registers the generic remote agent host part that PRD
// 0017 kept out of the web build: the remote host enable switch, the
// workbench integration of a live connection (file system, agents, models,
// authentication) and the Viewer's own remote agent host service. Cloud
// sandboxes, GitHub, tunnels, SSH and WSL stay out.

import { localize } from '../../../../../nls.js';
import { IRemoteAgentHostService, RemoteAgentHostsEnabledSettingId } from '../../../../../platform/agentHost/common/remoteAgentHostService.js';
import { ConfigurationScope, Extensions as ConfigurationExtensions, IConfigurationRegistry } from '../../../../../platform/configuration/common/configurationRegistry.js';
import { InstantiationType, registerSingleton } from '../../../../../platform/instantiation/common/extensions.js';
import { Registry } from '../../../../../platform/registry/common/platform.js';
import { registerWorkbenchContribution2, WorkbenchPhase } from '../../../../../workbench/common/contributions.js';
import { RemoteAgentHostContribution } from '../../../../../workbench/contrib/chat/browser/remoteAgentHost/remoteAgentHostChatContribution.js';
import { IRemoteAgentHostConnectionCustomizationService, RemoteAgentHostConnectionCustomizationService } from '../../../../../workbench/contrib/chat/browser/remoteAgentHost/remoteAgentHostConnectionCustomization.js';
import { RemoteAccessViewerAgentHostService } from './remoteAccessViewerAgentHostService.js';

// Replaces the plain web entry's registration (later registrations win).
registerSingleton(IRemoteAgentHostService, RemoteAccessViewerAgentHostService, InstantiationType.Delayed);
registerSingleton(IRemoteAgentHostConnectionCustomizationService, RemoteAgentHostConnectionCustomizationService, InstantiationType.Delayed);

registerWorkbenchContribution2(RemoteAgentHostContribution.ID, RemoteAgentHostContribution, WorkbenchPhase.AfterRestored);

Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).registerConfiguration({
	properties: {
		[RemoteAgentHostsEnabledSettingId]: {
			type: 'boolean',
			description: localize('remoteAccessViewer.remoteAgentHostsEnabled', "Follow the paired Host through the Relay. The Viewer turns this on; turning it off disconnects the Viewer."),
			default: true,
			scope: ConfigurationScope.APPLICATION,
			restricted: true,
			tags: ['experimental', 'advanced'],
		},
	},
});
