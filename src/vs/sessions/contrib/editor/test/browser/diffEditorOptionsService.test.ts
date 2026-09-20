/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { MockContextKeyService } from '../../../../../platform/keybinding/test/common/mockKeybindingService.js';
import { InMemoryStorageService, StorageScope } from '../../../../../platform/storage/common/storage.js';
import { SESSIONS_DIFF_EDITOR_WORD_WRAP_SETTING, SESSIONS_EDITOR_WORD_WRAP_SETTING, SessionsDiffViewModeContext } from '../../common/diffEditorOptionsService.js';
import { DiffEditorOptionsService } from '../../browser/diffEditorOptionsService.js';

suite('DiffEditorOptionsService', () => {

	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	test('defaults to automatic and persists explicit modes', () => {
		const storageService = disposables.add(new InMemoryStorageService());
		const contextKeyService = disposables.add(new MockContextKeyService());
		const configurationService = new TestConfigurationService({
			[SESSIONS_DIFF_EDITOR_WORD_WRAP_SETTING]: 'inherit',
			[SESSIONS_EDITOR_WORD_WRAP_SETTING]: 'inherit',
		});
		const service = disposables.add(new DiffEditorOptionsService(storageService, contextKeyService, configurationService));

		const initial = {
			viewMode: service.viewMode.get(),
			renderSideBySide: service.renderSideBySide.get(),
			diffEditorWordWrap: service.diffEditorWordWrap.get(),
			editorWordWrap: service.editorWordWrap.get(),
			contextValue: contextKeyService.getContextKeyValue(SessionsDiffViewModeContext.key),
			storedValue: storageService.get('sessions.diffEditor.viewMode', StorageScope.PROFILE),
		};
		service.setViewMode('sideBySide');

		assert.deepStrictEqual({
			initial,
			viewMode: service.viewMode.get(),
			renderSideBySide: service.renderSideBySide.get(),
			contextValue: contextKeyService.getContextKeyValue(SessionsDiffViewModeContext.key),
			storedValue: storageService.get('sessions.diffEditor.viewMode', StorageScope.PROFILE),
		}, {
			initial: {
				viewMode: 'automatic',
				renderSideBySide: true,
				diffEditorWordWrap: 'inherit',
				editorWordWrap: 'inherit',
				contextValue: 'automatic',
				storedValue: undefined,
			},
			viewMode: 'sideBySide',
			renderSideBySide: true,
			contextValue: 'sideBySide',
			storedValue: 'sideBySide',
		});
	});

	test('restores a stored inline preference and toggles back to automatic', () => {
		const storageService = disposables.add(new InMemoryStorageService());
		const contextKeyService = disposables.add(new MockContextKeyService());
		const first = disposables.add(new DiffEditorOptionsService(storageService, contextKeyService, new TestConfigurationService()));
		first.setViewMode('inline');
		const restored = disposables.add(new DiffEditorOptionsService(storageService, contextKeyService, new TestConfigurationService()));

		const restoredViewMode = restored.viewMode.get();
		const restoredRenderSideBySide = restored.renderSideBySide.get();
		restored.toggleRenderSideBySide();

		assert.deepStrictEqual({
			restoredViewMode,
			restoredRenderSideBySide,
			viewMode: restored.viewMode.get(),
			storedValue: storageService.get('sessions.diffEditor.viewMode', StorageScope.PROFILE),
		}, {
			restoredViewMode: 'inline',
			restoredRenderSideBySide: false,
			viewMode: 'automatic',
			storedValue: 'automatic',
		});
	});

	test('uses and updates independent word wrap settings', async () => {
		const storageService = disposables.add(new InMemoryStorageService());
		const contextKeyService = disposables.add(new MockContextKeyService());
		const updates: { key: string; value: unknown }[] = [];
		const configurationService = new class extends TestConfigurationService {
			override updateValue(key: string, value: unknown): Promise<void> {
				updates.push({ key, value });
				return Promise.resolve();
			}
		}({
			[SESSIONS_DIFF_EDITOR_WORD_WRAP_SETTING]: 'off',
			[SESSIONS_EDITOR_WORD_WRAP_SETTING]: 'on',
		});
		const service = disposables.add(new DiffEditorOptionsService(storageService, contextKeyService, configurationService));

		await service.setEditorWordWrap('off');
		await service.setDiffEditorWordWrap('on');

		assert.deepStrictEqual({
			editorWordWrap: service.editorWordWrap.get(),
			diffEditorWordWrap: service.diffEditorWordWrap.get(),
			updates,
		}, {
			editorWordWrap: 'on',
			diffEditorWordWrap: 'off',
			updates: [
				{
					key: SESSIONS_EDITOR_WORD_WRAP_SETTING,
					value: 'off',
				},
				{
					key: SESSIONS_DIFF_EDITOR_WORD_WRAP_SETTING,
					value: 'on',
				},
			],
		});
	});
});
