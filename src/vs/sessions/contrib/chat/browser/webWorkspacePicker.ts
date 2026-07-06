/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IActionWidgetService } from '../../../../platform/actionWidget/browser/actionWidget.js';
import { IActionListItem } from '../../../../platform/actionWidget/browser/actionList.js';
import { IMenuService } from '../../../../platform/actions/common/actions.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IFileDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { IUriIdentityService } from '../../../../platform/uriIdentity/common/uriIdentity.js';
import { IWorkspacesService } from '../../../../platform/workspaces/common/workspaces.js';
import { IWorkbenchLayoutService } from '../../../../workbench/services/layout/browser/layoutService.js';
import { ISessionsProvidersService } from '../../../services/sessions/browser/sessionsProvidersService.js';
import { IWorkspacePickerItem, WorkspacePicker } from './sessionWorkspacePicker.js';
import { showMobileWorkspacePickerSheet, shouldUseMobileWorkspacePickerSheet } from './mobile/mobileWorkspacePickerSheet.js';

/**
 * Web variant of {@link WorkspacePicker} for the Agents window's
 * vscode.dev / insiders.vscode.dev surface. On phone-layout viewports it
 * renders the picker as a bottom sheet (via `showMobileWorkspacePickerSheet`)
 * instead of the desktop action-widget popup, and falls through to
 * `super.showPicker()` on non-phone viewports so a single instance works
 * correctly across rotation across the phone breakpoint.
 */
export class WebWorkspacePicker extends WorkspacePicker {

	constructor(
		@IActionWidgetService actionWidgetService: IActionWidgetService,
		@IStorageService storageService: IStorageService,
		@IUriIdentityService uriIdentityService: IUriIdentityService,
		@ISessionsProvidersService sessionsProvidersService: ISessionsProvidersService,
		@ICommandService commandService: ICommandService,
		@IWorkspacesService workspacesService: IWorkspacesService,
		@IMenuService menuService: IMenuService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IFileDialogService fileDialogService: IFileDialogService,
		@ITelemetryService telemetryService: ITelemetryService,
		@INotificationService notificationService: INotificationService,
		@IWorkbenchLayoutService private readonly _layoutService: IWorkbenchLayoutService,
	) {
		super(
			actionWidgetService,
			storageService,
			uriIdentityService,
			sessionsProvidersService,
			commandService,
			workspacesService,
			menuService,
			contextKeyService,
			instantiationService,
			fileDialogService,
			telemetryService,
			notificationService,
		);
	}

	protected override _showTabs(): boolean {
		// Scoped picker is already filtered to a single host — the categorical
		// tab bar would be redundant.
		return false;
	}

	override showPicker(): void {
		if (!this._triggerElement) {
			return;
		}
		// On phone, render the picker as a bottom sheet instead of the
		// desktop action-widget popup. Falls through to `super` on non-
		// phone viewports so a single instance handles both desktop
		// browsers and rotation across the phone breakpoint.
		if (!shouldUseMobileWorkspacePickerSheet(this._layoutService)) {
			super.showPicker();
			return;
		}
		const items = this._buildItems();
		showMobileWorkspacePickerSheet(
			this._layoutService,
			this._triggerElement,
			items,
			item => this._dispatchPickerItem(item),
			this._getAllBrowseActions(),
		);
	}

	protected override _buildItems(): IActionListItem<IWorkspacePickerItem>[] {
		return [];
	}
}
