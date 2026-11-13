# PRD 0027 — Upstream sync to 1.146.0 in two PRs: build/pnpm first, then `src/vs`

**Status:** COMPLETE — PR A MERGED #860 (`1feddc94420`), PR B MERGED #861 (`9f3eb3d6bdb`), both 2026-11-13. Open: three-platform release dry run before the next release; `policyData.jsonc` re-export needs a built product; Host + Viewer pairing live re-test.
**Date:** 2026-11-13
**Base of the last sync:** upstream `480c6e142fa` (1.140.0), PR #464 (`45a4c6d6ddc`, 2026-09-29)
**Upstream reference:** `/Users/abdullahatrash/flowleap/refrence/vscode` at tag `1.146.0` = `69047191fc4` (2026-11-10)
**Survey:** `docs/reviews/2026-11-13-upstream-survey-1.140-to-1.146.md` (+ `-agenthost-sessions.md`, `-chat-byok-build.md`)
**Follows:** PRD 0017 (whole-tree sync recipe), PRD 0018 (agent host is the only Claude).

## Why

Upstream moved 4,438 commits since the last sync. The survey found three structural shifts the fork must absorb before any later port is a plain copy again: the Agents Window code moved into `workbench/contrib/sessions`, the build moved to pnpm 12, and Electron went to 43.8.6. The security batch `0695d911316` (MSRC) and the credential-forwarding fix `ccbfadeb451` sit inside the synced tree.

The Patent AI agent is not in the delta: `extensions/copilot` is never copied, the fork's Claude seams (`claudeSdkOptions.ts`, `claudeInteractiveTools.ts`) have no upstream commits, and the 145 fork-created core files (skills, tool sets, remote access, hosted workspace) carry over as files.

## Decision

Two PRs, in order. Each one leaves `main` releasable.

