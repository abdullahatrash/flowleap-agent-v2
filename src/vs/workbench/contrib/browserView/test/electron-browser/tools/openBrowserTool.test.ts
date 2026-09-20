/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { CancellationToken } from '../../../../../../base/common/cancellation.js';
import { upcastPartial } from '../../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../base/test/common/utils.js';
import { URI } from '../../../../../../base/common/uri.js';
import { IPlaywrightService } from '../../../../../../platform/browserView/common/playwrightService.js';
import { TestConfigurationService } from '../../../../../../platform/configuration/test/common/testConfigurationService.js';
import { ILogService } from '../../../../../../platform/log/common/log.js';
import { AgentNetworkFilterService } from '../../../../../../platform/networkFilter/common/networkFilterService.js';
import { AgentNetworkDomainSettingId } from '../../../../../../platform/networkFilter/common/settings.js';
import { IEditorService } from '../../../../../services/editor/common/editorService.js';
import { IRemoteExplorerService } from '../../../../../services/remote/common/remoteExplorerService.js';
import { Tunnel, TunnelModel } from '../../../../../services/remote/common/tunnelModel.js';
import { IChatService } from '../../../../chat/common/chatService/chatService.js';
import { IToolInvocation, ToolProgress } from '../../../../chat/common/tools/languageModelToolsService.js';
import { IBrowserViewWorkbenchService } from '../../../common/browserView.js';
import { OpenBrowserTool } from '../../../electron-browser/tools/openBrowserTool.js';

function createRemoteExplorerService(localUri: string): IRemoteExplorerService {
	return upcastPartial<IRemoteExplorerService>({
		tunnelModel: upcastPartial<TunnelModel>({
			forwarded: new Map([
				['localhost:3000', upcastPartial<Tunnel>({ localUri: URI.parse(localUri) })],
			]),
			detected: new Map(),
		}),
	});
}

suite('OpenBrowserTool', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	test('blocks an external forwarded destination before opening a browser page', async () => {
		const configService = new TestConfigurationService();
		configService.setUserConfiguration(AgentNetworkDomainSettingId.NetworkFilter, true);
		configService.setUserConfiguration(AgentNetworkDomainSettingId.AllowedNetworkDomains, ['localhost']);
		const networkFilterService = disposables.add(new AgentNetworkFilterService(configService));
		let openCount = 0;
		const browserViewService = upcastPartial<IBrowserViewWorkbenchService>({
			willUseRemoteProxy: () => false,
		});
		const tool = new OpenBrowserTool(
			upcastPartial<IPlaywrightService>({
				openPage: async () => {
					openCount++;
					return { pageId: 'page-id', summary: 'Page summary' };
				},
			}),
			upcastPartial<IEditorService>({}),
			browserViewService,
			createRemoteExplorerService('https://blocked-tunnel.example'),
			networkFilterService,
			upcastPartial<IChatService>({}),
			configService,
			upcastPartial<ILogService>({}),
		);
		const parameters = { url: 'http://localhost:3000/private', forceNew: true };

		await tool.prepareToolInvocation({
			parameters,
			toolCallId: 'test-tool-call',
			chatSessionResource: undefined,
		}, CancellationToken.None);
		const result = await tool.invoke(
			upcastPartial<IToolInvocation>({
				parameters,
				context: { sessionResource: URI.parse('chat:session') },
			}),
			async () => 0,
			upcastPartial<ToolProgress>({ report: () => { } }),
			CancellationToken.None,
		);

		assert.deepStrictEqual({
			openCount,
			error: result.toolResultError,
		}, {
			openCount: 0,
			error: networkFilterService.formatError(URI.parse('https://blocked-tunnel.example/private')),
		});
	});

	test('rechecks policy before existing-page discovery', async () => {
		let allowed = true;
		let discoveryCount = 0;
		const networkFilterService = upcastPartial<AgentNetworkFilterService>({
			isUriAllowed: () => allowed,
			formatError: uri => `Blocked ${uri.authority}`,
		});
		const browserViewService = upcastPartial<IBrowserViewWorkbenchService>({
			willUseRemoteProxy: () => true,
			getContextualBrowserViews: () => {
				discoveryCount++;
				return new Map();
			},
		});
		const tool = new OpenBrowserTool(
			upcastPartial<IPlaywrightService>({}),
			upcastPartial<IEditorService>({}),
			browserViewService,
			upcastPartial<IRemoteExplorerService>({}),
			networkFilterService,
			upcastPartial<IChatService>({}),
			new TestConfigurationService(),
			upcastPartial<ILogService>({}),
		);
		const parameters = { url: 'https://example.com/private' };

		await tool.prepareToolInvocation({
			parameters,
			toolCallId: 'test-tool-call',
			chatSessionResource: undefined,
		}, CancellationToken.None);
		allowed = false;
		const result = await tool.invoke(
			upcastPartial<IToolInvocation>({ parameters }),
			async () => 0,
			upcastPartial<ToolProgress>({ report: () => { } }),
			CancellationToken.None,
		);

		assert.deepStrictEqual({
			discoveryCount,
			error: result.toolResultError,
		}, {
			discoveryCount: 0,
			error: 'Blocked example.com',
		});
	});
});
