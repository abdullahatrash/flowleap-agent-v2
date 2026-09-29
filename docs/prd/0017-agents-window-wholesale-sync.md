# PRD 0017 — Whole-tree sync of `src/vs` to upstream 1.140

**Status:** SPIKE GREEN 2026-09-29 — deliverable PR pending founder decisions D1–D9 (see Outcome)
**Date:** 2026-09-29
**Fork point:** `b0b6062a94664d83022ccc705c0f68ee259de768` (1.127.0, 2026-06-26)
**Last ported upstream (feature-by-feature):** `44825207bf4` (1.139.0, 2026-09-20) via PRD 0016
**Upstream reference:** `/Users/abdullahatrash/flowleap/refrence/vscode` at `480c6e142fa` (1.140.0, 2026-09-29)
**Follows:** PRD 0016. **Unblocks:** Remote Access (ADR 0009 + PRD 0018, see `CONTEXT.md` → Remote Access).
**Evidence:** v1 spike report, `scratchpad/prd0017/scripts/SPIKE-REPORT.md` (copied to
`docs/reviews/2026-09-29-prd-0017-spike-report.md` when this PRD lands).

## Why

Remote Access will render the Agents Window on a phone through upstream's own web build, so
the fork's Agents Window must equal upstream's. v1 of this PRD tried to sync only
`src/vs/sessions` plus the agent host client. The spike proved that scope cannot compile:
upstream's Agents Window at 1.140 depends on upstream's chat core, base, platform and
workbench at 1.140, and the fork's copies are at 1.127 plus ports.

| How much of `src/vs` copied from upstream | Type errors left |
|---|---|
| Agents Window + agent host client only (v1 scope) | 2,137 |
| + the 313 new files those trees import | 1,909 |
| + every file the fork never touched | 2,439 |
| + every file whose fork commits were all ports | 878 |
| **All of `src/vs`** | **139** |

Every narrower cut is worse than the whole. So the sync unit is the whole of `src/vs` and
`src/vscode-dts`. This is PRD 0013/0016 done once as a copy instead of waves, and it makes
every later upstream port a copy job plus one short intent list.

Divergence measured 2026-09-29 (fork HEAD vs upstream vs fork point):

| Area | identical | stale (never touched) | fork-touched | fork-only | upstream-only |
|---|---|---|---|---|---|
| all of `src/vs` | 5,182 | 1,326 | 586 | 216 | 4,335 |
| `src/vs/sessions` | 108 | 141 | 138 | 81 | 600 |
| `src/vs/workbench/contrib/chat` | 355 | 255 | 217 | 15 | 681 |
| `src/vscode-dts` | 167 | 9 | 2 | 0 | 4 |

Of the 586 fork-touched files outside the Agents Window, 448 sit outside the two v1 trees;
195 fork commits touched them, 134 are upstream ports the copy subsumes, **61 carry fork
intent** (listed below).

## Decision

**Copy upstream `src/vs` and `src/vscode-dts` wholesale, then re-apply the fork's intents
from the named lists.** Never merge hunks. Fork-only files are kept and re-pointed at
upstream's current seams. Nothing outside `src/` is copied: `product.json`, `build/`,
`extensions/`, `cli/`, `resources/` stay as they are, so intents that live there survive
untouched.

