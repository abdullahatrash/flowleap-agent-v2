# PRD 0017 v2 re-apply notes: `chat` (B3, B9, B10 + context-gauge guardrail)

Branch `spike/0017-ra-chat` in `branch spike/0017-ra-chat worktree`, based on 443ed85db36.
tsgo: 1 error (the base error in copilotCliSessionType.ts, not mine). No file under src/vs/sessions or
src/vs/platform/agentHost was edited.

## B3a byok-nudge (e90557a5504, #39): re-applied, 638d4f26f25
Files: chat/browser/widget/chatWidget.ts, chat/browser/widget/chatListRenderer.ts.
The empty-chat welcome shows "No AI model connected yet. [Add your AI model]..." when patentIdeMode != false,
clientByokEnabled and !hasByokModels. The hasByokModels context listener now calls
renderWelcomeViewContentIfNeeded (it ends in updateChatViewVisibility). The chat error renderer trusts
only `workbench.action.chat.manage` in error markdown. The extension half (patentEndpointProvider) is in
extensions/copilot and is untouched.

## B3b byok-rejected-key (dababb75e64, #210): re-applied (core side), 50563b5c627
Files: chat/common/chatErrorMessages.ts + test. ChatFetchResponseType.ProviderAuthFailed, payload
fields modelProvider / credentialSent / renderedMessage, getProviderAuthFailedMessage (names the key,
links Manage Models, provider text as trailing detail). Tests: ChatErrorMessages 22/22 pass.

## B3c per-model-token-totals (383784b3999, #274): re-applied (core side), 2c0504cfa0a
Files: api/common/extHost.protocol.ts (IChatUsageDto.modelTotals), api/common/extHostChatAgents2.ts,
api/browser/mainThreadChatAgents2.ts (parent-response setUsage path only; the subagent progress path
stays as upstream, same as the fork). Subsumed parts: the footer hover (formatResponseTokenStats in
chatListRenderer.ts), IChatUsage.modelTotals and IChatUsageModelTotal already ship upstream; the dts
is at the base.

## B3d chat-extension-always-enabled (81e6bf0321a): re-applied, 733db76a1e1
Files: base/common/product.ts (IDefaultChatAgent.alwaysEnabled), services/extensionManagement/browser/
extensionEnablementService.ts (migration never disables and re-enables a globally disabled chat
extension; _isDisabledByUnification never disables it), test re-derived: upstream's "chat extension
is disabled on profile switch when setup is not completed" is replaced by the fork's "patent chat
extension stays enabled on profile switch..." (from 810ad70ca59; this is the 5c0012e9962 expectation,
re-derived). product.json already has `alwaysEnabled: true`. Tests: ExtensionEnablementService 126/126.

## B3e no-model-way-out (174e6c71524, #306): re-applied, 395c4b1359c
Files: chatWidget.ts (isByokWithoutModel, isFlowLeapSignedOut, signed-out welcome variant with the
Trial sign-in link, re-render on `flowleap.signedIn`, send gate with notification prompt "Sign In" /
"Add Your AI Model"; INotificationService + ICommandService added at the end of the constructor),
upstream's new picker: modelPicker/modelPickerItemTypes.ts (IByokNoModelActions,
IBuildModelPickerItemsOptions.byokNoModelActions), modelPickerItemSections.ts
(buildUnavailableStateItems: the "No models available" row carries Sign In / Add Model links + hover
when clientByokEnabled), modelPickerWidget.ts (IContextKeyService injected, reads `flowleap.signedIn`).
Tests: two BYOK cases added to modelPickerItems.test.ts; modelPickerTelemetry.test.ts stubs
IContextKeyService (MockContextKeyService) because the widget now injects it. Suites
buildModelPickerItems / ModelPickerTelemetry / ModelPickerActionItem: 316 pass.
Not covered: the opt-in tabbed picker (`chat.experimentalModelPicker`, modelPickerTabbedWidget.ts) has
its own empty state; the fork never had it.

## B9a claude-md-off-by-default (9dc98a53ed7): re-applied (core side), 8c2b637ad41
chat.shared.contribution.ts: chat.useClaudeMdFile default false. notes.md prompt part is in
extensions/copilot (untouched).

## B9b personal-claude-skills-off (4ce788cbc60, #342): re-applied (core side), ca0d2761670
chat.shared.contribution.ts: chat.agentSkillsLocations default maps `~/.claude/skills` to false
(upstream now marks the setting deprecated, but the Local harness still reads it via
PromptsConfig.promptSourceFolders, which drops a default folder set to false). Template and seed-prompt
parts are in extensions/copilot.

## B9c recommended-default-sonnet (1a87cde19ba, #160): re-applied (core side), 2c2098e7abb
Upstream deleted chatModelSelectionLogic.ts; the default now comes from
ChatInputModelSelectionController via the input part's runtime `getDeclaredDefaultModel`. Added
exported findRecommendedDefaultModel to chat/common/modelSelection.ts (reuses its compareModelVersions)
and chatInputPart.ts's getDeclaredDefaultModel = recommended ?? isDefaultForLocation. A configured
`chat.defaultModel` and remembered/explicit picks still win (they are resolved before the declared
default). 3 tests in modelSelection.test.ts. Suites ModelSelection / ChatInputModelSelection: 140 pass.
Note: the Agents-window composer has its own runtime (src/vs/sessions, not mine); the fork's intent
text says the Agents window already resolves to Sonnet.

