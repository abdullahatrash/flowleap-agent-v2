/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { buildPreviewHtml } from './htmlPreviewDocument';

/** The custom editor that shows an HTML file rendered. Registered as the default editor for `*.html`. */
export const HTML_PREVIEW_VIEW_TYPE = 'flowleap.htmlPreview';

/**
 * Read-only custom editor for HTML files. Opening an HTML file from the Explorer, a chat link or
 * a command shows the rendered page, the way a Markdown file opens rendered. The file is read
 * through the workspace file system, so it works on desktop and in a hosted workspace. The page
 * reloads when the file changes on disk, so a dashboard the agent rewrites updates in place.
 * "Open HTML Source" in the editor title switches to the text editor.
 */
export class HtmlPreviewEditorProvider implements vscode.CustomReadonlyEditorProvider {

	async openCustomDocument(uri: vscode.Uri): Promise<vscode.CustomDocument> {
		return { uri, dispose: () => { } };
	}

	async resolveCustomEditor(document: vscode.CustomDocument, panel: vscode.WebviewPanel): Promise<void> {
		const folder = vscode.Uri.joinPath(document.uri, '..');
		panel.webview.options = {
			enableScripts: true,
			localResourceRoots: [folder],
		};

		const render = async () => {
			let text: string;
			try {
				text = new TextDecoder().decode(await vscode.workspace.fs.readFile(document.uri));
			} catch (error) {
				panel.webview.html = `<p>${escapeText(vscode.l10n.t('Could not read {0}: {1}', document.uri.path, String(error)))}</p>`;
				return;
			}
			const baseHref = panel.webview.asWebviewUri(folder).toString().replace(/\/?$/, '/');
			panel.webview.html = buildPreviewHtml(text, panel.webview.cspSource, baseHref);
		};

		const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(folder, basename(document.uri)));
		const subscriptions = [
			watcher,
			watcher.onDidChange(render),
			watcher.onDidCreate(render),
		];
		panel.onDidDispose(() => {
			for (const subscription of subscriptions) {
				subscription.dispose();
			}
		});

		await render();
	}
}

function basename(uri: vscode.Uri): string {
	return uri.path.split('/').pop() ?? '';
}

function escapeText(value: string): string {
	return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
