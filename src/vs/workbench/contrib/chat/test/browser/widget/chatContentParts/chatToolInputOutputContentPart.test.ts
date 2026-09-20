/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { mainWindow } from '../../../../../../../base/browser/window.js';
import { Event } from '../../../../../../../base/common/event.js';
import { observableValue } from '../../../../../../../base/common/observable.js';
import { URI } from '../../../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../../base/test/common/utils.js';
import { workbenchInstantiationService } from '../../../../../../test/browser/workbenchTestServices.js';
import { IChatToolInvocationSerialized, ToolConfirmKind } from '../../../../common/chatService/chatService.js';
import { ToolDataSource } from '../../../../common/tools/languageModelToolsService.js';
import { CodeBlockPart } from '../../../../browser/widget/chatContentParts/codeBlockPart.js';
import { ChatCollapsibleContentPart } from '../../../../browser/widget/chatContentParts/chatCollapsibleContentPart.js';
import { IDisposableReference } from '../../../../browser/widget/chatContentParts/chatCollections.js';
import { DiffEditorPool, EditorPool } from '../../../../browser/widget/chatContentParts/chatContentCodePools.js';
import { IChatContentPartRenderContext, InlineTextModelCollection } from '../../../../browser/widget/chatContentParts/chatContentParts.js';
import { ChatCollapsibleInputOutputContentPart } from '../../../../browser/widget/chatContentParts/chatToolInputOutputContentPart.js';
import { ChatInputOutputMarkdownProgressPart } from '../../../../browser/widget/chatContentParts/toolInvocationParts/chatInputOutputMarkdownProgressPart.js';
import { IChatResponseViewModel } from '../../../../common/model/chatViewModel.js';

