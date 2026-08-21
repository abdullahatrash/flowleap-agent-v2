/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { HomeDashboardMessage, handleHomeDashboardMessage, renderHomeDashboard } from './homeDashboardContent';

/**
 * The home dashboard as an activity-bar view. It renders the same markup as
 * `HomeDashboardPanel` and answers the same messages; only the host differs.
 */
export class HomeDashboardViewProvider implements vscode.WebviewViewProvider {

	public static readonly viewType = 'flowleap.dashboardView';

	private static _current: HomeDashboardViewProvider | undefined;

	private _view: vscode.WebviewView | undefined;
	private _viewDisposables: vscode.Disposable[] = [];

	/**
	 * Re-render the activity-bar dashboard if the view is resolved, so it stays
	 * in sync with the other project surfaces after the project store changes.
	 */
	public static refresh() {
		HomeDashboardViewProvider._current?._update();
	}

	constructor(
		private readonly _extensionUri: vscode.Uri,
		private readonly _context: vscode.ExtensionContext
	) {
		HomeDashboardViewProvider._current = this;
	}

	public resolveWebviewView(webviewView: vscode.WebviewView): void {
		this._view = webviewView;

		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [vscode.Uri.joinPath(this._extensionUri, 'media')]
		};

		// A view can be resolved again after it was disposed, so the listeners of
		// the previous round must go before the new ones are registered.
		this._disposeViewListeners();

		this._viewDisposables.push(
			webviewView.onDidDispose(() => {
				if (this._view === webviewView) {
					this._view = undefined;
				}
				this._disposeViewListeners();
			}),
			webviewView.onDidChangeVisibility(() => {
				if (webviewView.visible) {
					this._update();
				}
			}),
			webviewView.webview.onDidReceiveMessage((message: HomeDashboardMessage) => handleHomeDashboardMessage(message))
		);

		this._update();
	}

	private _disposeViewListeners(): void {
		while (this._viewDisposables.length) {
			this._viewDisposables.pop()?.dispose();
		}
	}

	private async _update(): Promise<void> {
		const view = this._view;
		if (!view) {
			return;
		}

		view.webview.html = await renderHomeDashboard(view.webview, this._context);
	}
}
