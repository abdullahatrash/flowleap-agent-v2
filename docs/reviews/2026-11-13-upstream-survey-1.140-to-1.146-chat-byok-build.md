# Upstream survey 1.140.0 (480c6e142fa) .. 1.146.0 (69047191fc4): chat / seams / build

Date: 2026-11-13. Read-only. Range = 4,438 commits. Per area (no merges): contrib/chat 1,160; contrib/mcp 37;
workbench/api 80; aiCustomization 207; modelPicker 85; promptSyntax 49; chat/common/tools 16; canvases 36;
chatWindow 15; mediaPreview 8.

## A. Chat, MCP, API: classified

### A1. Must-have (security, BYOK/ext-host correctness, leak fixes)

Security (hash = reason):
- 0695d911316 2026-10-13 "MSRC fixes" (#341342). Non-agent-host parts the synced core gets for free:
  `base/common/resources.ts` isEqualOrParent now rejects backslash path tricks (win32 normalize before parent
  check) + `strings.ts` case-insensitive compare fix; `webview/browser/resourceLoading.ts` + `webviewElement.ts`
  resolve roots with the remote OS (path-traversal in webview resource loading); `terminal/browser/terminalInstance.ts`
  workspace-trust check hoisted into `_ensureWorkspaceTrustedForProcess` and applied on BOTH process-create paths
  (the second path skipped it); `platform/chat/common/chatSettings.ts` new `getChatSensitiveEditLocations`
  (hook/agent locations become confirm-before-edit; `VALID_PROMPT_FOLDER_PATTERN` now re-exported from here, so the
  fork's `.flowleap/` root patch in promptFileLocations.ts must keep the import); `mcp/common/mcpConfiguration.ts`
  + `mcpSandboxService.ts` sandbox schema with `allowGrants`; `mcpTypes.ts`. Agent-host parts (sessionPermissions,
  claudeAgent/codexAgent, agentHostSessionHandler) are relevant to the fork because the fork ships the Claude agent host.
- 3ac04f49fd8 2026-09-29 sanitize model ids in time-to-first-progress telemetry (chatUserInteractionTelemetry.ts).
  Must-have only in the sense that BYOK model ids (arbitrary strings) were sent raw; harmless to take.
- ccbfadeb451 2026-11-04 `platform/request/node/requestService.ts`: do not forward credentials across origins on
  redirects. Core request path used by BYOK fetches through the node request service: take.
- 9ea28e299ee 2026-10-09 defense in depth for webview resource loading; 8460a1ecda7 / 144aaa7de45 / 9d530daf090
  2026-11-04/05 check resolved paths, deny silently-failing resolutions, strict resolution + 404 (webview).
- 0aba719df98 2026-11-04 markdown preview: do not reuse script nonce, escape failed KaTeX math
  (`base/browser/markdownRenderer.ts`, `chatMarkdownContentPart.ts`, markdown-language-features preview-src).
- 04861ffbe8d 2026-10-09 command links in untrusted-workspace Markdown go through trustedDomainsValidator.
- fab0e01e6b7 2026-10-01 harden untrusted notification text (new eslint rule `code-no-legacy-notification-parsing`
  + `notificationMessage.ts`). The eslint rule will flag fork extension code that still uses legacy parsing.
- 59444e285e4 2026-11-03 full URI shown in the prompt URL confirmation dialog; 10d4431d5a5 escape prompt names in
  request decorations; d72d0f835c4 subagent edit markers no longer leak into output.
- 1356222d342 2026-10-19 marketplace protocol links need user confirmation; 1d68904be00 + dfc8718c28a strict plugin
  marketplace allowlists enforced only from managed settings (interacts with fork B6b `isDefaultMarketplaceReference`
  pre-trust: keep the fork's "after the strict-policy allowlist" ordering).
- 462715e3581 2026-10-28 mcp: managed allowlists take precedence over registry access (platform/mcp).
- Terminal auto-approve / sandbox: 4cb6f049942 (telemetry only), ad0f100a29a + 07225c7a78b masked env vars /
  credential masking settings, 33fd5cc3f4f managed sandbox host+fs restrictions, c7282ad3829 removes MXC sandbox for
  the Local harness (drops `@microsoft/mxc-sdk` dependency: fork package.json still lists it). Classification:
  must-have for the sandbox-settings schema; the MXC removal is a required cleanup for the dep diff (see C).
- Extension-side only (ideas for extensions/copilot, NOT synced): 4aaffdd2a66 require edit confirmation for
  configured agent/skill locations (`editFileToolUtils.tsx`), 17d89f42801 confirm before modifying chat memory
  (`memoryTool.tsx`), fb964648ff8 shell-argument injection in generated commit messages, 783a9e4af73 confirm agent
  edits to devcontainer config, fcf255ce3ba confirm hook settings edits. Port the two edit-confirmation ideas.

BYOK / extension-host chat correctness (core, synced wholesale):
- c1ce6113b81 2026-10-01 preserve reasoning across turns AND for custom providers (24 files; extHostLanguageModels +
  languageModels.ts + chat model). Must-have: Anthropic/OpenAI reasoning replay through vscode.lm providers.
- 0af48c2b0ba 2026-10-02 fail requests whose selected model is unavailable (no silent fallback to a Copilot model).
- f4a2106dc92 2026-10-08 preserve model options across duplicate provider groups (same vendor registered twice).
- 5042306fad0 2026-10-09 memory leak in ext-host language model providers; 8854342c970 leak in LM removal
  notifications; 0b9ae1f1ff9 leak in chat debug providers; 916049e0acb notify model config changes once per update.
- 7c1ba3f52dc 2026-10-07 picker: remembered model absent; be75dcb9bcc 2026-11-03 agent model configuration isolation
  and restoration; 0930e333ead custom agent model + reasoning preferences (prompt-file `model:` honored).
- d93a3848b5b 2026-10-13 share + rate-limit core utility model requests (title/summary requests through one path);
  new proposal `languageModelRateLimit` (LanguageModelError.RateLimited(retryAfter)) + `languageModelCapabilities`
  (apiType ChatCompletions/Responses/Messages, adaptiveThinking) in src/vscode-dts. The fork's providers should
  declare `apiType`/`adaptiveThinking` and throw RateLimited for 429s (distro enables these proposals: ab0c7b8db7a).
- 9ac22ae3616 2026-10-15 providers contribute an icon for the model picker (`modelProviderIcons.ts`): BYOK vendors
  (Anthropic/OpenAI/Gemini/Mistral/OpenRouter) can ship their own icon.
- 0088fae3aa2 2026-11-05 recently-used model list removed; 625cef07493 pins shared across editor + Agents windows.
- 83acb7dc514 2026-10-16 keep contributed tool sets whose members register late (fork patent tool sets register
  from an extension after activation: must-have).
- 3a5dda6ed72 2026-10-01 do not cache prompt discovery results from a cancelled scan; 76cf4ac8bd6 refresh extension
  prompt files after updates (fork ships 17 bundled skills from the extension).
- 0f2282b73a3 2026-11-09 fixed context windows shown without "Max" prefix (context gauge for BYOK models).
- 69047191fc4 2026-11-11 release/1.146 port: `base/common/htmlContent.ts`, `base/node/unc.ts` (UNC allow list),
  `extHostMcp.ts` (33 lines), `handleDialogBrowserTool.ts`, extension management allow-list checks. Take.

### A2. Nice-to-have UI (fork may want; no correctness risk)
- 09ab182715d 2026-10-07 old model picker deleted; tabbed picker is the only picker (see B3e/B5a below).
- bd2ba5565df tabbed picker overflow with many providers (BYOK users have 5-6 vendors: take).
- 7394117d44c + 40ae292f957 attachments as inline draggable pills in the prompt; 787c48d1638 response images open
  in a carousel; e0a99e0bcf2 `<br>` in markdown table cells.
- 88f9a3afea7 2026-11-06 customizations organized by scope (workspace/user/extension) in the Customizations editor.
- 45fb4b29cb9 + 33979cc334a customizations multi-root aware; f2460c8a584 discover parent customizations from Git
  worktrees (fork runs worktree-per-agent live runs: useful).
- 37b0141b684 custom agent skill suggestions; f983ac4f719 empty skill inventories; 395e625a57d / 5b7277ed430
  agent files use harness tool inventories and model catalogues (makes the `tools:`/`model:` validators harness-aware;
  B4d `icon` attribute must be threaded into the new per-harness attribute tables).
- 47ad840afb9 input font size follows chat font size; 83b2d78545b long agent questions in one scroll area.
- 2d7c85305a7 MCP + plugin discovery moved to Customizations; bbf5ce6e550 legacy MCP links redirect there;
  980571ce84e MCP server config edit form; 6746cf22ca2 gallery catalog totals vs page counts; 1f871d21f97 registry
  servers at slash-terminated URLs (FlowLeap registry: check trailing slash); b974cae9a8c gallery account errors.
- 23447db4fdb / d9368fe4f31 / 8c00dcbe4de Browse (marketplace) rendering as sources load, stable during refresh;
  b9cd8afe75d marketplace source errors as notifications; 0b6f7e4c055 plugin skill links; 8f3ba768d15 installed plugin
  locations; fcdfa8f173b plugin repository provenance; 00edd711488 marketplace + connectors as previews.
- e7d9908a81d 2026-10-20 `extensions/media-preview` deleted in favor of core `contrib/mediaPreview` (registered in
  workbench.common.main.ts). The fork's `build/npm/dirs.ts:37` and `build/gulpfile.extensions.ts:72` still list
  media-preview: when core is synced, delete the extension and the two build entries, else image/audio/video previews
  are registered twice.
- New `contrib/modernUI/electron-browser/frostedGlass.contribution.ts` (e8a1531a9c8): frosted-glass overlays, safe
  fallbacks; cosmetic.
- Unattended restart for updates (e5568db9284, `services/lifecycle/common/unattendedRestart.ts`): relevant to ADR 0008
  silent updates; opt-in setting.

### A3. Irrelevant (Copilot/GitHub/Codex/agent-host-Copilot only)
- Copilot Fusion / HydraFusion / Auto tiers / Ensemble (~35 commits in modelPicker, e.g. 3261d9c5081, 609ee52dea3,
  5f5ee3e4627 model routers): all gated on the Copilot vendor; dead under BYOK but they churn modelPickerWidget.ts
  (46 commits) and modelPickerItems.ts, so fork patches there re-anchor.
- chatSetup: 3daf19a04b5 restore Copilot sign-in / defer ChatGPT UI; c46161fa184 Microsoft sign-in via Entra;
  e9cfa3dce9a multiple enterprise hosts (deleted `welcomeOnboarding/test/common/onboardingTypes.test.ts`, the fork's
  B1 test file: re-create it as a fork-only test); 403b47d6984 removes workspace generation flows.
- Quota/entitlement: d4d88977430 Codex usage in status bar; 4eb4c8d0621 Copilot continuation near ChatGPT limits;
  acb9c660323 Codex continuation; 3ba782e19cd Agent Host defaults across entry points. chatEntitlementService.ts
  keeps `clientByokEnabled` / `hasByokModels` / `onDidChangeAnonymous` (chatWidget.ts:769,1599,3042): B3a seam alive.
- Copilot connectors (1c3667afe87, 326cc93135c), GitHub Feed plugin (08f3be916e5), Copilot CLI shim (A/C below),
  Mission Control, sessions Inbox, canvases (`contrib/canvases`, agent-host artifacts, desktop-only registration
  `editorCanvases.contribution.js`), `contrib/chatWindow` (registered only from `src/vs/sessions/sessions.common.main.ts`:
  Agents window parts, c8110cefee9/7ea5245eb79), spotlight tour `chat/browser/onboarding/chatInputSpotlightTour.js`
  (22308219d39, Copilot harness only; registered in workbench.common.main.ts: gate or keep out like modelPickerTryout).
- Chat memory tool, voice mode (24fd95e49d3 OpenAI BYOK voice mode is BYOK-ish but needs the extension side).

### A4. Prompt roots and skills at 1.146.0 (fork adds `.flowleap/`)
`promptFileLocations.ts` still has `.github`, `.claude` (agents, rules, skills, settings.json), `.agents/skills`,
`~/.copilot/skills`, `~/.claude/skills` in `DEFAULT_SKILL_SOURCE_FOLDERS` (lines 173-178). Settings `chat.useClaudeMdFile`
(PromptsConfig.USE_CLAUDE_MD, chat.shared.contribution.ts:2175) and `chat.agentSkillsLocations` (line 2232, default
built from DEFAULT_SKILL_SOURCE_FOLDERS) exist: B9a/B9b seams intact. New: `.claude/settings.local.json` (hooks),
`promptFilesLocator.ts:423` excludes `.claude/` paths for some harness; `chat.agentFilesLocations` and
`chat.hookFilesLocations` are now "sensitive edit locations" (MSRC). The fork's `.flowleap/` root must be added to
`getChatSensitiveEditLocations` consumers if its agents/hooks should be edit-confirmed.

## B. Fork seams at 1.146.0 (file exists? seam exists?)

Legend: FILE = upstream file present; SEAM = patch's removed/context lines still found (n/m anchors).

| Seam | FILE | SEAM | Notes |
|---|---|---|---|
| B2 flowleap-sign-in-only | yes | 9/9 | chatSetupContributions.ts 1 commit (403b47d6984). Re-apply as-is. |
| B1 onboarding wizard | yes | 258/270 | onboardingVariationA.ts 4 upstream commits (Entra sign-in, enterprise hosts, nls keys, AH defaults) all in GitHub sign-in code the fork deletes. `test/common/onboardingTypes.test.ts` DELETED upstream (e9cfa3dce9a): keep as fork-only file. |
| B1b flowleap cli main service | yes | add-only | app.ts 18 commits; the IPC-channel insertion point is additive. |
| B8a light theme default | yes | 1/1, 1/1 | 0 upstream commits on both files. |
| B8b hide developer surfaces | yes | 1/1, 2/2 | paneCompositeBar.ts 2 commits, anchors intact. |
| B8c command palette icon | yes | 4/4 | globalCompositeBar.ts 1 commit. |
| B3a byok nudge | yes | 2/2 + 1/2 | chatWidget.ts 58 commits; only the import line moved. `hasByokModels` listener + `renderWelcomeViewContentIfNeeded` still there (lines 769, 1694, 3042). |
| B3b byok rejected key | yes | add-only | chatErrorMessages.ts 1 commit. |
| B3c per-model token totals | yes | 1/1 | mainThreadChatAgents2 setUsage path intact; extHost.protocol.ts 28 commits (additive). |
| B3d chat ext always enabled | yes | add-only | `_isDisabledByUnification` still at extensionEnablementService.ts:670; product.ts 2 commits. |
| B3e no-model way out | PARTIAL | 2/8 | `modelPickerItemSections.ts` and `modelPickerItemTypes.ts` DELETED (09ab182715d). Picker half must be re-done in `modelPickerWidget.ts` (SetupRequired/"No models available" at lines 904-962, `ModelPickerUnavailableReason` in `modelPickerPresentation.ts:165`). chatWidget half intact (missing anchors are the fork's own B3a lines). |
| B9a claude.md off | yes | 1/1 | setting still registered (line 2175). |
| B9b personal claude skills off | yes | 1/1 | default now derived from DEFAULT_SKILL_SOURCE_FOLDERS; override `~/.claude/skills` to false in the same object. |
| B9c recommended default sonnet | yes | 1/2 | `getDeclaredDefaultModel` still at chatInputPart.ts:1232 (import line churned); modelSelection.ts 2 commits. |
| B10a subagent header ext-host | yes | all | extHostTypeConverters 0 commits; runSubagentTool 3. |
| B10b tree find description | yes | 2/2 | |
| B10c files from disk | yes | add-only | chatContext.ts 4 commits. |
| B10d chat output zero height | yes | 1/1 | 0 commits. |
| B10e provider agents unbacked URIs | yes | 1/1 | `CustomizationHarnessServiceBase` ctor still `(staticHarnesses, defaultHarness, promptsService)` (line 664): optional 4th `fileService` arg still fits; `parseNew` calls at 827/850. 13 commits on the file. |
| B4a patent context key (22 files) | yes | all but 2 | timeline.contribution.ts: `when` now `ContextKeyExpr.and(ResourceContextKey.HasResource, TimelineHasProviderContext)` (line 99); gettingStartedContent.ts Copilot step `when` reworded (line ~217). Re-anchor those two; chatWidget 1/1. |
| B4b menubar gates | yes | add-only | 0 commits. |
| B4c view/help prune | yes | 2/2 | views.ts 1 commit, viewsService 1. |
| B4d custom agent icon | yes | 0/3 | chatModes.ts `constObservable(undefined)` gone; promptValidator per-type attribute table reshaped (harness-aware, 395e625a57d/5b7277ed430); promptsServiceImpl return object reshaped. Re-derive on the new attribute tables. |
| B5a rebrand strings (43 files) | yes (1 gone) | ~90% | Gone: modelPickerItemSections.ts. Reworded: toolsListWidget CLI set strings moved to `agentHost/copilotCliBuiltinToolSet.ts:61`; agentSessionsActions.ts handoff strings deleted; chatTipCatalog "Copilot CLI" tip reworded; modelPickerTabs builtInProvider fallback moved; chat.shared.contribution 2 of 15 moved. `setupRequiredHover` "Sign in to GitHub Copilot" still at modelPickerActionItem.ts:246; picker aria "sign in to use Copilot" at modelPickerWidget.ts:962. Re-run the string script. |
| B5b input placeholders | yes | 1/1, 3/3 | |
| B5c letterpress / open in agents | yes | 16/28 | editorGroupWatermark.ts 4 commits (empty-state redesign 2e68dd0b645/6e702205353, d41a36a4d8d hides Open Chat when chat disabled). Re-derive on new entry list. |
| B5d robot icon | yes | 1/1 | |
| B6a mcp gallery flowleap registry | yes | 1/1, 1/1 | mcpGalleryManifestService.ts 0 commits; mcpListWidget 44 commits but the "Learn more" anchor intact. Check 1f871d21f97 (slash-terminated URLs) against the FlowLeap registry. |
| B6b flowleap default marketplace | yes | 1/2 | `DEFAULT_PLUGIN_MARKETPLACE` still `'github/awesome-copilot#marketplace'` (marketplaceReference.ts:18); Open Marketplace default section line now at aiCustomizationManagement.contribution.ts:912; `isDefaultMarketplaceReference` + dfc8718c28a managed-only strict allowlist. |
| B6c list clipping | yes | 0/1 | `_galleryList.layout(... height - galleryOffset)` line gone: likely subsumed (1765367ee65 scrollable lists fix). Verify, then drop. |
| B6d mcp list action state | yes | 2/3 | `getServerItemContextMenuActions` now takes 4 args (line 1887) and already filters hidden/local-enablement actions: re-check whether the fork's `hidden` filter is subsumed. |
| B6e mcp tools in tools section | fork file gone | 4/55 | Fork's restored `agentHostCustomizationToolSets.ts` never existed upstream; upstream now has `agentHost/copilotCliBuiltinToolSet.ts` with `getCustomizationToolSets` (d7d2fd6929d 2026-10-25) and toolsListWidget uses it (lines 51, 673, 820). SUBSUMED in shape: drop the fork helper, re-express the MCP-group rule on `getCustomizationToolSets`/`countEnabledCustomizationTools`. |
| 37 d7 reachable Copilot strings | yes | ~70% | chatAccessibilityHelp 3/4 strings reworded; chat.shared.contribution 22/31; agentHostStarter.config 1/2; sessions a11y help 0/1. Re-run the script by key. |

Keep-out watch (new registrations in `workbench.common.main.ts` since 1.140): `chat/browser/onboarding/chatInputSpotlightTour.js`
(Copilot harness tour), `services/github/electron-browser/githubService.js` (desktop), `platform/agentHost/electron-browser/
agentHostMcpOAuthMetadataService.js`, `platform/artifactIntegrations`, `contrib/mediaPreview`, `contrib/canvases` (desktop),
`contrib/modernUI/electron-browser/frostedGlass.contribution.js`; removed: `welcomeAgentSessions`, `copilotConnectorsRequestService`,
`canonicalUriService` (moved). `../sessions/common/theme.js` became `./common/agentsColors.js` (B8/brand colors may reference it).

## C. Build and packaging

### C1. Package manager: upstream is pnpm 12 only
- ae153038247 2026-11-02 "move to pnpm12" (#344791): `packageManager: pnpm@12.16.0`; `.npmrc` DELETED at root and
  remote/; `pnpm-workspace.yaml` (14 members incl. scripts, test/*, .eslint-plugin-local, vscode-selfhost-*),
  `.pnpmfile.mjs` -> `build/npm/pnpm/nativeBuildEnv.ts` (passes `nativeBuild` as npm_config_* to every dependency
  install script; `pnpm ci` frozen flag forwarded to separate roots). `minimumReleaseAge: 10080` with an exclude list
  (`@anthropic-ai/*` is excluded, so Claude SDK bumps land immediately).
- cce800b9d37 2026-11-04 native build targets moved from `.npmrc` to `package.json#nativeBuild`
  (`{runtime: electron, target: 43.8.6, disturl, msBuildId: 15893748, buildFromSource: true}`); `build/lib/electronVersion.ts`
  reads it (`readNativeBuildConfig`); `build/lib/electron.ts` serves `SHASUMS256.txt` from `build/checksums/electron.txt`
  (c39671bcaa0) and uses `electronChecksumFile`.
- Electron: 1.140.0 was 43.7.3; d6e20fdc019 2026-10-23 -> 43.8.3; 98e4ad8fbc8 2026-11-03 -> 43.8.6 (what 1.146.0 ships).
  Node `.nvmrc` 24.18.0 -> 24.22.1. `src/mainImpl.ts`: `regionalLocale` passed to startup, `UpdateCompositorMemoryPolicyOnScreenChange`
  feature added, `HideCursorWhileTyping` disable removed (fork patch 42-build-mainimpl-entry must re-anchor).
- Separate pnpm roots now: `build/`, `remote/`, `extensions/` (1099e28757d own workspace + `extensions/package.json`
  + `extensions/pnpm-lock.yaml`), `extensions/copilot/` (own lock). `build/npm/gyp` DELETED (e7dcb4b5838: headers via
  pnpm's node-gyp, `build/npm/nodeGypHeaders.ts`); `build/npm/installWithoutSaving.ts` new; `install-fast` and the
  install-state fast path removed (a8cd7f0c314); npm->pnpm conversion tooling removed (2f68fe29ab7).
- `build/npm/preinstall.ts` hard-fails under npm: `checkPackageManager(npm_config_user_agent, pinned)` returns
  "This repository uses pnpm. Run `pnpm install`." and throws (lines 48-51); also throws unless run via `pnpm run preinstall`
  when `npm_config_node_gyp` is unset (line 15). `build/npm/postinstall.ts` spawns `getPnpmCommand()` per separate root
  (`pnpmInstallAsync`) and requires `packageManager` to pin pnpm (line 78). `build/npm/dirs.ts` is now
  `workspaceMembers` + `separateRoots` (not a flat npm dirs list). `build/gulpfile.vscode.ts` reads versions from
  `pnpm-lock.yaml` via `build/lib/pnpmLock.ts#getLockedVersion` (replaces the `package-lock.json` read);
  `gulpfile.vscode.web.ts` uses `getFlatProductionDependencies` (remote/web is a member of the remote workspace).
  CI: `.github/actions/setup-pnpm` (pnpm/action-setup v6.1.0 reads `packageManager`), all pr-*.yml rewritten (+5.4k lines),
  `node_modules_cache/*` keyed on pnpm-lock.

What a fork that stays on npm + package-lock.json must do (verdict: staying on npm is possible only by NOT syncing
`build/npm/*`, `build/lib/pnpm*.ts`, `.pnpmfile.mjs`, workspace yamls, and by keeping its own `.npmrc`; everything
else in `build/` that the fork syncs must be patched):
1. Keep fork `.npmrc` (target 42.8.1 today; bump to 43.8.6 + ms_build_id 15893748 to match the synced `src/`; the fork's
   `package.json` still says electron 42.8.1 and version 1.127.0) OR adopt `package.json#nativeBuild` and port
   `build/lib/electronVersion.ts` to read it without `nativeBuildEnv.ts` (small: 40 lines).
2. Keep the fork's `build/npm/preinstall.ts`, `postinstall.ts`, `dirs.ts` (npm shape); do not take upstream's. Re-add the
   `build/npm/gyp` header install the fork relies on, because upstream deleted it.
3. Patch `build/gulpfile.vscode.ts`: replace `getLockedVersion('', pkg, root)` (pnpm-lock) with the old package-lock read;
   drop the Copilot shim block (`renderCopilotShimLauncher`, `resources/win32/bin/copilot.sh` -> `bin/copilot-shim/copilot`);
   keep `core-ci-pr` split (harmless). `gulpfile.vscode.web.ts`: revert to `getProductionDependencies` or keep a flat
   `remote/web/node_modules` (npm already installs flat). `gulpfile.extensions.ts`: upstream removed `media-preview` and
   `vscode-extras` entries and exported `createExtensionTasks` (fine to take; delete media-preview with it).
4. CI (`.github/workflows/flowleap-release.yml` uses `npm ci`, `cache: npm`, `npm run gulp ...`): nothing upstream to mirror
   except Node 24.22.1 in `.nvmrc`; do NOT copy upstream pr-*.yml. `build/flowleap/produce-claude-sdk.ts` reuses
   `build/agent-sdk/produce.ts#buildOne`: produce.ts is UNCHANGED in the range (only package.ts/upload.ts +2 lines, README).
5. `build/agent-sdk`: Claude Agent SDK 0.3.281 -> 0.3.304 (3fa345dbdaf 2026-10-21; also adds a beta flag in
   `platform/agentHost/node/claude/anthropicBetas.ts`); Codex SDK 0.142.0 -> 0.163.0 (3854f5e95f8; fork keeps Codex out,
   skip). `build/agent-sdk/agents/claude/package-lock.json` still exists upstream (the SDK sub-roots stay npm locks).
6. Root `package.json` is no longer `workspaces`-based; the fork's npm `workspaces` (if any) stay fork-owned.

### C2. moduleignore, dep-lists, signing, installers
- `build/.moduleignore` and `.moduleignore.drop`: 0 commits in the range. Nothing to mirror. But gulpfile.vscode.ts dropped
  the `foundry-local-sdk/foundry-local-core/**` + `@microsoft/mxc-sdk/bin/**` exclusions (MXC removed, foundry 2.x
  853a5db5e7e): if the fork keeps mxc-sdk in package.json it must keep the exclusion.
- `build/linux/rpm/dep-lists.ts`: +`libdl.so.2(GLIBC_2.3.3)(64bit)` (7e7e374944b, 6756a7371ee "for Copilot SDK"); debian
  dep-lists unchanged. Fork's dep-list guard (memory: Linux release leg #450) should add the rpm entry only if the
  agent-host binary needs it. add8003cb34 hardens the `dpkg-shlibdeps.pl` download; a58fdc7c54a Chromium scripts via
  GitHub API with fallbacks (build/linux/debian/calculate-deps): take both (fork builds deb/rpm in CI).
- Copilot CLI shim, keep OUT: 25f764abcdb / dfa3c12d23a / 07f69c5547a add `build/win32/copilot.iss` (+1,193 lines, `#include`d
  by `code.iss` under `#ifdef CopilotShim`), `resources/win32/bin/copilot.sh`, `resources/linux/copilot-link.sh` and
  `@@COPILOT_LINK_HELPER@@` placeholders in `resources/linux/debian/postinst.template`, `postrm.template`,
  `rpm/code.spec.template`, replaced by `gulpfile.vscode.linux.ts`. If the fork syncs `resources/linux/*` templates it must
  either carry the replace lines or strip the placeholder, else the deb/rpm post-scripts contain a literal `@@COPILOT_LINK_HELPER@@`.
  `code.iss` also changed the context-menu COM surrogate kill command (a0fba2a7fca) and `policies\*` recursesubdirs: take.
- Signing/notarization (fork has its own pipeline, electron-builder-style secrets): `build/darwin/sign.ts` (+137 lines:
  b8b6f56cf60 retry on Apple timestamp errors, 2b76d6829cc server binary signing retry, e0e50ddb02f notarization retry once
  on MacSignFailed, 65cb57ee3cf resubmit stalled ESRP) and `create-universal-app.ts` (14). These are ESRP-specific; the only
  portable idea is "retry notarization once". e5b6876dcb9 passes macOS developer certificate secrets through env in Azure
  YAML only. 419dc8780af Windows ESRP stuck-session fail-fast: n/a. `build/win32/code.iss` +29 lines (above).
- `build/gulpfile.vscode.ts` still reads `agentSdks` for packaging (fork relies on it; unchanged in the range).

### C3. package.json dependency diff (fork main vs upstream 1.146.0), packages synced `src/vs` imports
dependencies, version-diff (must follow core): `@vscode/diff 0.0.2-7 -> 0.0.2-128` (editor diff algorithm: core calls
new API, a3683a3c467/2b92153006c), `@vscode/policy-watcher ^1.4.0 -> ^1.7.0`, `@vscode/proxy-agent 0.45 -> 0.46`,
`@vscode/windows-process-tree 0.7 -> 0.8`, `@vscode/windows-registry 1.2 -> 1.3`, `@vscode/codicons 0.0.46-40 -> -49`
(new codicons used by core), all `@xterm/*` beta.285 -> beta.301-304, `node-pty beta.13 -> beta.18`, `tar 7.5.16 -> 7.5.20`,
`foundry-local-sdk 1.2.3 -> 2.2.1` (dictation runtime moved to per-user cache), `@microsoft/dev-tunnels-* 1.3.41 -> 1.3.61`,
`@github/copilot-sdk 1.0.15-preview.4 -> 1.0.30-preview.0` (agent host Copilot: fork keeps out; pin or drop).
dependencies, upstream-only: `@hpke/core ^1.9.0`, `libsodium-wrappers ^0.8.4` (47da279f730 "agentHost: seal client
tokens": `src/vs/platform/agentHost` imports them: REQUIRED if the agent-host tree is synced).
dependencies, fork-only: `@github/copilot ^1.0.65`, `@microsoft/mxc-sdk 0.8.0` (upstream removed MXC, c7282ad3829: drop).
devDependencies, upstream-only that `src/` or `build/` import: `@modelcontextprotocol/sdk ^1.29.0`, `js-yaml`/`@types/js-yaml`
(pnpm-lock reader in build/lib/pnpmLock.ts: skip if staying on npm), `@typescript/native npm:typescript@^7.0.2`
(replaces fork's `@typescript/native-preview`), `typescript` now `npm:@typescript/typescript6@^6.0.2`, `eslint 9.36 -> 10.8.0`
+ `@eslint/compat`, `@stylistic/eslint-plugin ^5.10.0` (replaces `@stylistic/eslint-plugin-ts`), `typescript-eslint 8.66.0`,
`eslint-plugin-jsdoc 63.3.3`, `c8`, `playwright 1.61.1` (declared at root 366f292cd74), `@vscode/gulp-vinyl-zip`, `vinyl-fs`,
`json-schema-to-typescript 16.0.0`, `typanion`, `buffer`/`events`/`readable-stream` (web bundle shims, e7807507069).
devDependencies, fork-only (upstream deleted as unused, 637713fc6dc/f38b6d8928a): `@types/debug`, `@types/eslint`,
`@types/gulp-svgmin`, `gulp-svgmin`, `@types/http-proxy-agent`, `@typescript-eslint/utils`, `@vscode/v8-heap-parser`,
`@vscode/vscode-perf`, `istanbul-*`, `merge-options`, `mime`, `os-browserify`, `pump`, `source-map`, `yaserver`, and
`electron@42.8.1` (upstream no longer lists electron in devDependencies at all; version lives in `nativeBuild`).
devDependencies, version-diff: `@anthropic-ai/claude-agent-sdk 0.3.281 -> 0.3.304`, `@openai/codex 0.142.0 -> 0.163.0`,
`@playwright/test 1.56.1 -> 1.61.1`, `@vscode/gulp-electron 1.42 -> 1.43`, `@vscode/test-web 0.0.76 -> 0.0.81`,
`@vscode/component-explorer* -161/-163`, `@vscode/telemetry-extractor 1.20.5`.
Note: `extensions/copilot` (fork-modified) has its own lock; upstream now installs chat-lib with the copilot workspace
(f692da244c9): not applicable to the fork's npm layout.

## Bottom line per area
- A: take core wholesale as before; the must-have list above is all inside `src/vs` except five extension-side ideas.
  The one structural change that breaks fork patches is the old model picker deletion (09ab182715d): B3e picker half and
  the B5a picker strings must be re-done on `modelPickerWidget.ts` / `modelPickerPresentation.ts`.
- B: 41 of 46 seams re-anchor cleanly; re-derive B3e (picker), B4d (attribute tables), B5c (watermark), B6e (use upstream
  `getCustomizationToolSets`), B6c/B6d (probably subsumed); one fork test file to resurrect (onboardingTypes.test.ts).
- C: do not sync `build/npm`, `build/lib/pnpm*.ts`, workspace yamls; patch gulpfile.vscode.ts (lock read + Copilot shim),
  strip `@@COPILOT_LINK_HELPER@@` from Linux templates, bump Electron to 43.8.6 + Node 24.22.1, bump the 23 runtime deps
  (notably `@vscode/diff`, `@xterm/*`, codicons, policy-watcher), add `@hpke/core` + `libsodium-wrappers`, drop mxc-sdk,
  delete `extensions/media-preview` + its two build entries, Claude SDK 0.3.304 in build/agent-sdk/agents/claude.
