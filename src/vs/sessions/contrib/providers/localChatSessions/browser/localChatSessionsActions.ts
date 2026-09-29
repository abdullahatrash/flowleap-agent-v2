/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { BaseActionViewItem } from '../../../../../base/browser/ui/actionbar/actionViewItems.js';
import { Disposable, DisposableStore, IDisposable } from '../../../../../base/common/lifecycle.js';
import { derived, IObservable } from '../../../../../base/common/observable.js';
import { localize2 } from '../../../../../nls.js';
import { IActionViewItemService } from '../../../../../platform/actions/browser/actionViewItemService.js';
import { Action2, registerAction2 } from '../../../../../platform/actions/common/actions.js';
import { ContextKeyExpr } from '../../../../../platform/contextkey/common/contextkey.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../../../workbench/common/contributions.js';
import { ChatPermissionLevel } from '../../../../../workbench/contrib/chat/common/constants.js';
import { Menus } from '../../../../browser/menus.js';
import { SessionProviderIdContext, SessionTypeContext } from '../../../../common/contextkeys.js';
import { ISessionContext } from '../../../../services/sessions/browser/sessionContext.js';
import { ISessionsProvidersService } from '../../../../services/sessions/browser/sessionsProvidersService.js';
import { ISession } from '../../../../services/sessions/common/session.js';
import { IActiveSession } from '../../../../services/sessions/common/sessionsManagement.js';
import { ModePicker, ScopedModePickerModelCache } from '../../copilotChatSessions/browser/modePicker.js';
import { IPermissionLevelMeta, IPermissionPickerDelegate, PermissionPicker } from '../../copilotChatSessions/browser/permissionPicker.js';
import { ILocalSessionConfiguration, LOCAL_PROVIDER_ID, LocalChatSessionsProvider, LocalSessionType } from './localChatSessionsProvider.js';

/*
 * FlowLeap: the mode and permission pickers of the new-session composer for
 * Local sessions. Upstream removed the Local harness (445ff849bd5) and with it
 * these registrations; the pickers themselves are upstream's shared widgets.
 */

const IsActiveLocalSession = ContextKeyExpr.and(
	ContextKeyExpr.equals(SessionTypeContext.key, LocalSessionType.id),
	ContextKeyExpr.equals(SessionProviderIdContext.key, LOCAL_PROVIDER_ID),
);

const LOCAL_MODE_PICKER_ID = 'sessions.local.modePicker';
const LOCAL_PERMISSION_PICKER_ID = 'sessions.local.permissionPicker';

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: LOCAL_MODE_PICKER_ID,
			title: localize2('localModePicker', "Mode"),
			f1: false,
			menu: [{ id: Menus.NewSessionConfig, group: 'navigation', order: 0, when: IsActiveLocalSession }],
		});
	}
	override async run(): Promise<void> { /* handled by the action view item */ }
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: LOCAL_PERMISSION_PICKER_ID,
			title: localize2('localPermissionPicker', "Permissions"),
			f1: false,
			menu: [{ id: Menus.NewSessionControl, group: 'navigation', order: 1, when: IsActiveLocalSession }],
		});
	}
	override async run(): Promise<void> { /* handled by the action view item */ }
});

/**
 * Wraps a standalone picker widget as a {@link BaseActionViewItem} so a
 * {@link MenuWorkbenchToolBar} can render it.
 */
class PickerActionViewItem extends BaseActionViewItem {
	constructor(private readonly picker: { render(container: HTMLElement): void; dispose(): void }, disposable?: IDisposable) {
		super(undefined, { id: '', label: '', enabled: true, class: undefined, tooltip: '', run: () => { } });
		if (disposable) {
			this._register(disposable);
		}
	}

	override render(container: HTMLElement): void {
		this.picker.render(container);
	}

	override dispose(): void {
		this.picker.dispose();
		super.dispose();
	}
}

/** Reads and changes the permission level of the active Local session. */
class LocalPermissionPickerDelegate implements IPermissionPickerDelegate {

	readonly currentPermissionLevel: IObservable<ChatPermissionLevel | undefined>;

	constructor(
		private readonly _session: IObservable<IActiveSession | undefined>,
		private readonly _sessionsProvidersService: ISessionsProvidersService,
	) {
		this.currentPermissionLevel = derived(reader => this._configuration(this._session.read(reader))?.permissionLevel.read(reader));
	}

	getPermissionLevelMeta(_level: ChatPermissionLevel, meta: IPermissionLevelMeta): IPermissionLevelMeta {
		return meta;
	}

	setPermissionLevel(level: ChatPermissionLevel): void {
		this._configuration(this._session.get())?.setPermissionLevel(level);
	}

	private _configuration(session: ISession | undefined): ILocalSessionConfiguration | undefined {
		const provider = session ? this._sessionsProvidersService.getProvider(session.providerId) : undefined;
		return session && provider instanceof LocalChatSessionsProvider ? provider.getSessionConfiguration(session.sessionId) : undefined;
	}
}

class LocalPickerActionViewItemContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'sessions.localPickerActionViewItems';

	constructor(
		@IActionViewItemService actionViewItemService: IActionViewItemService,
		@ISessionsProvidersService sessionsProvidersService: ISessionsProvidersService,
	) {
		super();
		const modePickerModels = this._register(new ScopedModePickerModelCache(session => session.providerId === LOCAL_PROVIDER_ID));

		this._register(actionViewItemService.register(
			Menus.NewSessionConfig, LOCAL_MODE_PICKER_ID,
			(_action, _options, scopedInstantiationService) => {
				const { session } = scopedInstantiationService.invokeFunction(accessor => accessor.get(ISessionContext));
				const store = new DisposableStore();
				const modePickerModel = store.add(modePickerModels.acquire(session, scopedInstantiationService));
				const picker = scopedInstantiationService.createInstance(ModePicker, modePickerModel.model, session);
				store.add(picker.onDidSelect(mode => {
					const active = session.get();
					const provider = active ? sessionsProvidersService.getProvider(active.providerId) : undefined;
					if (active && provider instanceof LocalChatSessionsProvider) {
						provider.getSessionConfiguration(active.sessionId)?.setMode(mode);
					}
				}));
				return new PickerActionViewItem(picker, store);
			},
		));

		this._register(actionViewItemService.register(
			Menus.NewSessionControl, LOCAL_PERMISSION_PICKER_ID,
			(_action, _options, scopedInstantiationService) => {
				const { session } = scopedInstantiationService.invokeFunction(accessor => accessor.get(ISessionContext));
				const delegate = new LocalPermissionPickerDelegate(session, sessionsProvidersService);
				return new PickerActionViewItem(scopedInstantiationService.createInstance(PermissionPicker, delegate));
			},
		));
	}
}

registerWorkbenchContribution2(LocalPickerActionViewItemContribution.ID, LocalPickerActionViewItemContribution, WorkbenchPhase.AfterRestored);
