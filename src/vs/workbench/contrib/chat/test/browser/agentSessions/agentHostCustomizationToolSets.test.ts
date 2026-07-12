/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { Codicon } from '../../../../../../base/common/codicons.js';
import { ExtensionIdentifier } from '../../../../../../platform/extensions/common/extensions.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../base/test/common/utils.js';
import { IToolSet, ToolDataSource } from '../../../common/tools/languageModelToolsService.js';
import { COPILOT_CLI_TOOL_SET_ID, getStaticReadOnlyToolSets, isCustomizationToolSet } from '../../../browser/agentSessions/agentHost/agentHostCustomizationToolSets.js';

suite('agentHostCustomizationToolSets', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	function toolSet(source: ToolDataSource, deprecated?: boolean): IToolSet {
		return { id: 'x', referenceName: 'x', icon: Codicon.tools, source, deprecated, getTools: () => [] };
	}

	const mcpSource: ToolDataSource = { type: 'mcp', label: 'flowleap', serverLabel: 'flowleap', instructions: undefined, collectionId: 'c', definitionId: 'd' };
	const extSource: ToolDataSource = { type: 'extension', label: 'ext', extensionId: new ExtensionIdentifier('pub.ext') };

	test('isCustomizationToolSet: keeps non-deprecated and MCP sets, hides other deprecated sets', () => {
		assert.deepStrictEqual(
			{
				internal: isCustomizationToolSet(toolSet(ToolDataSource.Internal)),
				mcpLive: isCustomizationToolSet(toolSet(mcpSource)),
				mcpDeprecated: isCustomizationToolSet(toolSet(mcpSource, true)),
				extDeprecated: isCustomizationToolSet(toolSet(extSource, true)),
			},
			{ internal: true, mcpLive: true, mcpDeprecated: true, extDeprecated: false });
	});

	test('getStaticReadOnlyToolSets exposes the CLI Agent reference set with its tools', () => {
		const sets = getStaticReadOnlyToolSets();
		const cli = sets.find(s => s.id === COPILOT_CLI_TOOL_SET_ID);
		assert.ok(cli);
		assert.ok([...cli.getTools()].length > 0);
	});
});
