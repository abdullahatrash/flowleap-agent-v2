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
import { layoutChatWidgetForInputHeight, saveAllBeforeChatSend } from '../../../browser/widget/chatWidget.js';
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
