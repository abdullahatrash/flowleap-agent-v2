/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { HomeDashboardMessage, handleHomeDashboardMessage, renderHomeDashboard } from './homeDashboardContent';

/**
 * The home dashboard as an editor tab. The markup and the message handling come
 * from `homeDashboardContent`, which the activity-bar view shares.
 */
export class HomeDashboardPanel {
	public static currentPanel: HomeDashboardPanel | undefined;

	public static readonly viewType = 'flowleap.homeDashboard';

	private readonly _panel: vscode.WebviewPanel;
	private readonly _context: vscode.ExtensionContext;
	private _disposables: vscode.Disposable[] = [];

	public static createOrShow(extensionUri: vscode.Uri, context: vscode.ExtensionContext) {
		const column = vscode.window.activeTextEditor
			? vscode.window.activeTextEditor.viewColumn
			: undefined;

		if (HomeDashboardPanel.currentPanel) {
			HomeDashboardPanel.currentPanel._panel.reveal(column);
			return;
		}

		const panel = vscode.window.createWebviewPanel(
			HomeDashboardPanel.viewType,
			'FlowLeap',
			column || vscode.ViewColumn.One,
			{
				enableScripts: true,
				retainContextWhenHidden: true,
				localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')]
			}
		);

		HomeDashboardPanel.currentPanel = new HomeDashboardPanel(panel, context);
	}

	public static revive(panel: vscode.WebviewPanel, _extensionUri: vscode.Uri, context: vscode.ExtensionContext) {
		HomeDashboardPanel.currentPanel = new HomeDashboardPanel(panel, context);
	}

	/**
	 * Re-render the home dashboard if it is currently open, so it stays in sync
	 * with the project sidebar after the project store changes.
	 */
	public static refresh() {
		HomeDashboardPanel.currentPanel?._update();
	}

	private constructor(panel: vscode.WebviewPanel, context: vscode.ExtensionContext) {
		this._panel = panel;
		this._context = context;

		this._update();

		this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

		this._panel.onDidChangeViewState(
			() => {
				if (this._panel.visible) {
					this._update();
				}
			},
			null,
			this._disposables
		);

		this._panel.webview.onDidReceiveMessage(
			(message: HomeDashboardMessage) => handleHomeDashboardMessage(message),
			null,
			this._disposables
		);
	}

	public dispose() {
		HomeDashboardPanel.currentPanel = undefined;

		this._panel.dispose();

		while (this._disposables.length) {
			const x = this._disposables.pop();
			if (x) {
				x.dispose();
			}
		}
	}

	private async _update() {
		this._panel.title = 'FlowLeap';
		this._panel.webview.html = await renderHomeDashboard(this._panel.webview, this._context);
	}
}
