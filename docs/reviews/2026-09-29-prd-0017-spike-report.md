# PRD 0017 spike report (2026-09-29)

**Verdict: the PRD's scope cannot reach zero type errors.** Upstream `src/vs/sessions` at 1.140 needs upstream `workbench/contrib/chat` (and pieces of `base`, `platform`, `workbench`) at 1.140. The fork's copies are at 1.127 plus ports. A sync of the Agents Window alone is not closable. A sync of all of `src/vs` compiles with 139 errors, but it drops the fork's intents in 448 files outside the two trees. Fix rounds, tests and the eyeball run were NOT done. They have no meaning at 2,000+ errors. The lead was told mid-spike.

Worktree: `/Users/abdullahatrash/flowleap/wt-spike-0017` (throwaway). Branches: `spike/0017-agents-window-sync` (PRD scope, steps 01 to 01c), `spike/0017-exp-all-upstream` (full `src/vs` experiment plus 02). Both are checkpoint commits only. No PR.

## Scripts (scripts/, each takes the worktree path as $1)
| Script | Scope | What it does |
|---|---|---|
| 01-copy-upstream.sh | PRD | Upstream `src/vs/sessions`, restores the 81 fork-only files, copies agentHost browser/common/electron-browser plus 4 docs, deletes agentSessionState, rewrites every `/agentSessionState/` import in src/ and eslint.config.js |
| 01b-copy-closure.sh | experiment | Copies upstream files that the synced trees import transitively and that the fork lacks (313 files, never overwrites) |
| 01c-copy-stale-outside.sh | experiment | Copies upstream HEAD over 1,185 `src/vs` files the fork never touched since the fork point, plus the closure |
| 01d-exp-all-upstream.sh | experiment | Copies upstream HEAD over the 448 fork-touched `src/vs` files outside the two trees, plus the 146-file closure |
| 02-keep-out.sh | PRD | Removes 53 registration imports from the three sessions entry points (log: 02-keep-out.log) |
| closure.mjs, div.mjs, divergence.sh | tools | Import closure and per-directory divergence measurement |
No 03-* scripts were written. See "Deliberate changes" below.

## Error count per step
| Step | Errors |
|---|---|
| baseline main 810ad70ca59 | 0 |
| 01 | 2,137 (423 missing module, 153 distinct modules, 629 missing member) |
| 01b (+313 new files outside) | 1,909 |
| 01c (+1,185 stale files to upstream) | 2,439 (1,187 now in workbench/contrib/chat: stale files meet fork-touched ones) |
| 01d full src/vs (experiment) | 139 |
| 02 on top of 01d | 139 |

