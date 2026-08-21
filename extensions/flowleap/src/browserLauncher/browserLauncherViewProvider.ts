/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

/**
 * A message posted by the browser launcher webview.
 */
interface BrowserLauncherMessage {
	command?: string;
	url?: string;
}

/**
 * Patent research sites offered as one-click links. The integrated browser
 * itself is a native editor pane, so this view only launches tabs — it never
 * hosts page content.
 */
const QUICK_LINKS: ReadonlyArray<{ label: string; url: string; description: string }> = [
	{ label: 'Espacenet', url: 'https://worldwide.espacenet.com/', description: 'EPO worldwide patent search' },
	{ label: 'Google Patents', url: 'https://patents.google.com/', description: 'Full-text patent search' },
	{ label: 'USPTO Patent Center', url: 'https://patentcenter.uspto.gov/', description: 'US applications and file wrappers' },
	{ label: 'WIPO PatentScope', url: 'https://patentscope.wipo.int/', description: 'PCT and international filings' },
	{ label: 'EPO Register', url: 'https://register.epo.org/', description: 'EP legal status and prosecution' }
];

/**
 * Activity-bar launcher for the integrated browser. The browser renders as an
 * editor tab (a native web layer over the editor area) and cannot be embedded
 * in the sidebar, so this view offers a URL box and curated patent links that
 * open tabs via `workbench.action.browser.open`.
 */
export class BrowserLauncherViewProvider implements vscode.WebviewViewProvider {

	public static readonly viewType = 'flowleap.browserLauncher';

	private _view: vscode.WebviewView | undefined;
	private _viewDisposables: vscode.Disposable[] = [];

	public resolveWebviewView(webviewView: vscode.WebviewView): void {
		this._view = webviewView;

		webviewView.webview.options = { enableScripts: true };

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
			webviewView.webview.onDidReceiveMessage((message: BrowserLauncherMessage) => {
				if (message.command === 'open') {
					vscode.commands.executeCommand('workbench.action.browser.open', normalizeUrl(message.url));
				}
			})
		);

		webviewView.webview.html = renderLauncher(webviewView.webview);
	}

	private _disposeViewListeners(): void {
		while (this._viewDisposables.length) {
			this._viewDisposables.pop()?.dispose();
		}
	}
}

/**
 * Turn launcher input into something the browser accepts: bare hosts get
 * https, and an empty box opens the browser's own start page.
 */
function normalizeUrl(url: string | undefined): string | undefined {
	const trimmed = url?.trim();
	if (!trimmed) {
		return undefined;
	}
	return /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function renderLauncher(webview: vscode.Webview): string {
	const nonce = getNonce();

	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>Browser</title>
	<style>
		* { margin: 0; padding: 0; box-sizing: border-box; }

		body {
			font-family: var(--vscode-font-family, -apple-system, sans-serif);
			background: var(--vscode-sideBar-background, var(--vscode-editor-background));
			color: var(--vscode-foreground);
			padding: 12px;
		}

		.url-row {
			display: flex;
			gap: 6px;
			margin-bottom: 10px;
		}

		.url-input {
			flex: 1;
			min-width: 0;
			background: var(--vscode-input-background);
			color: var(--vscode-input-foreground);
			border: 1px solid var(--vscode-input-border, transparent);
			border-radius: 4px;
			padding: 6px 8px;
			font-size: 12px;
			font-family: inherit;
			outline: none;
		}

		.url-input:focus {
			border-color: var(--vscode-focusBorder);
		}

		.open-btn {
			background: var(--vscode-button-background);
			color: var(--vscode-button-foreground);
			border: none;
			border-radius: 4px;
			padding: 6px 12px;
			font-size: 12px;
			font-family: inherit;
			cursor: pointer;
		}

		.open-btn:hover {
			background: var(--vscode-button-hoverBackground, var(--vscode-button-background));
		}

		.hint {
			color: var(--vscode-descriptionForeground);
			font-size: 11px;
			margin-bottom: 16px;
		}

		.section-title {
			color: var(--vscode-descriptionForeground);
			font-size: 11px;
			font-weight: 600;
			text-transform: uppercase;
			letter-spacing: 0.1em;
			margin-bottom: 8px;
		}

		.quick-link {
			display: block;
			background: var(--vscode-editorWidget-background, transparent);
			border: 1px solid var(--vscode-widget-border, transparent);
			border-radius: 6px;
			padding: 8px 10px;
			margin-bottom: 6px;
			cursor: pointer;
			transition: border-color 0.15s;
		}

		.quick-link:hover {
			border-color: var(--vscode-focusBorder);
			background: var(--vscode-list-hoverBackground);
		}

		.quick-link-label {
			font-size: 12px;
			font-weight: 500;
		}

		.quick-link-desc {
			color: var(--vscode-descriptionForeground);
			font-size: 11px;
			margin-top: 2px;
		}
	</style>
</head>
<body>
	<div class="url-row">
		<input class="url-input" id="url" type="text" placeholder="Enter URL or search…" />
		<button class="open-btn" id="open">Open</button>
	</div>
	<p class="hint">Opens as a tab in the editor area.</p>
	<div class="section-title">Patent Research</div>
	${QUICK_LINKS.map(link => `
	<div class="quick-link" data-url="${link.url}">
		<div class="quick-link-label">${link.label}</div>
		<div class="quick-link-desc">${link.description}</div>
	</div>`).join('')}
	<script nonce="${nonce}">
		const vscode = acquireVsCodeApi();
		const input = document.getElementById('url');

		const open = (url) => vscode.postMessage({ command: 'open', url });

		document.getElementById('open').addEventListener('click', () => open(input.value));
		input.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') {
				open(input.value);
			}
		});
		document.querySelectorAll('.quick-link').forEach((el) => {
			el.addEventListener('click', () => open(el.dataset.url));
		});
	</script>
</body>
</html>`;
}

function getNonce(): string {
	let text = '';
	const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	for (let i = 0; i < 32; i++) {
		text += possible.charAt(Math.floor(Math.random() * possible.length));
	}
	return text;
}