suite('ChatCollapsibleInputOutputContentPart', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	test('animates disclosure state and keeps collapsed content inert', () => {
		const editorElement = mainWindow.document.createElement('div');
		const codeBlockPart = Object.create(CodeBlockPart.prototype) as CodeBlockPart;
		Object.defineProperties(codeBlockPart, {
			element: { value: editorElement },
			render: { value: () => { } },
			layout: { value: () => { } },
		});
		const editorReference: IDisposableReference<CodeBlockPart> = {
			object: codeBlockPart,
			isStale: () => false,
			dispose: () => { },
		};
		const editorPool = Object.create(EditorPool.prototype) as EditorPool;
		Object.defineProperty(editorPool, 'get', { value: () => editorReference });
		const element = Object.create(null) as IChatResponseViewModel;
		Object.assign(element, {
			id: 'response',
			sessionResource: URI.parse('chat-session://test/session'),
		});
		const context: IChatContentPartRenderContext = {
			element,
			elementIndex: 0,
			container: mainWindow.document.createElement('div'),
			content: [],
			contentIndex: 0,
			inlineTextModels: Object.create(InlineTextModelCollection.prototype) as InlineTextModelCollection,
			editorPool,
			codeBlockStartIndex: 0,
			treeStartIndex: 0,
			diffEditorPool: Object.create(DiffEditorPool.prototype) as DiffEditorPool,
			currentWidth: observableValue('testWidth', 500),
			onDidChangeVisibility: Event.None,
		};
		const instantiationService = workbenchInstantiationService(undefined, store);
		const part = store.add(instantiationService.createInstance(
			ChatCollapsibleInputOutputContentPart,
			'Read Terminal',
			undefined,
			undefined,
			context,
			{
				kind: 'code',
				data: '{"shellId":"test"}',
				languageId: 'json',
				options: {},
				codeBlockIndex: 0,
				ownerMarkdownPartId: 'test',
			},
			undefined,
			false,
			false,
			false,
		));

		let toggleCount = 0;
		part.domNode.addEventListener(ChatCollapsibleContentPart.userToggleEvent, () => toggleCount++);
		const button = part.domNode.querySelector<HTMLElement>('.chat-confirmation-widget-title');
		const widget = part.domNode.querySelector('.chat-confirmation-widget');
		const animationContent = part.domNode.querySelector<HTMLElement>('.chat-confirmation-widget-message-animation-inner');
		const chevron = part.domNode.querySelector('.chat-collapsible-hover-chevron');
		assert.ok(button);
		assert.ok(widget);
		assert.ok(animationContent);
		assert.ok(chevron);

		const initiallyInert = animationContent.inert;
		button.click();
		const expandedState = {
			ariaExpanded: button.ariaExpanded,
			chevronExpanded: chevron.classList.contains('expanded'),
			inert: animationContent.inert,
			hasMessage: !!animationContent.querySelector('.chat-confirmation-widget-message'),
		};
		button.click();

		assert.deepStrictEqual({
			initiallyInert,
			titleIsFirst: widget.firstElementChild === button,
			expandedState,
			collapsedInert: animationContent.inert,
			toggleCount,
		}, {
			initiallyInert: true,
			titleIsFirst: true,
			expandedState: {
				ariaExpanded: 'true',
				chevronExpanded: true,
				inert: false,
				hasMessage: true,
			},
			collapsedInert: true,
			toggleCount: 2,
		});
	});

	test('uses output MIME types and defaults to plaintext', () => {
		const renderedCodeBlocks: { text: string; languageId: string }[] = [];
		const editorPool = Object.create(EditorPool.prototype) as EditorPool;
		Object.defineProperty(editorPool, 'get', {
			value: () => {
				const codeBlockPart = Object.create(CodeBlockPart.prototype) as CodeBlockPart;
				Object.defineProperties(codeBlockPart, {
					element: { value: mainWindow.document.createElement('div') },
					render: { value: (data: { text: string; languageId: string }) => renderedCodeBlocks.push({ text: data.text, languageId: data.languageId }) },
					layout: { value: () => { } },
					uri: { value: URI.parse('test://codeblock') },
				});
				return {
					object: codeBlockPart,
					isStale: () => false,
					dispose: () => { },
				} satisfies IDisposableReference<CodeBlockPart>;
			}
		});
		const element = Object.assign(Object.create(null), {
			id: 'response',
			sessionResource: URI.parse('chat-session://test/session'),
		}) as IChatResponseViewModel;
		const context: IChatContentPartRenderContext = {
			element,
			elementIndex: 0,
			container: mainWindow.document.createElement('div'),
			content: [],
			contentIndex: 0,
			inlineTextModels: Object.create(InlineTextModelCollection.prototype) as InlineTextModelCollection,
			editorPool,
			codeBlockStartIndex: 0,
			treeStartIndex: 0,
			diffEditorPool: Object.create(DiffEditorPool.prototype) as DiffEditorPool,
			currentWidth: observableValue('testWidth', 500),
			onDidChangeVisibility: Event.None,
		};
		const toolInvocation: IChatToolInvocationSerialized = {
			kind: 'toolInvocationSerialized',
			toolCallId: 'tool-call-id',
			toolId: 'test-tool',
			invocationMessage: 'Running tool',
			originMessage: undefined,
			pastTenseMessage: 'Ran tool',
			isComplete: true,
			isConfirmed: { type: ToolConfirmKind.ConfirmationNotNeeded },
			presentation: undefined,
			source: ToolDataSource.Internal,
		};
		const instantiationService = workbenchInstantiationService(undefined, store);
		const part = store.add(instantiationService.createInstance(
			ChatInputOutputMarkdownProgressPart,
			toolInvocation,
			context,
			0,
			'Ran tool',
			undefined,
			'{"query":"test"}',
			undefined,
			[
				{ type: 'embed', value: '# Heading', isText: true, mimeType: ' Text/Markdown ; charset=utf-8' },
				{ type: 'embed', value: '{"declared":true}', isText: true, mimeType: 'text/plain' },
				{ type: 'embed', value: 'invalid JSON', isText: true, mimeType: 'application/problem+json' },
				{ type: 'embed', value: '{"detected":true}', isText: true },
				{ type: 'embed', value: '[1, 2, 3]', isText: true },
				{ type: 'embed', value: 'ordinary output', isText: true },
				{ type: 'embed', value: '1', isText: true },
			],
			false,
		));

		part.domNode.querySelector<HTMLElement>('.chat-confirmation-widget-title')?.click();

		assert.deepStrictEqual(renderedCodeBlocks, [
			{ text: '{"query":"test"}', languageId: 'json' },
			{ text: '# Heading', languageId: 'markdown' },
			{ text: '{"declared":true}', languageId: 'plaintext' },
			{ text: 'invalid JSON', languageId: 'json' },
			{ text: '{"detected":true}\n[1, 2, 3]\nordinary output\n1', languageId: 'plaintext' },
		]);
	});
});
