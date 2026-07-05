/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { InstantiationType, registerSingleton } from '../../instantiation/common/extensions.js';
import { IFlowLeapCliService } from '../common/flowleapCliService.js';

/**
 * Web fallback for {@link IFlowLeapCliService}. Browser targets cannot inspect a
 * host `PATH`, so we report the CLI as present to avoid nudging the user about a
 * dependency that has no meaning in the web workbench.
 */
class NullFlowLeapCliService implements IFlowLeapCliService {
	declare readonly _serviceBrand: undefined;

	async findFlowLeapCli(): Promise<string | undefined> {
		return 'flowleap';
	}
}

registerSingleton(IFlowLeapCliService, NullFlowLeapCliService, InstantiationType.Delayed);
