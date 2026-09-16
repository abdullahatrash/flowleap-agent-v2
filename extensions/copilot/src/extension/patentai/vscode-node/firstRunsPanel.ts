/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { randomUUID } from 'crypto';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { IVSCodeExtensionContext } from '../../../platform/extContext/common/extensionContext';
import { ILogService } from '../../../platform/log/common/logService';
import { hashTelemetryValue } from '../../../util/node/crypto';
import { DisposableStore } from '../../../util/vs/base/common/lifecycle';
import { buildSampleDisclosureUrl, FirstRun, firstRuns } from '../common/firstRuns';
import { getPatentAIConfig } from './configService';
import { FirstRunsController, FirstRunsSurface } from './firstRunsController';
import { FlowLeapAuthenticationProvider } from './flowleapAuthProvider';

/**
 * The first-runs surface: an editor tab carrying the three published first runs, opened once per
 * account on the first launch after a FlowLeap Session exists.
 *
 * It exists because FlowLeap opens on an empty editor. A user who arrived from the website's
 * `/welcome` page or the day-0 trial email has been shown three things to try and then lands on
 * nothing, so the app repeats the same three — the editor area is where they are already looking.
 *
 * Each run is one click that puts the published prompt into the chat input WITHOUT sending it
 * (`isPartialQuery`), so the user reads what they are about to ask before they ask it. The same
 * three also ship as bundled `.prompt.md` files, so they stay reachable in the Prompts view long
 * after this tab is gone.
 */

/** Opens the surface on demand. Contributed so the three stay reachable after a dismiss. */
export const FIRST_RUNS_COMMAND = 'flowleap.firstRuns';

/** Webview panel type, and the tab's serializer key. */
export const FIRST_RUNS_VIEW_TYPE = 'flowleap.firstRuns';

/** The workbench action that prefills the chat input. Probed before a launch opens the tab. */
const CHAT_OPEN_COMMAND = 'workbench.action.chat.open';

/** What the page posts back. Anything else is ignored. */
type FirstRunsInMessage =
	| { readonly type: 'run'; readonly id: string }
	| { readonly type: 'openSample' }
	| { readonly type: 'dismiss' };

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

/** One card: the run's name, its prompt verbatim, what comes back, and the actions. */
function renderCard(run: FirstRun, index: number, sampleUrl: string): string {
	const note = run.note ? `<p class="note">${escapeHtml(run.note)}</p>` : '';
	const sample = run.attachment === 'sample'
		? `<a class="sample" href="${escapeHtml(sampleUrl)}" data-action="openSample">${escapeHtml(l10n.t('Download the sample disclosure (PDF)'))}</a>`
		: '';
	return `<section class="card">
		<div class="card-index">${index + 1}</div>
		<div class="card-body">
			<h2 class="card-title">${escapeHtml(run.name)}</h2>
			<p class="prompt">${escapeHtml(run.prompt)}</p>
			<p class="result">${escapeHtml(run.result)}</p>
			${note}
			<div class="actions">
				<button class="primary" data-action="run" data-id="${escapeHtml(run.id)}">${escapeHtml(l10n.t('Open in Chat'))}</button>
				${sample}
			</div>
		</div>
	</section>`;
}

/**
 * The page markup. Fully server-rendered — the three runs never change while the tab is open, so
 * there is no state to post in. Exported for tests.
 *
 * @param nonce Script nonce for the Content Security Policy.
 * @param runs The three first runs, in published order.
 * @param sampleUrl Public URL of the sample disclosure offered with the prior-art run.
 */
