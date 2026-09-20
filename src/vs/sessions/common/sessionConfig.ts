/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ResolveSessionConfigResult } from '../../platform/agentSessionState/common/state/protocol/commands.js';

/**
 * Whether a session in a git workspace defaults to running in a new worktree.
 * Supplies the default only: a choice the user has already made for the workspace
 * is remembered separately and still wins.
 */
export const USE_WORKTREE_SETTING = 'sessions.useWorktree';

export function isSessionConfigComplete(config: ResolveSessionConfigResult): boolean {
	return (config.schema.required ?? []).every(property => config.values[property] !== undefined);
}
