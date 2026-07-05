/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from '../../../../../base/common/codicons.js';
import { localize } from '../../../../../nls.js';
import { ISessionType } from '../../../../services/sessions/common/session.js';

/** Copilot CLI session type. */
export const CopilotCLISessionType: ISessionType = {
	id: 'copilotcli',
	label: localize('copilotCLI', "Copilot"),
	icon: Codicon.copilot,
};
