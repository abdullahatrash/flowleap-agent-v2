/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../instantiation/common/instantiation.js';
import { IFlowLeapCliService } from '../common/flowleapCliService.js';

export const IFlowLeapCliMainService = createDecorator<IFlowLeapCliMainService>('flowleapCli');

/**
 * Main-process identity for {@link IFlowLeapCliService}. Registered in the
 * Electron main process and exposed to renderers via an IPC channel.
 */
export interface IFlowLeapCliMainService extends IFlowLeapCliService {
	readonly _serviceBrand: undefined;
}
