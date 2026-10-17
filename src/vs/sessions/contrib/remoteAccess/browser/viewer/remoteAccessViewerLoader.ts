/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// The Remote Access Viewer loader (`/loader.js` on remote.flowleap.co, PRD 0018 B4).
//
// The site root keeps the last three Viewer builds, one folder each. The root
// `index.html` is the same for all of them and runs this script, which picks
// the build folder from the address (`/<version>/`, else the newest), sets the
// file root the workbench loads from, and imports that build's boot page. It
// assumes no single version: the build list comes from `versions.json`.

import { mainWindow } from '../../../../../base/browser/window.js';
import { parseViewerBuilds, pickLoadedBuild } from '../../common/remoteAccessViewerBoot.js';

async function fetchJson(path: string): Promise<unknown> {
	const response = await fetch(path, { cache: 'no-store', credentials: 'omit' });
	if (!response.ok) {
		throw new Error(`${path}: ${response.status}`);
	}
	return response.json();
}

async function load(): Promise<void> {
	let config: unknown;
	let buildsJson: unknown;
	try {
		[config, buildsJson] = await Promise.all([fetchJson('/config.json'), fetchJson('/versions.json')]);
	} catch {
		// No localization here: the strings live in the build that is not loaded yet.
		mainWindow.document.body.textContent = 'The FlowLeap Viewer is not installed correctly (config.json or versions.json is missing).';
		return;
	}
	const builds = parseViewerBuilds(buildsJson);
	if (!builds) {
		mainWindow.document.body.textContent = 'The FlowLeap Viewer is not installed correctly (versions.json lists no build).';
		return;
	}
	const buildVersion = pickLoadedBuild(location.pathname, builds);
	const fileRoot = `${location.origin}/${buildVersion}/out/`;
	const globals = globalThis as { _VSCODE_FILE_ROOT?: string; flowleapViewer?: object };
	globals._VSCODE_FILE_ROOT = fileRoot;
	globals.flowleapViewer = { buildVersion, fileRoot, builds, config };
	await import(`${fileRoot}vs/sessions/contrib/remoteAccess/browser/viewer/remoteAccessViewerBoot.js`);
}

void load();
