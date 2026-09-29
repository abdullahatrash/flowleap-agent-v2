# PRD 0017 v2 spike report — whole-tree sync of src/vs to upstream 1.140 (2026-09-29)

**Verdict: green with decisions pending.** `src/vs` + `src/vscode-dts` copied from upstream 480c6e142fa, fork intents re-applied, 0 type errors in core and in `extensions/copilot`, layers check passes, the scripts replay byte-identically from `main` (one exception: the regenerated font, see step 41). Tests: only environmental failures. Eyeball: 10 pass, 0 fail, 4 not testable, after 3 defects found and fixed during the eyeball run (steps 34, 35, 36, plus the font in 41). 9 items need a founder decision.

Worktree `/Users/abdullahatrash/flowleap/wt-spike-0017`, branch `spike/0017-full-tree` (61 commits on 810ad70ca59, checkpoint per step). Replay proof: worktree `wt-0017-replay`. Baseline for tests: worktree `wt-0017-base` at 810ad70ca59. Main checkout untouched. No PR.

## Scripts (in `scratchpad/prd0017/scripts/`, each takes the worktree path; `run-all.sh <wt>` replays everything)
| Step | Script | What |
|---|---|---|
| 10 | 10-copy-src-vs.sh | upstream `src/vs` + `src/vscode-dts`; restores the 76 fork-CREATED files (`10-fork-only.txt`); does NOT restore 52 files upstream deleted (`10-upstream-deleted.txt`) nor subsumed fork files (`10-subsumed-fork-files.txt`); drops `platform/agentHost/{node,electron-main,test/node}`; deletes `platform/agentSessionState`; rewrites imports incl. `eslint.config.js` |
| 11 | 11-npm-deps.sh | upstream lockfile versions: @vscode/os-proxy-resolver 0.4.0, foundry-local-sdk 1.2.3, @vscode/proxy-agent 0.45.0, tas-client 0.4.6, zod 4.4.3, @vscode/codicons 0.0.46-40, @vscode/component-explorer(-cli) 0.2.1-140/-143. Refuses a symlinked node_modules |
| 12 | 12-copy-src-root.sh | top-level `src/*` (bootstrap-*, main, new mainImpl, cli, server-*, tsconfig.base) to upstream; fork never touched them |
| 13 | 13-copy-test-harness.sh | `test/unit/**` to upstream; fork never touched it |
| 20 | 20-keep-out.sh | 59 registration imports removed from `sessions.{common,desktop,web}.main.ts`, `workbench.{common,desktop}.main.ts` (log `v2/20-keep-out.log`); agent host process wiring removed from `app.ts`, `sharedProcessMain.ts`, `serverServices.ts` (#73 intent: no agent host is started; server keeps only the bridge to an externally managed host); SSH/WSL null services on desktop |
| 30 | 30-reapply-01..12-A*.sh | list A (12 scripts) |
| 31 | 31-reapply-13..46-B*.sh | list B (34 scripts) |
| 32 | 32-integration.sh | merge fixes: duplicate import, sessions harness forwards IFileService (B10e), modelPickerTryout kept out of sessions too, eslint allowlist for the Claude provider dir |
| 33 | 33-test-rederive.sh | test expectations re-derived for FlowLeap product.json / rebrand / #147 count (5c0012e9962 rule) |
| 34 | 34-keep-out-agent-host-client.sh | desktop `IAgentHostService` = `EditorRemoteAgentHostServiceClient` (inert without a remote, as at 810ad70ca59). Fold into 20 for the deliverable |
| 35 | 35-local-harness-no-di-cycle.sh | Local harness registered by the Local provider contribution, not the harness service (broke a DI cycle) |
| 36 | 36-kept-out-contrib-services.sh | new fork file `contrib/keptOutServices/browser/keptOutServices.contribution.ts`: registers only the services of the kept-out github/codeReview/automations contribs |
| 40 | 40-ext-dts.sh | `agentDisplayName` + `ChatResultModelTotal`/`modelTotals` re-added to upstream `vscode.proposed.chatParticipantAdditions.d.ts`; 4 forced extension edits |
| 41 | 41-brand-codicon-font.sh | regenerates `build/flowleap/codicon.ttf` for codicons 0.0.46-40 (adds upstream's `copilot-dot`, `copilot-dot-compact` to the patch script). Needs fontforge; output is not bit-reproducible, so the deliverable should take the spike's committed font |
Re-apply scripts apply a patch (`patches/*.patch`) written against upstream code after step 10; `lib/apply-patch.sh` is idempotent.

## Type-check counts
| After | core `tsgo -p src/tsconfig.json` | extension (4 projects) |
|---|---|---|
| baseline main | 0 | 0 |
| 10 (first cut, all fork-only files restored) | 105 | — |
| 11 | 77 → 66 | — |
| 10 (fork-created only) | 9 | — |
| 20 | 6 → 2 | — |
| 40 | 1 | 232 → 0 |
| re-apply agents merged (46 commits) | 2 | 0 |
| 32 … 36, 12, 13, 41 | **0** | **0** |
`npm run valid-layers-check` (needs `NODE_OPTIONS=--max-old-space-size=12288` here): pass.
ESLint on every file the fork changes on top of upstream (212 files): 0 errors, 1 warning. ESLint on all of `src/vs`: 23 errors / 90 warnings, all lint-config drift (fork's `eslint.config.js` + eslint 9 vs upstream's eslint 10 config: 17 × `code-no-bracket-notation-for-identifiers` is warn upstream, error in the fork, all in upstream test files) plus 6 header errors in vendored skills `.mjs` (present on main too).

## Tests
| Suite | Spike | Baseline main | Notes |
|---|---|---|---|
| core `scripts/test.sh` (electron) | 36,981 pass / 2 fail (final run, branch head) | 22,156 pass / 0 fail | both failures = machine locale en_FR ("9:00" not "9:00 AM", "31 May" not "May 31"): `AutomationsCardsWidget accessible view…`, `ChatStatusDashboard Enterprise Managed … (compact)`. Environmental |
| node unit (mocha, Node 24) | 12,020 pass / 0 fail | 9,318 pass / 0 fail | |
| extensions/copilot vitest | 9,182 pass / 2 fail | 8,874 pass / 310 fail | spike fails only `createWebSocket.spec.ts` (fails in the main checkout too, per worktree memory). Baseline's 310 are the symlinked-node_modules WASM failures; the spike worktree has a real node_modules clone |
Fixed on the way (not counted): 20 core failures after the copy → 2. Causes: unsynced `src/*` root (bootstrap ESM tests → step 12), unsynced `test/unit` harness (ProtocolMainService → step 13), expectations tied to product.json/rebrand/#147 count (step 33).

Final core run on the branch head (after steps 34–36, 12, 13, 41): **36,981 pass / 2 fail / 425 pending**, the same two en_FR locale failures. Nothing else fails.

## Eyeball (TMPDIR=/tmp, fresh throwaway profile, `launch` skill; screenshots `v2/eyeball/shots/`)
| Item | Result |
|---|---|
| Onboarding wizard on a fresh profile (role → sign-in → model → finale "Copy prompt") | pass |
| FlowLeap welcome (wizard sign-in step, patent start page "Search Prior Art…") | pass |
| Sign-in CTA ("Continue with FlowLeap", FlowLeap Settings "Sign In") | pass (completing sign-in not testable: flowleap:// cannot reach a throwaway profile) |
| Editor Patent Agent chat, first-run BYOK nudge | pass (after step 34; before it the chat view was blank) |
| BYOK turn in the editor | not testable (fresh profile has no key; did not copy the real profile) |
| Agents Window, Claude-only picker | pass (Claude + Local only) |
| Local session starts | pass (session created; turn says "Language model unavailable", no key) |
| Skills listed | pass (45 built-in incl. vendored `flowleap*`, "Browse Skill Packs" CTA) |
| Claude session starts and streams | pass (extension-host Claude, answered "OK") |
| MCP view start/stop | not testable (no server configured; MCP Servers view present) |
| Marketplace default | pass (Browse Skill Packs CTA; default `flowleap-ai/flowleap-plugins` covered by unit tests) |
| Patent-mode menubar | not testable over CDP (native macOS menu); activity-bar gates visible (no SCM/Debug/Extensions) |
| Light 2026 default | pass (`vscode-theme-defaults-themes-2026-light-json`) |
| Phone layout at narrow width | not testable on desktop: layout is picked at startup and a reload restores the 1440 px window |
Defects found by the eyeball and fixed: codicons rendered as boxes (font not regenerated for the new codicons, step 41; dev worktrees also need the font copied into `src/`/`out/`, which 41 does); editor chat view failed ("Local agent host is not supported in the browser", step 34); Agents Window blank (DI cycle, step 35) and its sessions list/changes view failing on missing kept-out services (step 36).
Environmental noise seen: built-in extensions github, git, emmet, merge-conflict fail to activate in the worktree (their own node_modules are absent).

## Keep-out as landed (and moves)
Not registered (PRD list): sessions github, codeReview, tunnelHost, remoteSessions, remoteAgentHost (whole, incl. cloud sandbox), providers/agentHost, automations, policyBlocked; workbench agentHost service (electron), SSH/WSL remote agent host services, copilotConnectors, web remoteTunnelService; workbench chat `agentSessions/agentHost/agentHost.contribution`, `remoteAgentHost.contribution`, `tunnelHost.contribution`; agent host process in app.ts/shared process/server.
Moves recorded:
- **Upstream `copilotChatSessions` provider** not registered (Cloud/Sandbox only; needs IGitHubService). The fork's Claude path is a new fork-only `contrib/providers/claudeChatSessions` provider (A2).
- **Services of github (IGitHubService, IPullRequestIconCache), codeReview (ICodeReviewService), automations (IAutomationService/Runner/DialogService)**: moved to "registered, service only" (step 36). Core parts inject them: sessions list, changes view, agent feedback, blocked sessions, onboarding tour. Their UI contributions stay out.
- **IAgentHostService on desktop** = remote client (step 34), not the browser null service.
- **modelPickerTryout** (workbench + sessions): kept out (offers GitHub Copilot setup and Copilot billing copy). onboardingTryout, diffEditorTryout stay registered (never auto-run, no sign-in).
- blockedSessions has no registration line upstream; its class is used by two contributions that now work with the step-36 services.

## Subsumed (no script)
A4 (keep-out), A14 (doc only), A15 (fork never changed the kept view items; upstream replaced them), A16 (upstream already routes session aggregates through `readSessionChangesStats`; its changes-view header sums the selected changeset, a different quantity), A18, B7 (all keep-out), B10 #440 (upstream ships the real agentEditorComments; fork-only null-seam test dropped), #442 and #3 (outside src). Partly subsumed: B6c (upstream sizes lists), B6d inline start (upstream), B10d remount half (upstream keeps Mermaid mounted; re-adding broke 6 upstream tests). Guardrails from PRD 0016: `maxContextWindowTokens` gauge wiring, `_diffLayoutOptions`, `readSessionChangesStats` all present after the copy; `isOpenAIModel` and reasoning provenance live in `extensions/copilot` (not synced, untouched).
52 fork files were upstream files that upstream later deleted (pickers, localChatSessions, styleOverrides, old model picker…). They are not restored by step 10; re-apply scripts restored only `localChatSessions/**` and `claudePermissionModePicker` where the intent needed them. The PRD's "fork-only" labels for A11/A12/A15 were wrong on this point.

## Intents re-applied (landing, per script)
A1 sessionsSetUpService no GitHub gate + FlowLeap welcome · A2 Claude-only provider (fork-only claudeChatSessions) · A3 account panel on flowleap · A5 logo/aquarium · A6 patent-voice strings · A9 workflow template chips · A10 CLI nudge registration · A11 Local provider restored + re-pointed · A12 Claude permission-mode picker · A13 mcp.json inputs + tools count · A17 Terminal menubar gate in sessions. B1 onboarding wizard + walkthrough + CLI main channel · B2 FlowLeap sign-in only, GitHub setup gated by patentIdeMode · B3a–e BYOK nudge, rejected key, per-model totals, always-enabled chat ext, no-model way out (new picker) · B4a–d patentIdeMode key + gates, menubar, View/Help prune, custom-agent icon · B5a–d rebrand strings (~100 keys), placeholders + no Problems counter, letterpress + Open in Agents, robot icon · B6a–e MCP gallery on FlowLeap registry, default marketplace + Browse Skill Packs, list clipping, action state, MCP tools in Tools · B8a–c Light 2026 + native chrome, hidden dev surfaces, Command Palette icon · B9a–c CLAUDE.md off, personal Claude skills off, recommended Sonnet default · B10a–e subagent header, tree find, Files from Disk, zero-height output, unbacked agent URIs. Per-intent notes with evidence: `v2/notes-{aw,onb,chat,brand}.md`.
Not re-applied: A12 isolation/branch/mobile permission pickers (applied only to Copilot CLI sessions at 810ad70ca59); #117 lone-chip hide (decision D3); Local mobile/web permission picker.

## Forced files outside src/vs (for PRD 0018 and the deliverable)
`src/*` root (step 12), `test/unit/**` (13), `package.json` + `package-lock.json` (11), `eslint.config.js` (10 import rename, 32 allowlist), `build/flowleap/codicon.ttf` + `patch-copilot-glyphs.py` (41), and the 4 extension files of step 40.

## Extension edits as landed (step 40)
1. `voiceProgress`: no-op on `ChatResponseStreamImpl`, forwarded in `ResponseStreamWithLinkification` and `CodeBlockTrackingChatResponseStream`; all test mocks inherit it (164 errors gone).
2. Fork proposals re-added on upstream dts: `agentDisplayName` (#413) and `ChatResultModelTotal` + `modelTotals` (#274), both in `vscode.proposed.chatParticipantAdditions.d.ts` (the PRD said chatProvider.d.ts; upstream already has `includeEncryptedThinking`, `maxContextWindowTokens`, `modelName`).
3. `claudeCustomizationProvider.ts`: `source: 'local' | 'user'` on source folders.
4. `@vscode/os-proxy-resolver` added to package.json (step 11), not kept out.
Nothing else in the extension changed; no other extension compile error.

## Decisions needed (9)
1. **Claude in the Agents Window.** Upstream removed the extension-host Claude (78a7b6c291b) and the Local harness. Implemented: fork-only extension-host Claude provider (~1.1k lines) + restored Local provider. Alternative: upstream's agent-host Claude, which needs the agent host process PRD 0004 removed. Recommendation: keep the fork provider until Remote Access needs the agent host. Claude provider lacks multi-chat, fork, side chat, delete, quick chats.
2. **Claude provider id** reuses `default-copilot` so stored per-session UI state survives; alternative a new id (state resets once).
3. **#117 lone session-type chip**: kept upstream's disabled single chip (desktop always shows two types now); alternative re-apply the hide and edit 2 upstream tests.
4. **A1 gate condition** keyed on `defaultChatAgent.provider.default.id !== 'github'`; alternative `defaultChatAgent.alwaysEnabled`.
5. **B9c** recommended Sonnet default outranks a provider's declared default (same order as the fork had).
6. **B4a Configure Snippets** command replaced by the patent prompt-template picker (as today); alternative a separate command.
7. **Remaining Copilot strings**: ~165 user-visible strings in 47 files remain (mostly agent-host/Copilot SDK settings, voice mode, Copilot connectors, migration). Scope call.
8. **Scope moves beyond `src/vs`**: steps 11 (npm deps incl. zod 3→4 and codicons), 12 (`src/*` root), 13 (`test/unit`), 41 (brand font). All were needed to compile, test or render; none carries fork intent loss (fork never touched 12/13 files).
9. **Unsynced neighbours**: built-in `extensions/` stay at fork level (one visible symptom: `mermaid-markdown-features` uses `legacyToolReferenceFullNames` without `chatParticipantPrivate`, logged error); `build/` needs upstream's `mainImpl` entry for packaging (`build/next/index.ts`, `build/lib/esbuild.ts`) before a release build; fork `eslint.config.js`/eslint 9 vs upstream eslint 10 rules; `package.json` version still 1.127.0. Decide sync-now vs follow-up.

## Unclassified fork changes
- 0a929ed019f deleted sessions `repoPicker.ts` (GitHub repo picker): upstream still ships it, nothing imports it → keep-out by non-use.
- 5c434b42abb sessionHeader test stub: subsumed (upstream harness no longer needs it).
- fork-only `agentSessionState/{browser,common}/agentHost.config.contribution.ts` defaults (`chat.agentHost.enabled=false`, `hideExtensionHost=true`): nothing in upstream `src/vs` or the extension reads these keys anymore; not re-registered.
No other non-port fork commit outside lists A/B was found (each re-apply agent checked its files).
