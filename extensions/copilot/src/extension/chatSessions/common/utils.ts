/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Uri } from 'vscode';
import { IWorkspaceService } from '../../../platform/workspace/common/workspaceService';
import { URI } from '../../../util/vs/base/common/uri';

export function isUntitledSessionId(sessionId: string): boolean {
	return sessionId.startsWith('untitled:') || sessionId.startsWith('untitled-');
}

/** Whether the workbench is in the empty-workspace ("welcome") state with no folders open. */
export function isWelcomeView(workspaceService: IWorkspaceService): boolean {
	return workspaceService.getWorkspaceFolders().length === 0;
}

/** Maps an agent-session id to/from its `copilotcli:` resource URI. */
export namespace SessionIdForCLI {
	export function getResource(sessionId: string): Uri {
		return URI.from({ scheme: 'copilotcli', path: `/${sessionId}` }) as unknown as Uri;
	}

	export function parse(resource: Uri): string {
		return resource.path.slice(1);
	}

	export function isCLIResource(resource: Uri): boolean {
		return resource.scheme === 'copilotcli';
	}
}
