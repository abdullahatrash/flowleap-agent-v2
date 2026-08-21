/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../base/test/common/utils.js';
import { TestConfigurationService } from '../../../../../../platform/configuration/test/common/testConfigurationService.js';
import { SaveReason } from '../../../../../common/editor.js';
import { ISaveAllEditorsOptions, ISaveEditorsResult } from '../../../../../services/editor/common/editorService.js';
import { TestEditorService } from '../../../../../test/browser/workbenchTestServices.js';
import { ChatWidget, layoutChatWidgetForInputHeight, saveAllBeforeChatSend } from '../../../browser/widget/chatWidget.js';
import { ChatConfiguration } from '../../../common/constants.js';

suite('ChatWidget', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	class RecordingEditorService extends TestEditorService {
		readonly saveAllCalls: (ISaveAllEditorsOptions | undefined)[] = [];

		override async saveAll(options?: ISaveAllEditorsOptions): Promise<ISaveEditorsResult> {
			this.saveAllCalls.push(options);
			return { success: true, editors: [] };
		}
	}

	function createRequestEditWidget(currentInput: string, currentAttachmentIds: readonly string[], confirmResult = false) {
		const editing = {};
		let confirmationCount = 0;
		let finishedCount = 0;
		let focusCount = 0;
		const widget = Object.create(ChatWidget.prototype) as ChatWidget;
		Object.defineProperties(widget, {
			viewModel: { value: { editing } },
			input: {
				value: {
					inputEditor: { getValue: () => currentInput },
					attachmentModel: { getAttachmentIDs: () => new Set(currentAttachmentIds) },
					focus: () => focusCount++,
				}
			},
			_requestEditSnapshot: {
				value: {
					input: 'original request',
					attachmentIds: new Set(['original-attachment']),
				},
				writable: true,
			},
			_requestEditCancellationPending: { value: false, writable: true },
			dialogService: {
				value: {
					confirm: async () => {
						confirmationCount++;
						return { confirmed: confirmResult };
					}
				}
			},
			finishedEditing: { value: () => finishedCount++ },
		});

		return {
			widget,
			result: () => ({ confirmationCount, finishedCount, focusCount }),
		};
	}

	test('saves non-untitled editors before sending by default', async () => {
		const configurationService = new TestConfigurationService();
		const editorService = store.add(new RecordingEditorService());

		await saveAllBeforeChatSend(configurationService, editorService);
		await configurationService.setUserConfiguration(ChatConfiguration.SaveBeforeSend, false);
		await saveAllBeforeChatSend(configurationService, editorService);

		assert.deepStrictEqual(editorService.saveAllCalls, [{
			includeUntitled: false,
			reason: SaveReason.EXPLICIT,
		}]);
	});

	test('confirms before cancelling changed request edits', async () => {
		const scenarios = [
			{ name: 'unchanged', input: 'original request', attachmentIds: ['original-attachment'] },
			{ name: 'text changed', input: 'edited request', attachmentIds: ['original-attachment'] },
			{ name: 'attachment added', input: 'original request', attachmentIds: ['original-attachment', 'new-attachment'] },
			{ name: 'attachment removed', input: 'original request', attachmentIds: [] },
		];
		const actual = [];

		for (const scenario of scenarios) {
			const requestEdit = createRequestEditWidget(scenario.input, scenario.attachmentIds);
			await requestEdit.widget.cancelEditing();
			actual.push({ name: scenario.name, ...requestEdit.result() });
		}
		assert.deepStrictEqual(actual, [
			{ name: 'unchanged', confirmationCount: 0, finishedCount: 1, focusCount: 0 },
			{ name: 'text changed', confirmationCount: 1, finishedCount: 0, focusCount: 1 },
			{ name: 'attachment added', confirmationCount: 1, finishedCount: 0, focusCount: 1 },
			{ name: 'attachment removed', confirmationCount: 1, finishedCount: 0, focusCount: 1 },
		]);
	});

	test('confirmed cancellation discards changed request edits', async () => {
		const requestEdit = createRequestEditWidget('edited request', ['original-attachment'], true);

		await requestEdit.widget.cancelEditing();

		assert.deepStrictEqual(requestEdit.result(), {
			confirmationCount: 1,
			finishedCount: 1,
			focusCount: 0,
		});
	});

	test('input height changes update the budget without re-laying out the input', () => {
		const calls: unknown[] = [];
		const target = {
			setInputPartMaxHeightOverride: (height: number | undefined) => calls.push(['setInputPartMaxHeightOverride', height]),
			layoutForInputHeight: (height: number, width: number) => calls.push(['layoutForInputHeight', height, width]),
		};

		layoutChatWidgetForInputHeight(target, 600, 420, 720);

		assert.deepStrictEqual(calls, [
			['setInputPartMaxHeightOverride', 600],
			['layoutForInputHeight', 420, 720],
		]);
	});
});
