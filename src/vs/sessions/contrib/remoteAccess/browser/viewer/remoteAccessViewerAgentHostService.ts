/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// The remote agent host service of the Remote Access Viewer (PRD 0018 B4).
//
// The Viewer is the web Agents Window with the generic remote agent host
// provider. Upstream fills that provider from the `chat.remoteAgentHosts`
// setting through a WebSocket connection factory. The Viewer has exactly one
// remote host, the Host of the pair the boot page picked, so this service
// replaces the settings-driven factory with one that publishes that single
// entry and dials it through the Relay (`RemoteAccessViewerTransport`).
// Every agent the Host publishes (`claude`, and `flowleap-chat` after slice C)
// arrives through this one connection and this one provider.

import { constObservable, IObservable } from '../../../../../base/common/observable.js';
import { AgentHostProtocolClient } from '../../../../../platform/agentHost/browser/agentHostProtocolClient.js';
import { RemoteAccessViewerTransport } from '../../../../../platform/agentHost/browser/remoteAccessViewerTransport.js';
import { AgentsWindowRemoteAgentHostService } from '../../../../../platform/agentHost/browser/remoteAgentHostServiceImpl.js';
import { agentsWindowAgentHostClientInfo } from '../../../../../platform/agentHost/common/agentHostClientInfo.js';
import { IRemoteAgentHostReconnectPolicy } from '../../../../../platform/agentHost/common/reconnectPolicy.js';
import { IRemoteAccessViewerOptions, IRemoteAccessViewerStatus, RemoteAccessViewerState } from '../../../../../platform/agentHost/common/remoteAccessViewer.js';
import { NonReconnectableTransportError } from '../../../../../platform/agentHost/common/state/sessionTransport.js';
import {
	IRemoteAgentHostConnectionFactory, IRemoteAgentHostConnectOptions, IRemoteAgentHostCreatedConnection, IRemoteAgentHostEntry, RemoteAgentHostEntryType,
} from '../../../../../platform/agentHost/common/remoteAgentHostService.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { IEnvironmentService } from '../../../../../platform/environment/common/environment.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { ILabelService } from '../../../../../platform/label/common/label.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { IStorageService } from '../../../../../platform/storage/common/storage.js';
import { IBrowserWorkbenchEnvironmentService } from '../../../../../workbench/services/environment/browser/environmentService.js';

/**
 * The Viewer keeps trying while the page is open: a Host that sleeps for an
 * hour is normal. A pending `connect()` does not count as an attempt (the
 * transport waits for the Host), so attempts only add up while the Relay is
 * unreachable.
 */
export const REMOTE_ACCESS_VIEWER_RECONNECT_POLICY: IRemoteAgentHostReconnectPolicy = Object.freeze({
	autoRestore: true,
	initialDelayMs: 1_000,
	maxDelayMs: 30_000,
	maxAttempts: Number.MAX_SAFE_INTEGER,
	jitter: true,
});

/** The address of the pair's Host in the remote agent host service. One per pair, so two pairs never share cached sessions. */
export function remoteAccessViewerAddress(pairId: string): string {
	return `remote-access-${pairId.toLowerCase()}`;
}

/** Builds the Relay-backed protocol client for the pair's single entry. */
export class RemoteAccessViewerConnectionFactory implements IRemoteAgentHostConnectionFactory {
	readonly kind = RemoteAgentHostEntryType.WebSocket;
	readonly entries: IObservable<readonly IRemoteAgentHostEntry[]>;
	private readonly _address: string;

	constructor(
		private readonly _options: IRemoteAccessViewerOptions,
		private readonly _instantiationService: IInstantiationService,
	) {
		this._address = remoteAccessViewerAddress(_options.pairId);
		this.entries = constObservable([{
			name: _options.hostLabel,
			connection: { type: RemoteAgentHostEntryType.WebSocket, address: this._address },
		}]);
	}

	createConnection(entry: IRemoteAgentHostEntry, _options: IRemoteAgentHostConnectOptions): Promise<IRemoteAgentHostCreatedConnection> {
		if (entry.connection.type !== RemoteAgentHostEntryType.WebSocket || entry.connection.address !== this._address) {
			throw new Error(`The Remote Access Viewer dials only its pair's Host, not this ${entry.connection.type} entry.`);
		}
		// After a refusal (4401, 4402, 4403, 4409, 4429) the same identity gets the
		// same answer, and a 4409 retry would take the pair back from the other
		// tab, which would take it back again. So every later transport fails at
		// once, and the page asks the user to reload.
		let refusal: string | undefined;
		const reportStatus = (status: IRemoteAccessViewerStatus) => {
			if (status.state === RemoteAccessViewerState.Refused) {
				refusal = status.message ?? '';
			}
			this._options.onDidChangeStatus?.(status);
		};
		const refusedOptions = (message: string): IRemoteAccessViewerOptions => ({
			...this._options,
			getToken: () => Promise.reject(new NonReconnectableTransportError(message)),
		});
		// The protocol client makes a new transport for every reconnect attempt.
		const transportFactory = () => this._instantiationService.createInstance(
			RemoteAccessViewerTransport,
			refusal === undefined ? this._options : refusedOptions(refusal),
			reportStatus,
			undefined,
			undefined,
		);
		const connection = this._instantiationService.createInstance(AgentHostProtocolClient, this._address, transportFactory, {
			clientInfo: agentsWindowAgentHostClientInfo,
			reconnectPolicy: REMOTE_ACCESS_VIEWER_RECONNECT_POLICY,
		});
		return Promise.resolve({ connection });
	}
}

/**
 * The Agents Window remote agent host service, with the Viewer's pair as the
 * only WebSocket-kind entry. Without `remoteAccessViewer` construction options
 * it has no entries at all; the page never boots the workbench that way.
 */
export class RemoteAccessViewerAgentHostService extends AgentsWindowRemoteAgentHostService {

	protected override get supportsWebSocketConnections(): boolean {
		return false;
	}

	constructor(
		@IConfigurationService configurationService: IConfigurationService,
		@IInstantiationService instantiationService: IInstantiationService,
		@ILogService logService: ILogService,
		@ILabelService labelService: ILabelService,
		@IEnvironmentService environmentService: IEnvironmentService,
		@IStorageService storageService: IStorageService,
		@IBrowserWorkbenchEnvironmentService browserEnvironmentService: IBrowserWorkbenchEnvironmentService,
	) {
		super(configurationService, instantiationService, logService, labelService, environmentService, storageService);
		const options = browserEnvironmentService.options?.remoteAccessViewer;
		if (options) {
			this._register(this.registerConnectionFactory(new RemoteAccessViewerConnectionFactory(options, instantiationService)));
		} else {
			logService.warn('[RemoteAccessViewer] The workbench started without a pair; the Viewer boot page passes one.');
		}
	}
}