The 139 in the full-sync experiment:
| Area | Errors | Cause |
|---|---|---|
| workbench/api (extHost) | 58 | `src/vscode-dts` not synced: upstream proposals (ChatAttachContextProvider, TabSelector, voiceProgress). Fork touched 2 dts files (subagent header #413, BYOK token totals #274) |
| sessions (fork-only files) | 33 | localChatSessionsProvider vs new ISessionsProvider (createQuickChat, getModelsSnapshot, capabilities observable), ISessionType.authRequirement, branch/isolation/permission pickers vs new ICopilotChatSession, MenuId.SessionHeaderMeta gone |
| workbench/contrib/chat | 19 | fork-only chat files (localAgentDisabledInputTip, agentSessionsQuickAccess, ...) |
| workbench/test fixtures | 15 | fixture utils drift |
| app.ts, sharedProcessMain.ts, serverServices.ts | 7 | upstream wires `platform/agentHost/node` and electron-main starter (re-apply #73 intent) |
| `@vscode/os-proxy-resolver` | 3 | new upstream dependency, not in the fork's package.json |
| other | 4 | dialogs test, assignmentService implicit any |

## Divergence measured (src/vs, fork HEAD vs upstream 480c6e142fa vs fork point b0b6062)
| Area | identical | stale | fork-touched | fork-only | upstream-only |
|---|---|---|---|---|---|
| all of src/vs | 5,182 | 1,326 | 586 | 216 | 4,335 |
| workbench/contrib/chat | 355 | 255 | 217 | 15 | 681 |
| workbench/contrib (all) | 1,933 | 558 | 290 | 32 | 861 |
| workbench/services | 529 | 95 | 22 | 0 | 52 |
| src/vscode-dts | 167 | 9 | 2 | 0 | 4 |

Fork-touched files outside the two trees: 448. Fork commits touching them since the fork point: 195. Of these, 134 are `port` commits (subsumed by a copy). 61 carry fork intent (list: scripts/touched_outside_commits.txt minus the `port` lines). Main groups: onboarding wizard and trial (about 12), auth and FlowLeap sign-in (#21, #22, L3), BYOK (#39, #210, #274, #28), patent mode and menubar gates (#20, #82, #83), rebrand strings and survey off (#76, #99, #100, #117, #135), MCP and marketplace (#113, #114, #144, #146, #147), agent host and tunnel removal (#60, #72, #73, #74, #77), theme and developer-surface defaults, prompt and project notes, chat UI fixes (#306, #330, #413).

## Forced files outside the two trees (PRD scope, step 01)
Import rewrite only (mechanical, 43 files): workbench/contrib/chat (agentSessions/agentHost, common, widget, aiCustomization, actions, tools), workbench/services/agentHost, workbench/services/workspaces, workbench/contrib/mcp, terminalContrib/chatAgentTools, browserView, component fixtures, platform/agentPlugins/common/pluginParsers.ts (relative `../../agentSessionState/` form), eslint.config.js line 346.
Beyond that, the forced set is the 313-file closure plus API upgrades to existing files. That is the finding above, not a list of fixes.

## Keep-out (02-keep-out.log)
PRD list applied: github, codeReview, tunnelHost, remoteSessions, remoteAgentHost (whole provider, incl. cloud sandbox), automations, policyBlocked.
Added by the spike (move to "copied, not registered"):
- `contrib/providers/agentHost/**` (local agent host provider, 16 registrations). It needs the agent host process that PRD 0004 removed. The PRD list omits it.
- `workbench/services/agentHost/electron-browser/agentHostService`, `platform/agentHost/electron-browser/{ssh,wsl}RemoteAgentHostService`: spawn or connect agent hosts.
- `platform/copilotConnectors/electron-browser/copilotConnectorsRequestService`, `platform/remoteTunnel/browser/remoteTunnelService` (web): Copilot connectors and MS tunnels.
Not decided: automations/blockedSessions/policyBlocked registration test (compile against our providers) could not run; kept out. blockedSessions has no registration line in upstream's entry points.
Note: upstream's Claude agent runs inside the agent host (`chat.agentHost.claudeAgent.enabled`). Keeping `providers/agentHost` out means the fork's Claude path stays the extension-host one through `copilotChatSessions`. Upstream removed `chat.agentHost.enabled`. The fork's defaults for it (false) and `hideExtensionHost` (true) lived in the fork-only `agentSessionState/{browser,common}/agentHost.config.contribution.ts`, which step 01 deleted with the tree.

## Deliberate changes (PRD list) — status
| # | Status |
|---|---|
| 1 Claude-native setup | Needs re-apply. Upstream sessionsSetUpService has 32 GitHub/Copilot references. Not done. |
| 2 Claude-only type picker | Needs re-apply in upstream sessionTypePicker. Fork-only copilotCliSessionType.ts no longer compiles (authRequirement). Not done. |
| 3 Account panel to flowleap | Needs re-apply. Upstream account.contribution uses ChatStatusDashboard and "Sign in to use GitHub Copilot". Not done. |
| 4 No tunnel toggle | Subsumed by keep-out (tunnelHost unregistered). |
| 5 FlowLeap logo | Fork-only files restored. Upstream sessions-logo svgs replaced; needs re-apply. Not done. |
| 6 Patent-voice strings | Needs re-apply; partly lives outside sessions (#117 touched workbench/contrib/chat). Not done. |
| 7 Survey off | Lives outside sessions (#100 in workbench). The sessions entry points still import survey.contribution in both fork and upstream. Nothing to do in sessions. |
| 8 to 12, 15 fork-only files | Restored by 01. 11 and 12 break against upstream's new ISessionsProvider / ICopilotChatSession (33 errors above); 15: MenuId.SessionHeaderMeta no longer exists upstream. |
| 13, 14 MCP and marketplace | The sessions part is docs only (AI_CUSTOMIZATIONS.md). The code is in workbench/contrib/mcp and chat. Out of PRD scope; lost under a full sync. |
| 16 readSessionChangesStats | Applies: upstream now ships `contrib/changes/browser/sessionChangesEditor.ts`, which reads `stats.insertions/deletions` itself. Needs re-point to the reader. Not done. |
| 17 patentIdeMode gate | No code in `src/vs/sessions`; it lives in workbench menus. Out of PRD scope. |

## Fork changes on neither the list nor upstream
- `agentSessionState/{browser,common}/agentHost.config.contribution.ts`: fork defaults `chat.agentHost.enabled=false`, `chat.agents.copilotCli.hideExtensionHost=true`, `chat.editor.copilotCli.hideExtensionHost=true`. Not on the list. Probably belongs under item 2.
- `remoteAgentHostProtocolClient.ts` (fork-only) is upstream's `agentHostProtocolClient.ts` renamed; subsumed.
- The 61 intent commits outside the two trees are not on the list. The PRD's list only covers sessions.

## Tests, lint, layers, eyeball
Not run. The PRD-scope branch has 2,439 errors, so test and launch results would not describe anything real.

## Extension-side findings
- A full sync needs upstream `src/vscode-dts`. `extensions/copilot` enables fork-era proposals (agentSessionsWorkspace, agentsWindowConfiguration, chatDebug, ...). Their shapes changed upstream (58 extHost errors show the drift). The extension will need a change to compile against 1.140 proposals. Not measured (no change to extensions/copilot made).

## Options for the lead (my recommendation first)
1. **Full `src/vs` rebase to 1.140 as the sync unit.** It compiles at 139 errors mechanically. The real work is re-applying 61 intent commits outside the trees plus the 17 sessions items, and syncing vscode-dts with the extension. Needs a new intent list for the outside files before a spike to zero.
2. Keep sessions feature-by-feature (PRD 0016 style) and accept the lag. Remote Access then serves a window that differs from upstream's Viewer.
3. Pin sessions to an older upstream commit. Not viable: the fork's workbench matches no single upstream commit.

## Addendum (lead request 2): closure copy and drift split

### Measurement A — `workbench/contrib/chat` fork commits that are not ports
36 commits (76 more are ports). Source: `chat_intent_commits.txt`. Intents, with chat files touched:
| Intent | Commits | Chat files |
|---|---|---|
| Agent host and tunnel removal (Copilot clusters) | #60 e6865267bab, #72 7a1eb81fca6, #74 4a69caa535c, #75 2380c4e3527, #77 22a47d4792e | 85 |
| Rebrand and patent voice (strings, icons, watermark, survey off) | #76 99720b8e769 + 6fa2c27dbee, #99 05cd3a14f73, #100 50efab55511, #117 95176f3f8f6, #135 1852ce01d01, b4f7c37a75a, 59915b316fa, 800599007b5 | 60 |
| Patent mode and GitHub setup suppression | #20 f258aa3d2d2, L3 c383eab50b8 | 3 |
| BYOK and no-model UX | #39 e90557a5504, #210 dababb75e64, #306 174e6c71524 | 7 |
| MCP (gallery, mcp.json inputs, tools, start/stop) | #113 1a78cff4600, #146 2a0e34af2c1 + 372009241b3, #147 6eef477e03e | 9 |
| Marketplace and plugins (FlowLeap default, flowleap-ai org) | #114 b739038a3ac, 3e5305ded55, #269 1d4f0fc5aca | 10 |
| Prompt and investigation behavior (notes.md memory, CLAUDE.md off, personal skills off, trajectory gap) | 9dc98a53ed7, #342 4ce788cbc60, #160 1a87cde19ba | 5 |
| Subagent header on the extension-host path | #413 dba5adc26a4, 66f6d0fdad2 | 8 |
| Chat UX fixes (Files from Disk, blank webviews, unbacked agent URIs, customization list clip) | b77076f8a90, f6f334edec4, #78 a18f4ae30cc, #144 ea8b26da9fd | 12 |
| Test expectation updates only | 5c0012e9962 | 7 |
Caveat: the BYOK context gauge and the security fixes came in as `port(` commits, so the grep drops them. A port commit can still carry a fork adaptation (for example #439 set the agent host defaults). The re-apply list for this tree must check the port commits that touched fork-only defaults.

### Measurement B — drift after the closure copy (step 01b, 1,909 errors)
By error location: synced trees 1,113, new upstream files 723, fork-touched 62, stale 7, fork-only 4.
Missing-export errors by the module they point at: stale 151, fork-touched 131.

| Split | How measured | Errors |
|---|---|---|
| (a) fixed by copying stale files | 01c: errors in synced trees + new files went from 1,836 to 1,148 | about 690 |
| (a') fixed by copying port-only fork-touched files | 302 of the 448 touched files outside the trees have only port commits. 01e copies them: 2,439 to 878 | about 1,560 (these were mostly errors the stale copy exposed) |
| (b) needs hand re-application | 01e residue with only the 146 intent-bearing files at fork content | 878, of which 443 are in test files |
In short: copying stale plus port-only files takes the PRD tree from 1,909 to 878. The last 878 sit against 146 fork-intent files (70 in workbench/contrib/chat) plus the 81 fork-only sessions files.

01e residue by location: synced 282, fork-touched 275, stale 225, new upstream 67, fork-only 25, identical 4.

Top 20 fork-intent files by error count after 01e (errors located in the file + missing-export errors that point at it):
| Errors | File |
|---|---|
| 18 | workbench/contrib/chat/browser/widget/input/chatInputPart.ts |
| 15 | workbench/contrib/terminalContrib/chatAgentTools/common/sandboxSettingsReader.ts |
| 13 | workbench/test/browser/componentFixtures/sessions/sessionHeader.fixture.ts |
| 12 | workbench/test/browser/componentFixtures/sessions/aiCustomizationManagementEditor.fixture.ts |
| 12 | workbench/api/common/extHost.api.impl.ts |
| 11 | workbench/test/browser/componentFixtures/fixtureUtils.ts |
| 10 | workbench/contrib/chat/test/browser/agentSessions/agentSessionViewModel.test.ts |
| 10 | workbench/contrib/chat/browser/widget/chatListRenderer.ts |
| 9 | workbench/contrib/chat/test/browser/widget/chatListRenderer.test.ts |
| 9 | workbench/contrib/chat/browser/chatSetup/chatSetupContributions.ts |
| 7 | workbench/contrib/terminalContrib/chatAgentTools/browser/terminal.chatAgentTools.contribution.ts |
| 7 | workbench/contrib/chat/test/browser/tools/languageModelToolsService.test.ts |
| 7 | workbench/contrib/chat/common/promptSyntax/promptTypes.ts |
| 6 | workbench/contrib/terminalContrib/chatAgentTools/test/common/sandboxSettingsReader.test.ts |
| 6 | workbench/contrib/chat/common/customizationHarnessService.ts |
| 6 | workbench/contrib/chat/browser/chatQuotaNotification.ts |
| 6 | workbench/contrib/chat/browser/agentSessions/agentHost/agentHostCustomizationService.ts |
| 6 | workbench/contrib/browserView/electron-browser/features/browserEditorChatFeatures.ts |
| 6 | workbench/api/common/extHostAuthentication.ts |
| 5 | workbench/contrib/chat/common/tools/builtinTools/runSubagentTool.ts |
Lists: `touched_intent.txt` (146), `touched_portonly.txt` (302). Branch `spike/0017-exp-portonly` holds the 01e state.
Caveat: the port-only rule trusts commit subjects. A port commit that also carried a fork tweak loses it under 01e.

## Addendum (lead request 3)

### The 61 fork-intent commits outside the two trees, by intent
Source: `outside_intent_commits.txt`. Grouping map: `intent_groups.txt`. Every commit is in exactly one group (checked).

**Onboarding and trial (12)**
- 30d1f711c3f 2026-07-05 feat(sessions): detect missing FlowLeap CLI + install nudge (#66)
- bbefeb5c7f1 2026-08-29 feat: no-card trial — onboarding sells Subscribe, not a trial (backend ADR 0018)
- d24f9f18ed9 2026-07-06 refactor(onboarding): finale copies the prompt instead of auto-running
- 15b6084d985 2026-07-06 feat(onboarding): "Run your first investigation" finale step
- 0d7eb0ca1f3 2026-07-06 feat(onboarding): finale step model + role→investigation mapping
- 16d8ab200ce 2026-07-06 fix(onboarding): minimize the wizard for workbench UI; add data-keys shortcut
- c9113991693 2026-07-06 fix(onboarding): make the wizard react to async sign-in + existing access
- c34c9a782a5 2026-07-06 fix(onboarding): filter the Trial step when access already exists
- 19e2a4129e0 2026-07-06 fix(onboarding): never touch the theme — the product default is the default
- 03db45ba6e3 2026-07-06 feat(onboarding): role, trial, and model steps in the wizard
- e250e5869ba 2026-07-06 feat(onboarding): patent-persona step model — role, reorder, trial poll
- 6776fe339c3 2026-07-07 feat(branding): FlowLeap Patent AI panel identity + working walkthrough (#92)

**Auth and FlowLeap sign-in (3)**
- db5992d9a9c 2026-06-28 L3 auth: working end-to-end FlowLeap sign-in + soft onboarding step (PRD 0002 #21, #5)
- c383eab50b8 2026-06-27 L3 auth: branded Accounts sign-in CTA + suppress GitHub chat-setup surfaces in Patent IDE mode (PRD 0002 issues 6 and 22)
- 05cd3a14f73 2026-07-10 fix(rebrand): de-Copilot Settings descriptions and title-bar sign-in (#99)

**BYOK (5)**
- e90557a5504 2026-07-01 feat(chat): first-run BYOK nudge in the empty-chat welcome + actionable no-model error (#39)
- dababb75e64 2026-08-09 fix(patentai): a rejected BYOK key says so, instead of "User not found." (#210)
- 383784b3999 2026-08-21 feat(byok): per-model token totals on completed responses (#274 follow-up)
- 81e6bf0321a 2026-06-29 fix(enablement): keep the patent chat extension always enabled in BYOK builds
- 174e6c71524 2026-09-03 fix(chat): name the way out when no AI model is connected (#306)

**Patent mode and menubar gates (5)**
- f258aa3d2d2 2026-06-27 #20 patent: Patent IDE mode context key + prompt templates (dedicated area)
- 47d4f619ec1 2026-07-06 feat(menubar): hide Selection/Go/Terminal menus in patent mode (#82)
- 34e7571f418 2026-07-06 feat(menubar): prune dev entries from View/Help menus in patent mode (#83)
- 1852ce01d01 2026-07-11 fix(chat): patent-voice display name and icon for the Patent Research agent mode (#135)
- dd8ebe3e841 2026-06-26 L1: Prune programming-language extensions to old-fork keep-set (#3)

**Rebrand strings and survey off (7)**
- 99720b8e769 2026-07-06 chore(sessions): rebrand surviving Copilot strings to FlowLeap voice (#76)
- 6fa2c27dbee 2026-07-06 chore(sessions): patent-voice for welcome dialog, growth session, and Claude setting (#76 follow-up)
- 50efab55511 2026-07-10 refactor(chat): de-Copilot runtime UI strings, disable survey service (#100)
- 95176f3f8f6 2026-07-11 feat(chat): patent-voice per-mode input placeholders; hide Problems counter and lone environment chip (#117)
- b4f7c37a75a 2026-07-06 chore(branding): FlowLeap letterpress watermark, Chat Debug icon, robot Open-in-Agents button
- 59915b316fa 2026-07-06 chore(chat): custom-agents icon uses the robot codicon, not the VS Code agent mark
- 5c0012e9962 2026-07-12 test: update 36 stale expectations after rebrand and enablement changes

**MCP and marketplace (8)**
- 1a78cff4600 2026-07-11 feat(mcp): activate MCP gallery against FlowLeap registry + branding sweep (#113)
- b739038a3ac 2026-07-11 feat(marketplace): FlowLeap plugins as default marketplace, pre-trusted + Browse Skill Packs CTA (#114)
- ea8b26da9fd 2026-07-12 fix(aiCustomization): browse gallery + long lists clip last item (#144)
- 2a0e34af2c1 2026-07-12 fix(sessions): load mcp.json inputs so MCP server start resolves ${input:} + inline start/stop (#146)
- 6eef477e03e 2026-07-12 fix(sessions): surface MCP server tools in Tools section + reconcile tool count (#147)
- 372009241b3 2026-07-12 fix(sessions): MCP context menu honors action state so Start/Stop stop no-opping (#146)
- 3e5305ded55 2026-07-23 chore: point drift guard, CI, and default plugin marketplace at the flowleap-ai org
- 1d4f0fc5aca 2026-08-21 test(marketplace): update expectations for flowleap-ai org (#269)

**Agent host and tunnel removal (7)**
- e6865267bab 2026-07-05 feat(chat): remove tunnel host service (workbench half) (#60)
- 7a1eb81fca6 2026-07-05 chore(workbench): delete agent-host workbench UI (#72)
- 23895f04f35 2026-07-05 chore(code): remove agent-host process wiring (#73)
- 4a69caa535c 2026-07-05 chore(platform): delete the agentHost tree (#74)
- 24acf1a7d3c 2026-07-05 chore(sessions): delete the sessions GitHub layer (#75) — part 1
- 2380c4e3527 2026-07-05 chore(sessions): delete the code-review service + excise the agentFeedback PR pipeline (#75) — part 2
- 22a47d4792e 2026-07-06 chore: delete deferred dormant agent-host clusters (#77)

**Theme and developer-surface defaults (3)**
- a97e3817858 2026-07-04 feat(theme): default to Light 2026 on desktop; native chrome follows theme
- eb7c832c4be 2026-07-04 feat(product): hide developer surfaces by default for new users
- 6b1d2f2f0bb 2026-07-11 feat(workbench): Command Palette icon in the activity bar's bottom action zone (#143)

**Prompt and project notes (3)**
- 9dc98a53ed7 2026-09-02 feat(prompt): project notes.md as memory, never evidence; CLAUDE.md instructions off by default
- 4ce788cbc60 2026-09-13 fix: provenance appendix on every content template; explicit output paths in seed prompts; personal Claude skills off by default (#342)
- 1a87cde19ba 2026-07-23 Close the Claude-harness vs Patent AI trajectory gap (map 0002): 2/8 → 7/8 win-or-tie (#160)

**Chat UI fixes and core seams (8)**
- 66f6d0fdad2 2026-09-20 feat(chat-ui): patent-search subagent renders as a nested header on the extension-host path (#413) (#436)
- dba5adc26a4 2026-09-20 feat(chat-ui): subagent header shows the type on the extension-host path (#413) (#428)
- 0fac3c980d8 2026-09-12 fix(projects): keep the inline tree find above the list and let it match the row description (#330)
- b77076f8a90 2026-08-18 feat(chat): add "Files from Disk..." item to the Add Context picker
- f6f334edec4 2026-08-06 fix(chat): blank chat output webviews after streaming re-render reuse
- a18f4ae30cc 2026-07-06 fix(chat): resolve provider agents with unbacked URIs without a file read (#78)
- e80d597da2b 2026-09-20 core: agentEditorComments null seam + CustomEditorPriority.explicit (#440) (#445)
- a26d3dae2ed 2026-09-20 ext: wholesale replace markdown-language-features with upstream 1.139 (#442) (#446)

### Extension host API errors and `src/vscode-dts`
`src/vscode-dts` against upstream: 167 identical, 9 stale, 2 fork-touched, 0 fork-only, 4 upstream-only.
- Fork-touched: `vscode.proposed.chatParticipantAdditions.d.ts` (#413 subagent header, `ChatSubagentToolInvocationData`), `vscode.proposed.chatProvider.d.ts` (#274 BYOK per-model token totals, `ChatResultModelTotal`).
- Stale: `vscode.d.ts`, `README.md`, proposals authIssuers, chatContextProvider, chatInputNotification, chatParticipantPrivate, chatSessionCustomizationProvider, chatSessionsProvider, scmProviderOptions.
- Upstream-only: proposals agentsWindowActivation, authSessionAccountIcon, authSessionExpiration, terminalRemoteResolver.

`extensions/copilot` reads these files directly (`src/extension/vscode-api.d.ts` references `src/vscode-dts/*`). Test: script `04-exp-sync-vscode-dts.sh` replaced `src/vscode-dts` with upstream (branch `spike/0017-exp-portonly`, commit "spike exp: 04"). Then `npx tsgo --noEmit` on the extension's typecheck projects. Nothing was fixed.
| Project | Baseline | With upstream vscode-dts |
|---|---|---|
| tsconfig.json | 0 | 209 |
| test/simulation/workbench/tsconfig.json | 0 | 0 |
| tsconfig.worker.json | 0 | 23 |
| Total | 0 | 232 |
Causes: 164 errors are one new required member, `ChatResponseStream.voiceProgress`, missing on the extension's stream classes and test mocks (MockChatResponseStream, ChatResponseStreamImpl, SpyChatResponseStream, ...). The rest are the two lost fork proposals (`ChatResultModelTotal`, `ChatSubagentToolInvocationData`) and `ChatSessionCustomizationSourceFolder` shape changes. So a vscode-dts sync needs an extension change, plus re-applying the two fork proposal edits (#274, #413) on top of upstream dts.
