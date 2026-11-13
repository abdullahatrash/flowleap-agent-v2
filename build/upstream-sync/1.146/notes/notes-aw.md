# PRD 0017 v2 re-apply — Agents Window (`aw`)

Branch `spike/0017-ra-aw` (worktree `branch spike/0017-ra-aw worktree`), base 443ed85db36.
tsgo: **0 errors** (the 1 base error in `copilotCliSessionType.ts` is removed in A2). Layers check: pass (Node 24).
ESLint on changed files: 0 errors, 2 warnings (see Findings).

## A1 Claude-native setup, no GitHub gate — re-applied — 37d2566a065
Files: `sessions/browser/sessionsSetUpService.ts`.
Upstream grew a signed-out machinery (`allowSignedOutWhenUsable`, `canInitializeWithoutGitHub`) that still shows a GitHub sign-in dialog on first launch until providers register. Re-applied the intent as one branch in `_start()`: when the product's `defaultChatAgent.provider.default.id !== 'github'` (FlowLeap: `flowleap`), run `_runWithoutGitHubGate()` = enable AI features, show the welcome dialog on first desktop launch (skipped and marked done if `welcomeOnboarding.state` is set, e04542181ac), open straight into the sessions list, watch `chat.disableAIFeatures`. Welcome dialog drops the Copilot terms footer when the provider is not GitHub. All upstream code paths stay intact (GitHub products unchanged). Tour string: upstream no longer names Copilot (subsumed). No unit test exists for this service.

## A2 Claude-only session-type picker — re-applied — c8dc2f069dc
Files: new `contrib/providers/claudeChatSessions/browser/{claudeChatSessionsProvider.ts, claudeChatSessions.contribution.ts, localChangesets.ts}`, test `claudeChatSessions/test/browser/claudeChatSessionsProvider.test.ts`, `sessions.common.main.ts`; deletes fork-only `copilotChatSessions/browser/copilotCliSessionType.ts` (unreferenced, was the base tsgo error).
See "Decisions needed" D1. New fork-only `ClaudeChatSessionsProvider` (id `default-copilot`, label "FlowLeap Chat", icon robot) offers only `claude-code` (authRequirement None) for `file:` folders; creates Claude sessions through the extension's `createNewChatSessionItem` (Claude commits its resource before send), sends via `IChatService`, lists committed sessions from `IAgentSessionsService` (providerType `claude-code`) with a workspace built from `repositoryPath`/`worktreePath` metadata; resume = opening the `claude-code:` resource, served by the extension's content provider. Rename via `github.copilot.claude.sessions.rename`. Changesets: upstream `createChangesets` needs the sessions GitHub service (kept out), so the fork's git-backed changesets are kept as fork-only `localChangesets.ts`. Upstream `copilotChatSessions.contribution` is no longer imported (keep-out: Cloud/Sandbox only, and its provider needs `IGitHubService`/`IPullRequestIconCache`, which only the kept-out github contrib registers — it would fail DI at runtime).
`hideExtensionHost` defaults (fork-only `agentHost.config.contribution.ts`): not re-registered — nothing in upstream `src/vs` or `extensions/copilot` reads `chat.agents.copilotCli.hideExtensionHost` / `chat.editor.copilotCli.hideExtensionHost` any more, and upstream's picker has no extension-host Copilot CLI row.
Tests: ClaudeChatSessionsProvider 3/3 pass.

## A3 Account panel on flowleap auth — re-applied — fc10cb993d2
Files: `browser/accountTitleBarState.ts`, `contrib/accountMenu/browser/account.contribution.ts`, `browser/media/openInVSCode.css`, `browser/actions/vscodeActions.ts`, `electron-browser/actions/vscodeActions.ts`, `browser/widget/openInVSCodeWidget.ts`, 2 tests.
`resolveAccountInfo` reads `flowleap` sessions first; Sign In = `flowleap.signIn`, Sign Out confirms then `patent-ai.signOut`, both gated on `flowleap.signedIn`; `ChatStatusDashboard` skipped for `flowleap` accounts; FlowLeap quota/availability strings; "Open in Patent Workspace" + masked FlowLeap mark. Tests updated (sign-in label/command; account-icon test mocks per provider) + new FlowLeap-first test. Account suites 18/18 pass.

