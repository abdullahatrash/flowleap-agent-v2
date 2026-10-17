/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { autorun, derived, IObservable } from '../../../../base/common/observable.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { ISession, isActiveSessionStatus } from '../../../services/sessions/common/session.js';

/** The power-save blocker seam (main process `powerSaveBlocker` behind INativeHostService). */
export interface IKeepAwakeBlocker {
	start(): Promise<number>;
	stop(id: number): Promise<boolean>;
}

/**
 * Keeps this computer awake while Remote Access is on, the keep-awake setting
 * is on, and at least one Agent Session is running or waiting for input, so a
 * paired Viewer can follow it. Releases the blocker as soon as any of the three
 * stops being true, and on dispose.
 */
export class RemoteAccessKeepAwakeController extends Disposable {

	readonly shouldKeepAwake: IObservable<boolean>;
	private _blockerId: number | undefined;
	private _wanted = false;
	private _queue: Promise<void> = Promise.resolve();

	constructor(
		enabled: IObservable<boolean>,
		keepAwakeSetting: IObservable<boolean>,
		sessions: IObservable<readonly ISession[]>,
		private readonly _blocker: IKeepAwakeBlocker,
		private readonly _logService: ILogService,
	) {
		super();
		this.shouldKeepAwake = derived(this, reader => {
			if (!enabled.read(reader) || !keepAwakeSetting.read(reader)) {
				return false;
			}
			return sessions.read(reader).some(session => !session.isArchived.read(reader) && isActiveSessionStatus(session.status.read(reader)));
		});
		this._register(autorun(reader => this._apply(this.shouldKeepAwake.read(reader))));
		this._register(toDisposable(() => this._apply(false)));
	}

	/** Resolves when every start/stop issued so far has settled. */
	whenSettled(): Promise<void> {
		return this._queue;
	}

	private _apply(wanted: boolean): void {
		if (wanted === this._wanted) {
			return;
		}
		this._wanted = wanted;
		this._queue = this._queue.then(async () => {
			try {
				if (this._wanted && this._blockerId === undefined) {
					this._blockerId = await this._blocker.start();
					this._logService.info('[RemoteAccess] Keeping this computer awake while an Agent Session runs');
				} else if (!this._wanted && this._blockerId !== undefined) {
					const id = this._blockerId;
					this._blockerId = undefined;
					await this._blocker.stop(id);
					this._logService.info('[RemoteAccess] Released keep-awake');
				}
			} catch (error) {
				this._logService.warn('[RemoteAccess] Keep-awake failed', error instanceof Error ? error.message : undefined);
			}
		});
	}
}
