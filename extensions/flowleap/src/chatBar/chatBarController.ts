/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

interface ChatMode {
	id: string;
	label: string;
	description: string;
	icon: string;
}

/** A quick-pick entry that carries a {@link ChatMode}, so mode entries can be discriminated without the `in` operator. */
interface ChatModeQuickPickItem extends vscode.QuickPickItem {
	readonly mode: ChatMode;
}

function isChatModeQuickPickItem(item: vscode.QuickPickItem): item is ChatModeQuickPickItem {
	return (item as Partial<ChatModeQuickPickItem>).mode !== undefined;
}

const CHAT_MODES: ChatMode[] = [
	{
		id: 'default',
		label: 'Default',
		description: 'General assistance and patent analysis',
		icon: '$(comment-discussion)'
	},
	{
		id: 'plan',
		label: 'Plan',
		description: 'Create step-by-step analysis plans',
		icon: '$(list-ordered)'
	},
	{
		id: 'search',
		label: 'Search',
		description: 'Search patents and prior art',
		icon: '$(search)'
	},
	{
		id: 'analyze',
		label: 'Analyze',
		description: 'Deep patent analysis mode',
		icon: '$(beaker)'
	}
];

export class ChatBarController implements vscode.Disposable {
	private statusBarItem: vscode.StatusBarItem;
	private currentMode: ChatMode = CHAT_MODES[0];
	private disposables: vscode.Disposable[] = [];

	constructor(private readonly context: vscode.ExtensionContext) {
		// Create status bar item that spans across the status bar
		this.statusBarItem = vscode.window.createStatusBarItem(
			vscode.StatusBarAlignment.Left,
			-1000 // Very low priority to be at the far left after other items
		);

		this.statusBarItem.name = 'FlowLeap Chat';
		this.statusBarItem.command = 'flowleap.openChatQuickPick';
		this.updateStatusBar();
		this.statusBarItem.show();

		// Register the quick pick command
		this.disposables.push(
			vscode.commands.registerCommand('flowleap.openChatQuickPick', () => this.showChatQuickPick())
		);

		// Register mode change command
		this.disposables.push(
			vscode.commands.registerCommand('flowleap.setChatMode', (modeId: string) => this.setMode(modeId))
		);

		this.disposables.push(this.statusBarItem);
	}

	private updateStatusBar(): void {
		this.statusBarItem.text = `$(comment-discussion) Ask FlowLeap...`;
		this.statusBarItem.tooltip = new vscode.MarkdownString(
			`**FlowLeap AI Assistant**\n\nCurrent mode: ${this.currentMode.label}\n\n*Click to open chat or change mode*`,
			true
		);
		this.statusBarItem.backgroundColor = undefined;
	}

	private async showChatQuickPick(): Promise<void> {
		const items: vscode.QuickPickItem[] = [
			{
				label: '$(comment-discussion) Start New Chat',
				description: 'Open the AI chat panel',
				alwaysShow: true
			},
			{
				label: '',
				kind: vscode.QuickPickItemKind.Separator
			},
			{
				label: '$(gear) Mode',
				description: this.currentMode.label,
				detail: 'Change the chat mode'
			},
			{
				label: '',
				kind: vscode.QuickPickItemKind.Separator
			},
			...CHAT_MODES.map((mode): ChatModeQuickPickItem => ({
				label: `${mode.icon} ${mode.label}`,
				description: mode.id === this.currentMode.id ? '(current)' : '',
				detail: mode.description,
				mode: mode
			}))
		];

		const quickPick = vscode.window.createQuickPick();
		quickPick.items = items;
		quickPick.placeholder = 'Ask FlowLeap anything about patents...';
		quickPick.matchOnDescription = true;
		quickPick.matchOnDetail = true;

		// Custom input box for direct questions
		quickPick.onDidChangeValue(value => {
			if (value && value.length > 0) {
				// User is typing a question
				const customItem: vscode.QuickPickItem = {
					label: `$(search) Ask: "${value}"`,
					alwaysShow: true
				};
				quickPick.items = [customItem, ...items];
			} else {
				quickPick.items = items;
			}
		});

		quickPick.onDidAccept(async () => {
			const selected = quickPick.selectedItems[0];

			if (!selected) {
				// User typed a question and pressed enter
				const question = quickPick.value;
				if (question) {
					quickPick.hide();
					await this.askQuestion(question);
				}
				return;
			}

			const label = selected.label;

			if (label.includes('Start New Chat')) {
				quickPick.hide();
				await vscode.commands.executeCommand('flowleap.chatInput.focus');
			} else if (label.startsWith('$(search) Ask:')) {
				const question = quickPick.value;
				quickPick.hide();
				await this.askQuestion(question);
			} else if (isChatModeQuickPickItem(selected)) {
				const mode = selected.mode;
				this.setMode(mode.id);
				quickPick.hide();
				vscode.window.showInformationMessage(`Chat mode set to: ${mode.label}`);
			}
		});

		quickPick.onDidHide(() => quickPick.dispose());
		quickPick.show();
	}

