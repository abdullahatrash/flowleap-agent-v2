/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { localize } from '../../../../../nls.js';
import { IFlowLeapCliService } from '../../../../../platform/flowleapCli/common/flowleapCliService.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { INotificationService, NeverShowAgainScope, Severity } from '../../../../../platform/notification/common/notification.js';
import { IOpenerService } from '../../../../../platform/opener/common/opener.js';

/** The FlowLeap CLI install documentation (source of truth for install steps). */
const FLOWLEAP_CLI_INSTALL_URL = 'https://github.com/abdullahatrash/flowleap-cli#installation';

/** Storage id for the "Don't Show Again" choice; APPLICATION-scoped so it sticks across windows. */
const FLOWLEAP_CLI_NUDGE_NEVER_SHOW_AGAIN_ID = 'flowleap.cli.installNudge';

/**
 * Surfaces a one-time, dismissible nudge when the FlowLeap CLI (`flowleap`) is
 * absent from `PATH`. Patent research sessions in the Agents window reach the
 * FlowLeap backend through this CLI, so a missing binary is worth flagging early
 * rather than letting the first patent lookup fail mysteriously.
 *
 * The check is cheap (a filesystem probe over `PATH`, no process spawn), runs
 * off the session-creation critical path, and only ever runs once per window via
 * {@link checkOnce}. Dismissal is persisted by the notification service's
 * application-scoped "Don't Show Again" affordance, which also suppresses the
 * prompt on subsequent windows.
 */
export class FlowLeapCliNudge extends Disposable {

	private _checked = false;

	constructor(
		@IFlowLeapCliService private readonly _flowleapCliService: IFlowLeapCliService,
		@INotificationService private readonly _notificationService: INotificationService,
		@IOpenerService private readonly _openerService: IOpenerService,
		@ILogService private readonly _logService: ILogService,
	) {
		super();
	}

	/**
	 * Runs the detection at most once for the lifetime of this instance and shows
	 * the install nudge when the CLI is missing. Failures are swallowed (logged)
	 * so detection can never disrupt session flows.
	 */
	async checkOnce(): Promise<void> {
		if (this._checked) {
			return;
		}
		this._checked = true;

		let resolvedPath: string | undefined;
		try {
			resolvedPath = await this._flowleapCliService.findFlowLeapCli();
		} catch (error) {
			this._logService.warn(`[flowleap-cli-nudge] Detection failed: ${error}`);
			return;
		}

		if (resolvedPath) {
			return; // CLI present — nothing to do.
		}

		this._showNudge();
	}

	private _showNudge(): void {
		this._notificationService.prompt(
			Severity.Info,
			localize('flowleap.cli.missing', "The FlowLeap CLI (`flowleap`) isn't on your PATH. Patent research sessions use it to reach the FlowLeap backend. Install it with `npm i -g flowleap`."),
			[
				{
					label: localize('flowleap.cli.install', "Install Instructions"),
					run: () => this._openerService.open(URI.parse(FLOWLEAP_CLI_INSTALL_URL))
				}
			],
			{
				neverShowAgain: { id: FLOWLEAP_CLI_NUDGE_NEVER_SHOW_AGAIN_ID, scope: NeverShowAgainScope.APPLICATION }
			}
		);
	}
}
