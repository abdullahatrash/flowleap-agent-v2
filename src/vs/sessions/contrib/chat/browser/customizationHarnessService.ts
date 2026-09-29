/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DisposableStore, IDisposable, MutableDisposable } from '../../../../base/common/lifecycle.js';
import { CustomizationHarnessServiceBase, createVSCodeHarnessDescriptor, IHarnessDescriptor } from '../../../../workbench/contrib/chat/common/customizationHarnessService.js';
import { IPromptsService } from '../../../../workbench/contrib/chat/common/promptSyntax/service/promptsService.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { ISessionsManagementService } from '../../../services/sessions/common/sessionsManagement.js';

/**
 * FlowLeap: the session type of the Local sessions provider. The Local harness
 * is registered while a provider offers it (upstream removed the Local harness).
 */
const LOCAL_HARNESS_SESSION_TYPE = 'local';

/**
 * Sessions-window override of the customization harness service.
 *
 * Harnesses are provided by chat session providers and AHP remote servers.
 */
export class SessionsCustomizationHarnessService extends CustomizationHarnessServiceBase {

	private readonly _store = new DisposableStore();
	private readonly _localHarnessRegistration = this._store.add(new MutableDisposable());

	constructor(
		@IPromptsService promptsService: IPromptsService,
		@ISessionsManagementService sessionsManagementService: ISessionsManagementService,
		@IFileService fileService: IFileService,
	) {
		super([], '', promptsService, fileService);

		const localHarness = createVSCodeHarnessDescriptor();
		const sync = () => {
			const enabled = sessionsManagementService.getAllSessionTypes().some(type => type.id === LOCAL_HARNESS_SESSION_TYPE);
			if (enabled && !this._localHarnessRegistration.value) {
				this._localHarnessRegistration.value = this.registerExternalHarness(localHarness);
			} else if (!enabled) {
				this._localHarnessRegistration.clear();
			}
		};
		this._store.add(sessionsManagementService.onDidChangeSessionTypes(sync));
		sync();
	}

	override dispose(): void {
		this._store.dispose();
		super.dispose();
	}

	override registerExternalHarness(descriptor: IHarnessDescriptor): IDisposable {
		const registration = super.registerExternalHarness(descriptor);
		if (!this.findHarnessById(this.activeHarness.get())) {
			this.setActiveSession(this.getSessionResourceForHarness(descriptor.id));
		}
		return registration;
	}
}
