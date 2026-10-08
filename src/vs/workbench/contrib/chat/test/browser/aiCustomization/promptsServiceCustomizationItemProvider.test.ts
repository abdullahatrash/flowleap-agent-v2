/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { CancellationToken } from '../../../../../../base/common/cancellation.js';
import { Event } from '../../../../../../base/common/event.js';
import { ResourceSet } from '../../../../../../base/common/map.js';
import { URI } from '../../../../../../base/common/uri.js';
import { mock } from '../../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../base/test/common/utils.js';
import { ExtensionIdentifier, IExtensionDescription } from '../../../../../../platform/extensions/common/extensions.js';
import { IProductService } from '../../../../../../platform/product/common/productService.js';
import { IWorkspaceContextService } from '../../../../../../platform/workspace/common/workspace.js';
import { PromptsServiceCustomizationItemProvider } from '../../../browser/aiCustomization/promptsServiceCustomizationItemProvider.js';
import { IAICustomizationWorkspaceService } from '../../../common/aiCustomizationWorkspaceService.js';
import { PromptFileSource, PromptsType } from '../../../common/promptSyntax/promptTypes.js';
import { IAgentSkill, IPromptFileDiscoveryResult, IPromptPath, IPromptsService, PromptsStorage } from '../../../common/promptSyntax/service/promptsService.js';

suite('PromptsServiceCustomizationItemProvider', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	function createProvider(skills: IAgentSkill[], skillFiles: IPromptPath[], discovery: IPromptFileDiscoveryResult[]): PromptsServiceCustomizationItemProvider {
		const promptsService = new class extends mock<IPromptsService>() {
			override onDidChangeCustomAgents = Event.None;
			override onDidChangeSlashCommands = Event.None;
			override onDidChangeSkills = Event.None;
			override onDidChangeHooks = Event.None;
			override onDidChangeInstructions = Event.None;
			override onDidChangeAgentInstructions = Event.None;
			override getDisabledPromptFiles() { return new ResourceSet(); }
			override async findAgentSkills() { return skills; }
			override async listPromptFiles(type: PromptsType) { return type === PromptsType.skill ? skillFiles : []; }
			override async getDiscoveryInfo(type: PromptsType) { return { type, files: type === PromptsType.skill ? discovery : [], durationInMillis: 0 }; }
			override async getCustomAgents() { return []; }
			override async getPromptSlashCommands() { return []; }
			override async getInstructionFiles() { return []; }
			override async listAgentInstructions() { return []; }
		};
		return new PromptsServiceCustomizationItemProvider(
			promptsService,
			new class extends mock<IAICustomizationWorkspaceService>() { override isSessionsWindow = false; },
			new class extends mock<IProductService>() { },
			new class extends mock<IWorkspaceContextService>() { },
		);
	}

	test('shows a user skill that has the name of a built-in skill as not loaded, with the reason', async () => {
		const builtinExtension = { identifier: new ExtensionIdentifier('flowleap.patent-ai'), isBuiltin: true } as IExtensionDescription;
		const builtinUri = URI.file('/app/extensions/patent-ai/assets/skills/prior-art/SKILL.md');
		const shadowedUri = URI.file('/workspace/.flowleap/skills/prior-art/SKILL.md');
		const otherUri = URI.file('/workspace/.flowleap/skills/upc-revocation/SKILL.md');
		const skill = (uri: URI, name: string, storage: PromptsStorage): IAgentSkill => ({ uri, name, storage, description: name, disableModelInvocation: false, userInvocable: true });
		const builtinPath: IPromptPath = { uri: builtinUri, storage: PromptsStorage.extension, type: PromptsType.skill, extension: builtinExtension, source: PromptFileSource.ExtensionContribution };
		const shadowedPath: IPromptPath = { uri: shadowedUri, storage: PromptsStorage.local, type: PromptsType.skill, source: PromptFileSource.FlowLeapWorkspace };
		const otherPath: IPromptPath = { uri: otherUri, storage: PromptsStorage.local, type: PromptsType.skill, source: PromptFileSource.FlowLeapWorkspace };

		const provider = createProvider(
			// The service already resolved the name collision: the built-in skill won.
			[skill(builtinUri, 'prior-art', PromptsStorage.extension), skill(otherUri, 'upc-revocation', PromptsStorage.local)],
			[builtinPath, shadowedPath, otherPath],
			[
				{ status: 'loaded', promptPath: builtinPath },
				{ status: 'skipped', skipReason: 'duplicate-name', duplicateOf: builtinUri, promptPath: shadowedPath },
				{ status: 'loaded', promptPath: otherPath },
			],
		);

		const items = await provider.provideChatSessionCustomizations(URI.parse('test:///session'), CancellationToken.None);
		assert.deepStrictEqual(
			items.filter(i => i.type === PromptsType.skill).map(i => ({ path: i.uri.path, status: i.status, statusMessage: i.statusMessage })),
			[
				{ path: builtinUri.path, status: undefined, statusMessage: undefined },
				{ path: otherUri.path, status: undefined, statusMessage: undefined },
				{ path: shadowedUri.path, status: 'error', statusMessage: 'A built-in skill has this name, so this skill does not load. Rename your skill to use it.' },
			],
		);
	});
});
