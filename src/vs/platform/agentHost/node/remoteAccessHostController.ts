/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { decodeBase64 } from '../../../base/common/buffer.js';
import { Disposable, DisposableStore, IDisposable, MutableDisposable } from '../../../base/common/lifecycle.js';
import { ILogService } from '../../log/common/log.js';
import { IRemoteAccessHostConfig, IRemoteAccessHostStatus, REMOTE_ACCESS_STOPPED_STATUS } from '../common/remoteAccessHost.js';
import type { IProtocolServer } from '../common/state/sessionTransport.js';
import { IRemoteAccessRelayOptions, IRemoteAccessRelayTimings, RemoteAccessRelayProtocolServer } from './remoteAccessRelayTransport.js';

/**
 * `true` when the Relay URL may carry the FlowLeap Session token: `wss:`
 * anywhere, plain `ws:` only to this machine (development and tests).
 */
export function isAllowedRelayUrl(relayUrl: string): boolean {
	let url: URL;
	try {
		url = new URL(relayUrl);
	} catch {
		return false;
	}
	if (url.protocol === 'wss:') {
		return true;
	}
	return url.protocol === 'ws:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]');
}

/**
 * Owns the Remote Access Host transport inside the agent host process.
 * The renderer switches it on, refreshes it and switches it off with
 * {@link setConfig}; the controller keeps the token and pair keys in memory.
 */
export class RemoteAccessHostController extends Disposable {

	private readonly _running = this._register(new MutableDisposable<DisposableStore>());
	private _server: RemoteAccessRelayProtocolServer | undefined;

	constructor(
		private readonly _appVersion: string,
		private readonly _ahpVersions: readonly string[],
		/** Attaches a ProtocolServerHandler to the transport; disposed with it. */
		private readonly _attachHandler: (server: IProtocolServer) => IDisposable,
		private readonly _logService: ILogService,
		private readonly _timings?: Partial<IRemoteAccessRelayTimings>,
	) {
		super();
	}

	get status(): IRemoteAccessHostStatus {
		return this._server?.status ?? REMOTE_ACCESS_STOPPED_STATUS;
	}

	setConfig(config: IRemoteAccessHostConfig | undefined): void {
		if (!config) {
			if (this._server) {
				this._logService.info('[RemoteAccess] Host switched off');
			}
			this._server = undefined;
			this._running.clear();
			return;
		}
		if (!isAllowedRelayUrl(config.relayUrl)) {
			throw new Error('Remote Access needs a wss:// Relay URL.');
		}
		const options: IRemoteAccessRelayOptions = {
			relayUrl: config.relayUrl,
			token: config.token,
			hostId: config.hostId,
			appVersion: this._appVersion,
			ahpVersions: this._ahpVersions,
			pairs: config.pairs.map(pair => ({ pairId: pair.pairId, pairKey: decodeBase64(pair.pairKey).buffer })),
		};
		if (this._server) {
			this._server.updateOptions(options);
			return;
		}
		const store = new DisposableStore();
		const server = store.add(new RemoteAccessRelayProtocolServer(options, this._logService, this._timings));
		store.add(this._attachHandler(server));
		this._server = server;
		this._running.value = store;
		this._logService.info('[RemoteAccess] Host switched on');
		server.start();
	}
}
