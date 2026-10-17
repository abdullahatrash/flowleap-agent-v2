/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Remote Access in the Agents Window title bar (PRD 0018 B3): the switch, the
// Pairing dialog (QR + pasteable code) and the Viewer list. Vocabulary from
// CONTEXT.md → Remote Access: Host, Viewer, Pairing, Relay.

import * as DOM from '../../../../base/browser/dom.js';
import { Button } from '../../../../base/browser/ui/button/button.js';
import { Dialog } from '../../../../base/browser/ui/dialog/dialog.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { encodeQrCode, QrErrorCorrection, qrCodeToSvgPath } from '../../../../base/common/qrCode.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { localize, localize2 } from '../../../../nls.js';
import { Action2, MenuRegistry, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { RemoteAccessHostState, IRemoteAccessHostStatus } from '../../../../platform/agentHost/common/remoteAccessHost.js';
import { IClipboardService } from '../../../../platform/clipboard/common/clipboardService.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { ILayoutService } from '../../../../platform/layout/browser/layoutService.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { INotificationService, Severity } from '../../../../platform/notification/common/notification.js';
import { IQuickInputService, IQuickPickItem, IQuickPickSeparator } from '../../../../platform/quickinput/common/quickInput.js';
import { defaultButtonStyles, defaultDialogStyles } from '../../../../platform/theme/browser/defaultStyles.js';
import { createWorkbenchDialogOptions } from '../../../../workbench/browser/parts/dialogs/dialog.js';
import { IsAuxiliaryWindowContext, IsSessionsWindowContext } from '../../../../workbench/common/contextkeys.js';
import {
	IRemoteAccessPair, IRemoteAccessPairingOffer, IRemoteAccessService, RemoteAccessEnabledContext, RemoteAccessError, RemoteAccessErrorKind,
} from '../../../../workbench/contrib/chat/common/remoteAccess/remoteAccess.js';
import { IHostService } from '../../../../workbench/services/host/browser/host.js';
import { Menus } from '../../../browser/menus.js';
import './media/remoteAccess.css';

export const TOGGLE_REMOTE_ACCESS_ID = 'flowleap.remoteAccess.toggle';
export const PAIR_VIEWER_ID = 'flowleap.remoteAccess.pairViewer';
export const MANAGE_VIEWERS_ID = 'flowleap.remoteAccess.manageViewers';
/** The `flowleap` authentication provider's sign-in command (extension). */
const FLOWLEAP_SIGN_IN_COMMAND = 'flowleap.signIn';

const category = localize2('remoteAccess.category', "Remote Access");
const titleBarWhen = ContextKeyExpr.and(IsSessionsWindowContext, IsAuxiliaryWindowContext.toNegated());

/** Services resolved synchronously in `run`: a ServicesAccessor is invalid after the first `await`. */
interface IRemoteAccessUiServices {
	readonly remoteAccessService: IRemoteAccessService;
	readonly notificationService: INotificationService;
	readonly commandService: ICommandService;
	readonly logService: ILogService;
	readonly layoutService: ILayoutService;
	readonly keybindingService: IKeybindingService;
	readonly hostService: IHostService;
	readonly clipboardService: IClipboardService;
}

function getUiServices(accessor: ServicesAccessor): IRemoteAccessUiServices {
	return {
		remoteAccessService: accessor.get(IRemoteAccessService),
		notificationService: accessor.get(INotificationService),
		commandService: accessor.get(ICommandService),
		logService: accessor.get(ILogService),
		layoutService: accessor.get(ILayoutService),
		keybindingService: accessor.get(IKeybindingService),
		hostService: accessor.get(IHostService),
		clipboardService: accessor.get(IClipboardService),
	};
}

function reportError({ notificationService, commandService, logService }: IRemoteAccessUiServices, error: unknown): void {
	if (error instanceof RemoteAccessError && error.kind === RemoteAccessErrorKind.NotSignedIn) {
		notificationService.prompt(Severity.Info, error.message, [{
			label: localize('remoteAccess.signIn', "Sign In"),
			run: () => commandService.executeCommand(FLOWLEAP_SIGN_IN_COMMAND),
		}]);
		return;
	}
	if (error instanceof RemoteAccessError) {
		notificationService.error(error.message);
		return;
	}
	logService.error('[RemoteAccess]', error);
	notificationService.error(localize('remoteAccess.unexpectedError', "Remote Access failed: {0}", error instanceof Error ? error.message : String(error)));
}

/** One line for the Host's Relay status, in the Remote Access vocabulary. */
export function describeHostStatus(status: IRemoteAccessHostStatus): string {
	switch (status.state) {
		case RemoteAccessHostState.Connected:
			return status.connectedPairIds.length === 1
				? localize('remoteAccess.status.connectedOne', "Connected to the Relay. 1 Viewer is following this Host.")
				: localize('remoteAccess.status.connectedMany', "Connected to the Relay. {0} Viewers are following this Host.", status.connectedPairIds.length);
		case RemoteAccessHostState.Connecting:
			return localize('remoteAccess.status.connecting', "Connecting to the Relay.");
		case RemoteAccessHostState.Retrying:
			return localize('remoteAccess.status.retrying', "The Relay cannot be reached. Trying again.");
		case RemoteAccessHostState.Unauthorized:
			return localize('remoteAccess.status.unauthorized', "The Relay refused the FlowLeap sign-in. Sign in again.");
		case RemoteAccessHostState.SubscriptionRequired:
			return localize('remoteAccess.status.subscription', "Remote Access needs an active FlowLeap subscription or trial.");
		case RemoteAccessHostState.Replaced:
			return localize('remoteAccess.status.replaced', "Another FlowLeap window or install took this Host's connection.");
		default:
			return localize('remoteAccess.status.off', "Remote Access is off.");
	}
}

// ---- Pairing dialog ---------------------------------------------------------------

async function showPairingDialog({ layoutService, keybindingService, hostService, clipboardService }: IRemoteAccessUiServices, offer: IRemoteAccessPairingOffer): Promise<void> {
	const disposables = new DisposableStore();
	try {
		const dialog = disposables.add(new Dialog(
			layoutService.activeContainer,
			localize('remoteAccess.pair.title', "Pair a Viewer"),
			[localize('remoteAccess.pair.done', "Done")],
			createWorkbenchDialogOptions({
				type: 'none',
				extraClasses: ['remote-access-pairing-dialog'],
				cancelId: 0,
				dialogStyles: defaultDialogStyles,
				renderBody: container => {
					const body = DOM.append(container, DOM.$('.remote-access-pairing'));
					DOM.append(body, DOM.$('p', undefined, localize('remoteAccess.pair.scan', "Scan this code with the phone or tablet you want to use as a Viewer. Sign in there with the same FlowLeap account.")));

					const qr = encodeQrCode(offer.url, QrErrorCorrection.Medium);
					const border = 4;
					const extent = qr.size + border * 2;
					const svgNs = 'http://www.w3.org/2000/svg';
					const svg = document.createElementNS(svgNs, 'svg');
					svg.setAttribute('viewBox', `0 0 ${extent} ${extent}`);
					svg.setAttribute('shape-rendering', 'crispEdges');
					svg.setAttribute('role', 'img');
					svg.setAttribute('aria-label', localize('remoteAccess.pair.qrLabel', "Pairing QR code"));
					const background = document.createElementNS(svgNs, 'rect');
					background.setAttribute('width', String(extent));
					background.setAttribute('height', String(extent));
					background.setAttribute('fill', '#ffffff');
					const modules = document.createElementNS(svgNs, 'path');
					modules.setAttribute('d', qrCodeToSvgPath(qr, border));
					modules.setAttribute('fill', '#000000');
					svg.append(background, modules);
					DOM.append(body, DOM.$('.remote-access-pairing-qr')).appendChild(svg);

					DOM.append(body, DOM.$('p', undefined, localize('remoteAccess.pair.paste', "On a computer without a camera, open remote.flowleap.co and paste this pairing code:")));
					const codeRow = DOM.append(body, DOM.$('.remote-access-pairing-code-row'));
					const code = DOM.append(codeRow, DOM.$('code.remote-access-pairing-code'));
					code.textContent = offer.code;
					const copy = disposables.add(new Button(codeRow, { ...defaultButtonStyles, secondary: true, title: localize('remoteAccess.pair.copyTitle', "Copy the pairing code") }));
					copy.label = localize('remoteAccess.pair.copy', "Copy");
					disposables.add(copy.onDidClick(async () => {
						await clipboardService.writeText(offer.code);
						copy.label = localize('remoteAccess.pair.copied', "Copied");
					}));

					DOM.append(body, DOM.$('p.remote-access-pairing-note', undefined, localize('remoteAccess.pair.note', "The code works once and expires in 10 minutes. The Relay never sees it, so it cannot read what this Host sends.")));
				},
			}, keybindingService, layoutService, hostService),
		));
		await dialog.show();
	} finally {
		disposables.dispose();
	}
}

async function pairViewer(services: IRemoteAccessUiServices): Promise<void> {
	const { remoteAccessService } = services;
	try {
		if (!remoteAccessService.enabled.get()) {
			await remoteAccessService.setEnabled(true);
		}
		const offer = await remoteAccessService.startPairing();
		await showPairingDialog(services, offer);
		void remoteAccessService.refreshPairs().catch(() => { /* the list refreshes on the next open */ });
	} catch (error) {
		reportError(services, error);
	}
}

// ---- Actions ------------------------------------------------------------------------

registerAction2(class ToggleRemoteAccessAction extends Action2 {
	constructor() {
		super({
			id: TOGGLE_REMOTE_ACCESS_ID,
			title: localize2('remoteAccess.turnOn', "Turn On Remote Access"),
			tooltip: localize('remoteAccess.turnOnTooltip', "Remote Access: let your paired phone or tablet follow this Host's Agent Sessions"),
			category,
			icon: Codicon.radioTower,
			toggled: {
				condition: RemoteAccessEnabledContext,
				title: localize('remoteAccess.turnOff', "Turn Off Remote Access"),
				tooltip: localize('remoteAccess.turnOffTooltip', "Remote Access is on: paired Viewers can follow this Host's Agent Sessions"),
			},
			f1: true,
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const services = getUiServices(accessor);
		const { remoteAccessService } = services;
		try {
			if (remoteAccessService.enabled.get()) {
				await remoteAccessService.setEnabled(false);
				return;
			}
			await remoteAccessService.setEnabled(true);
			let pairs = remoteAccessService.pairs.get();
			try {
				await remoteAccessService.refreshPairs();
				pairs = remoteAccessService.pairs.get();
			} catch {
				// Offline: fall back to the cached list.
			}
			if (pairs.length === 0) {
				await pairViewer(services);
			}
		} catch (error) {
			reportError(services, error);
		}
	}
});

registerAction2(class PairViewerAction extends Action2 {
	constructor() {
		super({
			id: PAIR_VIEWER_ID,
			title: localize2('remoteAccess.pairViewer', "Pair a Viewer"),
			category,
			icon: Codicon.deviceMobile,
			f1: true,
		});
	}

	run(accessor: ServicesAccessor): Promise<void> {
		return pairViewer(getUiServices(accessor));
	}
});

interface IPairItem extends IQuickPickItem {
	readonly pair?: IRemoteAccessPair;
	readonly run?: 'pair' | 'turnOff' | 'turnOn';
}

registerAction2(class ManageViewersAction extends Action2 {
	constructor() {
		super({
			id: MANAGE_VIEWERS_ID,
			title: localize2('remoteAccess.manageViewers', "Manage Viewers"),
			category,
			f1: true,
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const remoteAccessService = accessor.get(IRemoteAccessService);
		const quickInputService = accessor.get(IQuickInputService);
		const commandService = accessor.get(ICommandService);
		const notificationService = accessor.get(INotificationService);

		const removeButton = { iconClass: ThemeIcon.asClassName(Codicon.trash), tooltip: localize('remoteAccess.removeViewer', "Remove this Viewer") };
		const disposables = new DisposableStore();
		const picker = disposables.add(quickInputService.createQuickPick<IPairItem>({ useSeparators: true }));
		picker.title = localize('remoteAccess.manageViewers.title', "Remote Access Viewers");
		picker.placeholder = describeHostStatus(remoteAccessService.hostStatus.get());

		const render = () => {
			const online = new Set(remoteAccessService.hostStatus.get().connectedPairIds);
			const items: (IPairItem | IQuickPickSeparator)[] = [];
			for (const pair of remoteAccessService.pairs.get()) {
				const paired = pair.state !== 'offered';
				items.push({
					label: pair.viewerLabel || (paired ? localize('remoteAccess.unnamedViewer', "Viewer") : localize('remoteAccess.offeredViewer', "Pairing not finished")),
					description: online.has(pair.pairId) ? localize('remoteAccess.viewerOnline', "following now") : undefined,
					iconClass: ThemeIcon.asClassName(Codicon.deviceMobile),
					buttons: [removeButton],
					pair,
				});
			}
			if (items.length) {
				items.push({ type: 'separator' });
			}
			items.push({ label: localize('remoteAccess.pairAnother', "Pair a Viewer..."), iconClass: ThemeIcon.asClassName(Codicon.add), run: 'pair' });
			items.push(remoteAccessService.enabled.get()
				? { label: localize('remoteAccess.turnOff', "Turn Off Remote Access"), run: 'turnOff' }
				: { label: localize('remoteAccess.turnOn.item', "Turn On Remote Access"), run: 'turnOn' });
			picker.items = items;
		};
		render();

		disposables.add(picker.onDidTriggerItemButton(async e => {
			const pair = e.item.pair;
			if (!pair) {
				return;
			}
			try {
				await remoteAccessService.removePair(pair.pairId);
				render();
			} catch (error) {
				notificationService.error(error instanceof Error ? error.message : String(error));
			}
		}));
		disposables.add(picker.onDidAccept(() => {
			const item = picker.selectedItems[0];
			picker.hide();
			if (item?.run === 'pair') {
				void commandService.executeCommand(PAIR_VIEWER_ID);
			} else if (item?.run === 'turnOff' || item?.run === 'turnOn') {
				void commandService.executeCommand(TOGGLE_REMOTE_ACCESS_ID);
			}
		}));
		disposables.add(picker.onDidHide(() => disposables.dispose()));
		picker.show();

		picker.busy = true;
		try {
			await remoteAccessService.refreshPairs();
			if (!disposables.isDisposed) {
				render();
			}
		} catch {
			// Keep the cached list; the status line says why.
		} finally {
			if (!disposables.isDisposed) {
				picker.busy = false;
			}
		}
	}
});

// ---- Title bar ------------------------------------------------------------------

MenuRegistry.appendMenuItem(Menus.TitleBarRightLayout, {
	command: {
		id: TOGGLE_REMOTE_ACCESS_ID,
		title: localize('remoteAccess.title', "Remote Access"),
		icon: Codicon.radioTower,
		toggled: RemoteAccessEnabledContext,
	},
	group: 'navigation',
	order: 90,
	when: titleBarWhen,
});