**`extensions/copilot` is NOT synced.** It only receives the edits the new API proposals
force (measured: 232 errors, 164 of them one new required member
`ChatResponseStream.voiceProgress` on the stream classes and test mocks; the rest are the
two fork proposal edits re-applied on top of upstream's files and one shape change).

**Restore the upstream path `src/vs/platform/agentHost`** (browser, common, electron-browser)
and retire the fork's rename `platform/agentSessionState`. The server layer
(`platform/agentHost/node`, `electron-main`, the server halves of `test`) stays out
(PRD 0004; Remote Access serves the protocol from the window, ADR 0009 option B).

**Neutralize, do not delete.** An unwanted upstream contrib stays on disk and is kept out of
the registration entry points. Deleting made this sync a merge; not registering makes the
next sync a copy.

**Fork-intent commits that were also ports are re-checked, not trusted.** The rule "port
commit ⇒ upstream replaces the file" loses fork tweaks that rode on port commits (known:
#439 agent host defaults, #414 context gauge wiring, #413 subagent header). The spike greps
for the fork symbols named in PRD 0016 waves B and W after the copy.

## Keep-out (copied, not registered)

Sessions entry points (`sessions.*.main.ts`, contribution indexes):
- `contrib/github/**`, `contrib/codeReview/**` (#75)
- `contrib/tunnelHost/**` (Microsoft Dev Tunnels; Remote Access uses our Relay)
- `contrib/remoteSessions/**` (host-to-host delegation; Remote Access v3)
- `contrib/providers/remoteAgentHost/**` whole provider incl. cloud sandbox — PRD 0018 issue 1
  re-registers the generic remote-host part only
- `contrib/providers/agentHost/**` local agent host provider (needs the agent host process)
- `contrib/automations/**`, `contrib/policyBlocked/**` — kept out; `blockedSessions` has no
  registration line upstream

Workbench and platform:
- `workbench/services/agentHost/electron-browser/agentHostService` and
  `platform/agentHost/electron-browser/{ssh,wsl}RemoteAgentHostService` (spawn/connect hosts)
- `platform/copilotConnectors/electron-browser/copilotConnectorsRequestService`,
  `platform/remoteTunnel/browser/remoteTunnelService` (web)
- Agent host process wiring in `app.ts`, shared process and server services (#73): re-apply
  the intent "no agent host process is started" against upstream's current wiring.
- Upstream removed `chat.agentHost.enabled`; the fork's defaults
  `chat.agents.copilotCli.hideExtensionHost=true`, `chat.editor.copilotCli.hideExtensionHost=true`
  lived in fork-only `agentHost.config.contribution.ts`. Re-apply under Agents Window item 2.

Not copied at all: `platform/agentHost/node/**`, `platform/agentHost/electron-main/**`, and
the server halves of `platform/agentHost/test/**`.

The spike may move an item between lists when the type-checker forces it. Record every
move in the Outcome.

## Fork intents to re-apply — Agents Window (`src/vs/sessions`)

Status column is from the v1 spike.

| # | Intent | Source | v1 spike status |
|---|---|---|---|
| 1 | Claude-native setup: no Copilot gate, no GitHub sign-in in `sessionsSetUpService`; FlowLeap welcome; suppress duplicate welcome after the wizard | 800599007b5, e04542181ac | needs re-apply; upstream has 32 GitHub/Copilot refs there |
| 2 | Session-type picker shows Claude only; no Copilot CLI / Cloud rows; `hideExtensionHost` defaults | 588287d25a6, 86ea702cce8, fork-only `agentHost.config.contribution.ts` | needs re-apply; fork-only `copilotCliSessionType.ts` breaks on `authRequirement` |
| 3 | Account panel and header on the `flowleap` auth provider, no Copilot dashboard | cdf6e2bdfee, de4b3b5dbb3 | needs re-apply; upstream uses `ChatStatusDashboard` |
| 4 | No tunnel toggle | b8a416a1af1 | subsumed by keep-out |
| 5 | FlowLeap logo and brand mark, aquarium mark | 02740c34129, 27da65af6c5, 7732f8084a7 | fork-only svg/path restored; upstream logo svgs need swapping |
| 6 | Patent-voice strings in welcome, composer, empty state | #65, #76, #93 | needs re-apply |
| 7 | Survey off | #100 | lives in workbench (see list B) |
| 8 | Vendored skills `sessions/skills/**` + drift guard | #64, #67, re-vendors | restored verbatim; never hand-edit |
| 9 | Workflow template starters | #68, #69 | fork-only, restored |
| 10 | FlowLeap CLI nudge `contrib/flowleapCli/**` | #66 | fork-only, restored |
| 11 | Local chat sessions provider | fork-only | breaks on upstream's new `ISessionsProvider`; re-point |
| 12 | Claude permission-mode, isolation, branch, mobile permission pickers | fork-only | break on new `ICopilotChatSession`; re-point |
| 13 | MCP: inputs, tools in Tools, inline start/stop | #146, #147 | code is in workbench (list B) |
| 14 | Marketplace CTA | #114 | code is in workbench (list B) |
| 15 | `sessionsDiffEditorLayout`, `sessionHeaderMetaActionViewItem`, `newSessionActionViewItem`, `syncChangesActionViewItem`, `workspaceFolderActions`, `agentFeedbackHover` | fork-only | `MenuId.SessionHeaderMeta` no longer exists upstream; re-point or drop with a note |
| 16 | `readSessionChangesStats` is the ONE change-count reader | PRD 0016 wave W | upstream's new `sessionChangesEditor.ts` reads `stats.insertions/deletions` itself; re-point it |
| 17 | `patentIdeMode` gate on view containers and menubars | #82 | lives in workbench (list B) |
| 18 | `remoteAgentHostProtocolClient.ts` fork-only | — | is upstream's `agentHostProtocolClient.ts` renamed; drop, subsumed |

## Fork intents to re-apply — outside the Agents Window (61 commits, 9 groups)

Full hash list in the spike report addendum. Re-apply the **intent** against upstream's
current code; intents whose files live outside `src/` need nothing.

**B1. Onboarding and trial (12 commits, 2026-07-05 → 08-29).** Wizard steps role/trial/model,
finale "Run your first investigation" that copies the prompt, reacts to async sign-in and
existing access, filters the Trial step, never touches the theme, minimised for workbench UI;
no-card trial sells Subscribe (bbefeb5c7f1); Patent AI panel identity + walkthrough (#92);
CLI nudge trigger (#66).

**B2. Auth and FlowLeap sign-in (3).** L3 end-to-end sign-in + soft onboarding step
(db5992d9a9c, ADR 0003); branded Accounts CTA + suppress GitHub chat-setup surfaces in patent
mode (c383eab50b8); de-Copilot Settings descriptions and title-bar sign-in (#99).

**B3. BYOK (5).** First-run BYOK nudge + actionable no-model error (#39); rejected key says so
(#210); per-model token totals (#274, incl. the `ChatResultModelTotal` proposal); patent chat
extension always enabled in BYOK builds (81e6bf0321a, `defaultChatAgent.alwaysEnabled`);
"name the way out" when no model (#306).

**B4. Patent mode and menubar gates (5).** `patentIdeMode` context key + prompt templates
(#20); hide Selection/Go/Terminal menus (#82); prune dev entries from View/Help (#83);
patent-voice name + icon for the Patent Research mode (#135); language-extension prune (#3,
lives in `build/`/`extensions/`, nothing to do).

**B5. Rebrand strings and survey off (7).** #76 and follow-up, #100 (survey service disabled),
#117 (per-mode placeholders, no Problems counter, no lone environment chip), letterpress
watermark + Chat Debug icon + robot Open-in-Agents (b4f7c37a75a), robot codicon for custom
agents (59915b316fa); test expectation updates (5c0012e9962) are re-derived, not re-applied.

**B6. MCP and marketplace (8).** MCP gallery on the FlowLeap registry (#113);
FlowLeap plugins default marketplace, pre-trusted, Browse Skill Packs CTA (#114); gallery
list clipping (#144); mcp.json inputs + inline start/stop + action state (#146 ×2);
server tools in Tools + count (#147); flowleap-ai org (3e5305ded55, #269).

**B7. Agent host and tunnel removal (7).** #60, #72, #73, #74, #75 ×2, #77 — all become the
keep-out list above. No file deletion.

**B8. Theme and developer-surface defaults (3).** Light 2026 default + native chrome follows
theme (a97e3817858); hide developer surfaces for new users (eb7c832c4be); Command Palette
icon in the activity bar bottom zone (#143). Parts in `product.json` need nothing (and are
inert on desktop anyway; set defaults in code registration).

**B9. Prompt and project notes (3).** notes.md as memory, CLAUDE.md instructions off by
default (9dc98a53ed7); provenance appendix on content templates, explicit output paths,
personal Claude skills off (#342); trajectory-gap fixes (#160) — check which parts are in
`src/vs` vs the extension.

**B10. Chat UI fixes and core seams (8).** Subagent header on the extension-host path
(#413 ×2, incl. the `ChatSubagentToolInvocationData` proposal); inline tree find (#330);
"Files from Disk…" in Add Context (b77076f8a90); blank output webviews after re-render
(f6f334edec4); provider agents with unbacked URIs (#78); `agentEditorComments` null seam +
`CustomEditorPriority.explicit` (#440); markdown-language-features (#442) lives in
`extensions/`, nothing to do.

**Guardrails carried from PRD 0016:** after the copy, grep for the wave-B symbols
(`maxContextWindowTokens` gauge wiring in core, `isOpenAIModel` de-hash, reasoning
provenance) and the wave-W `_diffLayoutOptions`/`readSessionChangesStats` seams; any that
vanished are re-applied and listed in the Outcome.

## Extension edits forced by `src/vscode-dts`

1. Add `voiceProgress` to every `ChatResponseStream` implementation and test mock in
   `extensions/copilot` (164 errors; one member; no behaviour).
2. Re-apply the two fork proposal edits on top of upstream's dts files:
   `ChatResultModelTotal` in `vscode.proposed.chatProvider.d.ts` (#274) and
   `ChatSubagentToolInvocationData` in `vscode.proposed.chatParticipantAdditions.d.ts` (#413).
3. `ChatSessionCustomizationSourceFolder` shape change: adapt the extension's customization
   provider.
4. Add `@vscode/os-proxy-resolver` to `package.json` (new upstream dependency, 3 errors) —
   or keep the upstream file that needs it out; spike decides, Outcome records.

Nothing else in `extensions/copilot` changes under this PRD.

## Explicit non-goals

- No product change beyond upstream's improvements arriving. The app must look and behave
  as today: FlowLeap welcome, Claude-only sessions, patent voice, BYOK, onboarding, gates.
- No agent host process. No `platform/agentHost/node`.
- No Remote Access code (PRD 0018).
- No `extensions/copilot` sync beyond the forced list above.
- No re-vendoring of skills; `chore: sync bundled skills` owns them.

## Execution

### Spike (throwaway worktree `../wt-spike-0017`, branch `spike/0017-full-tree`, no PR)
1. Numbered idempotent scripts in `scratchpad/prd0017/scripts/`, each taking the worktree
   path: `10-copy-src-vs.sh` (all of `src/vs` + `src/vscode-dts` from upstream, then restore
   the 216 fork-only files, then delete `platform/agentSessionState` and the not-copied
   server trees, then rewrite the `agentSessionState` imports incl. `eslint.config.js`),
   `20-keep-out.sh`, `30-reapply-A<nn>-<slug>.sh` per Agents Window item,
   `31-reapply-B<n>-<slug>.sh` per outside group, `40-ext-dts.sh` for the forced extension
   edits. Log "subsumed" for anything upstream already has; write no script for it.
2. `npx tsgo --noEmit -p src/tsconfig.json` to zero; then the extension typecheck projects to
   zero. Log counts per script in `typecheck-log.md`.
3. `npm run valid-layers-check`; `npx eslint` on changed trees.
4. `node build/next/index.ts transpile`; `VSCODE_SKIP_PRELAUNCH=1 ./scripts/test.sh` full
   core suite; `extensions/copilot` vitest. Failures listed with one-line causes;
   environmental ones named per the worktree memory; #447's pre-existing reds allowed.
5. Eyeball run with `TMPDIR=/tmp`: onboarding wizard on a fresh profile, FlowLeap welcome,
   sign-in CTA, editor Patent Agent chat on BYOK (first-run nudge, a turn), Agents Window
   (Claude-only picker, Local session starts, skills listed, Claude session if credentials
   exist), MCP view start/stop, marketplace default, patent-mode menubar, Light 2026 default,
   phone layout at narrow width. Record each as pass/fail/not-testable.
6. Report to `SPIKE-REPORT-v2.md`: scripts, error counts, keep-out moves, subsumed intents,
   intents not re-applied and why, tests, eyeball, forced extension edits as landed.

### Deliverable (after the spike is green)
- Branch `port/0017-full-tree-1.140` off `main`, replay the scripts, ONE PR for the copy +
  keep-out + re-applies. Splitting re-creates the merge. If review needs it, the PR is
  reviewed by intent group using the script list as the map.
- PR body: the two divergence tables before and after, keep-out as landed, intent checklist
  A1–A18 and B1–B10 with the landing file for each, forced extension edits.
- CI green except #447. Founder eyeballs the app before merge (Remote Access Stage 2).
- After merge: `docs/reviews/2026-09-29-prd-0017-spike-report.md`, memory note updated, and
  the next upstream sync is "re-run 10/20/30/31/40 against a newer reference".

## Outcome

### v2 spike (2026-09-29) — green
Evidence: `docs/reviews/2026-09-29-prd-0017-spike-report-v2.md`; scripts `10…41` + `run-all.sh`
replay the branch `spike/0017-full-tree` byte-identically from `main` (only the regenerated
codicon font differs; the deliverable reuses the committed font).

| Check | Result |
|---|---|
| tsgo core | 0 errors |
| tsgo `extensions/copilot` (4 projects) | 0 errors |
| layers check | pass |
| core Mocha suite | 36,981 pass, 2 fail (machine locale en_FR date/time; baseline main 22,156 pass) |
| node unit | 12,020 pass |
| extension vitest | 9,182 pass, 2 fail (`createWebSocket.spec`, fails on main too) |
| eyeball | 10 pass, 0 fail, 4 not testable (BYOK turn w/o key, MCP w/o server, native menubar, phone layout on desktop) |

Eyeball defects found and fixed as scripted steps: codicon font not regenerated (41), editor
chat view "Local agent host is not supported in the browser" (34), Agents Window DI cycle (35),
sessions list/changes view missing kept-out services (36).

Keep-out moves: upstream `copilotChatSessions` provider not registered (Cloud/Sandbox only, needs
IGitHubService) → fork-only `contrib/providers/claudeChatSessions` (A2); github/codeReview/
automations SERVICES registered service-only because core parts inject them, their UI stays out;
`IAgentHostService` on desktop = remote client; `modelPickerTryout` kept out.

Scope moves beyond `src/vs` (all needed to compile, test or render): npm deps (zod 3→4, codicons,
`@vscode/os-proxy-resolver`), `src/*` root files, `test/unit/**`, `eslint.config.js`, brand
codicon font. Fork never touched the `src/*`/`test/unit` files.

Correction to the intent lists: 52 "fork-only" files were upstream files that upstream later
deleted (old pickers, `localChatSessions`, style overrides, old model picker). Only
`localChatSessions/**` and `claudePermissionModePicker` were restored, where the intent needed
them. A12 isolation/branch/mobile pickers and the #117 lone-chip hide were not re-applied.

### Decisions for the founder (D1–D9)
See the report's "Decisions needed". D1 is the one with product weight: upstream removed the
extension-host Claude from the Agents Window (78a7b6c291b); the spike carries a ~1.1k-line
fork-only Claude provider that lacks multi-chat, fork, side chat, delete and quick chats. The
alternative is upstream's agent-host Claude, which needs the agent host process PRD 0004 removed
and which changes Remote Access Q10 (see `CONTEXT.md` → Remote Access, PRD 0018).

### Follow-ups filed after merge
- Built-in `extensions/` still at fork level (`mermaid-markdown-features` logs a proposal error).
- `build/` needs upstream's `mainImpl` entry for packaging — included in the deliverable as a
  release blocker; CI release dry run before merge.
- ~165 remaining Copilot strings in 47 files, mostly in kept-out surfaces.
- eslint 9 vs upstream eslint 10 rules; `package.json` version still 1.127.0.
