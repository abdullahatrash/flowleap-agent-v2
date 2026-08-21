/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ILogService } from '../../../platform/log/common/logService';
import { FlowLeapTrialLMProvider } from '../../byok/vscode-node/flowleapTrialProvider';
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
	/** Models connected with the user's OWN provider key (FlowLeap Trial models excluded). */
	readonly byokModelCount: number;
	/**
	 * Models served by the FlowLeap Trial provider (ADR 0015). Only present while `trialing` —
	 * the provider hides them for every other subscription state. With no own-key models, the
	 * AI Model row counts them as configured but tells the truth: FlowLeap pays for them via
	 * OpenRouter, and the user should add their own key before the trial ends. Optional
	 * (defaults to 0).
	 */
	readonly trialModelCount?: number;
	readonly epoConfigured: boolean;
	readonly usptoConfigured: boolean;
	/**
	 * Whether the FlowLeap subscription is currently a trial. When true, the still-missing patent-
	 * data key rows carry a deadline-framed description: today the keys are good practice, but once
	 * backend ADR 0008 lands (`data_keys_required` after the trial) they become load-bearing, so we
	 * make the "add them before the trial ends" ask concrete now. Optional (defaults to false).
	 */
	readonly trialing?: boolean;
}

/** Description for a missing patent-data key row — deadline-framed while trialing, plain otherwise. */
function missingKeyDescription(trialing: boolean | undefined): string {
	return trialing ? 'Add before your trial ends — free to obtain' : 'Add key…';
}

/** The AI Model row's description/tooltip triple — own-key models, trial-only models, or none. */
function aiModelRow(state: SetupState): { description: string; tooltip: string; ok: boolean } {
	if (state.byokModelCount > 0) {
		return {
			description: `${state.byokModelCount} connected`,
			tooltip: `${state.byokModelCount} model${state.byokModelCount === 1 ? '' : 's'} connected with your own key. Click to manage.`,
			ok: true,
		};
	}
	if ((state.trialModelCount ?? 0) > 0) {
		return {
			description: 'FlowLeap Trial — add your own key before the trial ends',
			tooltip: 'Chat runs on FlowLeap Trial models: FlowLeap pays for them via OpenRouter during your free trial, and they stop when it ends. Add your own provider key (Anthropic, OpenAI, OpenRouter, …) at any time to switch — your models then take over. Click to manage.',
			ok: true,
		};
	}
	return {
		description: 'Add your key…',
		tooltip: 'Connect an AI model with your own provider key (Anthropic, OpenAI, OpenRouter, …) to start chatting.',
		ok: false,
	};
}

export function buildSetupItems(state: SetupState): SetupItemData[] {
	const aiModel = aiModelRow(state);
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
			description: aiModel.description,
			tooltip: aiModel.tooltip,
			icon: 'sparkle',
			ok: aiModel.ok,
			command: { command: 'workbench.action.chat.manage' },
		},
		{
			id: 'epo',
			label: 'EPO OPS',
			description: state.epoConfigured ? 'Configured' : missingKeyDescription(state.trialing),
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
			description: state.usptoConfigured ? 'Configured' : missingKeyDescription(state.trialing),
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
		let trialModelCount = 0;
		try {
			const models = await vscode.lm.selectChatModels({});
			// FlowLeap Trial models are counted separately: they satisfy the row, but its copy must
			// say who pays for them and that they end with the trial (ADR 0015 disclosure, #243).
			trialModelCount = models.filter(m => m.vendor === FlowLeapTrialLMProvider.providerId).length;
			byokModelCount = models.filter(m => !NON_BYOK_VENDORS.has(m.vendor) && m.vendor !== FlowLeapTrialLMProvider.providerId).length;
		} catch {
			// Model enumeration unavailable (e.g. during startup) — show the connect nudge.
		}

		// Trial state drives the deadline-framed copy on missing patent-data key rows. Only worth a
		// read when signed in (an anonymous user can't be trialing); `getSubscriptionSnapshot`
		// itself short-circuits to `unknown` without a token, so this stays cheap when signed out.
		let trialing = false;
		if (signedIn) {
			try {
				trialing = (await this._authProvider.getSubscriptionSnapshot()).status === 'trialing';
			} catch {
				// Inconclusive subscription read — leave the rows in their neutral "Add key…" copy.
			}
		}

		return {
			signedIn,
			accountLabel,
			byokModelCount,
			trialModelCount,
			epoConfigured: !!keys?.epo,
			usptoConfigured: !!keys?.usptoOdp,
			trialing,
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
