/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { RawContextKey } from '../../../platform/contextkey/common/contextkey.js';

/**
 * Context key that indicates Patent IDE mode is enabled.
 * When true, Patent IDE-specific UI is shown; when false, standard VS Code UI is shown.
 * Set to true to hide developer-focused features in Patent IDE.
 */
export const PatentIdeContextKeys = {
	/**
	 * Patent IDE mode context key.
	 * Set to true to hide non-patent features (Git, Debug, Extensions, Testing, etc.)
	 */
	Mode: new RawContextKey<boolean>('patentIdeMode', true, {
		type: 'boolean',
		description: 'Indicates if Patent IDE mode is enabled (hides developer tools)'
	})
};
