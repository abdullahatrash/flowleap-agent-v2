/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { HTML_PREVIEW_VIEW_TYPE, HtmlPreviewEditorProvider } from './htmlPreviewEditor';

/** Open an HTML file in the rendered preview editor. */
export const PREVIEW_HTML_COMMAND = 'flowleap.previewHtmlFile';

/** Open the active preview's HTML file in the text editor. */
export const OPEN_HTML_SOURCE_COMMAND = 'flowleap.openHtmlSource';

/**
 * Resolve the file an HTML command acts on: the argument (Explorer, editor title), else the
 * active text editor when it shows an HTML file, else a file the user picks.
 */
async function resolveHtmlFile(resource: vscode.Uri | undefined): Promise<vscode.Uri | undefined> {
	const active = vscode.window.activeTextEditor?.document.uri;
	if (resource) {
		return resource;
	}
	if (active && /\.html?$/i.test(active.path)) {
		return active;
	}
	const picked = await vscode.window.showOpenDialog({
		canSelectMany: false,
		filters: { [vscode.l10n.t('HTML files')]: ['html', 'htm'] },
		title: vscode.l10n.t('Preview HTML File'),
	});
	return picked?.[0];
}

/** Register the HTML preview editor and its commands. */
export function registerHtmlPreview(): vscode.Disposable {
	return vscode.Disposable.from(
		vscode.window.registerCustomEditorProvider(HTML_PREVIEW_VIEW_TYPE, new HtmlPreviewEditorProvider(), {
			webviewOptions: { retainContextWhenHidden: true },
			supportsMultipleEditorsPerDocument: false,
		}),
		vscode.commands.registerCommand(PREVIEW_HTML_COMMAND, async (resource?: vscode.Uri) => {
			const uri = await resolveHtmlFile(resource);
			if (uri) {
				await vscode.commands.executeCommand('vscode.openWith', uri, HTML_PREVIEW_VIEW_TYPE);
			}
		}),
		vscode.commands.registerCommand(OPEN_HTML_SOURCE_COMMAND, async (resource?: vscode.Uri) => {
			const activeInput = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
			const uri = resource ?? (activeInput instanceof vscode.TabInputCustom ? activeInput.uri : await resolveHtmlFile(undefined));
			if (uri) {
				await vscode.commands.executeCommand('vscode.openWith', uri, 'default');
			}
		}),
	);
}
