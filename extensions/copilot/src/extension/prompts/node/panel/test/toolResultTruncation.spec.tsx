/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { PromptElement, Raw, UserMessage } from '@vscode/prompt-tsx';
import { describe, expect, test } from 'vitest';
import { IEndpointProvider } from '../../../../../platform/endpoint/common/endpointProvider';
import { IInstantiationService } from '../../../../../util/vs/platform/instantiation/common/instantiation';
import { LanguageModelTextPart } from '../../../../../vscodeTypes';
import { createExtensionUnitTestingServices } from '../../../../test/node/services';
import { ToolName } from '../../../../tools/common/toolNames';
import { renderPromptElement } from '../../base/promptRenderer';
import { IToolResultProps, ToolResult } from '../toolCalling';

/** ToolResult can only be rendered inside a chat message. */
class ToolResultInUserMessage extends PromptElement<IToolResultProps> {
	override render() {
		return <UserMessage><ToolResult {...this.props} /></UserMessage>;
	}
}

async function renderToolResultText(content: string, toolArguments: string, truncate: number): Promise<string> {
	const accessor = createExtensionUnitTestingServices().createTestingAccessor();
	try {
		const instantiationService = accessor.get(IInstantiationService);
		const endpoint = await accessor.get(IEndpointProvider).getChatEndpoint('copilot-utility');
		const { messages } = await renderPromptElement(instantiationService, endpoint, ToolResultInUserMessage, {
			content: [new LanguageModelTextPart(content)],
			truncate,
			toolCallId: 'call-1',
			sessionId: 'session-1',
			toolName: ToolName.GetPatentDetails,
			toolArguments,
		});
		return messages
			.flatMap(message => message.content)
			.filter(part => part.type === Raw.ChatCompletionContentPartKind.Text)
			.map(part => part.text)
			.join('');
	} finally {
		accessor.dispose();
	}
}

describe('ToolResult truncation', () => {
	const evidenceLookupArguments = JSON.stringify({ publicationNumber: 'EP0983762A1', evidenceLookup: { query: 'heat exchanger' } });

	test('caps an oversized local evidence page without offloading it, and leaves a normal page intact', async () => {
		const truncate = 1000;
		const oversized = 'x'.repeat(truncate * 8);
		const normal = 'y'.repeat(truncate);

		const [oversizedText, normalText] = await Promise.all([
			renderToolResultText(oversized, evidenceLookupArguments, truncate),
			renderToolResultText(normal, evidenceLookupArguments, truncate),
		]);

		expect({
			oversizedWasCapped: oversizedText.length < oversized.length,
			oversizedWithinCeiling: oversizedText.length <= truncate * 4,
			oversizedSaysItWasTruncated: oversizedText.includes('[Tool response was too long and was truncated.]'),
			oversizedKeepsHeadAndTail: oversizedText.startsWith('x') && oversizedText.endsWith('x'),
			normalUntouched: normalText === normal,
		}).toEqual({
			oversizedWasCapped: true,
			oversizedWithinCeiling: true,
			oversizedSaysItWasTruncated: true,
			oversizedKeepsHeadAndTail: true,
			normalUntouched: true,
		});
	});
});
