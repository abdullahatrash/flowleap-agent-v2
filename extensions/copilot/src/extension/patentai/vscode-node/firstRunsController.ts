/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IVSCodeExtensionContext } from '../../../platform/extContext/common/extensionContext';
import { ILogService } from '../../../platform/log/common/logService';
import { FIRST_RUNS_STORAGE_KEY, firstRunsGateStep, rememberFirstRuns } from '../common/firstRuns';

/**
 * Decides whether the first-runs surface opens, and remembers that it has. Deliberately free of
 * `vscode` — the surface it drives is an interface, so the once-per-account rule and the dismiss
 * are testable without a webview (the split `ocrConsentService.ts` uses).
 */

/** The surface the controller opens and closes. Implemented by the webview panel. */
export interface FirstRunsSurface {
	/** Open it, or reveal it if it is already open. */
	show(): void;
	/** Close it. A no-op when it is not open. */
	close(): void;
}

export class FirstRunsController {

	constructor(
		private readonly _context: IVSCodeExtensionContext,
		/** The signed-in FlowLeap account id, or `undefined` when there is no FlowLeap Session. */
		private readonly _accountId: () => Promise<string | undefined>,
		/** Turns the account id into the stored marker. Injected so this file stays node-free. */
		private readonly _hash: (value: string) => string,
		private readonly _surface: FirstRunsSurface,
		private readonly _logService: ILogService,
	) { }

	/**
	 * Show the three first runs on the first launch after a FlowLeap Session exists, once per
	 * account. Called on startup for an already signed-in user, and on the sign-in transition for a
	 * new one — the same two triggers the activation-telemetry first-launch hook uses (#349).
	 */
	async maybeShowOnLaunch(): Promise<void> {
		try {
			const marker = await this._marker();
			if (!marker) {
				// No FlowLeap Session yet. Sign-in fires this again.
				return;
			}
			const seen = this._context.globalState.get<readonly string[]>(FIRST_RUNS_STORAGE_KEY);
			if (firstRunsGateStep(seen, marker) === 'skip') {
				return;
			}
			// Record BEFORE opening. "Shown" has to mean shown: a user who closes the tab, or a
			// window that crashes a second later, must not be interrupted again on the next launch.
			await this._context.globalState.update(FIRST_RUNS_STORAGE_KEY, rememberFirstRuns(seen, marker));
			this._logService.info('[Patent AI] First launch for this account — opening the first runs');
			this._surface.show();
		} catch (error) {
			this._logService.debug(`[Patent AI] Could not open the first runs: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	/**
	 * The command behind "FlowLeap: Show First Runs". Always opens, so the three stay reachable
	 * after a dismiss without reaching into the stored markers.
	 */
	showOnDemand(): void {
		this._surface.show();
	}

	/**
	 * The dismiss affordance: close the surface and make sure this account is never shown it on a
	 * launch again. Idempotent, and the path that makes the dismiss stick when the surface was
	 * reopened with the command rather than by the launch gate.
	 */
	async dismiss(): Promise<void> {
		this._surface.close();
		try {
			const marker = await this._marker();
			if (!marker) {
				return;
			}
			const seen = this._context.globalState.get<readonly string[]>(FIRST_RUNS_STORAGE_KEY);
			await this._context.globalState.update(FIRST_RUNS_STORAGE_KEY, rememberFirstRuns(seen, marker));
		} catch (error) {
			this._logService.debug(`[Patent AI] Could not record the first-runs dismiss: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	private async _marker(): Promise<string | undefined> {
		const accountId = await this._accountId();
		return accountId ? this._hash(accountId) : undefined;
	}
}
