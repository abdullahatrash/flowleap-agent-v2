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
	label?: string;
}

/** A link the user added to the launcher, kept in global state. */
export interface UserLink {
	label: string;
	url: string;
}

/** The global-state key of the user's own launcher links. */
export const USER_LINKS_KEY = 'flowleap.browser.userLinks';

/**
 * Patent research sites offered as one-click links. The integrated browser
 * itself is a native editor pane, so this view only launches tabs — it never
 * hosts page content.
 */
/** FlowLeap's own web surfaces, listed above the public patent offices. */
const FLOWLEAP_LINKS: ReadonlyArray<{ label: string; url: string; description: string }> = [
	{ label: 'FlowLeap Analytics', url: 'https://www.flowleap.co/analytics', description: 'Portfolio and landscape analytics' }
];

const QUICK_LINKS: ReadonlyArray<{ label: string; url: string; description: string }> = [
	{ label: 'Espacenet', url: 'https://worldwide.espacenet.com/', description: 'EPO worldwide patent search' },
	{ label: 'Google Patents', url: 'https://patents.google.com/', description: 'Full-text patent search' },
	{ label: 'USPTO Patent Center', url: 'https://patentcenter.uspto.gov/', description: 'US applications and file wrappers' },
	{ label: 'WIPO PatentScope', url: 'https://patentscope.wipo.int/', description: 'PCT and international filings' },
	{ label: 'EPO Register', url: 'https://register.epo.org/', description: 'EP legal status and prosecution' }
];

