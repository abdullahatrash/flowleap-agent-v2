/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { Codicon } from '../../../../../base/common/codicons.js';
import { Event } from '../../../../../base/common/event.js';
import { mock } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { SessionType } from '../../../../../workbench/contrib/chat/common/chatSessionsService.js';
import { IPromptsService } from '../../../../../workbench/contrib/chat/common/promptSyntax/service/promptsService.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { ISessionType, SessionTypeAuthRequirement } from '../../../../services/sessions/common/session.js';
import { ISessionsManagementService } from '../../../../services/sessions/common/sessionsManagement.js';
import { SessionsCustomizationHarnessService } from '../../browser/customizationHarnessService.js';

suite('SessionsCustomizationHarnessService', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	function createPromptsService(): IPromptsService {
		return new class extends mock<IPromptsService>() {
			override readonly onDidChangeSlashCommands = Event.None;
			override readonly onDidChangeCustomAgents = Event.None;
		}();
	}

	function createFileService(): IFileService {
		return new class extends mock<IFileService>() { }();
	}

	function createSessionsManagementService(sessionTypes: ISessionType[] = []): ISessionsManagementService {
		return new class extends mock<ISessionsManagementService>() {
			override readonly onDidChangeSessionTypes = Event.None;
			override getAllSessionTypes() { return sessionTypes; }
		}();
	}

	test('does not register the Local harness without a Local session type', () => {
		const service = disposables.add(new SessionsCustomizationHarnessService(createPromptsService(), createSessionsManagementService(), createFileService()));

		assert.deepStrictEqual({
			availableHarnesses: service.availableHarnesses.get().map(harness => harness.id),
			localHarness: service.findHarnessById(SessionType.Local),
		}, {
			availableHarnesses: [],
			localHarness: undefined,
		});
	});

	test('registers the Local harness while a provider offers the Local session type', () => {
		const localType: ISessionType = { id: 'local', label: 'Local', icon: Codicon.vm, authRequirement: SessionTypeAuthRequirement.None };
		const service = disposables.add(new SessionsCustomizationHarnessService(createPromptsService(), createSessionsManagementService([localType]), createFileService()));

		assert.deepStrictEqual(service.availableHarnesses.get().map(harness => harness.id), [SessionType.Local]);
	});

	test('activates the first provider harness', () => {
		const service = disposables.add(new SessionsCustomizationHarnessService(createPromptsService(), createSessionsManagementService(), createFileService()));
		disposables.add(service.registerExternalHarness({
			id: 'copilotcli',
			label: 'Copilot CLI',
			icon: Codicon.copilot,
		}));

		assert.deepStrictEqual({
			activeHarness: service.activeHarness.get(),
			availableHarnesses: service.availableHarnesses.get().map(harness => harness.id),
		}, {
			activeHarness: 'copilotcli',
			availableHarnesses: ['copilotcli'],
		});
	});
});
