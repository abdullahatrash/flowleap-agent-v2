/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { BasePromptElementProps, PromptElement, UserMessage } from '@vscode/prompt-tsx';
import { expect, it } from 'vitest';
import { MockEndpoint } from '../../../../../platform/endpoint/test/node/mockEndpoint';
import { messageToMarkdown } from '../../../../../platform/log/common/messageStringify';
import { WorkingDirectory } from '../../../../../platform/workspace/common/workingDirectory';
import { URI } from '../../../../../util/vs/base/common/uri';
import { IInstantiationService } from '../../../../../util/vs/platform/instantiation/common/instantiation';
import { createExtensionUnitTestingServices } from '../../../../test/node/services';
import { renderPromptElement } from '../../base/promptRenderer';
import { WorkspaceFoldersHint } from '../agentPrompt';

class FolderPrompt extends PromptElement<BasePromptElementProps & { workingDir: WorkingDirectory }> {
	render() { return <UserMessage><WorkspaceFoldersHint workingDir={this.props.workingDir} /></UserMessage>; }
}

it.each(['/workspace/Dental Composites', '/workspace/legitimate trailing space '])('renders the exact workspace path without inserting or trimming characters: %s', async path => {
	const services = createExtensionUnitTestingServices();
	const accessor = services.createTestingAccessor();
	try {
		const instantiation = accessor.get(IInstantiationService);
		const endpoint = instantiation.createInstance(MockEndpoint, undefined);
		const workingDir = instantiation.createInstance(WorkingDirectory, URI.file(path));
		const { messages } = await renderPromptElement(instantiation, endpoint, FolderPrompt, { workingDir });
		const text = messages.map(message => messageToMarkdown(message)).join('\n');
		expect(text.split('\n').find(line => line.startsWith('- '))).toBe('- ' + path);
	} finally { accessor.dispose(); }
});
