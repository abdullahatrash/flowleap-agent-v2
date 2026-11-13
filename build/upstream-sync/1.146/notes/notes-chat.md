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

# PRD 0027 PR B (1.146.0) re-apply notes: `chat`

Branch `port/1146-chat`, worktree `wt-1146-chat`, on top of checkpoint 932e66ca19e. Commits are one per
intent (`port(0027-B): <id> — …`) each followed by `port(0027-B): kit — <id>`; kit patches are written
against upstream 1.146.0 after step 10-13. tsgo at the checkpoint: 62 errors (4 in chat paths); at the
end: 59 (0 in chat paths). Extension dts check (`extensions/copilot` tsconfig + worker): 2 → 0 and 0 → 0.

## B3a byok-nudge: re-anchored (31-reapply-19)
chatWidget.ts: the `constants.js` import line gained upstream symbols (CONTINUE_CHAT_IN_COPILOT_ACTION_ID
etc.), so only that hunk moved; the welcome-message branch, the hasByokModels listener and the error
renderer trust (chatListRenderer.ts) are byte-identical to 1.140.

## B3b byok-rejected-key: as-is (31-reapply-20). ## B3c per-model-token-totals: as-is + dts (31-reapply-21)
The ext-host DTOs applied as-is. The dts half (`ChatResultModelTotal` + `ChatResultUsage.modelTotals` in
vscode.proposed.chatParticipantAdditions.d.ts) was carried by the 1.140 `40-ext-dts` patch; it now lives
in this intent's patch because the extension's toolCallingLoop.ts needs it to compile.

## B3d chat-extension-always-enabled: re-anchored (31-reapply-22)
One conflict: the constructor line next to `_chatExtensionId` (upstream removed
`_sessionsWindowAllowedExtensions`). product.ts and the test applied as-is. Files are in brand's paths
(see "Files outside my paths").

## B3e no-model-way-out: re-derived (31-reapply-23), includes 0f93554f310
Upstream deleted modelPickerItemSections.ts/modelPickerItemTypes.ts (09ab182715d); the tabbed picker is
the only picker. Picker half now: `modelPickerRequiresSetup` takes `clientByokEnabled` and returns false
for it (0f93554f310, so BYOK never reaches Copilot setup), and `ModelPickerWidget._providerPlaceholders`
returns a BYOK placeholder in the "no models" branch — signed out: "Sign In" (flowleap.signIn) with the
Trial-models message; signed in: "Add Model" (workbench.action.chat.manage). The picker reads
`flowleap.signedIn` through an injected IContextKeyService (new ctor arg; modelPickerLocalModelItems.test
already stubbed it, modelPickerTelemetry.test now does). The tab-bar "Manage Models..." remains the second
path while signed out. chatWidget half (signed-out welcome variant, send gate + notification prompt,
re-render on `flowleap.signedIn`) applied unchanged except the ctor anchor (INotificationService appended
after IChatOpenDiagnosticsService). Tests: 2 cases in modelPickerPresentation.test, 2 in
modelPickerTelemetry.test; `TestChatEntitlementService.clientByokEnabled/hasByokModels` widened to
`boolean` so anonymous subclasses can override them.

## B9a / B9b: as-is / re-anchored (31-reapply-24 / 25) — chat.shared.contribution.ts (aw's file)
B9b: same one-line default change; upstream now wraps the description in a migrationsTabLink and the
`markdownDeprecationMessage` line moved, so the hunk re-anchored by 3-way. Exact lines are listed under
"Registrations for aw" in the report.

## B9c recommended-default-sonnet: re-anchored (31-reapply-26)
modelSelection.ts applied as-is; chatInputPart.ts import line (upstream added getRegisteredLanguageModels,
resolveModelIdentifierFromLanguageModels) and the test import line (getDefaultModelPolicyDescription)
re-anchored. The Agents-window half (A5.2) is aw's.

## B10a subagent-header-ext-host: as-is by 3-way (31-reapply-27); dts half in 40-ext-dts.
## B10b tree-find-matches-description: as-is (31-reapply-28) — treeView.ts is in brand's paths.
## B10c add-context-files-from-disk: SUBSUMED, dropped
Upstream de09766493b "chat: add a file chooser to the attachment menu" ships `FileContextValuePick`
("Files...", ordinal 900, native dialog, per-file warnings). Only delta: the fork allowed folders. Kit
script 31-reapply-29 kept for the record; not applied.
## B10d chat-output-zero-height: as-is (31-reapply-30).
## B10e provider-agents-unbacked-uris: re-anchored (31-reapply-31)
Imports + optional 4th ctor arg + the parseNew guard at the new line; test applied as-is.
FOLLOW-UP for aw: `src/vs/sessions/contrib/chat/browser/customizationHarnessService.ts` lost the
`@IFileService fileService` ctor arg and the 4th `super(..., fileService)` argument (as at 1feddc94420).