/** The Unified Patent Court's case management system (CMS), where representatives file. */
const UPC_LINKS: ReadonlyArray<{ label: string; url: string; description: string }> = [
	{ label: 'UPC CMS Front Office', url: 'https://cms.unifiedpatentcourt.org/', description: 'User profile, organisation and legal teams' },
	{ label: 'UPC CMS Portfolio', url: 'https://cms.unifiedpatentcourt.org/portfolio', description: 'Your UPC cases and new filings' },
	{ label: 'UPC Opt-out Registry', url: 'https://www.unifiedpatentcourt.org/en/registry/opt-out/', description: 'Check and search opt-out applications' }
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

	constructor(private readonly _globalState: vscode.Memento) { }

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
				} else if (message.command === 'addLink') {
					void this._addLink(message.label, message.url);
				} else if (message.command === 'removeLink') {
					void this._saveLinks(removeUserLink(this._userLinks(), message.url));
				}
			})
		);

		this._render();
	}

	private _userLinks(): UserLink[] {
		return readUserLinks(this._globalState.get<unknown>(USER_LINKS_KEY));
	}

	private async _addLink(label: string | undefined, url: string | undefined): Promise<void> {
		const result = addUserLink(this._userLinks(), label, url);
		if (typeof result === 'string') {
			vscode.window.showWarningMessage(result);
			return;
		}
		await this._saveLinks(result);
	}

	private async _saveLinks(links: UserLink[]): Promise<void> {
		await this._globalState.update(USER_LINKS_KEY, links);
		this._render();
	}

	private _render(): void {
		if (this._view) {
			this._view.webview.html = renderLauncher(this._view.webview, this._userLinks());
		}
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

/**
 * Read the stored user links, dropping any entry that is not a well-formed
 * `{ label, url }` with an http(s) URL.
 */
export function readUserLinks(stored: unknown): UserLink[] {
	if (!Array.isArray(stored)) {
		return [];
	}
	return stored.filter((link): link is UserLink =>
		typeof link?.label === 'string' && typeof link?.url === 'string' && isWebUrl(link.url));
}

/**
 * Add a link to the list. Returns the new list, or a message saying why the
 * link was refused. An empty label falls back to the URL's host.
 */
export function addUserLink(links: readonly UserLink[], label: string | undefined, url: string | undefined): UserLink[] | string {
	const normalized = normalizeUrl(url);
	if (!normalized || !isWebUrl(normalized)) {
		return 'Enter a web address that starts with http:// or https://.';
	}
	const href = new URL(normalized).href;
	if (links.some(link => link.url === href)) {
		return 'This link is already in My links.';
	}
	const name = label?.trim() || new URL(href).host;
	return [...links, { label: name, url: href }];
}

/** Remove the link with this URL from the list. */
export function removeUserLink(links: readonly UserLink[], url: string | undefined): UserLink[] {
	return links.filter(link => link.url !== url);
}

function isWebUrl(value: string): boolean {
	try {
		const { protocol } = new URL(value);
		return protocol === 'http:' || protocol === 'https:';
	} catch {
		return false;
	}
}

export function escapeHtml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

function renderLauncher(webview: vscode.Webview, userLinks: readonly UserLink[]): string {
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

		.user-link {
			display: flex;
			align-items: center;
			gap: 6px;
		}

		.user-link .quick-link-body {
			flex: 1;
			min-width: 0;
		}

		.user-link .quick-link-desc {
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}

		.remove-btn {
			background: transparent;
			color: var(--vscode-descriptionForeground);
			border: none;
			border-radius: 4px;
			padding: 2px 6px;
			font-size: 14px;
			line-height: 1;
			cursor: pointer;
		}

		.remove-btn:hover {
			color: var(--vscode-foreground);
			background: var(--vscode-toolbar-hoverBackground);
		}

		.empty {
			color: var(--vscode-descriptionForeground);
			font-size: 11px;
			margin-bottom: 8px;
		}

		.add-form {
			display: flex;
			flex-direction: column;
			gap: 6px;
			margin-bottom: 16px;
		}

		.add-form .open-btn {
			align-self: flex-end;
		}
	</style>
</head>
<body>
	<div class="url-row">
		<input class="url-input" id="url" type="text" placeholder="Enter URL or search…" />
		<button class="open-btn" id="open">Open</button>
	</div>
	<p class="hint">Opens as a tab in the editor area.</p>
	<div class="section-title">FlowLeap</div>
	${FLOWLEAP_LINKS.map(link => `
	<div class="quick-link" data-url="${link.url}">
		<div class="quick-link-label">${link.label}</div>
		<div class="quick-link-desc">${link.description}</div>
	</div>`).join('')}
	<div class="section-title">Patent Research</div>
	${QUICK_LINKS.map(link => `
	<div class="quick-link" data-url="${link.url}">
		<div class="quick-link-label">${link.label}</div>
		<div class="quick-link-desc">${link.description}</div>
	</div>`).join('')}
	<div class="section-title">Unified Patent Court</div>
	${UPC_LINKS.map(link => `
	<div class="quick-link" data-url="${link.url}">
		<div class="quick-link-label">${link.label}</div>
		<div class="quick-link-desc">${link.description}</div>
	</div>`).join('')}
	<div class="section-title">My links</div>
	${userLinks.length ? userLinks.map(link => `
	<div class="quick-link user-link" data-url="${escapeHtml(link.url)}">
		<div class="quick-link-body">
			<div class="quick-link-label">${escapeHtml(link.label)}</div>
			<div class="quick-link-desc">${escapeHtml(link.url)}</div>
		</div>
		<button class="remove-btn" data-remove="${escapeHtml(link.url)}" title="Remove link" aria-label="Remove ${escapeHtml(link.label)}">×</button>
	</div>`).join('') : `
	<p class="empty">Add the sites you use most.</p>`}
	<div class="add-form">
		<input class="url-input" id="link-label" type="text" placeholder="Name (optional)" />
		<input class="url-input" id="link-url" type="text" placeholder="https://…" />
		<button class="open-btn" id="add-link">Add link</button>
	</div>
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
		document.querySelectorAll('.remove-btn').forEach((el) => {
			el.addEventListener('click', (e) => {
				e.stopPropagation();
				vscode.postMessage({ command: 'removeLink', url: el.dataset.remove });
			});
		});

		const linkLabel = document.getElementById('link-label');
		const linkUrl = document.getElementById('link-url');
		const addLink = () => vscode.postMessage({ command: 'addLink', label: linkLabel.value, url: linkUrl.value });
		document.getElementById('add-link').addEventListener('click', addLink);
		[linkLabel, linkUrl].forEach((el) => el.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') {
				addLink();
			}
		}));
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
