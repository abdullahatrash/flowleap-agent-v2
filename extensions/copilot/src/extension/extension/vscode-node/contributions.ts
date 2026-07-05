/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { PromptFileContribution } from '../../agents/vscode-node/promptFileContrib';
import { AuthenticationContrib } from '../../authentication/vscode-node/authentication.contribution';
import { PatentAIContribution } from '../../patentai/vscode-node/patentContribution';
import { BYOKContrib } from '../../byok/vscode-node/byokContribution';
import { ChatDebugFileLoggerContribution } from '../../chat/vscode-node/chatDebugFileLoggerService';
import { ChatSessionContextContribution } from '../../chatSessionContext/vscode-node/chatSessionContextProvider';
import { ChatSessionsContrib } from '../../chatSessions/vscode-node/chatSessions';
import { SessionStoreTracker } from '../../chronicle/vscode-node/sessionStoreTracker';
import * as sessionSyncContribution from '../../chronicle/vscode-node/sessionSync.contribution';
import * as chatBlockLanguageContribution from '../../codeBlocks/vscode-node/chatBlockLanguageFeatures.contribution';
import { IExtensionContributionFactory, asContributionFactory } from '../../common/contributions';
import { ConfigurationMigrationContribution } from '../../configuration/vscode-node/configurationMigration';
import { ContextKeysContribution } from '../../contextKeys/vscode-node/contextKeys.contribution';
import { ByokUtilityModelNotificationContribution } from '../../chatInputNotification/vscode-node/byokUtilityModel.contribution';
import { AiMappedEditsContrib } from '../../conversation/vscode-node/aiMappedEditsContrib';
import { ConversationFeature } from '../../conversation/vscode-node/conversationFeature';
import { LanguageModelAccess } from '../../conversation/vscode-node/languageModelAccess';
import { LogWorkspaceStateContribution } from '../../conversation/vscode-node/logWorkspaceState';
import { DiagnosticsContextContribution } from '../../diagnosticsContext/vscode/diagnosticsContextProvider';
import { LanguageModelProxyContrib } from '../../externalAgents/vscode-node/lmProxyContrib';
import { ScmContextProviderContribution } from '../../git/vscode/scmContextprovider';
import { IgnoredFileProviderContribution } from '../../ignore/vscode-node/ignoreProvider';
import { ExtensionStateCommandContribution } from '../../log/vscode-node/extensionStateCommand';
import { FetcherTelemetryContribution, LoggingActionsContrib } from '../../log/vscode-node/loggingActions';
import { RequestLogTree } from '../../log/vscode-node/requestLogTree';
import { McpSetupCommands } from '../../mcp/vscode-node/commands';
import { NotebookFollowCommands } from '../../notebook/vscode-node/followActions';
import { OTelContrib } from '../../otel/vscode-node/otelContrib';
import { PowerStateLogger } from '../../power/vscode-node/powerStateLogger';
import { DebugCommandsContribution } from '../../prompt/vscode-node/debugCommands';
import { PromptFileContextContribution } from '../../promptFileContext/vscode-node/promptFileContextService';
import { SettingsSchemaFeature } from '../../settingsSchema/vscode-node/settingsSchemaFeature';
import { ToolsContribution } from '../../tools/vscode-node/tools';
import { OTelChatDebugLogProviderContribution } from '../../trajectory/vscode-node/otelChatDebugLogProvider';
import vscodeContributions from '../vscode/contributions';

// ###################################################################################################
// ###                                                                                             ###
// ###                   Node contributions run ONLY in node.js extension host.                    ###
// ###                                                                                             ###
// ### !!! Prefer to list contributions in ../vscode/contributions.ts to support them anywhere !!! ###
// ###                                                                                             ###
// ###################################################################################################

export const vscodeNodeContributions: IExtensionContributionFactory[] = [
	...vscodeContributions,
	asContributionFactory(ExtensionStateCommandContribution),
	asContributionFactory(ConversationFeature),
	asContributionFactory(AuthenticationContrib),
	asContributionFactory(PatentAIContribution),
	chatBlockLanguageContribution,
	asContributionFactory(LoggingActionsContrib),
	asContributionFactory(FetcherTelemetryContribution),
	asContributionFactory(PowerStateLogger),
	asContributionFactory(ContextKeysContribution),
	asContributionFactory(ByokUtilityModelNotificationContribution),
	asContributionFactory(DebugCommandsContribution),
	asContributionFactory(LanguageModelAccess),
	asContributionFactory(SettingsSchemaFeature),
	asContributionFactory(NotebookFollowCommands),
	asContributionFactory(PromptFileContextContribution),
	asContributionFactory(ScmContextProviderContribution),
	asContributionFactory(DiagnosticsContextContribution),
	asContributionFactory(ChatSessionContextContribution),
	asContributionFactory(ChatSessionsContrib),
	asContributionFactory(OTelContrib),
	asContributionFactory(SessionStoreTracker),
	sessionSyncContribution,
	asContributionFactory(BYOKContrib),
];

/**
 * These contributions are special in that they are only instantiated
 * when the user is logged in and chat is enabled.
 * Anything that contributes a copilot chat feature that doesn't need
 * to run when chat is not enabled should be added here.
*/
export const vscodeNodeChatContributions: IExtensionContributionFactory[] = [
	asContributionFactory(ConfigurationMigrationContribution),
	asContributionFactory(RequestLogTree),
	asContributionFactory(ToolsContribution),
	asContributionFactory(AiMappedEditsContrib),
	asContributionFactory(LogWorkspaceStateContribution),
	asContributionFactory(IgnoredFileProviderContribution),
	asContributionFactory(McpSetupCommands),
	asContributionFactory(LanguageModelProxyContrib),
	asContributionFactory(PromptFileContribution),
	asContributionFactory(OTelChatDebugLogProviderContribution),
	asContributionFactory(ChatDebugFileLoggerContribution),
];
