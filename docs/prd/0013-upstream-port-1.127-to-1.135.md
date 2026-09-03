# PRD 0013 — Port upstream VS Code fixes (1.127 → 1.135)

**Status:** Proposed
**Date:** 2026-08-21
**Fork point:** `b0b6062a94664d83022ccc705c0f68ee259de768` (2026-06-26)
**Upstream reference:** `/Users/abdullahatrash/flowleap/refrence/vscode` at `07c20d96cf3` (1.135.0, 2026-08-21)
**Upstream delta:** 3,672 commits, 5,781 files

## Why

We forked VS Code at 1.127.0. Upstream is now at 1.135.0. The upstream repo has
security fixes, crash fixes, memory-leak fixes, and features that improve our
product. This PRD selects what to port and in which order. We cherry-pick;
we do not merge or rebase now.

## Divergence map (verified)

| Area | Our churn since fork point | Port method |
|---|---|---|
| `src/vs/base`, `src/vs/editor`, `src/vs/platform/update`, `src/vs/workbench/api`, `extensionManagement`, `contrib/mcp` | ~zero (byte-identical) | clean cherry-pick |
| `src/vs/code` | 2 files, small | clean cherry-pick |
| `src/vs/workbench/contrib/chat` | +1.2k/−22.6k (Copilot removal; render files near-pristine) | guided re-apply |
| `src/vs/sessions` | +8.6k/−36.4k (repurposed for Claude) | per-file cherry-pick, verified live bugs |
| `extensions/copilot` | rewritten (±60–73k) | re-implement by idea only |

Every claim below marked **[verified]** was checked by hand against our tree.

---

## Wave 1 — Security (one PR, do first)

