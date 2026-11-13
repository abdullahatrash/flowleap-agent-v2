/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// FlowLeap (PRD 0027 keep-out): upstream's `chat/browser/remoteAgentHost/remoteAgentHost.contribution.ts`
// registers the remote agent host connection, the Copilot cloud sandbox and the Mission Control (GitHub
// environments) services and contributions in one file. The product ships none of those surfaces, so that
// file is not imported. Core code still injects three of its services:
// - `IRemoteAgentHostConnectionCustomizationService` (the local agent host provider's artifact integrations),
// - `IAgentHostAdvertisedAuthenticationResolver` (the window's remote agent host service),
// - `IMissionControlEnvironmentService` (the session environment picker).
// The first two are upstream's own implementations, which are inert without a registered customization or
// an advertised remote host. The third is a null object: no Mission Control account, no hosts.

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { constObservable, IObservable } from '../../../../base/common/observable.js';
import { IAgentHostAdvertisedAuthenticationResolver } from '../../../../platform/agentHost/common/agentHostAdvertisedAuthentication.js';
import { IMissionControlEnvironmentService, IMissionControlHost } from '../../../../platform/agentHost/common/missionControlEnvironment.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { RemoteAgentHostAuthenticationResolver } from '../../chat/browser/remoteAgentHost/remoteAgentHostAuthenticationResolver.js';
import { IRemoteAgentHostConnectionCustomizationService, RemoteAgentHostConnectionCustomizationService } from '../../chat/browser/remoteAgentHost/remoteAgentHostConnectionCustomization.js';

class NullMissionControlEnvironmentService implements IMissionControlEnvironmentService {
	declare readonly _serviceBrand: undefined;
	readonly hosts: IObservable<readonly IMissionControlHost[]> = constObservable([]);
	readonly ownEnvironmentId: IObservable<string | undefined> = constObservable(undefined);
	readonly accountKey = undefined;
	readonly enabled = false;
	async initialize(): Promise<void> { }
	async refresh(_token: CancellationToken): Promise<void> { }
	async connect(_id: string, _token: CancellationToken): Promise<void> { }
	async disconnect(_id: string): Promise<void> { }
	async delete(_id: string, _token: CancellationToken): Promise<void> { }
	setDisplayName(_id: string, _name: string | undefined): void { }
}

registerSingleton(IRemoteAgentHostConnectionCustomizationService, RemoteAgentHostConnectionCustomizationService, InstantiationType.Delayed);
registerSingleton(IAgentHostAdvertisedAuthenticationResolver, RemoteAgentHostAuthenticationResolver, InstantiationType.Delayed);
registerSingleton(IMissionControlEnvironmentService, NullMissionControlEnvironmentService, InstantiationType.Delayed);
