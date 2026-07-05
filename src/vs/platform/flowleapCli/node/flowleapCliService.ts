/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IProcessEnvironment } from '../../../base/common/platform.js';
import { findExecutable } from '../../../base/node/processes.js';
import { IConfigurationService } from '../../configuration/common/configuration.js';
import { INativeEnvironmentService } from '../../environment/common/environment.js';
import { ILogService } from '../../log/common/log.js';
import { getResolvedShellEnv } from '../../shell/node/shellEnv.js';
import { IFlowLeapCliService } from '../common/flowleapCliService.js';

/** The command name of the FlowLeap CLI as installed on `PATH`. */
const FLOWLEAP_CLI_COMMAND = 'flowleap';

/**
 * Node implementation of {@link IFlowLeapCliService}. Resolves the `flowleap`
 * command against the user's *shell* `PATH` (resolved via
 * {@link getResolvedShellEnv} and merged over the process env) using
 * {@link findExecutable}, which also honors Windows `PATHEXT` extensions (so
 * an npm-installed `flowleap.cmd` is found). The shell resolution matters: on
 * macOS/Linux GUI launches the raw main-process `PATH` misses login-shell
 * locations like `~/.local/bin` or the Homebrew prefix, which would produce a
 * false "CLI missing" result. It never spawns the binary.
 */
export class FlowLeapCliService implements IFlowLeapCliService {
	declare readonly _serviceBrand: undefined;

	private _shellEnv: Promise<IProcessEnvironment> | undefined;

	constructor(
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@INativeEnvironmentService private readonly _environmentService: INativeEnvironmentService,
		@ILogService private readonly _logService: ILogService,
	) { }

	private _getShellEnv(): Promise<IProcessEnvironment> {
		if (!this._shellEnv) {
			this._shellEnv = getResolvedShellEnv(this._configurationService, this._logService, this._environmentService.args, process.env)
				.then(shellEnv => ({ ...process.env, ...shellEnv }))
				.catch(error => {
					this._logService.warn(`[FlowLeapCliService] Unable to resolve shell environment, falling back to the process environment: ${error}`);
					return process.env;
				});
		}
		return this._shellEnv;
	}

	async findFlowLeapCli(): Promise<string | undefined> {
		return findExecutable(FLOWLEAP_CLI_COMMAND, undefined, undefined, await this._getShellEnv());
	}
}