export function renderFirstRunsHtml(nonce: string, runs: readonly FirstRun[], sampleUrl: string): string {
	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>${escapeHtml(l10n.t('First Runs'))}</title>
	<style>
		* { margin: 0; padding: 0; box-sizing: border-box; }
		body {
			font-family: var(--vscode-font-family, sans-serif);
			background: var(--vscode-editor-background);
			color: var(--vscode-foreground);
			font-size: 13px;
			line-height: 1.5;
		}
		.container { max-width: 720px; margin: 0 auto; padding: 40px 28px 56px; }
		h1 { font-size: 22px; font-weight: 600; margin-bottom: 6px; }
		.subtitle { color: var(--vscode-descriptionForeground); margin-bottom: 28px; }
		.card {
			display: flex;
			gap: 14px;
			background: var(--vscode-editorWidget-background, var(--vscode-editor-background));
			border: 1px solid var(--vscode-widget-border, var(--vscode-editorWidget-border, transparent));
			border-radius: 8px;
			padding: 16px;
			margin-bottom: 14px;
		}
		.card-index {
			flex: none;
			width: 22px; height: 22px; border-radius: 11px;
			font-size: 11px; font-weight: 600; text-align: center; line-height: 22px;
			background: color-mix(in srgb, var(--vscode-textLink-foreground) 18%, transparent);
			color: var(--vscode-textLink-foreground);
		}
		.card-body { flex: 1; min-width: 0; }
		.card-title { font-size: 15px; font-weight: 600; margin-bottom: 8px; }
		.prompt {
			font-family: var(--vscode-editor-font-family, monospace);
			font-size: 12px;
			padding: 10px 12px;
			border-radius: 6px;
			background: var(--vscode-textCodeBlock-background, var(--vscode-editor-background));
			border: 1px solid var(--vscode-widget-border, transparent);
			margin-bottom: 10px;
			white-space: pre-wrap;
			overflow-wrap: break-word;
		}
		.result { margin-bottom: 8px; }
		.note { color: var(--vscode-descriptionForeground); font-size: 12px; margin-bottom: 10px; }
		.actions { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; margin-top: 12px; }
		button {
			font-family: inherit; font-size: 13px; padding: 5px 14px; border: none; border-radius: 3px; cursor: pointer;
		}
		button.primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
		button.primary:hover { background: var(--vscode-button-hoverBackground); }
		button.link {
			background: none; color: var(--vscode-textLink-foreground); padding: 0; text-decoration: underline;
		}
		a.sample { color: var(--vscode-textLink-foreground); font-size: 12px; }
		.footer {
			display: flex; align-items: center; justify-content: space-between; gap: 14px; flex-wrap: wrap;
			margin-top: 26px; padding-top: 18px;
			border-top: 1px solid var(--vscode-widget-border, var(--vscode-editorWidget-border, transparent));
			color: var(--vscode-descriptionForeground); font-size: 12px;
		}
	</style>
</head>
<body>
	<main class="container">
		<h1>${escapeHtml(l10n.t('Your First Ten Minutes'))}</h1>
		<p class="subtitle">${escapeHtml(l10n.t('Three runs that show what the agent does with real patent data. Every result carries its source.'))}</p>
		${runs.map((run, index) => renderCard(run, index, sampleUrl)).join('\n')}
		<div class="footer">
			<span>${escapeHtml(l10n.t('These three stay in the Prompts view in the FlowLeap sidebar.'))}</span>
			<button class="link" data-action="dismiss">${escapeHtml(l10n.t('Don\'t Show This Again'))}</button>
		</div>
	</main>
	<script nonce="${nonce}">
		const vscode = acquireVsCodeApi();
		document.addEventListener('click', event => {
			const target = event.target.closest('[data-action]');
			if (!target) { return; }
			event.preventDefault();
			const action = target.getAttribute('data-action');
			if (action === 'run') {
				vscode.postMessage({ type: 'run', id: target.getAttribute('data-id') });
			} else if (action === 'openSample') {
				vscode.postMessage({ type: 'openSample' });
			} else if (action === 'dismiss') {
				vscode.postMessage({ type: 'dismiss' });
			}
		});
	</script>
</body>
</html>`;
}

/** The webview tab behind {@link FirstRunsSurface}. One tab at a time; reopening reveals it. */
class FirstRunsPanel implements FirstRunsSurface {

	private _panel: vscode.WebviewPanel | undefined;
	private _controller: FirstRunsController | undefined;
	/** Everything one open tab owns. Cleared when that tab closes, so reopening starts empty. */
	private readonly _lifetime = new DisposableStore();

	constructor(private readonly _logService: ILogService) { }

	/**
	 * Hand the panel its controller. Set once, straight after construction — the two refer to each
	 * other (the controller opens the panel; the panel's dismiss button records through it).
	 */
	setController(controller: FirstRunsController): void {
		this._controller = controller;
	}

	show(): void {
		if (this._panel) {
			this._panel.reveal(vscode.ViewColumn.One);
			return;
		}
		const panel = vscode.window.createWebviewPanel(
			FIRST_RUNS_VIEW_TYPE,
			l10n.t('First Runs'),
			vscode.ViewColumn.One,
			{ enableScripts: true, localResourceRoots: [] },
		);
		this._panel = panel;
		panel.webview.html = renderFirstRunsHtml(randomUUID(), firstRuns(), buildSampleDisclosureUrl(getPatentAIConfig().frontendUrl));
		this._lifetime.add(panel);
		this._lifetime.add(panel.webview.onDidReceiveMessage((message: FirstRunsInMessage) => void this._onMessage(message)));
		this._lifetime.add(panel.onDidDispose(() => {
			this._panel = undefined;
			// Drop this tab's subscriptions rather than letting them pile up across reopens.
			this._lifetime.clear();
		}));
	}

	close(): void {
		// Disposing the panel fires onDidDispose, which clears the store and forgets the tab.
		this._panel?.dispose();
	}

	dispose(): void {
		this._lifetime.dispose();
		this._panel = undefined;
	}

	private async _onMessage(message: FirstRunsInMessage): Promise<void> {
		try {
			switch (message.type) {
				case 'run':
					await this._prefillChat(message.id);
					return;
				case 'openSample':
					await vscode.env.openExternal(vscode.Uri.parse(buildSampleDisclosureUrl(getPatentAIConfig().frontendUrl)));
					return;
				case 'dismiss':
					await this._controller?.dismiss();
					return;
			}
		} catch (error) {
			this._logService.error(`[Patent AI] First runs: ${message.type} failed: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	/**
	 * Put the run's prompt in the chat input, unsent. `isPartialQuery` is what makes it unsent: the
	 * user sees the whole ask, adds the attachment the run needs, and presses enter themselves.
	 */
	private async _prefillChat(id: string): Promise<void> {
		const run = firstRuns().find(candidate => candidate.id === id);
		if (!run) {
			return;
		}
		await vscode.commands.executeCommand(CHAT_OPEN_COMMAND, { query: run.prompt, isPartialQuery: true });
	}
}