## B10a subagent-header-ext-host (dba5adc26a4 + 66f6d0fdad2, #413): re-applied (core side), 6acfb706967
Files: api/common/extHostTypes.ts (ChatSubagentToolInvocationData.agentDisplayName;
ChatToolInvocationPart.toolSpecificData accepts ChatSubagentToolInvocationData),
api/common/extHostTypeConverters.ts (passes agentDisplayName), chat/common/tools/builtinTools/
runSubagentTool.ts (subagentDisplayName: `patent-search` -> "Patent Search"; only set when it differs
from the raw name, so upstream assertions stay valid). Tests: extHostTypeConverters test updated to
carry the display name; runSubagentTool test for patent-search added.
Subsumed: `modelName` on the ext-host type/converter (upstream bc383984174); the hasSameContent
subagent guard in chatToolInvocationPart.ts (line 447) and in chatThinkingContentPart.ts (moved above
the isComplete check, "A background child can be discovered after the parent response completes");
the header's displayName-or-agentName fallback (chatSubagentContentPart.ts:390) with upstream tests.

## B10b tree-find-matches-description (0fac3c980d8, #330): re-applied, f564a1271a4
browser/parts/views/treeView.ts: keyboard-navigation label = label/resource name + string description.

## B10c add-context-files-from-disk (b77076f8a90): re-applied, 668040bae2e
chat/browser/actions/chatContext.ts: BrowseFilesContextValuePick ("Files from Disk...", ordinal 900,
IFileDialogService + IChatAttachmentResolveService.resolveEditorAttachContext), gated on
supportsFileAttachments. Labels use double quotes (the fork used single quotes).

## B10d chat-output-zero-height (f6f334edec4): partly, ef799458128
Re-applied: chatOutputItemRenderer.ts ignores intrinsicContentSize heights of 0.
Subsumed: the "re-initialise a reused ChatOutputCodeBlockPart on the next frame" half. Evidence:
upstream 6a932e0f957 "chat: Keep Mermaid diagrams mounted while a response streams (#336337)"
reconciles markdown in place so the reused iframe stays connected, and chatListRenderer.test.ts
"keeps Mermaid output mounted while the rest of a response streams" asserts reinitializations: 0.
Re-adding the fork's remount made all 6 of those tests fail (6 reinitializations), so it was dropped.

## B10e provider-agents-unbacked-uris (a18f4ae30cc, #78): re-applied (workbench side), 27c2ab6ec3f
chat/common/customizationHarnessService.ts: CustomizationHarnessServiceBase takes an OPTIONAL
`fileService?: IFileService` (4th arg) and builds provider agents whose URI has no file system
provider from provider metadata (`new PromptFileParser().parse(uri, '')`) instead of parseNew.
chat/browser/aiCustomization/customizationHarnessService.ts forwards @IFileService. Optional so
src/vs/sessions compiles untouched. Test added (parseNew throws; agent still resolves).
Suites CustomizationHarnessService / ChatModeService: 32 pass.
FOLLOW-UP for the Agents Window agent: SessionsCustomizationHarnessService
(src/vs/sessions/contrib/chat/browser/customizationHarnessService.ts) must add `@IFileService fileService`
and pass it as the 4th super arg; the original ENOPRO bug was seen in the Agents window.

## Guardrail: context gauge uses maxContextWindowTokens: subsumed
chat/common/languageModels.ts has ILanguageModelChatMetadata.maxContextWindowTokens (line 275) and
getModelContextWindowTotal (line 359: declared window wins, input+output only as a legacy fallback).
Consumers: chatContextUsageWidget.ts:393, modelPickerHover.ts:161, modelPickerCard.ts:429,
modelPickerModelConfig.ts:161. extHostLanguageModels.ts:241 maps maxContextWindowTokens; the dts is at
the base (vscode.proposed.chatProvider.d.ts:43). Nothing to re-apply.

## Tests
- `node build/next/index.ts transpile` then `VSCODE_SKIP_PRELAUNCH=1 ./scripts/test.sh --grep ...`.
- Broad run `--grep "Chat|chat|ModelPicker|ExtHost"` on the final branch: 7034 passing, 22 pending;
  failures after the B10d fix: 1, `ChatStatusDashboard Enterprise Managed — PRU with credits used
  (compact)`, which fails identically on the base 443ed85db36 (not mine).
- ExtensionEnablementService 126/126; ChatErrorMessages 22/22; ComputeAutomaticInstructions /
  PromptsService / ChatListItemRenderer / ChatContext / TreeView 229 pass.

## Decisions needed
- None blocking. B9c: the recommended Sonnet default now outranks a provider's isDefaultForLocation
  model (same order as the fork: configured ?? recommended ?? declared/first). Say if the provider
  default should win instead.

## Unclassified fork changes
- None. Every non-port fork commit since b0b6062a946 touching chat contrib, workbench/api,
  views/treeView, extensionManagement and base/product.ts is on list A or list B.

## Findings outside scope
- B10e needs the one-line forward in src/vs/sessions (see above; Agents Window agent).
- chatModelsWidget.ts (Manage Language Models editor, lines 144/821/1455) still shows
  maxInputTokens + maxOutputTokens as the context size, as upstream and the fork did; not the
  gauge/picker hover, so left as is.
- Upstream picker strings "Sign in to use Copilot" / "Upgrade to GitHub Copilot Pro" in
  modelPickerItemSections.ts belong to B5 rebrand (another group).
- The tabbed picker (experimental) has no BYOK way-out links (see B3e).