**PR A — build, package manager, runtime pins (this PRD's first deliverable).** On the CURRENT `src/`:
- Copy upstream `build/` at 1.146.0 wholesale. Keep the fork-created files (`build/flowleap/*`, `build/upstream-sync/*`, `build/entitlements.plist`). Drop the fork's 1.127 leftovers upstream deleted (`buildfile.ts`, `buildConfig.ts`, `gulpfile.compile.ts`, `lib/{bundle,optimize,mangle}`, `npm/{fast-install,installStateHash,gyp}`, `build/.npmrc`, `build/package-lock.json`).
- Re-apply the fork's build intents on upstream's files (list below).
- Move to pnpm 12.16.0: `pnpm-workspace.yaml`, `.pnpmfile.mjs` (root, `build/`, `remote/`, `extensions/`), `packageManager` + `nativeBuild` in `package.json`, delete every `.npmrc` and `package-lock.json` the install roots own, generate `pnpm-lock.yaml` per root.
- Electron 43.8.6 (`nativeBuild.target`, `build/checksums/electron.txt`), Node 24.22.1 (`.nvmrc`).
- `package.json` dependencies = upstream 1.146.0's list, plus what the current `src/` still imports (`@microsoft/mxc-sdk` until PR B removes `terminalSandboxMxcRuntime.ts`), minus `@github/copilot`. Same for `remote/package.json` and `extensions/package.json`.
- CI (`flowleap-ci.yml`, `flowleap-release.yml`) on `pnpm/action-setup` + `setup-node` cache `pnpm`; `pnpm install --frozen-lockfile` (= `pnpm ci`); gulp calls through `pnpm run gulp`; the SDK tarball step reads `tar` from the lockfile the pnpm way.
- Docs: `docs/dev/LOCAL-DEV.md`, kit README + a new step `11-pnpm-deps.sh` for the 1.146 kit, `build/flowleap/README.md`.

**PR B — `src/vs` + `src/vscode-dts` wholesale at 1.146.0** with a new kit `build/upstream-sync/1.146/` (copy of the 1.140 kit, step 10 adjusted: keep `platform/agentHost/{node,electron-main}`, rewrite `vs/sessions/...` imports of fork-only files to the moved paths, drop `agentSessionState` handling). Re-apply the 13 patches that still apply, re-anchor or re-derive the 42 that do not (survey §5), add one script per new fork intent since #464 (survey §6), new keep-outs (survey §6 last paragraph), `extensions/media-preview` deleted for core `mediaPreview`. Separate PRD section when PR A is merged.

**Release** after PR B: Claude SDK tarballs 0.3.304 (`build/flowleap/produce-claude-sdk.ts`, `product.agentSdks.claude` re-stamped), one three-platform dry run (macOS arm64, Windows x64, Linux x64), founder word for the tag.

## Fork intents in `build/` to re-apply on upstream's 1.146.0 files (PR A)

| File | Intent | Fork commit |
|---|---|---|
| `.moduleignore` | exclude hoisted `foundry-local-sdk/**`; koffi + Claude SDK audio-capture exclusions (now upstream's own, verify) | #497, #498 |
| `agent-sdk/package.ts` | pin the shipped Claude SDK to the root devDependency version; produce glibc Linux tarballs on any host | 3b62c30627f (#490) |
| `agent-sdk/common.ts`, `README.md` | none (fork edits were the #74 delete-and-restore) | — |
| `filters.ts` | fork extensions kept (markdown-pdf, docx-viewer, pdf-preview, flowleap, media-preview); pruned language extensions | #3, #80 |
| `gulpfile.extensions.ts`, `lib/extensions.ts`, `npm/dirs.ts` | fork extensions list; pruned language extensions | #3, #4, #15, L2 docx, #80 |
| `gulpfile.reh.ts` | pruned extension list | #3 |
| `gulpfile.vscode.ts` | package `out-build/mainImpl.js` entry (PRD 0017); exclude claude-agent-sdk vendor tree from rcedit; bundle built-in skills | c5909b0c4e1, #81, #64 — check which are still needed: upstream 1.146 has its own mainImpl entry and its own SDK rcedit exclusion |
| `gulpfile.vscode.linux.ts`, `linux/debian/dep-lists.ts`, `linux/rpm/dep-lists.ts`, `linux/dependencies-generator.ts` | Linux x64 + arm64 release; dep-list guard entries (GLIBC_2.27, GLIBC_2.5); no MS apt repo in postinst | #450, #499 |
| `lib/electron.ts` | derive electronVersion from the pin (upstream now reads `nativeBuild` via `electronVersion.ts`) → take upstream's | #254 subsumed |
| `lib/compilation.ts`, `.gitattributes` | codicon glyph branding | #5 |
| `lib/i18n.resources.json` | fork contribs: patent, remoteAccess, flowleapCli, linkPresentation | #66, #92, #441, #481 |
| `lib/policies/policyData.jsonc` | update.mode + marketplace plugin auto-update policies | #269, update rewrite — check upstream has them |
| `next/index.ts` | agent host entry points the packaged app spawns; Viewer web build + boot page; skills bundling; mainImpl | #511, #482, #64, c5909b0c4e1 |
| `checksums/electron.txt` | take upstream's (43.8.6) | — |

## Keep-out in `build/` (copied, not used)

`build/win32/copilot.iss` (Copilot CLI shim), the Copilot link helper block in `gulpfile.vscode.ts` and the `@@COPILOT_LINK_HELPER@@` placeholder in `resources/linux` templates (strip, or the literal placeholder ships in postinst), `build/npm/cloudSandbox*.ts` (harmless).

## Acceptance (PR A)

1. `pnpm install` from clean at the root succeeds on macOS and in CI (Linux, Windows) with frozen lockfiles.
2. `npx tsgo --noEmit -p src/tsconfig.json` 0 errors; `pnpm run valid-layers-check`; `pnpm run gulp compile-extensions`; `pnpm run typecheck` (build/); unit suite green (`scripts/test.sh` after transpile).
3. The app launches from the worktree on Electron 43.8.6: chat view renders, Agents Window opens, a Claude session streams.
4. ~~Six-platform release dry run~~ Founder decision 2026-11-13: no dry run for PR A. One three-platform dry run (macOS arm64, Windows x64, Linux x64, sequential) runs after PR B and before the release; a packaging fault from PR A is found and fixed in `build/` there.
5. `docs/dev/LOCAL-DEV.md` and the kit README describe the pnpm setup; the 1.140 kit's step 11 is marked superseded.

## PR A — what actually changed (2026-11-13, branch `port/1146-pnpm-build`)

**Mechanical:** `build/` = upstream 1.146.0 wholesale, fork-created files kept (`build/flowleap/*`, `build/upstream-sync/*`, `entitlements.plist`); 1.127 leftovers gone (`buildfile.ts`, `gulpfile.compile.ts`, `lib/{bundle,optimize,mangle}`, `npm/{fast-install,installStateHash,gyp}`). Root, `remote/` and `extensions/` manifests = upstream's (fork `version` 1.127.0 and `distro` kept; `@github/copilot` and `@microsoft/mxc-sdk` re-added because the 1.140 source still imports them). pnpm 12.16.0 everywhere: `pnpm-workspace.yaml` + `.pnpmfile.mjs` per root, lockfiles seeded from upstream's then re-resolved, every `.npmrc` and `package-lock.json` removed except `build/agent-sdk/agents/*` (still npm, as upstream) and the two fork-only npm sub-roots under `extensions/copilot` (`evals/`, `serverPlugin/`). Node 24.22.1, Electron 43.8.6 (`nativeBuild`), `build/checksums/electron.txt` upstream's. `.eslint-plugin-local`, `.github/actions/detect-*`, `.github/workflows/workspace_image` vendored from upstream (build tests import them). `test/unit/package.json` from upstream (the test runner deps moved there).

**Workspace lists (fork extension set):** root `pnpm-workspace.yaml` (+`test/mcp`, +`vscode-extras`, −`test/scenario`), `extensions/pnpm-workspace.yaml` and `build/npm/dirs.ts` list the 30 fork extensions; `allowBuilds` adds `canvas`/`highlight.js` off (markdown-pdf); the copilot extension's `electron` devDependency moved to `^42.10.0` so upstream's allow-list key matches.

**Fork build intents re-applied on upstream's files:** filters (markdown-pdf), `compilations` list, unbundled fork extensions with production deps packaged through `getProductionDependencies` (`docx-viewer`, `markdown-pdf`, `pdf-preview`; new `unbundledExtensionsWithDependencies` in `build/lib/extensions.ts`), rcedit exclusion of the Claude SDK vendor tree, skills folder copied whole (`build/next/resources.ts`), `viewer` build target, Linux dep-lists + no Microsoft apt repo + dependencies-generator filter, `foundry-local-sdk/**` module ignore, i18n resources (patent, flowleapCli, remoteAccess, welcomeAgentSessions), `build/flowleap/codicon.ttf` preference, glibc Linux SDK tarballs on any host. Subsumed by upstream: mainImpl entry, policy texts, SDK pin (versionSync test), `lib/electron.ts` pin derivation.

**Source edits the build forced (all match upstream 1.146's code; PR B overwrites them):**
- `editor/common/diff/externalLinesDiffComputer.ts`: `@vscode/diff` 0.0.2-128 dropped `ignoreTrimWhitespace` (upstream's hunk).
- `platform/agentHost/node/copilot/copilotAgent.ts`, `copilotSessionLauncher.ts`: `@github/copilot-sdk` 1.0.30 removed `enableRemoteSessions`, `remoteSession`, `copilotUser` (Copilot agent is gated off; three one-line edits).
- `platform/agentHost/common/meta/mcpCustomizationMeta.ts`: `'account'` added to `McpServerSource` (SDK union grew).
- `workbench/contrib/policyExport/common/policyDto.ts`: upstream's file (optional `agentHost` status; build tests read it).
- Extension `tsconfig.json` files: `typeRoots` removed in 31 files, as upstream did for pnpm hoisting.
- `eslint.config.js`: `@stylistic/eslint-plugin-ts` → `@stylistic/eslint-plugin` (upstream's rename; fork rules unchanged).
- `extensions/copilot/chat-lib/script/postinstall.ts`: upstream's "no sources yet, skip" guard (pnpm runs it on every install).
- `platform/agentHost/node/copilot/copilotSessionLauncher.ts`: `CopilotSessionClient.rpc.sandbox` narrowed to `getHostSupport` (SDK 1.0.30 added `proxyCa`; test fakes stay small); test fakes in `agentHost/test/node` untouched.
- `extensions/{css,html,json}-language-features`, `extensions/simple-browser`, `extensions/esbuild-common.mts`, markdown/markdown-math esbuild scripts: upstream's 1.146 copies (no fork commits; their esbuild scripts resolve hoisted packages through `resolvePackageDirectory`); `mermaid-markdown-features/esbuild.webview.mts` patched the same way (fork keeps its 1.140 copy).
- `eslint.config.js`: `header/header` wrapped in `fixupPluginRules` (eslint 10) and upstream's `local/code-no-legacy-notification-parsing` block enabled for core.
- `build/next/index.ts`: entry point `mediaPreview/browser/imageEncoderWorkerMain` removed until PR B.
- `build/gulpfile.vscode.ts`: `product.builtInExtensions` typed explicitly (FlowLeap's list is empty).

**Gates (local, macOS arm64, 2026-11-13):** `pnpm install` clean on all five roots; `tsc -p src/tsconfig.json` 0 errors; layers check 0; copilot extension typecheck 0; `pnpm -C build run typecheck` 0; `pnpm -C build run test` 993 pass / 0 fail (needs `TMPDIR=/private/tmp` on macOS); `gulp compile-extensions` + `compile-extension-media` 0 errors; unit suite 44,789 passing, 6 failing — the same 6 fail on `main` (AutomationsCardsWidget accessible view, ChatStatusDashboard PRU reset date, ChatTokenDeleter ×3, LanguagesRegistry leak after-all), none from this PR; app launches from the worktree on Electron 43.8.6 with no renderer errors and the agent host registering Claude. Build tests that assert upstream-only infrastructure were removed (`detectChanges`, `detectMissingCaches`, `agentHostTestSelection`, `workspaceImage`, `cloudSandbox`, `testAgentHostE2EStartup`, and four `.eslint-plugin-local/tests` for rules the fork's lint config does not enable).

**Open for PR B / release:** `build/lib/policies/policyData.jsonc` is upstream's and lists Agent Host statuses for policies the 1.140 source does not register — run `pnpm run export-policy-data` after the source sync. `product.json` lacks `linuxDesktopName` (gulpfile falls back to `applicationName`). `@github/copilot` and `@microsoft/mxc-sdk` leave `package.json` with PR B. `copilotRuntimeVersion` 1.0.108-0 must track `@github/copilot-sdk`. Six-platform dry run still to run.

## PR B — what actually changed (2026-11-13, branch `port/1146-src-sync`)

**Mechanical (kit `build/upstream-sync/1.146/`, steps 10–13):** `src/vs`, `src/vscode-dts`, the `src/` root files and `test/unit` at upstream 1.146.0; 145 fork-created files restored with their relative imports re-pointed through `tools/rewrite-imports.mjs` (upstream moved the Agents Window into `workbench/contrib/sessions`, `dfe0bb738db`); 480 upstream-deleted files dropped; `eslint.config.js` = upstream's with the fork's three rules re-applied (Viewer layer target, `test/mcp`, drafting→drawings direction); `extensions/{git,github,github-authentication}` at 1.146 (no fork intent; Timeline API finalized), `git.enabled` stays off.

**Re-apply (four groups on their own branches, one commit per intent, each saved as a kit patch + runner + note):**
- `aw` (23 intents): keep-outs re-derived at the new paths plus the new ones (Copilot harness tour, GitHub service UI, artifact integrations, canvases, Inbox One, Computer Use, MCP-served skills, multiple chat providers, Mission Control; `chat.defaultToCopilotHarness` and `chat.editor.preferCopilotHarness` default false); Local provider on the 1.146 contract; account panel FlowLeap auth; patent voice in the unified composer; workflow starters re-homed; CLI nudge; MCP inputs; terminal menu gate; #471 hide PR/merge/checkout; Remote Access entry points and Viewer entry; Sonnet default on `sessionModelSelection.ts`.
- `chat` (22 intents): BYOK nudge/rejected key/token totals/always enabled; no-model way out re-derived on the tabbed picker; `.flowleap/` prompt roots; patent tool set (`flowleap-patent`) back in `clientToolSetsContribution.ts`; Mistral vendor; hosted MCP; webview product links; locked-agent patent placeholder; dts for the extension (`agentDisplayName`). Dropped as subsumed: B10c files-from-disk, B6c list clipping, B6e MCP tools section (the fork helper `agentHostCustomizationToolSets.ts` deleted), A12 permission picker, A15.
- `agenthost` (6 scripts): Claude-only agent host (Copilot never starts, Codex hidden, keychain claude.ai login counts, auth lookups at trace, spawn-env guardrail), AHP log metadata-only, patent voice on the Claude path, Remote Access host seams on `IAgentHostService` + lazy `RemoteAccessHostController`, chat mirror re-derived on the 1.146 agent service (5 hunks by hand), `@github/copilot` and `@microsoft/mxc-sdk` dropped from the manifests.
- `brand` (19 scripts): sign-in only, onboarding wizard, Light 2026, developer surfaces hidden, patent context key/menubar/help/custom agent icon, rebrand as a key-table sweep (`tools/rebrand-strings.{json,ts}`, 160 rows), input placeholders, letterpress on the new watermark, FlowLeap avatar, hosted web client re-anchored (`BrowserStorageService` got protected accessors), media-preview retired for core `mediaPreview`, webview CDN pin = `69047191fc4`, `flowleapVersion` product field.
- Integration: duplicate import, modern UI + frosted glass default off (founder: "off, keep it like today"), agent-host patent-voice strings, rebrand sweep over `chat.shared.contribution.ts` and the account menu.

**Gates on the integrated tree:** `tsc -p src/tsconfig.json` 0 errors; `valid-layers-check` 0; copilot extension typecheck 0 (main + worker); `compile-extensions` and `compile-extension-media` 0; copilot extension compiles; app launches from the worktree (Claude registered, 4 models, no renderer errors). Unit suite after re-derivation (`33-test-rederive`, 10 commits): 74,130 passing / 3 failing — 2 pre-existing on `main` (AutomationsCardsWidget accessible view, ChatStatusDashboard PRU reset date) and 1 upstream-flaky ChatListWidget streaming test whose files are byte-identical to upstream. The re-derivation also found two real defects, fixed on the branch (`34-test-rederive-product-fixes`): the FlowLeap default marketplace was hidden from Discover while the GitHub public feed was on (B6b: new `PUBLIC_FEED_PLUGIN_MARKETPLACE` constant), and the B17 avatar fallback hunk was missing. `extensions/theme-*` synced to 1.146 (`14-theme-extensions.sh`; no fork intent, two new tests read them). Dev note: a fresh worktree needs `pnpm run gulp copy-codicons` before the unit suite (font tests).

**Known / to do on the PR:** unit-test re-derivation; `policyData.jsonc` re-export needs a built product; live re-test of Host + Viewer pairing from one commit; `pluginMarketplaceService.test.ts` naming of the default marketplace; registry detail URL `/v0/servers/<name>` is 404 on the website (client uses `/versions/latest`, harmless).

## Non-goals (PR A)

No `src/` change beyond what the build needs. No `extensions/copilot` change. No new version number. No release.

## Execution

Worktree `../wt-1146-build`, branch `port/1146-pnpm-build`, DRAFT PR, gates + founder eyeball before merge (no merge without full confidence). Slices in order: build/ copy + intents → root manifests → install + locks → typecheck/compile → CI + docs → tests + launch → PR.
