# Upstream survey 1.140.0 → 1.146.0 and sync plan

**Date:** 2026-11-13
**Fork base of the last sync:** upstream `480c6e142fa` (1.140.0), merged as PR #464 on 2026-09-29 (merge `45a4c6d6ddc`).
**Upstream reference:** `/Users/abdullahatrash/flowleap/refrence/vscode`, fetched 2026-11-13. `origin/main` = `eb6e51e7e31` (1.147.0-dev). Latest release tag = `1.146.0` = `69047191fc4` (2026-11-10, release branch, not on main).
**Sync target:** tag `1.146.0`. A release tag, not main: 863 commits sit between 1.146.0 and main and change daily.
**Replay kit of the last sync:** `build/upstream-sync/1.140/` (README has the run order).
**Area surveys (same date):** `2026-11-13-upstream-survey-1.140-to-1.146-agenthost-sessions.md`, `2026-11-13-upstream-survey-1.140-to-1.146-chat-byok-build.md`.
**Follows:** PRD 0017 (`docs/prd/0017-agents-window-wholesale-sync.md`). The recipe is the same: copy `src/vs` + `src/vscode-dts` wholesale, keep out what the product does not ship, re-apply fork intents as patches against upstream's code.

## 0. Verdict

The sync is a **copy job plus three structural moves**, not a merge. Nothing in the delta touches the Patent AI agent's own code: `extensions/copilot` is not synced, the 145 fork-created core files (skills, patent tool sets, remote access, hosted workspace) carry over as files, and the two Claude seams the fork patches most (`claudeSdkOptions.ts`, `claudeInteractiveTools.ts`) have zero upstream commits in the window. The cost sits in three places upstream rewrote: the Agents Window moved into `workbench/contrib/sessions`, the build moved to pnpm 12, and the model picker + chat setup were rewritten. 13 of the 55 replay patches apply as is; 42 need rework, most of them one-line re-anchors.

