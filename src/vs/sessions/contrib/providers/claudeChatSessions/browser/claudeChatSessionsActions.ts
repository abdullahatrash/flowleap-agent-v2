/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { BaseActionViewItem } from '../../../../../base/browser/ui/actionbar/actionViewItems.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { localize2 } from '../../../../../nls.js';
import { IActionViewItemService } from '../../../../../platform/actions/browser/actionViewItemService.js';
import { Action2, registerAction2 } from '../../../../../platform/actions/common/actions.js';
import { ContextKeyExpr } from '../../../../../platform/contextkey/common/contextkey.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../../../workbench/common/contributions.js';
import { Menus } from '../../../../browser/menus.js';
import { SessionProviderIdContext, SessionTypeContext } from '../../../../common/contextkeys.js';
import { ISessionContext } from '../../../../services/sessions/browser/sessionContext.js';
import { ClaudePermissionModePicker } from './claudePermissionModePicker.js';
import { CLAUDE_CODE_SESSION_TYPE_ID, CLAUDE_PROVIDER_ID } from './claudeChatSessionsProvider.js';

/*
 * FlowLeap: the Claude permission mode picker in the new-session composer.
 * Upstream has no picker for the extension-host Claude permission modes
 * (Ask Before Edits, Edit Automatically, Plan Mode, ...).
 */

const CLAUDE_PERMISSION_MODE_PICKER_ID = 'sessions.claude.permissionModePicker';

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: CLAUDE_PERMISSION_MODE_PICKER_ID,
			title: localize2('claudePermissionModePicker', "Permission Mode"),
			f1: false,
			menu: [{
				id: Menus.NewSessionControl,
				group: 'navigation',
				order: 1,
				when: ContextKeyExpr.and(
					ContextKeyExpr.equals(SessionTypeContext.key, CLAUDE_CODE_SESSION_TYPE_ID),
					ContextKeyExpr.equals(SessionProviderIdContext.key, CLAUDE_PROVIDER_ID),
				),
			}],
		});
	}
	override async run(): Promise<void> { /* handled by the action view item */ }
});

/**
 * Wraps a standalone picker widget as a {@link BaseActionViewItem} so a
 * {@link MenuWorkbenchToolBar} can render it.
 */
class PickerActionViewItem extends BaseActionViewItem {
	constructor(private readonly picker: { render(container: HTMLElement): void; dispose(): void }) {
		super(undefined, { id: '', label: '', enabled: true, class: undefined, tooltip: '', run: () => { } });
	}

	override render(container: HTMLElement): void {
		this.picker.render(container);
	}

	override dispose(): void {
		this.picker.dispose();
		super.dispose();
	}
}

class ClaudePickerActionViewItemContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'sessions.claudePickerActionViewItems';

	constructor(
		@IActionViewItemService actionViewItemService: IActionViewItemService,
	) {
		super();
		this._register(actionViewItemService.register(
			Menus.NewSessionControl, CLAUDE_PERMISSION_MODE_PICKER_ID,
			(_action, _options, scopedInstantiationService) => {
				const { session } = scopedInstantiationService.invokeFunction(accessor => accessor.get(ISessionContext));
				return new PickerActionViewItem(scopedInstantiationService.createInstance(ClaudePermissionModePicker, session));
			},
		));
	}
}

registerWorkbenchContribution2(ClaudePickerActionViewItemContribution.ID, ClaudePickerActionViewItemContribution, WorkbenchPhase.AfterRestored);
