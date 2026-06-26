/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { assert } from 'chai';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, suite, test } from 'vitest';
import * as vscode from 'vscode';
import { IConfigurationService } from '../../../../platform/configuration/common/configurationService';
import { InMemoryConfigurationService } from '../../../../platform/configuration/test/common/inMemoryConfigurationService';
import { IVSCodeExtensionContext } from '../../../../platform/extContext/common/extensionContext';
import { IFileSystemService } from '../../../../platform/filesystem/common/fileSystemService';
import { MockExtensionContext } from '../../../../platform/test/node/extensionContext';
import { ITestingServicesAccessor } from '../../../../platform/test/node/services';
import { DisposableStore } from '../../../../util/vs/base/common/lifecycle';
import { SyncDescriptor } from '../../../../util/vs/platform/instantiation/common/descriptors';
import { IInstantiationService } from '../../../../util/vs/platform/instantiation/common/instantiation';
import { createExtensionUnitTestingServices } from '../../../test/node/services';
import { DEFAULT_READ_TOOLS, PATENT_TOOLS } from '../agentTypes';
import { PatentResearchAgentProvider } from '../patentResearchAgentProvider';

suite('PatentResearchAgentProvider', () => {
	let disposables: DisposableStore;
	let mockConfigurationService: InMemoryConfigurationService;
	let fileSystemService: IFileSystemService;
	let accessor: ITestingServicesAccessor;
	let instantiationService: IInstantiationService;

	beforeEach(() => {
		disposables = new DisposableStore();

		const testingServiceCollection = createExtensionUnitTestingServices(disposables);
		const globalStoragePath = path.join(os.tmpdir(), 'patent-research-agent-test-' + Date.now());
		testingServiceCollection.define(IVSCodeExtensionContext, new SyncDescriptor(MockExtensionContext, [globalStoragePath]));
		accessor = testingServiceCollection.createTestingAccessor();
		disposables.add(accessor);
		instantiationService = accessor.get(IInstantiationService);

		mockConfigurationService = accessor.get(IConfigurationService) as InMemoryConfigurationService;
		fileSystemService = accessor.get(IFileSystemService);
	});

	afterEach(() => {
		disposables.dispose();
	});

	function createProvider() {
		const provider = instantiationService.createInstance(PatentResearchAgentProvider);
		disposables.add(provider);
		return provider;
	}

	async function getAgentContent(agent: vscode.ChatResource): Promise<string> {
		const content = await fileSystemService.readFile(agent.uri);
		return new TextDecoder().decode(content);
	}

	test('provideCustomAgents() returns a single PatentResearch .agent.md', async () => {
		const provider = createProvider();

		const agents = await provider.provideCustomAgents({}, {} as any);

		assert.equal(agents.length, 1);
		assert.ok(agents[0].uri.path.endsWith('PatentResearch.agent.md'), 'Agent URI should be the PatentResearch agent file');
	});

	test('scopes the agent to the patent tool-set (PATENT_TOOLS + read tools + delegation)', async () => {
		const provider = createProvider();
		const agents = await provider.provideCustomAgents({}, {} as any);
		const content = await getAgentContent(agents[0]);

		const toolsMatch = content.match(/tools: \[([^\]]+)\]/);
		assert.ok(toolsMatch, 'Tools list not found in agent content');
		const actualTools = (toolsMatch[1].match(/'([^']+)'/g) || []).map(tool => tool.slice(1, -1)).sort();
		const expectedTools = [...DEFAULT_READ_TOOLS, ...PATENT_TOOLS, 'agent', 'vscode/askQuestions'].sort();

		assert.deepStrictEqual(actualTools, expectedTools);
	});

	test('emits the PatentResearch frontmatter, Explore delegation, body, and handoffs', async () => {
		const provider = createProvider();
		const agents = await provider.provideCustomAgents({}, {} as any);
		const content = await getAgentContent(agents[0]);

		assert.ok(content.includes('name: PatentResearch'));
		assert.ok(content.includes('agents: [\'Explore\']'), 'should delegate to the Explore subagent');
		assert.ok(content.includes('You are a PATENT RESEARCH AGENT'), 'should carry the patent research body');
		assert.ok(content.includes('handoffs:'));
		assert.ok(content.includes('label: Deep Analysis'));
		assert.ok(content.includes('label: Save Results'));
		assert.ok(content.includes('label: Create Plan'));
	});

	test('applies the patent research default model when configured', async () => {
		await mockConfigurationService.setNonExtensionConfig('patent.researchAgent.defaultModel', 'Claude Opus 4.8 (copilot)');

		const provider = createProvider();
		const agents = await provider.provideCustomAgents({}, {} as any);
		const content = await getAgentContent(agents[0]);

		assert.ok(content.includes('model: Claude Opus 4.8 (copilot)'));
	});

	test('omits the model field when no default model is configured', async () => {
		const provider = createProvider();
		const agents = await provider.provideCustomAgents({}, {} as any);
		const content = await getAgentContent(agents[0]);

		const frontmatter = content.slice(0, content.indexOf('---', 3));
		assert.ok(!frontmatter.includes('model:'), 'should not emit a model field without configuration');
	});

	test('fires onDidChangeCustomAgents when the patent research default model changes', async () => {
		const provider = createProvider();

		let eventFired = false;
		provider.onDidChangeCustomAgents(() => {
			eventFired = true;
		});

		await mockConfigurationService.setNonExtensionConfig('patent.researchAgent.defaultModel', 'some-model');

		assert.equal(eventFired, true);
	});

	test('does not fire onDidChangeCustomAgents for unrelated setting changes', async () => {
		const provider = createProvider();

		let eventFired = false;
		provider.onDidChangeCustomAgents(() => {
			eventFired = true;
		});

		await mockConfigurationService.setNonExtensionConfig('chat.planAgent.defaultModel', 'some-model');

		assert.equal(eventFired, false);
	});

	test('has a Patent Research label', () => {
		const provider = createProvider();
		assert.ok(provider.label.includes('Patent'));
	});
});
