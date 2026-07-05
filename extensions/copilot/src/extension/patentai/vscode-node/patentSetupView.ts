/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ILogService } from '../../../platform/log/common/logService';
import { FlowLeapAuthenticationProvider } from './flowleapAuthProvider';
import { PatentDataKeysStore } from './patentDataKeysStore';
import { PATENT_DATA_KEYS_COMMAND } from './patentDataKeysPage';
import { NON_BYOK_VENDORS } from './patentEndpointProvider';

/**
 * The "Setup" view under the FlowLeap activity-bar container (contributed by this
 * extension INTO the flowleap shell's `flowleap-sidebar` container, which core allows —
 * this extension owns all the state the view displays: the auth session, the BYOK model
 * pool, and the patent-data keys store). One glance answers "is my FlowLeap setup
 * complete?"; every row clicks through to the flow that fixes it.
 */

export const SETUP_VIEW_ID = 'flowleap.setupView';

/** Plain data for one setup row — kept UI-free so the composition is unit-testable. */
export interface SetupItemData {
	readonly id: string;
	readonly label: string;
	readonly description: string;
	readonly tooltip: string;
	readonly icon: string;
	readonly ok: boolean;
	readonly command?: { command: string; arguments?: unknown[] };
}

export interface SetupState {
	readonly signedIn: boolean;
	readonly accountLabel?: string;
	readonly byokModelCount: number;
	readonly epoConfigured: boolean;
	readonly usptoConfigured: boolean;
}

export function buildSetupItems(state: SetupState): SetupItemData[] {
	return [
		{
			id: 'account',
			label: 'Account',
			description: state.signedIn ? (state.accountLabel ?? 'Signed in') : 'Sign in…',
			tooltip: state.signedIn
				? `Signed in to FlowLeap as ${state.accountLabel ?? 'your account'}. Manage via the Accounts menu.`
				: 'Sign in to FlowLeap to use the patent-data tools.',
			icon: 'account',
			ok: state.signedIn,
			command: state.signedIn ? undefined : { command: 'flowleap.signIn' },
		},
		{
			id: 'aiModel',
			label: 'AI Model',
			description: state.byokModelCount > 0 ? `${state.byokModelCount} connected` : 'Add your key…',
			tooltip: state.byokModelCount > 0
				? `${state.byokModelCount} model${state.byokModelCount === 1 ? '' : 's'} connected with your own key. Click to manage.`
				: 'Connect an AI model with your own provider key (Anthropic, OpenAI, OpenRouter, …) to start chatting.',
			icon: 'sparkle',
			ok: state.byokModelCount > 0,
			command: { command: 'workbench.action.chat.manage' },
		},
		{
			id: 'epo',
			label: 'EPO OPS',
			description: state.epoConfigured ? 'Configured' : 'Add key…',
			tooltip: state.epoConfigured
				? 'Your EPO OPS credentials are stored on this machine. Click to test, update, or remove.'
				: 'Add your EPO OPS consumer key + secret for European patent data.',
			icon: 'key',
			ok: state.epoConfigured,
			command: { command: PATENT_DATA_KEYS_COMMAND, arguments: ['epo'] },
		},
		{
			id: 'uspto',
			label: 'USPTO ODP',
			description: state.usptoConfigured ? 'Configured' : 'Add key…',
			tooltip: state.usptoConfigured
				? 'Your USPTO ODP key is stored on this machine. Click to test, update, or remove.'
				: 'Add your USPTO ODP API key for US patent data and citation analysis.',
			icon: 'key',
			ok: state.usptoConfigured,
			command: { command: PATENT_DATA_KEYS_COMMAND, arguments: ['uspto'] },
		},
	];
}

class PatentSetupTreeProvider implements vscode.TreeDataProvider<SetupItemData> {

	private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
	readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

	constructor(
		private readonly _store: PatentDataKeysStore,
		private readonly _authProvider: FlowLeapAuthenticationProvider,
	) { }

	refresh(): void {
		this._onDidChangeTreeData.fire();
	}

	async getChildren(element?: SetupItemData): Promise<SetupItemData[]> {
		if (element) {
			return [];
		}
		return buildSetupItems(await this._collectState());
	}

	getTreeItem(data: SetupItemData): vscode.TreeItem {
		const item = new vscode.TreeItem(data.label, vscode.TreeItemCollapsibleState.None);
		item.id = data.id;
		item.description = data.description + (data.ok ? ' ✓' : '');
		item.tooltip = data.tooltip;
		item.iconPath = new vscode.ThemeIcon(data.icon, data.ok ? undefined : new vscode.ThemeColor('notificationsWarningIcon.foreground'));
		if (data.command) {
			item.command = { title: data.label, ...data.command };
		}
		return item;
	}

	private async _collectState(): Promise<SetupState> {
		const keys = this._store.getKeys();

		let signedIn = false;
		let accountLabel: string | undefined;
		try {
			const sessions = await this._authProvider.getSessions();
			signedIn = sessions.length > 0;
			accountLabel = sessions[0]?.account.label;
		} catch {
			// Treat an unreadable session as signed out — the row then offers sign-in.
		}

		let byokModelCount = 0;
		try {
			const models = await vscode.lm.selectChatModels({});
			byokModelCount = models.filter(m => !NON_BYOK_VENDORS.has(m.vendor)).length;
		} catch {
			// Model enumeration unavailable (e.g. during startup) — show the connect nudge.
		}

		return {
			signedIn,
			accountLabel,
			byokModelCount,
			epoConfigured: !!keys?.epo,
			usptoConfigured: !!keys?.usptoOdp,
		};
	}
}

/** Register the Setup tree view and its refresh triggers. */
export function registerPatentSetupView(store: PatentDataKeysStore, authProvider: FlowLeapAuthenticationProvider, logService: ILogService): vscode.Disposable {
	const provider = new PatentSetupTreeProvider(store, authProvider);
	const disposables: vscode.Disposable[] = [
		vscode.window.registerTreeDataProvider(SETUP_VIEW_ID, provider),
		store.onDidChange(() => provider.refresh()),
		authProvider.onDidChangeSessions(() => provider.refresh()),
		vscode.lm.onDidChangeChatModels(() => provider.refresh()),
	];
	logService.info('[Patent AI] FlowLeap Setup view registered');
	return vscode.Disposable.from(...disposables);
}