## A4 — settled by lead (keep-out).

## A5 FlowLeap logo / aquarium — re-applied — a3a8bddbfd5
Files: `browser/media/sessions-logo-{light,dark}.svg` (fork artwork), `browser/media/sessionsSetUp.css` (mask welcome icon), `contrib/aquarium/browser/fish.ts` (symbol from fork-only `flowleapLogoPath.ts`; upstream `vscodeLogoPath.ts` left unused on disk), `browser/parts/mobile/mobileTitlebarPart.ts` (#93: Copilot dashboard not shown for `flowleap` accounts; gated instead of deleted). #93 academic chip is in the fork-only templates file (A9).

## A6 Patent-voice strings — re-applied — 7f3df084ee1
Files: `contrib/chat/browser/newChatInput.ts` (#65 placeholders), `browser/sessionsSetUpService.ts` (welcome detail, 6fa2c27dbee), `platform/agentHost/common/agentHostSchema.ts`, `platform/agentHost/common/agentHostStarter.config.contribution.ts` (#76 lines still present upstream). Other #76/#76-follow-up sites are gone upstream (Claude setting, CLI session type, permission-picker subtext string no longer exists) or live in workbench. NewChatInput suites pass.

## A7 — settled (workbench). A8 — settled (skills verbatim; not edited).

## A9 Workflow template starters — re-applied — de0e755d81d
Files: `contrib/chat/browser/newChatWidget.ts`, `contrib/chat/browser/media/chatWidget.css`. Fork-only `sessionWorkflowTemplates.ts` (restored at base) re-wired: chip row below the composer, click → `NewChatInput.prefillInput`. Upstream's `NewSessionPromptOptionsWidget` is controller-driven suggestions, not static starters. `sessionWorkflowTemplates` suite passes.

## A10 FlowLeap CLI nudge — re-applied — 87e25dce438
Files: `sessions.desktop.main.ts` (renderer `flowleapCliService` + `flowleapCliNudge.contribution`), `sessions.web.main.ts` (browser `flowleapCliService`, as at 810ad70ca59). FlowLeapCliNudge 1/1 pass. Needs the electron-main channel (see Findings F1).

## A11 Local chat sessions provider — re-applied (restored + re-pointed) — 5c0e5588196
Files: restored `contrib/providers/localChatSessions/**` from 810ad70ca59 (provider, contribution, test, LOCAL_CHAT_SESSIONS_PROVIDER.md) + new `localChatSessionsActions.ts`; `sessions.common.main.ts`; `contrib/chat/browser/customizationHarnessService.ts` + its test.
Restoring was smaller than rewriting (9 tsgo errors): authRequirement None, IChat workspace/modelSource/interactivity/changesets (git-backed `localChangesets`), `getModelsSnapshot`, `setModel(…, source)`, observable `capabilities`, `createQuickChat`/`createSideChat`/`setSessionReadState`. Mode + permission pickers use upstream's shared `ModePicker`/`PermissionPicker` through a new `getSessionConfiguration()`; note at 810ad70ca59 these pickers were gated on `CopilotChatSessionsProvider` and did nothing for Local, now they work. Local customization harness re-registered while a provider offers the `local` type (upstream removed it, 445ff849bd5). LocalChatSessionsProvider + SessionsCustomizationHarnessService: 27 pass (1 new harness test).

## A12 Claude pickers — re-applied (Claude permission mode only) — 194c926d706
Files: `claudeChatSessions/browser/{claudePermissionModePicker.ts, claudeChatSessionsActions.ts}` + restored test. Restored the upstream-deleted fork picker (upstream's `PermissionPicker` models `ChatPermissionLevel`, not Claude's modes) re-pointed at the Claude provider (`setOption('permissionMode')`). Isolation, branch, mobile-permission pickers: not restored — at 810ad70ca59 they applied only to Copilot CLI sessions (hidden); Claude manages worktrees itself. Upstream's shared `contrib/chat/browser/branchPicker.ts` exists if a branch picker is ever wanted. ClaudePermissionModePicker 7/7 pass (grep also ran 3 upstream agent-host Claude picker tests, pass).

## A13 MCP (sessions parts of #146/#147, B6) — re-applied — 2d1fbf029ce
Files: `services/configuration/browser/configurationService.ts` (`userConfiguration.reload()` in initialize + reloadConfiguration so mcp.json `inputs` load), regression test; `aiCustomizationOverviewView.ts` + `customizationsToolbar.contribution.ts` count `getCustomizationToolSets` (upstream has the helper, but these two consumers still read raw `toolSets`); `AI_CUSTOMIZATIONS.md` one paragraph. 372009241b3 has no sessions files. Sessions ConfigurationService suite passes.

## A14 Marketplace CTA (#114 sessions part) — subsumed / nothing to apply
The only sessions change was an `AI_CUSTOMIZATIONS.md` table row about `aiCustomization.openMarketplace`; upstream rewrote that doc and the row no longer exists. Code is in workbench.

## A15 Fork-kept files — subsumed/dropped — 29d3c3c6635
`sessionsDiffEditorLayout.ts` (fork-only split) deleted: upstream defines and registers the same `SessionsDiffEditorLayoutContribution` in `diffEditor.sessions.contribution.ts`; nothing imported the fork file. `sessionHeaderMetaActionViewItem`, `newSessionActionViewItem`, `syncChangesActionViewItem`, `workspaceFolderActions`, `agentFeedbackHover(.css)`, `nullChatTipService`, mobile `AGENTS.md`: `git log b0b6062a946..810ad70ca59` shows zero fork commits on them — stale upstream files upstream later deleted/replaced (8629d2d1db5, 552104a5694, 30645906b5e, 4e6550688e4, 38220eab177, 2806869750e). Not restored.

## A16 — settled by lead.

## A17 patentIdeMode (sessions part of #82) — re-applied — 8df505ff7b5
File: `browser/parts/menubar.contribution.ts`: Terminal menubar entry `when: PatentIdeContextKeys.Mode.toNegated()` (fork-only key file restored at base).

## A18 remoteAgentHostProtocolClient.ts — subsumed
Not present at base; upstream's `platform/agentHost/browser/agentHostProtocolClient.ts` is the same client. Nothing to do.

## B5 sessions-tree parts
- #76 (99720b8e769, 6fa2c27dbee): in A3 (account strings) and A6.
- #93 (7732f8084a7): in A5; chip already in templates file.
- #100 (50efab55511): robot icon applied on the new Claude provider (A2); CLI session type gone.
- #117 (95176f3f8f6): **not re-applied**. Fork hid the session-type chip when ≤1 type. Upstream now deliberately renders a *disabled* chip for a single type (also used by the web creation-destination and pet surfaces); changing it breaks 2 upstream tests. With A2+A11 the desktop picker always has 2 types (Claude, Local), so the lone chip does not occur. See D3.

## B6 sessions-tree parts
- #114 (b739038a3ac): A14 (doc only, subsumed). #146 (2a0e34af2c1, 372009241b3), #147 (6eef477e03e): A13.

## Other classifications
- 0a929ed019f (deleted sessions `repoPicker.ts`): **keep-out by non-use** — upstream still ships `contrib/chat/browser/repoPicker.ts` but nothing imports it; leave on disk, no registration exists.
- 5c434b42abb (sessionHeader test stub `isSessionRead`): **subsumed** — upstream's harness no longer needs it; "Sessions - Headers" 9/9 pass.

## Test results (after `node build/next/index.ts transpile`)
- Electron unit, grep "SessionTypePicker|sessionsList|SessionsList|FlowLeapCliNudge|sessionWorkflowTemplates|LocalChatSessionsProvider|ClaudeChatSessionsProvider|ClaudePermissionModePicker|SessionsCustomizationHarnessService|Account Menu|Account Title Bar State|Sessions ConfigurationService|Sessions - Headers|SessionsManagementService|NewChatInput|CopilotChatSessionsProvider": **708 passing, 0 failing, 6 pending**.
- Node unit (`mocha test/unit/node/index.js` with Node 24; `npm run test-node` fails under the shell's Node 26 with an ESM `require` error — environmental): 11993 passing incl. `vendoredPatentSkills`, 0 failing.

## Decisions needed
- **D1 Claude in the Agents window.** (a) Keep an extension-host Claude provider in the fork (implemented: fork-only `claudeChatSessions` provider over the unchanged `extensions/copilot` Claude implementation; small surface: one provider + picker + git changesets, ~1.1k lines, re-applied per sync as a fork-only dir). (b) Adopt upstream's agent-host Claude (`contrib/providers/agentHost`, `platform/agentHost/node/claude`), which needs the agent host process that PRD 0004 removed and ADR 0009/PRD 0018 keep out; it would give upstream parity (permission picker, forks, side chats) but re-opens PRD 0004 and moves Claude off BYOK/native-auth plumbing in the extension. Recommendation: (a) until Remote Access needs the agent host.
- **D2 Provider id** `default-copilot` reused for the Claude provider so pins/groups/sort overrides keyed by session id survive the upgrade. Alternative: a new id (`claude-extension-host`) and accept that stored per-session UI state resets once.
- **D3 #117 lone chip.** Keep upstream's disabled single chip (implemented) vs. re-apply the hide (diverges from upstream, update 2 upstream tests).
- **D4 A1 gate condition.** Implemented on `defaultChatAgent.provider.default.id !== 'github'`. Alternative: key it on `defaultChatAgent.alwaysEnabled` once B3 re-adds that product field.

## Missing / not verified (central item)
- Not live-tested (no app launch per brief): Claude session create → send → replace, resume of a committed session, rename, archive, Local session send, pickers rendering.
- Claude provider does not implement: multi-chat, fork, side chat, delete (as at 810ad70ca59: `supportsDelete` false for Claude), automations, quick chats.
- Mobile/web permission picker for Local (fork had `mobilePermissionPicker.contribution`, web-only) not restored.

## Unclassified fork changes
- None beyond the lists. Skill re-vendors (f12e643f638, 9cc99a7a417, 03d2265c309, 1a35a85bcf2, 1612a606781, da3085c7b46, b309511d45a, ba215e5ecff, 5b7fa0d7b01, 5ce56d2ea43, 9de619e5a85, 222d6838c0d, dcf5361ee53, 51d671db3e4, 90938dfcde3) = A8; 5c0012e9962 = B5 test re-derive (templates test already in fork-only file); agent-host deletions (#71–#77, 22a47d4792e, 3818b6bc5ac) = B7 keep-out.

## Findings outside scope
- **F1** `src/vs/code/electron-main/app.ts` lacks the fork's `flowleapCli` main-process channel (810ad70ca59 app.ts L53-54, L1376-1377: `ProxyChannel.fromService(IFlowLeapCliMainService)` registered as `'flowleapCli'`). Without it the A10 nudge's `IFlowLeapCliService` proxy has no server. Owner: lead / workbench group (#66, B1).
- **F2** `eslint.config.js` restricts `agentSessionsService.js` imports to `contrib/providers/copilotChatSessions`; the new `contrib/providers/claudeChatSessions` provider (and its test) trigger 2 `no-restricted-imports` warnings. Add the Claude provider dir to that allowlist (file outside `src/`).
- **F3** a18f4ae30cc (#78, B10) passed `IFileService` to `CustomizationHarnessServiceBase`; upstream's base ctor no longer takes it. If the workbench group re-adds that param, `SessionsCustomizationHarnessService` (now also injecting `ISessionsManagementService`, A11) must pass it.
- **F4** Many new upstream agent-host setting/policy strings say "Copilot" (OTel policies, multi-root, system proxy) in `platform/agentHost/common/agentHostStarter.config.contribution.ts`; #76 covered only the lines that existed then. Rebrand pass is a follow-up.
- **F5** The Local provider's contribution still registers a `ForkConversationAction` subclass whose fork-as-chat path only works for agent-host providers (always false now); harmless, candidate for removal.