/**
 * Register the first-runs surface, its command, and the two triggers that open it on a first
 * launch — startup for an already signed-in user, and the sign-in transition for a new one.
 *
 * @param context Extension context; owns the once-per-account markers in globalState.
 * @param authProvider The FlowLeap Session owner, read for the account to key the markers by.
 * @param logService Records why a launch did not open the surface.
 */
export function registerFirstRuns(context: IVSCodeExtensionContext, authProvider: FlowLeapAuthenticationProvider, logService: ILogService): vscode.Disposable {
	const panel = new FirstRunsPanel(logService);
	const controller = new FirstRunsController(
		context,
		async () => (await authProvider.getSessions())[0]?.account.id,
		hashTelemetryValue,
		panel,
		logService,
	);
	panel.setController(controller);

	// Every card on the page is a click into the chat input, so a window with no chat — the Agents
	// window materializes none of this workbench's chat actions — must not be greeted with a tab
	// whose buttons do nothing. The command stays registered either way.
	const openOnLaunch = async (): Promise<void> => {
		if ((await vscode.commands.getCommands(true)).includes(CHAT_OPEN_COMMAND)) {
			await controller.maybeShowOnLaunch();
		}
	};

	const disposables: vscode.Disposable[] = [
		new vscode.Disposable(() => panel.dispose()),
		vscode.commands.registerCommand(FIRST_RUNS_COMMAND, () => controller.showOnDemand()),
		authProvider.onDidChangeSessions(event => {
			if ((event.added?.length ?? 0) > 0) {
				void openOnLaunch();
			}
		}),
	];

	void authProvider.waitForInitialization().then(
		openOnLaunch,
		() => { /* a failed session restore is not a launch to greet */ },
	);

	logService.info('[Patent AI] FlowLeap first runs registered');
	return vscode.Disposable.from(...disposables);
}
