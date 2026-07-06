/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from '../../../nls.js';
import { PolicyCategory } from '../../../base/common/policy.js';
import { Extensions as ConfigurationExtensions, IConfigurationRegistry } from '../../configuration/common/configurationRegistry.js';
import { Registry } from '../../registry/common/platform.js';
import {
	AgentHostClaudeAgentEnabledSettingId,
	AgentHostCodexAgentEnabledSettingId,
} from './agentService.js';

// Settings consumed by the agent host starter (`electronAgentHostStarter.ts`
// and `nodeAgentHostStarter.ts`) to populate the spawned agent host process's
// environment. The starter exists in both the desktop main process and the
// remote server process, so this registration has to be visible to both —
// each starter file side-effect-imports this contribution, which causes the
// registration to run as soon as the starter module is loaded. The renderer
// also imports this so the same defaults show up in the settings UI.
//
// Side-effect imports of this file:
//   - `src/vs/workbench/contrib/chat/browser/chat.shared.contribution.ts`
//     (renderer registration for the settings UI).

const configurationRegistry = Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration);
configurationRegistry.registerConfiguration({
	id: 'chatAgentHostStarter',
	title: nls.localize('chatAgentHostStarterConfigurationTitle', "Chat Agent Host Starter"),
	type: 'object',
	properties: {
		[AgentHostClaudeAgentEnabledSettingId]: {
			type: 'boolean',
			description: nls.localize('chat.agentHost.claudeAgent.enabled', "When enabled, the agent host registers the Claude provider (subject to the Claude SDK being reachable). Independent of `#chat.agents.claude.preferAgentHost#` and `#chat.editor.claude.preferAgentHost#`, which choose which integration surfaces Claude. Requires `#chat.agentHost.enabled#`. The agent host process must be restarted for changes to take effect."),
			default: true,
			tags: ['experimental', 'advanced'],
			// Owns the `Claude3PIntegration` policy; gating here disables Claude across all surfaces.
			// The user-facing copilot-chat setting `github.copilot.chat.claudeAgent.enabled` attaches
			// to this policy via a `policyReference` declared in the distro `product.json`. Ownership
			// lives here (not in `product.json`) so the policy can carry a `value` callback that honors
			// the account-side editor preview-features flag.
			policy: {
				name: 'Claude3PIntegration',
				category: PolicyCategory.InteractiveSession,
				minimumVersion: '1.113',
				value: (policyData) => policyData.chat_preview_features_enabled === false ? false : undefined,
				localization: {
					description: {
						key: 'chat.agentHost.claudeAgent.enabled.policy',
						value: nls.localize('chat.agentHost.claudeAgent.enabled.policy', "Enable Claude Agent sessions in VS Code. Start and resume agentic coding sessions powered by Anthropic Claude Agent SDK directly in the editor. Uses your existing FlowLeap subscription."),
					}
				}
			},
		},
		[AgentHostCodexAgentEnabledSettingId]: {
			type: 'boolean',
			description: nls.localize('chat.agentHost.codexAgent.enabled', "When enabled, the agent host registers the Codex provider (subject to the Codex SDK being reachable). Requires `#chat.agentHost.enabled#`. The agent host process must be restarted for changes to take effect."),
			default: false,
			tags: ['experimental', 'advanced'],
			// Allow the default to be overridden by an experiment. Uses `startup`
			// (matching the sibling agent-host settings) since the agent host
			// process must be restarted for a change to take effect anyway.
			experiment: { mode: 'startup' },
			// Owns the `Codex3PIntegration` policy; gating here disables Codex across all agent-host surfaces.
			policy: {
				name: 'Codex3PIntegration',
				category: PolicyCategory.InteractiveSession,
				minimumVersion: '1.126',
				value: (policyData) => policyData.chat_preview_features_enabled === false ? false : undefined,
				localization: {
					description: {
						key: 'chat.agentHost.codexAgent.enabled.policy',
						value: nls.localize('chat.agentHost.codexAgent.enabled.policy', "Enable Codex Agent sessions in VS Code. Start and resume agentic coding sessions powered by OpenAI Codex SDK. Uses your existing FlowLeap subscription."),
					}
				}
			},
		},
	}
});