## B6a mcp-gallery-flowleap-registry: re-anchored (31-reapply-40; 45 folded into it)
Service + Learn-more link as-is; the test's import block conflicted with upstream's new imports
(McpGalleryInvalidCursorError, CustomizationMarketplaceService, …) and was merged. 1f871d21f97
(slash-terminated registry URLs) checked live against https://www.flowleap.co/api/mcp: the manifest's
detail template is `/v0/servers/{name}/versions/latest`, which answers 200 for the URL-encoded name with
no redirect, so the probe never fires. (Plain `/v0/servers/<name>` is 404 either way: registry-side,
not a client concern.)

## B6b flowleap-default-marketplace: re-derived, smaller (31-reapply-41)
Kept: DEFAULT_PLUGIN_MARKETPLACE = flowleap-ai/flowleap-plugins, isDefaultMarketplaceReference, the
pre-trust in isMarketplaceTrusted AFTER the managed strict allowlist (dfc8718c28a ordering), the
OpenMarketplace default section → Plugins (now `target?.section ?? Plugins` on the target-object
signature), the pre-trust test. Dropped as subsumed: the "Browse Skill Packs" header button + CSS
(upstream's Skills section has a Browse button → `_onDidRequestBrowse` / customization discovery) and the
customizationMarketplaceWorkbenchService.test hunk (that test was rewritten and no longer hardcodes the
default). Risk for the integration test run: pluginMarketplaceService.test.ts still names
`github/awesome-copilot#marketplace` in upstream tests; they do not assert on the default, but were not run.

## B6c list clipping: SUBSUMED (1765367ee65 scrollable lists); kit step 42 removed.
## B6d mcp-list-action-state: re-anchored (31-reapply-43)
`getServerItemContextMenuActions` grew `hideLocalEnablement` filtering; the fork's self-hidden
McpServerAction filter sits in front of it. Test as-is.
## B6e mcp-tools-in-tools-section: SUBSUMED; fork helper deleted; kit step 44 removed
Upstream `copilotCliBuiltinToolSet.ts#getCustomizationToolSets` is the single list, and toolsListWidget
renders connected MCP servers with their tools as "connected" rows. The fork-only
agentHostCustomizationToolSets.ts (+ test) had no importer left; both are listed in
10-subsumed-fork-files.txt.

## B11 (#577) flowleap prompt roots: re-anchored by 3-way (31-reapply-47, NEW)
One import conflict in promptFilesLocator.ts (upstream added chatSettings imports). `PromptFileSource`
(not PromptFilesLocation) carries FlowLeapWorkspace/FlowLeapPersonal. Added `'**/.flowleap/agents/**':
false` to ALWAYS_CHECKED_EDIT_PATTERNS in platform/chat/common/chatSettings.ts (the MSRC sensitive-edit
list); `.flowleap/agents` also reaches getChatSensitiveEditLocations through the agent-locations default.

## B12 patent tool sets: re-applied (31-reapply-48, NEW)
The wholesale copy overwrote clientToolSetsContribution.ts, dropping the `flowleap-patent` set
(members = patentChatToolReferenceNames) and its test. Re-added after `vscode-general`.
`_registerDynamicToolSet` at 1.146 reconciles members on tool registration (83acb7dc514 late-registering
members), so the set survives the extension activating later. patentChatToolReferenceNames.ts (the
`patent_ai`-tag mirror) was restored by step 10 unchanged.

## B13 Mistral (778a70b1612): re-anchored (31-reapply-49, NEW) — `'mistral'` in BUILT_IN_BYOK_VENDOR_IDS.
The new languageModelCapabilities/languageModelRateLimit proposals are not required by the seam.

## B14 (#593) MCP hosted: re-derived (31-reapply-50, NEW)
b09b348544f (list once) applied as-is; e1b9d1a4761's service half did NOT land through 3-way although
git reported "cleanly" — re-added by hand: `canInstallInLocalUser()`, `resolveUserTarget`, `canInstall`
override in the common service, `false` override in the browser service. Tests re-derived on upstream's
rewritten fixture: a recording stub replaces the real local McpManagementService only when a test passes
`calls`/`localUserServers`; `remoteChannel` feeds `remoteConnection`; `localUserInstall` subclass.

## B15 (#549) webview product links: as-is by 3-way (31-reapply-51, NEW); the fork test already present.
## 40-ext-dts: dts only (agentDisplayName on ChatSubagentToolInvocationData); the 1.140 voiceProgress
no-ops are already in the extension (0 extension errors after the dts).
## 33-test-rederive: chatSetup.test + sessionTargetPickerActionItem.test as-is (they expect brand's B5a
strings "Sign in to FlowLeap", "GitHub may show…"); agentSessionsDraftHandoff.test hunk dropped (the
handoff strings are gone upstream); customizationsToolbar.test is aw's.
## 32-integration chatWidget hunk (removing a duplicated PatentIdeContextKeys import): not needed.
