/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { homedir } from 'os';
import { join } from 'path';

/**
 * Root of the shared per-user session-state directory (`~/.copilot/`, or
 * `$XDG_STATE_HOME/.copilot`). Shared by all VS Code installs (Stable, Insiders, OSS,
 * Exploration) so session metadata written by one is visible to the others.
 */
function getSessionStateHome(): string {
	const xdgHome = process.env.XDG_STATE_HOME;
	const home = '.copilot';
	return xdgHome ? join(xdgHome, home) : join(homedir(), home);
}

/** Directory holding the per-session metadata files (`~/.copilot/session-state/{id}/`). */
export function getSessionStateDir(sessionId: string): string {
	return join(getSessionStateHome(), 'session-state', sessionId);
}

/**
 * Path of the shared bulk metadata cache file. Shared by all VS Code installs so the
 * session list is consistent across them.
 */
export function getBulkMetadataFile(): string {
	return join(getSessionStateHome(), 'vscode.session.metadata.cache.json');
}