	private async askQuestion(question: string): Promise<void> {
		// Open the FlowLeap chat panel.
		await vscode.commands.executeCommand('flowleap.chatInput.focus');

		// Note: In a real implementation, we would send the question to the chat
		// This requires integration with the VS Code Chat API
		vscode.window.showInformationMessage(`Question: ${question}`);
	}

	private setMode(modeId: string): void {
		const mode = CHAT_MODES.find(m => m.id === modeId);
		if (mode) {
			this.currentMode = mode;
			this.updateStatusBar();
			this.context.globalState.update('flowleap.chatMode', modeId);
		}
	}

	dispose(): void {
		this.disposables.forEach(d => d.dispose());
	}
}

export class ChatInputPanel implements vscode.WebviewViewProvider {
	public static readonly viewType = 'flowleap.chatInput';

	private _view?: vscode.WebviewView;

	constructor(
		private readonly _extensionUri: vscode.Uri,
		private readonly _context: vscode.ExtensionContext
	) { }

	public resolveWebviewView(
		webviewView: vscode.WebviewView,
		_context: vscode.WebviewViewResolveContext,
		_token: vscode.CancellationToken,
	) {
		this._view = webviewView;

		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [this._extensionUri]
		};

		webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

		webviewView.webview.onDidReceiveMessage(data => {
			switch (data.type) {
				case 'submit':
					this.handleSubmit(data.message, data.mode);
					break;
				case 'modeChange':
					vscode.commands.executeCommand('flowleap.setChatMode', data.mode);
					break;
			}
		});
	}

	private async handleSubmit(_message: string, _mode: string): Promise<void> {
		// Open FlowLeap chat and send message.
		await vscode.commands.executeCommand('flowleap.chatInput.focus');
		// In real implementation, send the message
	}

	private _getHtmlForWebview(webview: vscode.Webview): string {
		const nonce = getNonce();

		return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<style>
		:root {
			--bg: var(--vscode-input-background);
			--border: var(--vscode-input-border);
			--text: var(--vscode-input-foreground);
			--placeholder: var(--vscode-input-placeholderForeground);
			--accent: var(--vscode-focusBorder);
		}

		* {
			margin: 0;
			padding: 0;
			box-sizing: border-box;
		}

		body {
			padding: 8px;
			font-family: var(--vscode-font-family);
		}

		.chat-container {
			display: flex;
			flex-direction: column;
			gap: 8px;
		}

		.input-wrapper {
			display: flex;
			align-items: center;
			background: var(--bg);
			border: 1px solid var(--border);
			border-radius: 6px;
			padding: 0 12px;
		}

		.input-wrapper:focus-within {
			border-color: var(--accent);
		}

		.chat-input {
			flex: 1;
			background: transparent;
			border: none;
			padding: 10px 0;
			font-size: 13px;
			color: var(--text);
			outline: none;
		}

		.chat-input::placeholder {
			color: var(--placeholder);
		}

		.send-btn {
			background: none;
			border: none;
			color: var(--accent);
			cursor: pointer;
			padding: 4px 8px;
			font-size: 14px;
		}

		.send-btn:hover {
			opacity: 0.8;
		}

		.mode-selector {
			display: flex;
			gap: 4px;
		}

		.mode-btn {
			background: var(--bg);
			border: 1px solid var(--border);
			color: var(--text);
			padding: 4px 10px;
			border-radius: 4px;
			font-size: 11px;
			cursor: pointer;
			opacity: 0.7;
			transition: all 0.15s;
		}

		.mode-btn:hover {
			opacity: 1;
		}

		.mode-btn.active {
			border-color: var(--accent);
			opacity: 1;
		}
	</style>
</head>
<body>
	<div class="chat-container">
		<div class="mode-selector">
			<button class="mode-btn active" data-mode="default">Default</button>
			<button class="mode-btn" data-mode="plan">Plan</button>
			<button class="mode-btn" data-mode="search">Search</button>
			<button class="mode-btn" data-mode="analyze">Analyze</button>
		</div>
		<div class="input-wrapper">
			<input type="text" class="chat-input" placeholder="Ask FlowLeap..." />
			<button class="send-btn">→</button>
		</div>
	</div>

	<script nonce="${nonce}">
		const vscode = acquireVsCodeApi();
		const input = document.querySelector('.chat-input');
		const sendBtn = document.querySelector('.send-btn');
		const modeButtons = document.querySelectorAll('.mode-btn');
		let currentMode = 'default';

		modeButtons.forEach(btn => {
			btn.addEventListener('click', () => {
				modeButtons.forEach(b => b.classList.remove('active'));
				btn.classList.add('active');
				currentMode = btn.dataset.mode;
				vscode.postMessage({ type: 'modeChange', mode: currentMode });
			});
		});

		function submit() {
			const message = input.value.trim();
			if (message) {
				vscode.postMessage({ type: 'submit', message, mode: currentMode });
				input.value = '';
			}
		}

		sendBtn.addEventListener('click', submit);
		input.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') submit();
		});
	</script>
</body>
</html>`;
	}
}

function getNonce(): string {
	let text = '';
	const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	for (let i = 0; i < 32; i++) {
		text += possible.charAt(Math.floor(Math.random() * possible.length));
	}
	return text;
}
