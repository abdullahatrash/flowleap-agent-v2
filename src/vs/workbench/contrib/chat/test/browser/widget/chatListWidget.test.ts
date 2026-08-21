/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { mainWindow } from '../../../../../../base/browser/window.js';
import { MarkdownString } from '../../../../../../base/common/htmlContent.js';
import { DisposableStore, toDisposable } from '../../../../../../base/common/lifecycle.js';
import { OffsetRange } from '../../../../../../editor/common/core/ranges/offsetRange.js';
import { Range } from '../../../../../../editor/common/core/range.js';
import { IAccessibleViewService } from '../../../../../../platform/accessibility/browser/accessibleView.js';
import { IConfigurationService } from '../../../../../../platform/configuration/common/configuration.js';
import { TestConfigurationService } from '../../../../../../platform/configuration/test/common/testConfigurationService.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../base/test/common/utils.js';
import { workbenchInstantiationService } from '../../../../../test/browser/workbenchTestServices.js';
import { IChatAccessibilityService } from '../../../browser/chat.js';
import { ChatListWidget, IChatListWidgetOptions, UserToggleResizeState } from '../../../browser/widget/chatListWidget.js';
import { ChatEditorOptions } from '../../../browser/widget/chatOptions.js';
import { IChatService } from '../../../common/chatService/chatService.js';
import { ChatAgentLocation, ChatConfiguration, ChatModeKind } from '../../../common/constants.js';
import { ChatModel } from '../../../common/model/chatModel.js';
import { ChatViewModel, isRequestVM, isResponseVM } from '../../../common/model/chatViewModel.js';
import { ChatAgentService, IChatAgentService } from '../../../common/participants/chatAgents.js';
import { ChatRequestTextPart } from '../../../common/requestParser/chatParserTypes.js';
import { MockChatService } from '../../common/chatService/mockChatService.js';

suite('ChatListWidget', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	function createWidget(options: IChatListWidgetOptions = {}) {
		const disposables = store.add(new DisposableStore());
		const instantiationService = workbenchInstantiationService(undefined, disposables);
		const configurationService = new TestConfigurationService();
		configurationService.setUserConfiguration(ChatConfiguration.IncrementalRendering, false);
		configurationService.setUserConfiguration('chat.checkpoints.enabled', false);
		configurationService.setUserConfiguration('chat.checkpoints.showFileChanges', false);
		instantiationService.stub(IConfigurationService, configurationService);
		instantiationService.stub(IChatService, new MockChatService());
		instantiationService.stub(IChatAgentService, disposables.add(instantiationService.createInstance(ChatAgentService)));
		instantiationService.stub(IAccessibleViewService, { getOpenAriaHint: () => '' });
		instantiationService.stub(IChatAccessibilityService, {
			acceptRequest: () => { },
			disposeRequest: () => { },
			acceptResponse: () => { },
			acceptElicitation: () => { },
		});

		const model = disposables.add(instantiationService.createInstance(ChatModel, undefined, { initialLocation: ChatAgentLocation.Chat, canUseTools: true }));
		const viewModel = disposables.add(instantiationService.createInstance(ChatViewModel, model, undefined));
		const container = mainWindow.document.createElement('div');
		container.style.position = 'absolute';
		container.style.insetBlockStart = '0px';
		container.style.insetInlineStart = '0px';
		container.style.width = '500px';
		container.style.height = '300px';
		container.classList.add('monaco-reduce-motion');
		mainWindow.document.body.appendChild(container);
		disposables.add(toDisposable(() => container.remove()));

		const widget = disposables.add(instantiationService.createInstance(ChatListWidget, container, {
			currentChatMode: () => ChatModeKind.Agent,
			location: ChatAgentLocation.Chat,
			editorOptions: {} as ChatEditorOptions,
			...options,
		}));
		widget.setViewModel(viewModel);
		widget.setVisible(true);
		return { disposables, model, viewModel, container, widget };
	}

	test('keeps user toggle suppression active until resizing settles', () => {
		const state = new UserToggleResizeState(2);
		const states = [state.isActive];

		state.start();
		states.push(state.isActive);
		state.advanceFrame();
		states.push(state.isActive);
		state.markResized();
		state.advanceFrame();
		states.push(state.isActive);
		state.advanceFrame();
		states.push(state.isActive);

		assert.deepStrictEqual(states, [false, true, true, true, false]);
	});

	// Sticky scroll nests each response under its request, which would hide responses whose
	// request a filter excludes. Filtered widgets must therefore stay a flat list.
	test('keeps responses visible when a filter excludes their requests', async () => {
		const { disposables, model, viewModel, widget } = createWidget({
			filter: { filter: item => isResponseVM(item) },
		});
		const text = 'question';
		const request = model.addRequest({
			text,
			parts: [new ChatRequestTextPart(new OffsetRange(0, text.length), new Range(1, 1, 1, text.length + 1), text)]
		}, { variables: [] }, 0);
		model.acceptResponseProgress(request, { kind: 'markdownContent', content: new MarkdownString('response') });

		widget.refresh();
		widget.layout(300, 500);

		const requestItem = viewModel.getItems().find(isRequestVM)!;
		const responseItem = viewModel.getItems().find(isResponseVM)!;
		assert.deepStrictEqual({
			requestVisible: widget.getElementTop(requestItem) !== undefined,
			responseVisible: widget.getElementTop(responseItem) !== undefined,
		}, {
			requestVisible: false,
			responseVisible: true,
		});

		disposables.dispose();
	});
});