1. **Security rollup** `06a2bc84d05` (#330308). Port the hunks for:
   - `base/common/processes.ts` — `removeDangerousEnvVariables` becomes
     case-insensitive on all platforms and also strips `VSCODE_NODE_OPTIONS`
     and `DYLD_INSERT_LIBRARIES` (macOS dylib injection — we ship a signed
     macOS app). **[verified pre-fix at `processes.ts:134`]**
   - `services/extensions/browser/extensionUrlHandler.ts` — trust prompt runs
     before any override handler. We route `flowleap://` through this seam.
   - `platform/networkFilter/common/domainMatcher.ts` — `https://trusted.com@evil.com` no longer matches.
   - `api/common/extHostCommands.ts` — copy VSBuffer out of the pooled buffer.
   - `contrib/terminal/browser/terminalInstance.ts` — missing `return` after untrusted-workspace bail.
   - `server/node/*` env-ordering hunks.
   - Drop hunks for files we deleted.
2. **Loopback OAuth callback XSS** `96f2210282f` (#330735) —
   `api/node/loopbackServer.ts` interpolates `appName`/URI raw into HTML.
   **[verified pre-fix at `loopbackServer.ts:188`]** Clean pick; `api/` is pristine.
3. **Web-worker ext-host iframe origin confusion** `a07fb2914c9` (MSRC) —
   plus the CSP script SHA in `server/node/webClientServer.ts` (our one
   locally-diverged file in that area; review that hunk by eye).
4. **Trusted-domain backslash bypass** `78e40aaa100` — 2 lines in
   `platform/url/common/trustedDomains.ts`.
5. **Stale secrets survive decryption failure** `b7c14909f57` —
   `platform/secrets/common/secrets.ts`. Our BYOK keys live behind this seam.
6. **Skill-name escaping in the auto-instructions block** `e530e14eda9`
   (#327475) — unescaped skill/instruction filenames are a prompt-injection
   vector. We bundle 17 Patent Skills and install marketplace plugins.
7. **Chat-import path traversal** `780ea331b28` (#329311) — session files
   shared between users must not write outside the store.
8. **Fetch tool auto-approval** `a4048cac638` + `f507e492b81` — URL
   substring match and un-normalized `file:` path check both skipped the
   confirmation prompt.
9. **Electron 42.3.0 → 42.8.1** — six Chromium security patch trains
   (`4b6f5e55bb8`…`1fc102e9ae7`). Bump `.npmrc` + `build/checksums/electron.txt`
   + `cgmanifest.json` together. No source adaptation needed upstream.
   Full sign + notarize round-trip after.
10. **markdown-it 12.3.2 → 14.2.0** `2fd704bc688` — we render untrusted
    content with a parser two majors behind. **[verified: still `^12.3.2`]**
11. **Workspace-trust gaps** `aa1e3cda0fd` + `773e6102d24` — notebook webview
    links bypassed trust; `setUrisTrust()` not awaited.

## Wave 2 — Live product bugs (one PR; each item is small)

1. **`cache_control` leak to BYOK providers** `f3eeb6d04d6` + `4c8eb023b48` —
   the host injects an Anthropic cache-breakpoint data part into every
   request; providers that do not understand it get junk in the request body.
   Fix = vendor allow-list (`anthropic`, `gemini`, `openrouter`) +
   `emitCacheBreakpoints` defaulting to false, mirrored in the tokenizer.
   Files: `endpointTypes.ts`, `extChatEndpoint.ts`, `extChatTokenizer.ts`.
   **[verified live at `extChatEndpoint.ts:377`]** Top item of the whole PRD.
   Directly relevant to the Trial provider branch in flight.
2. **`maxPersistedSessions` 50 → 400** `e08ca7bd81f` — sessions are silently
   deleted past 50; patent matters run for weeks.
   **[verified `chatSessionStore.ts:37` = 50]**
3. **macOS updater: late Squirrel error wipes Ready state** — the `onError`
   guard is part of `0e294574fb9` (#323206), not `c4f99fba345` as first
   surveyed; take the guard alone, the rest of that rewrite is Wave 4 —
   a staged update disappears from the UI. **[verified pre-fix at
   `updateService.darwin.ts:85`]** Ships in our live silent-update flow today.
4. **Main-process crash on disposed render frames** `1058ac0ced0` —
   `webRequest` filters read `frame.url` without `isDestroyed()` guards.
   **[verified pre-fix at `app.ts:299`]**
5. **Duplicate file operations from scoped editor services** `f1d94123d65`
   (#330462) — with two editor-service scopes alive, moves and deletes ran
   twice. We run the Agents window next to the main workbench.
6. **Sessions window quartet** (all **[verified live]**):
   - Endless Changes-view spinner for non-git folders `190016f5761` —
     one-line, `copilotChatSessionsChangesets.ts:36` returns `undefined`
     instead of `[]`.
   - Sessions picker closes on Ctrl+R release `7a1df4f080a` — delete the
     `picker.quickNavigate` block at `sessionsActions.ts:154`.
   - Listener leak in session grouping `ab9ec62c6a6` —
     `copilotChatSessionsProvider.ts:2702` adds one listener per cached session.
   - Archived sessions leak terminal PTYs on deleted worktree cwd
     `07c20d96cf3` — `sessionsTerminalContribution.ts:228` hides instead of
     disposes. Port the dispose + generation-guard core; skip the
     `worktreePending` part until Wave 4.
7. **LM-tools extension point at `BlockStartup`** `6d18451082b` — our patent
   tools can be missed by activation ordering. One line.
8. **Worktree branch/path collision race** (idea from `3e1d2a646cc`) — our
   `chatSessionWorktreeServiceImpl.ts#generateBranchName` checks only branch
   refs, one random suffix, no serialization. **[verified]** This is our own
   code; write our own fix (serialize per repo, check directory existence,
   retry numbered candidates). Own issue, not a port.
9. **Typed text discarded while a session loads** `323fd70ed6c` — input
   editor resets to the empty draft when the model binds. Data loss.
10. **Chat input model disposal race** `68a50091374` — NOT APPLICABLE until
    Wave 4: the race lives in `_holdInputModelReference`, introduced by the
    copy/paste-architecture refactor `0d5a81a060b` which we have not ported;
    our `newChatInput.ts` still creates the model synchronously. Fold this
    fix into whoever ports `0d5a81a060b` (Wave 4 item 2).

## Wave 3 — Leaks, perf, correctness batch (one PR, mechanical)

- **Memory-leak sweep** (~25 upstream commits, 2–8 lines each + tests):
  terminal cluster (port the `onWillDispose` seam `53e335d0387` first),
  search view/results, settings tree, markers, notebook, titlebar, SCM,
  debug model, tasks, breadcrumbs, code actions, diff-editor overlays,
  `mainThreadDocumentsAndEditors`, `mainThreadTerminalService`, RPC
  cancellation handlers `a8fee7001b2`, event-monitor retention `0e039628711`.
- **Chat/sessions leak cluster**: `2c0cd3edcff`, `c423d6bc458`,
  `b129e7f3ca2`, `4e6fd6e85e2`, `25b78bb3d67`; sessions context-menu actions
  `1a22b2a76dc`+`590ea12d448`; git/github extension retention `ac5293b1734`.
- **Perf**: remove `:has()` selectors `f57741ddcd2` + `92a31583948`
  (measured ~218 ms per style recalc; also grep our own CSS for `:has(`);
  ListView measurement batching `c2b336daae7`, `5616258b869`, `d1bc5c31380`,
  `30751f11c4f`; chat row-height/ResizeObserver fixes `a816e1a9ae1`,
  `938777f2271`; shimmer at half rate `9347994a7c1`; hidden-animation sync
  `5fa9548a391` (adds `base/browser/animationSync.ts`); editor-part early
  layout `b2e8d2a74f7`.
- **Crash/disposal guards**: `9302a9e943f`, `632430bbe67`, `8fd29eba502`,
  `275befb11a6`, `a88eb324af8`, `07be0760a43`, `b8d3a33d738`, unhandled
  rejection cluster `4064a18e3e6` `21aca566022` `453caa8cbcb`.
- **`base/` correctness primitives** (all with tests): glob basename case
  `b29a9b36a04`, `BidirectionalMap` `7234ef01c2c`, `stableStringify`
  `d467363f157`, `ArrayQueue` `fab68ed0cdd`, `fuzzyContains` `5a1699c60f4`,
  nls format `f489b728ba9`, `UriTemplate` `2ba22248396`, observable cache
  `be7d2fa5a9b`, RPC thenable guard `f59e07449be`, IPC handler `b08e38094f9`,
  **streaming-markdown token repair `6d82c1b6e2a` + `07c97749857`** (our
  chat render path).
- **MCP batch** (tree is 2 lines from pristine): sort comparator
  `2d17db0748e`+`624f5db912a`, first-tool-call-after-refresh `81d13c0686e`,
  auth loop `a911d720246`, auth context `5fd05efc37f`, stdio guard
  `72750ccdf49`, no-op notifications `9e99bb13efb`, remote init
  `b285c0292b5`, list focus `0701fdec3f3`, workspace config `d584e015c07`,
  cwd across hosts `d483f8059e9`, gallery non-2xx `1ab50677eeb`, scan-error
  logging `b169f020f54`, **marketplace TTL refresh `ea79c398337`** (today a
  cloned Plugin Marketplace never refreshes) + `d5eb7d2ed51`.
- **Gallery robustness** `aa1deb706bd`, `3b565c4a535`, `2fe5921225b` —
  dormant until we ship `extensionsGallery`, trivial to take now.

## Wave 4 — UX features (one PR per item, ranked)

1. **Ctrl+F find widget in chat** `f5929d2a1e3` + `584b7e3e1e2` +
   `97a71a0585f` — the single largest UX gap; patent transcripts are long
   and text-dense. ~2,200 lines incl. tests, new `chatFind/` directory.
2. **Copy chat output as rich HTML + clean Markdown** `f303fd73d50` +
   `0d5a81a060b` — patent attorneys paste into Word.
3. **Token stats per response** `909ca830f1f` — BYOK users pay per token;
   feed the producer side from our endpoint.
4. **Completed-response disclosure** `8fdf719d28a` + `93b7a2100cb` —
   collapses a finished turn's 20 tool calls behind a summary.
5. **Timestamps/elapsed time on turns** `de6ea36c9e3` + fixes — our
   `chatModel.ts` already stores `timestamp`; renderer surface is missing.
6. **Save dirty editors before send** `410a94f6c45`; **confirm discard of
   edited request** `8ba04220e3d` + `553ee8803d9`.
7. **Model-selection robustness cluster** `d3951d44def` et al. — restore
   last-used model when catalogs resolve late. Same shape as the Trial
   provider auto-fetch on `feat/trial-provider-lifecycle`.
8. **Sessions window QoL**: inline rename `72e79495a11`, reopen closed
   (Cmd+Shift+T) `e9d3ba19fc3`, middle-click close `264a406d0ac`, mouse
   back/forward `634c7e571ca`, OS notifications `b68a9f80c50`, session
   details dev command `dab975674ce`, worktree-delete prompt names the
   session `b4b15a9158c`, empty-repo worktree gate `c911cc76c3f`,
   worktree-pending state `dfb8be24b79`+`0cd101be81d` (completes Wave 2 #6d),
   archived-session resume `9aad6878a8b` (re-investigate against our Claude
   resume path).
9. **Update service rewrite** `0e294574fb9` + metered-connection deferral
   `c4f99fba345` — `update.mode` applies without restart; port
   `meteredConnection` first, then the abstract-service rewrite, then the
   `Cancelling` UI state. One deliberate unit; do not half-port.
10. **Sticky scroll in chat** `fdf686d3ea1` + follow-ups — medium-high; the
    `base/` tree changes are the risk.
11. **Go to Symbol in chat** `a76d1d0d035`; **preserve scroll position**
    `aa5ead32578`; **prompt-cache-break warning on model switch**
    `d9c7d78c4c4`; image/vision cluster `8c3bcf84aa3` et al. (patent figures
    are images); thinking-UX cluster `0331adc16ef` et al.; streaming
    tool-call rendering `098619aae79` + `94ef2b94568` + `5b9be8ab46c`;
    inline attachment references `bc3ab215d2c` + `50821935e35`;
    `PromptsStorage.builtIn` seam cleanup `5f37578848b` (our 17 skills sit
    on this seam).

## Explicit non-goals (product decisions, not ports)

- **Modern UI** (193 commits, experimental, still landing) — do not port;
  take the isolated perf wins only.
- **Single-pane sessions layout** (+7.2k lines) — large project; revisit
  only with a design decision. Port order is documented in the survey if
  ever attempted.
- **Dictation / Foundry Local / voice mode**, **desktop pet**,
  **Automations**, **Omni Chat** (added and removed in-range), **global OS
  keybindings** (interesting for "summon the agent" but 20 files; park).
- **node_modules.asar re-pack** `913d5cccc1a`, **tsgo → tsc toolchain swap**
  `7e4e91cab44`, npm `allowScripts` policy — rebase-time mechanics, not
  ports. Note: after any toolchain adoption, update `.claude/CLAUDE.md`
  (it still documents the tsgo-era commands and 7-project layers check).

## Rebase notes (for the future 1.135 rebase, not now)

- No new **required** `product.json` field; `mcpGallery` schema unchanged —
  our marketplace seams are stable. Optional `copilotVersions` self-stamps
  at runtime; smoke-test that path since we deleted Copilot packaging.
- `chatProvider` proposed API is purely additive; our BYOK providers keep
  compiling. `chatContextProvider` renamed — we do not use it.
- `mainThreadLanguageModels` now auto-flags non-default-extension models as
  `isBYOK: true`; with our blanked `defaultChatAgent` everything becomes
  BYOK — probably desired, but make it deliberate.
- Settings rename `autoApprove` → `allowAll` ships with a migration; adopt
  both together.
- Our `build/` conflict surface: `gulpfile.vscode.ts` (16 upstream commits,
  mostly resolvable by dropping dictation/Copilot hunks), `next/index.ts`
  (8; re-apply our 10-line delta), `lib/i18n.resources.json` (9).
  `build/flowleap/**` is pure addition and cannot conflict. `resources/**`
  untouched upstream; entitlements and Info.plist unchanged.
- Principles to audit in our code (from upstream incident fixes): never wipe
  all worktrees on shutdown (`22e44194656`); never let a transient resume
  error classify a session as empty and GC its worktree (`9302e033548`);
  eviction from a listing is not deletion — keep pins/groups (`71e54e81597`).

## Execution

Waves 1–3 are agent-grabbable batches (cherry-pick + adapt + compile +
targeted tests per the fork's validation steps). Wave 4 items are one issue
each. Sequence: Wave 1 → Wave 2 → Wave 3 → Wave 4 by rank. Wave 2 item 1
(`cache_control`) may land ahead of everything if the Trial-provider branch
ships first.

Verification per wave: build-watch clean, `valid-layers-check`, targeted
unit suites for touched areas (list/tree suites after the ListView batching),
and for Wave 1 a full sign + notarize round-trip because of the Electron bump.
