/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { buildPreviewHtml } from './htmlPreviewDocument';

/** Command that previews a workspace HTML file (a dashboard or another generated report). */
export const PREVIEW_HTML_COMMAND = 'flowleap.previewHtmlFile';

/**
 * Open a workspace HTML file in a webview panel. The file is read through the workspace file
 * system, so this works the same on desktop and in a hosted workspace in the browser, where
 * `open`/`xdg-open` on the server show nothing to the user and no port is forwarded.
 */
async function previewHtmlFile(resource: vscode.Uri | undefined): Promise<void> {
	const active = vscode.window.activeTextEditor?.document.uri;
	const uri = resource ?? (active && /\.html?$/i.test(active.path) ? active : undefined);
	if (!uri) {
		const picked = await vscode.window.showOpenDialog({
			canSelectMany: false,
			filters: { [vscode.l10n.t('HTML files')]: ['html', 'htm'] },
			title: vscode.l10n.t('Preview HTML File'),
		});
		if (!picked?.length) {
			return;
		}
		return previewHtmlFile(picked[0]);
	}

	let text: string;
	try {
		text = new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
	} catch (error) {
		vscode.window.showErrorMessage(vscode.l10n.t('Could not read {0}: {1}', uri.path, String(error)));
		return;
	}

	const folder = vscode.Uri.joinPath(uri, '..');
	const panel = vscode.window.createWebviewPanel(
		'flowleap.htmlPreview',
		vscode.l10n.t('Preview {0}', uri.path.split('/').pop() ?? ''),
		vscode.ViewColumn.Active,
		{
			enableScripts: true,
			localResourceRoots: [folder],
		}
	);
	const baseHref = panel.webview.asWebviewUri(folder).toString().replace(/\/?$/, '/');
	panel.webview.html = buildPreviewHtml(text, panel.webview.cspSource, baseHref);
}

/** Register the HTML file preview command. */
export function registerHtmlPreview(): vscode.Disposable {
	return vscode.commands.registerCommand(PREVIEW_HTML_COMMAND, (resource?: vscode.Uri) => previewHtmlFile(resource));
}