Estimate: one PR for build/ (pnpm, Electron 43.8.6, deps), one PR for the `src/vs` sync (same shape as #464), one release with new Claude SDK tarballs. Two to three working days of agent time plus the founder's eyeball run and a six-platform dry run.

## 1. Size of the delta

| Measure | Value |
|---|---|
| Upstream commits 1.140.0 → 1.146.0 | 4,438 |
| Files changed under `src/vs` | 7,065 (2,260 added, 186 deleted, 4,326 modified, ~290 renamed) |
| Of which `platform/agentHost` | 2,482 files, 1,242 commits |
| Of which `src/vs/sessions` | 1,110 files, 1,572 commits |
| Of which `workbench/contrib/chat` | 1,118 files, 1,311 commits |
| `extensions/` files changed | 1,704 |
| `build/` files changed | 291 |
| Fork commits since the last sync | 597 |
| Fork files touched in `src/vs` since the last sync | 2,358 (2,185 of them the agent host copy-in, PRD 0018) |

## 2. Divergence (fork HEAD vs upstream 1.146.0 vs base 1.140.0)

Measured with `build/upstream-sync/1.140/tools/div.mjs`. "stale" = fork file equals the 1.140.0 blob (safe to overwrite). "touched" = fork and upstream both changed the file since 1.140.0 (re-apply surface). "fork-only" splits into files the fork created (keep) and files upstream deleted since 1.140.0 (the copy drops them).

| Area | identical | stale | touched | fork-only | upstream-only |
|---|---|---|---|---|---|
| all of `src/vs` + `src/vscode-dts` | 6,723 | 4,160 | **245** | 626 (145 created, 481 upstream-deleted) | 2,561 |
| `platform/agentHost` | 828 | 1,623 | 34 | 26 | 820 |
| `workbench/contrib` | 2,311 | 1,179 | 126 (99 in `chat`) | 43 | 1,016 |
| `src/vs/sessions` | 125 | 399 | 33 | 516 | 266 |
| `workbench/browser` | 99 | 59 | 15 | 0 | 40 |
| `workbench/services` | 528 | 158 | 10 | 7 | 77 |

Other trees:

| Tree | Divergence | Sync stance |
|---|---|---|
| `extensions/copilot` | 2,257 identical, 161 stale, 571 touched, 1,405 fork-only, 419 upstream-only | **Not synced.** The Patent AI editor chat, BYOK providers and patent tools live here. Only the edits new API proposals force (step 40). Ideas to adopt by hand are listed in the chat survey §A.2 (new `languageModelRateLimit` / `languageModelCapabilities` proposals). |
| other built-in `extensions/*` | mostly identical or stale; small touched counts (git 10, typescript-language-features 20, github-authentication 9) | Still the deferred #466. Not in this sync, except `extensions/media-preview` (§3.4). |
| `build/` | 183 identical, 36 stale-1140, 100 stale-1127, 23 touched, 155 fork-only, 201 upstream-only | Never synced wholesale. This time it cannot be skipped: upstream moved to pnpm (§3.2). |

### 2.1 The 245 touched files (re-apply surface)

| Directory | Files | What the fork changed there |
|---|---|---|
| `workbench/contrib/chat` | 99 | BYOK nudge/rejected key/no-model way out, model picker Sonnet default, `.flowleap/` prompt roots (#577), patent tool sets (#774, #814, #826), chat setup never routes to Copilot, hosted secrets, rebrand strings |
| `platform/agentHost/{node,common,electron-browser,browser}` | 23 | Claude-only gates (#487), metadata-only AHP logs (#488), patent strings on the Claude path, chat mirror/remote access seams (PRD 0018 C1/C3), keychain login fix |
| `platform/agentHost/test` | 11 | tests for the above |
| `workbench/browser/parts` | 11 | patent menubar/activity bar gates, account menu, letterpress |
| `workbench/contrib/debug` | 7 | developer-surface hiding (B8b) |
| `sessions/*` | 33 | A-list patches (session type picker, permission mode picker, brand mark, patent voice, workflow starters, CLI nudge, remote access) |
| `workbench/contrib/welcome*` | 7 | onboarding wizard, walkthrough |
| rest | ~50 | one or two files each: mcp, themes, extensionManagement, inlineChat, secrets/storage (hosted), api/common |

### 2.2 Fork-created files to carry over as-is (145)

- `platform/agentHost/{browser,common,node,test}`: remote access (relay transport, crypto, viewer), chat mirror, `sessionLogContent.ts`, `flowleapChatMirrorAgent.ts` (15 files)
- `workbench/contrib/chat`: `agentHostChatMirrorSource.ts`, `agentHostCustomizationToolSets.ts`, `remoteAccess/*`, `patentChatToolReferenceNames.ts`, `patentInputPlaceholder.ts` + tests (12)
- `workbench/contrib/patent`, `workbench/common/patent` (6), `workbench/services/{secrets,storage}/browser/hosted*` (5)
- `sessions/contrib/{remoteAccess,flowleapCli,providers,chat}` (25), `sessions/skills/**` (66 bundled patent skills), `sessions/sessions.viewer.main.ts`
- `platform/{flowleapCli,agentFinder,copilotConnectors,customizationMarketplace,sandbox}` (fork-only leftovers, see 2.3)
- `base/common/qrCode.ts`, `vscode.proposed.{agentsWindowActivation,timeline}.d.ts`

Their imports point at `vs/sessions/...` paths that moved (§3.1). Step 10 must rewrite those imports (a sed map from the rename list) before the type check.

### 2.3 Files upstream deleted since 1.140.0 that the fork still has (481)

The copy drops them. 420 are under `src/vs/sessions` and are upstream's own files that MOVED (§3.1), not fork intent. To check by hand: `platform/agentHost/node/automationCron.ts`, `agentHostOctoKitService.ts`, `platform/github/common/{githubBackoff,githubRequestQueue,githubScheduler}.ts`, `platform/copilotConnectors/*`, `platform/agentFinder/*`, `workbench/contrib/welcomeAgentSessions/*` (whole contrib removed upstream), `chat/browser/widget/input/modelPicker/modelPickerItem{Sections,Types}.ts` (old picker deleted by `09ab182715d`), `chat/browser/aiCustomization/customizationMarketplaceSkillInstaller.ts` (fork #150 refresh-aware installs touched it; upstream subsumed by `agentHost/copilotCliBuiltinToolSet.ts#getCustomizationToolSets`, `d7d2fd6929d`), `workbench/services/agentHost/common/editorRemoteAgentHostTransport.ts`, `welcomeOnboarding/test/common/onboardingTypes.test.ts` (keep: fork-only test, `e9cfa3dce9a`).

## 3. The structural shifts upstream

### 3.1 The Agents Window moved into `workbench/contrib/sessions`

Commits `dfe0bb738db` (2026-11-06, "move the reusable Sessions code to vs/workbench/contrib/sessions, no behavior change", 446 renames) and `951e5eb2121` (Changes editor → `workbench/contrib/sessionChanges`, model → `workbench/services/sessions`, part frame → `workbench/browser/parts/sessions`, GitHub client → `workbench/services/github`). `src/vs/sessions` went from 987 to 836 files and is now the window shell only (entry points, layout, setup, account, window-only contribs). The Agents Window is still a separate window (`sessions.desktop.main.ts`, opened by `windowsMainService.openAgentsWindow`). Shared code registers nothing at module level; `vs/sessions` registers it and is never imported back.

| From | To |
|---|---|
| `sessions/contrib/providers` (67), `sessions/contrib/chat` (45), `sessions/browser/parts` (23), `sessions/contrib/sessions` (17), `sessions/services/sessions` (14), `sessions/contrib/github` (12), small ones | `workbench/contrib/sessions` |
| `sessions/contrib/changes` (24) | `workbench/contrib/sessionChanges` |
| `sessions/common/layoutConstants.ts` | `workbench/contrib/chatWindow` |

New upstream dirs under `sessions/contrib`: `canvases, chatEditor, chatWindow, getStarted, inboxOne, modernUI, sessionComparison, worktreeSuggestion`. Removed: `blockedSessions`, `workbench/contrib/welcomeAgentSessions`. `d1755aab64f` deletes `newChatInput.ts` (unified composer): the fork's A6 placeholders and A9 workflow templates lose their host file.

### 3.2 pnpm 12 replaces npm

Commit `ae153038247` (2026-11-02). At 1.146.0: `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `.pnpmfile.mjs`, `"packageManager": "pnpm@12.16.0"`, no `package-lock.json`, no `.npmrc`. `build/npm/preinstall.ts` hard-fails under npm (`checkPackageManager`); `postinstall.ts` spawns pnpm per separate root; `build/npm/dirs.ts` is workspace members + separate roots; `build/npm/gyp` deleted; `gulpfile.vscode.ts` reads the lock through `build/lib/pnpmLock.ts`; CI rewritten on `setup-pnpm`. Electron pin moved from `.npmrc` to `package.json` `nativeBuild` (`cce800b9d37`) read by `build/lib/electronVersion.ts`. `a8cd7f0c314` removed the install-state fast path.

Staying on npm is possible but means forking `build/npm/*`, `build/lib/pnpm*.ts`, both gulpfiles and the Linux package templates on every sync (chat survey §C.2). The fork's CI (`flowleap-ci.yml`, `flowleap-release.yml`), the kit's step 11, the worktree recipe and `docs/dev/LOCAL-DEV.md` all assume `npm ci`. Decision D2.

### 3.3 Electron 43.8.6, Node 24.22.1, new SDK pins

| Pin | Fork | Upstream 1.146.0 |
|---|---|---|
| Electron | 42.8.1 (`.npmrc`) | 43.8.6 (`d6e20fdc019` → `98e4ad8fbc8`; `package.json` `nativeBuild`) |
| Node (`.nvmrc`) | 24.15.0 | 24.22.1 |
| `@anthropic-ai/claude-agent-sdk` | 0.3.281 | 0.3.304 (`3fa345dbdaf`, adds `thinking.display` beta) |
| `@github/copilot-sdk` | 1.0.15-preview.4 | 1.0.30-preview.0 (kept out at runtime, still a dependency) |
| `@openai/codex` | 0.142.0 | 0.163.0 (skip the tarball) |
| `@microsoft/mxc-sdk` | 0.8.0 | removed (`c7282ad3829`); drop |
| `@github/copilot` | ^1.0.65 | removed; drop |
| `foundry-local-sdk` | 1.2.3 | 2.2.1 (fork `.moduleignore` keeps excluding it, #497) |
| `@vscode/diff` | 0.0.2-7 | 0.0.2-128 |
| xterm family | beta.285 | beta.301–304 |
| new runtime deps | — | `@hpke/core`, `libsodium-wrappers` (agent host credential sealing `47da279f730`) |
| new dev deps | — | `@typescript/native` 7.0.2 (replaces native-preview), eslint 10.8 + `@eslint/compat` + `@stylistic/eslint-plugin` 5, typescript-eslint 8.66, `@modelcontextprotocol/sdk` 1.29 |

The Electron bump needs a new `build/checksums/electron.txt` and a six-platform dry run. The Claude SDK bump needs new tarballs `claude-agent-sdk-0.3.304-<target>.tgz` published with the release and `product.agentSdks.claude` re-stamped (#490 recipe; `build/agent-sdk/produce.ts` is unchanged upstream, the fork's `produce-claude-sdk` keeps working). Take `e2204524d8a` (SDK cache GC) or every user keeps the old 200–400 MB SDK on disk.

### 3.4 `media-preview` moved into core

`e7d9908a81d` moved image/audio/video preview into `workbench/contrib/mediaPreview` and deleted `extensions/media-preview`. The fork still ships the extension (32 fork-only files). After the copy, delete the extension and its entries in `build/npm/dirs.ts:37` and `build/gulpfile.extensions.ts:72`, or previews register twice.

## 4. Security fixes to take regardless (all inside the synced `src/vs`)

- `0695d911316` (2026-10-13) "MSRC fixes": `resources.ts` backslash parent check, webview `resourceLoading.ts` remote-OS roots + `webviewElement.ts` (browser and electron), terminal instance trust check on both process paths, terminal sandbox, chat settings sensitive edit locations for hook/agent dirs, MCP sandbox schema, snippets resource, workspace trust. Verify the hosted web client (#520) and the `webview/browser/pre/` CDN pin still pass the resource-loading tests.
- `ccbfadeb451` no credential forwarding across redirect origins (node request service; the BYOK path uses it).
- `3ac04f49fd8` model identifier sanitizing in telemetry.
- Webview: `9ea28e299ee`, `8460a1ecda7`, `144aaa7de45`, `9d530daf090`. Markdown: `0aba719df98` (nonce, KaTeX escape). `04861ffbe8d` untrusted-workspace command links. `fab0e01e6b7` notification text hardening (+ eslint rule). `462715e3581` managed MCP allowlists. `1356222d342` marketplace protocol links confirm.
- Agent host: `47da279f730` / `d18caf8cae1` credential sealing; `ae873278f7e` scoped permission rules (`permissions.ask`, Claude Code rule syntax, new `common/permissionRules.ts`).
- Extension-side ideas only (the fork's `extensions/copilot`): `4aaffdd2a66` edit-confirm for agent/skill locations, `17d89f42801` memory tool confirm.

## 5. Replay-kit dry run (measured)

Every 1.140 patch was run with `git apply --check` against a clean 1.146.0 `src/` tree. Later patches that depend on earlier ones were checked in isolation, so a few FAILs are order effects; the count is an upper bound.

**Apply as is (13):** 30-04 A1 no-GitHub-gate welcome, 30-06 A5 brand mark, 31-15 B8a light theme, 31-16 B8b hide developer surfaces, 31-17 B8c command palette icon, 31-18 B1b CLI main service, 31-20 B3b BYOK rejected key, 31-21 B3c per-model token totals, 31-24 B9a claude.md off, 31-28 B10b tree find, 31-30 B10d chat output height, 31-33 B4b menubar gates, 31-39 B5d robot icon.

**Need rework (42):**

| Patch | Why it fails | Rework |
|---|---|---|
| 20-keep-out (8 files) | registration seams moved with §3.1; new things to keep out (§6) | re-derive |
| 30-01 A2, 30-02 A12 | session-type gate is now `agentHostSessionType.ts` + `sessionTypeAvailability.ts`; upstream ships its own permission-mode picker in `workbench/contrib/sessions/providers/agentHost` | A12 likely subsumed; A2 re-derive on the new gate + `chat.defaultToCopilotHarness=false` (`186e3338383`) |
| 30-03 A11, 30-05 A3, 30-09 A10, 30-10 A13, 30-12 A17 | files moved to `workbench/contrib/sessions`; seams exist at the same lines | re-anchor paths |
| 30-07 A6 patent voice | `newChatInput.ts` deleted; placeholders now in the unified composer; `1044782bfd8` dropped 3 settings A6 touched | re-derive |
| 30-08 A9 workflow starters | host moved to `workbench/contrib/sessions/browser/chat`; fork-only templates need a LAYERS-allowed home | re-derive |
| 30-11 A15 | subsumed upstream | drop |
| 31-13 B2, 31-14 B1, 31-19 B3a, 31-22 B3d, 31-25 B9b, 31-26 B9c, 31-27 B10a, 31-29 B10c, 31-31 B10e, 31-32 B4a (20/22 lines), 31-34 B4c, 31-37 B5b, 31-40/45 B6a, 31-41 B6b | context drift only; the seam lines exist in the 1.146.0 file (chat survey §B) | re-anchor, mostly one hunk each |
| 31-23 B3e no-model way out | old model picker deleted (`09ab182715d`); tabbed picker only | re-derive on `modelPickerWidget.ts:904-962`, `modelPickerPresentation.ts:165` |
| 31-35 B4d custom agent icon | per-harness attribute tables (`395e625a57d`, `5b7277ed430`) | re-derive |
| 31-36 + 31-46 B5a, 37-d7 rebrand strings | string sweeps; ~70 % re-anchor | redo as a grep sweep against 1.146.0, not a patch |
| 31-38 B5c letterpress | watermark redesign | re-derive |
| 31-42 B6c, 31-43 B6d, 31-44 B6e | B6e subsumed by `getCustomizationToolSets` (`d7d2fd6929d`); B6c/B6d probably subsumed | verify, then drop |
| 32-integration, 33-test-rederive | derived files | re-derive at the end |
| 34-keep-out-agent-host-client | **obsolete**: the fork ships the agent host since PRD 0018 | replace by the #487 gates (Copilot/Codex off) |
| 35-local-harness-no-di-cycle, 36-kept-out-contrib-services | paths moved; 36 must re-check against `workbench/services/github` + `sessions/contrib/github` | re-anchor |
| 40-ext-dts | one dts changed; the extension compile decides | re-derive |
| 42-build-mainimpl-entry | `src/mainImpl.ts` changed (regional locale, feature flags) | re-anchor with the build/ sync |

Step 10 also changes: it must NOT drop `platform/agentHost/{node,electron-main}` any more (the fork ships them since #486), the `agentSessionState` rewrite is dead, and it needs the import-rewrite map for §2.2.

## 6. New fork intents since the last kit (need their own scripts)

Fork commits since `45a4c6d6ddc` that carry intent in `src/vs` (the agent host copy-in itself is subsumed by the upstream copy):

| Group | PRs / commits | Where | Seam state at 1.146.0 |
|---|---|---|---|
| PRD 0018 A: agent host is the only Claude | #486 #487 #488 #491 #492 | `platform/agentHost/node/{agentHostMain,agentService,claude/*}`, `chat/browser/agentSessions/agentHost/*`, main.ts wiring | `claudeSdkOptions.ts`, `claudeInteractiveTools.ts`: 0 upstream commits, apply clean. `claudeMapSessionEvents.ts`: new `clientTools` arg + terminal output cache. `claudeToolDisplay.ts` rewritten (`ae873278f7e`). `node/agentService.ts`: 186 commits, +11k lines → re-derive by hand. `ac6c51db549` removed `allowSignedOutWhenUsable` → the transport-mode patch gets simpler. |
| PRD 0018 C: Remote Access | #481 #482 #719 #720 + fork-only files | `platform/agentHost/*/remoteAccess*`, `chat/*/remoteAccess/*`, `sessions/contrib/remoteAccess`, `sessions.viewer.main.ts` | fork-only; `2b6ab699bce` windowed AHP channel delivery touches the transport the relay wraps → re-test |
| Hosted workspace / web client | #520 #547 #548 #549 | `services/{secrets,storage}/browser/hosted*`, `contrib/patent/browser/patentHostedSession.web.contribution.ts`, `code/browser/workbench` | fork-only + 2 touched files |
| Patent tool sets + prompt | #774 #814 #826 `b2d60c8408a` `d3213dfd879` | `agentHostCustomizationToolSets.ts`, `patentChatToolReferenceNames.ts`, `patent-ai.agent.md` | fork-only; `83acb7dc514` late-registering tool sets changes the registration timing → re-test |
| `.flowleap/` prompt roots | #577 | `promptSyntax/{config/promptFileLocations,utils/promptFilesLocator,service/*}` | `VALID_PROMPT_FOLDER_PATTERN` now re-exported from `platform/chat/common/chatSettings.ts`; add `.flowleap` to the sensitive edit locations list (MSRC fix) |
| Native Mistral provider | `778a70b1612` | `languageModels.ts`, `modelSelection.ts` | re-anchor; adopt `languageModelCapabilities` proposal (`d93a3848b5b`) |
| Auth UI (avatar, accounts by id) | `d48dfc464d4` `79d70f0ab53` | `sessions/contrib/accountMenu`, `workbench/browser/parts` | account files all at the same path |
| Patent IDE mode hides PR/merge/checkout | #471 | `sessions/contrib/*` | moved → re-anchor |
| MCP hosted server listed once | #593 | `workbench/services/mcp` | re-anchor |
| BYOK never routes the picker to Copilot setup | `0f93554f310` | `chatSetup/*`, `modelPicker/*` | picker rewritten → re-derive with B3e |
| Skills re-vendor (CLI v0.10 → v0.12), drawings skills | #509 #833 + chores, #650–#805 | `sessions/skills/**` | fork-only, carried as files |

New keep-outs (registered upstream in `workbench.common.main.ts` or the sessions mains; the fork unregisters, never deletes): `chatInputSpotlightTour` (Copilot harness), `githubService`, `agentHostMcpOAuthMetadataService`, `artifactIntegrations`, `canvases` (Copilot-produced artifacts, gate `chat.canvases.enabled`), `frostedGlass`/`modernUI` (founder eyeball first), Computer Use, MCP-served skills (`b955338b63d`), `multipleChatProviders`, Inbox One (GitHub feed), Mission Control. Set `chat.defaultToCopilotHarness=false` in code registration (product.json defaults are inert on desktop).

## 7. What is worth having (beyond the mechanical copy)

Agent host, must-have: SDK 0.3.304 + cache GC (`3fa345dbdaf`, `e2204524d8a`); Claude cancellation/rebuild/resume correctness (`599658fecc5`, `5665b3bd253`, `23b07a58e88`); scoped permission rules (`ae873278f7e`); agent-host.db authoritative + opaque chat URIs + per-chat config (`83caa64d5c0`, `e941aa12741`, `3f894d96b3d`, `50559e744a1`); steering lists (`0b4e0632b1f`); windowed AHP delivery (`2b6ab699bce`); multi-root always on (`1044782bfd8`). AHP `.ahp-version` bumped 13 times: the Remote Access Viewer (web build) and Host must ship from the same commit.

Agents Window, user-visible and GitHub-free: chat windows (`c8110cefee9`), session comparison (`dd3b04daa8a`), Get Started checklist (`0301f5005ec`, needs patent voice), worktree suggestion (`b6bfa95ebee`), chat editor/session hosts (`a6172668be7`), unified composer (`d1755aab64f`), modernUI (`e8a1531a9c8`, eyeball).

Chat/BYOK, must-have: reasoning preserved across turns for custom providers (`c1ce6113b81`); fail on unavailable model (`0af48c2b0ba`); duplicate provider groups (`f4a2106dc92`); LM provider leaks (`5042306fad0`, `8854342c970`); late-registering tool sets (`83acb7dc514`); utility-model rate limiting + the two new proposals (`d93a3848b5b`); provider icons in the picker (`9ac22ae3616`); the 1.146 release port (`69047191fc4`, UNC allowlist, extHostMcp). Nice: picker overflow with many providers (`bd2ba5565df`), inline attachment pills (`7394117d44c`), customizations by scope (`88f9a3afea7`), worktree-parent customizations (`f2460c8a584`), MCP config edit form (`980571ce84e`), registry slash-URL fix (`1f871d21f97`, check the FlowLeap registry URL).

Irrelevant (keep out, do not port): Copilot Fusion/Hydra/Auto tiers, Entra/enterprise sign-in, Codex usage, Copilot Connectors, GitHub Feed, Mission Control, Copilot CLI shim, `build/win32/copilot.iss`.

## 8. How to bring it in without touching the Patent AI agent

The Patent AI agent = (a) `extensions/copilot` (editor chat, BYOK providers, patent tools, prompt), (b) the Claude path of the agent host with the fork's tool sets and skills, (c) the bundled skills under `sessions/skills`, (d) the backend client seam. The sync protects each by construction:

1. **(a) is never copied.** Step 40 applies only the edits the new `vscode.proposed.*.d.ts` force. The extension's own typecheck + vitest + promptfoo/trajectory gates run unchanged.
2. **(b) is patches on files upstream barely touched.** `claudeSdkOptions.ts` and `claudeInteractiveTools.ts` have no upstream commits. The fork-only `flowleapChatMirrorAgent.ts`, `agentHostCustomizationToolSets.ts`, `sessionLogContent.ts` are files, carried by step 10. The only hand work is `agentService.ts` (upstream +11k lines) and `claudeMapSessionEvents.ts` (new argument).
3. **(c) is fork-only.** 66 skill files carried as files; the agent host syncs built-in skills itself (unchanged seam, verified in PRD 0018).
4. **(d) lives in the extension and `platform/flowleapCli`** (fork-only).
5. **Acceptance is the same as #464:** typecheck 0, layers, full unit suite, then the founder's eyeball run through `.agents/skills/verify-flowleap-ide` (Settings sidebar, Prompts view, home, Patent Agent chat BYOK turn, Agents Window Claude session with a patent tool call and a bundled skill), plus one Remote Access pairing (Host + Viewer from the same commit).

## 9. Decisions for the founder

| # | Decision | Recommendation |
|---|---|---|
| D1 | Target | tag `1.146.0`, not main |
| D2 | Package manager | **Move to pnpm 12 with upstream**, as its own PR before the src sync. Staying on npm forks `build/npm/*`, both gulpfiles and the Linux templates on every future sync. Cost once: `flowleap-ci.yml`, `flowleap-release.yml` (`setup-pnpm`, cache keys), kit step 11, `docs/dev/LOCAL-DEV.md`, the worktree recipe (pnpm store makes the node_modules copy cheaper). |
| D3 | Order | PR A `build/` + deps + Electron 43.8.6 + Node 24.22.1 on the current `src/` (six-platform dry run) → PR B `src/vs` wholesale sync (same shape as #464, new kit `build/upstream-sync/1.146/`) → release v0.10.0 with SDK 0.3.304 tarballs |
| D4 | modernUI / frosted glass | keep out until the founder eyeballs it on the synced branch |
| D5 | New window features | keep chat windows, session comparison, worktree suggestion, Get Started (patent voice); keep out canvases, Inbox One, Computer Use, MCP-served skills |
| D6 | A9 workflow template starters | re-home in the unified composer, or drop if the Get Started checklist covers it |
| D7 | `extensions/media-preview` | delete, use core `mediaPreview` |
| D8 | Cadence | sync per upstream monthly release (one tag behind main). Six releases at once turned 42/55 patches stale; one release at a time keeps the re-anchor set small and the kit alive. |

## 10. Standing recipe for the next syncs

1. `git -C refrence/vscode fetch`; pick the newest release tag.
2. Measure: `div.mjs` on `ls-tree` lists (fork HEAD, upstream tag, last base) → the four numbers in §2.
3. Dry run: extract the tag's `src/` into the scratchpad, `git apply --check` every patch of the last kit → the apply/fail split of §5.
4. `git log --no-merges <last-sync-merge>..HEAD -- src/vs` on the fork, deduped by PR → the new-intent table of §6; one script each.
5. Copy the kit to `build/upstream-sync/<tag>/`, set `UPSTREAM`, `FORK_REF`; run 10–13; fix the failing patches by intent (read `notes/`), save with `lib/save-patch.sh`; typecheck to 0; layers; tests; eyeball run.
6. Also diff `build/.moduleignore*`, `build/linux/*/dep-lists.ts`, `build/gulpfile*.ts`, `build/agent-sdk/*`, `package.json` deps, `.nvmrc`, the Electron pin, and the webview CDN pin in `product.json` (`webviewContentExternalBaseUrlTemplate`).
