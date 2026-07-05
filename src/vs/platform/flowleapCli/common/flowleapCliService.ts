/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../instantiation/common/instantiation.js';

export const IFlowLeapCliService = createDecorator<IFlowLeapCliService>('flowleapCliService');

/**
 * Detects the presence of the FlowLeap CLI (`flowleap`) binary on the host.
 *
 * Patent research sessions reach the FlowLeap backend through this CLI, which is
 * a runtime dependency deliberately not bundled with the app. The check runs in a
 * node-capable process (the Electron main process) because resolving an
 * executable on `PATH` requires filesystem access unavailable to the sandboxed
 * renderer. The result is surfaced to the renderer over IPC so the Agents window
 * can nudge the user to install the CLI when it is missing.
 */
export interface IFlowLeapCliService {
	readonly _serviceBrand: undefined;

	/**
	 * Resolves the absolute path of the `flowleap` executable on `PATH`, or
	 * `undefined` when it cannot be found. The lookup is cheap and never spawns
	 * the binary; it only probes the filesystem.
	 */
	findFlowLeapCli(): Promise<string | undefined>;
}
