/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { ChatConfiguration } from './constants.js';

/**
 * Whether policy forbids auto-approval. When it does, the Bypass Approvals and
 * Autopilot permission levels must not auto-approve a tool, and a remembered
 * "always allow" must not be reused.
 */
export function isAutoApprovePolicyRestricted(configurationService: IConfigurationService): boolean {
	return configurationService.inspect<boolean>(ChatConfiguration.GlobalAutoApprove).policyValue === false;
}
