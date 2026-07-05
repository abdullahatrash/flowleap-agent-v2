/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { findExecutable } from '../../../base/node/processes.js';
import { IFlowLeapCliService } from '../common/flowleapCliService.js';

/** The command name of the FlowLeap CLI as installed on `PATH`. */
const FLOWLEAP_CLI_COMMAND = 'flowleap';

/**
 * Node implementation of {@link IFlowLeapCliService}. Resolves the `flowleap`
 * command against the process `PATH` using {@link findExecutable}, which also
 * honors Windows `PATHEXT` extensions (so an npm-installed `flowleap.cmd` is
 * found). It never spawns the binary.
 */
export class FlowLeapCliService implements IFlowLeapCliService {
	declare readonly _serviceBrand: undefined;

	findFlowLeapCli(): Promise<string | undefined> {
		return findExecutable(FLOWLEAP_CLI_COMMAND);
	}
}
