# notes-brand: PRD 0017 list B groups B4, B5, B6

Branch `spike/0017-ra-brand` (worktree branch spike/0017-ra-brand, base 443ed85db36). No edits under `src/vs/sessions/**` or `src/vs/platform/agentHost/**`.
tsgo: 1 error (the base error in copilotCliSessionType.ts). Layers check (`node build/checker/layersChecker.ts` with 12 GB heap; `npm run valid-layers-check` aborts on V8 heap here): pass. eslint on all changed files: clean.

## B4a patent-context-key (#20 f258aa3d2d2): re-applied, 190b0824d46
Files: browser/contextkeys.ts, browser/actions/helpActions.ts, contrib/{debug (breakpointsView, debug.contribution, debugCommands, debugEditorActions, debugStatus, debugViewlet, repl), scm, testing, timeline, outline, remote/tunnelView, extensions (Ctrl+Shift+X keybinding), chat/chatStatusEntry, chat/chatWidget, snippets/configureSnippets, welcomeGettingStarted (gettingStarted, gettingStartedService, gettingStartedContent)}.
How: `patentIdeMode` bound and set true in WorkbenchContextKeysHandler; every when/precondition gate from #20 added with `ContextKeyExpr.and(existing, Mode.toNegated())` on upstream's current code (debug views loop covers all current debug view registrations). Chat welcome titles and the "AI-powered patent analysis" welcome subtitle re-applied. gettingStartedContent carries the fork HEAD state (only the `patentSearchPriorArt` start entry; #92 later removed the other two). `configureSnippets.ts`: the fork's patent prompt-template picker (wires the restored `common/patent/patentPromptTemplates.ts`), plus upstream's exported `promoteActiveLanguage` kept because upstream's `configureSnippets.test.ts` imports it (dead in product).
Tests: chatStatusEntry.test sets patentIdeMode=false (the entry hides itself in patent mode). ChatStatusBarEntry, Configure Snippets, Getting Started: 16 pass.

## B4b patent-menubar-gates (#82 47d4f619ec1): re-applied, 76edab57333
Selection, Go, Terminal top-level menus gated in titlebar/menubar.contribution.ts. Sessions menubar Terminal gate NOT done (sessions tree).

## B4c patent-view-help-prune (#83 34e7571f418, PRD A17): re-applied, 614640b6194
Optional `when` on OpenCommandActionDescriptor (common/views.ts), composed in ViewsService; Extensions container row + Output view gated; Help hides Report Issue and View License. No new upstream view container with a View-menu row since the fork (checked openCommandActionDescriptor users).

## B4d custom-agent-icon (#135 1852ce01d01): re-applied, 91339d2ffde
Upstream has no custom-agent icon (CustomChatMode.icon returned constObservable(undefined)). `icon` header attribute threaded through PromptHeader, ICustomAgent, CustomChatMode, attribute schema, validator, autocompletion. Extension side (Patent Research provider emits name/icon) is in extensions/copilot, survives. Tests: 2 expectations updated + "header with icon" added; prompt suites 311 pass.

## B4 dd8ebe3e841 (#3): nothing to do (build/, extensions/).

## B5a rebrand-runtime-strings (#76 99720b8e769 + 6fa2c27dbee, #100 50efab55511 strings): re-applied, ba1d99b206b + e98afded638
How: script re-applies every localize string these commits changed, by key, where upstream still has the old text (100 strings). Where upstream reworded/moved, same rule by hand: model picker strings (moved to widget/input/modelPicker/*), tools list subtitle + CLI tool set, hook sections, empty-workspace tip, hook settings, defaultConfiguration description, `copilotcli` provider label, built-in provider tab fallback, setup footer `settingsWithoutLink`, assisted-permissions warning, Models editor sign-in. Rule used: "GitHub Copilot"/"Copilot" -> "FlowLeap"; Copilot CLI session type -> "CLI Agent"; "{0} Copilot" -> "{0}". Keys whose strings upstream deleted (approvals.default, preferAgentHost x2, plugin-removal dialog): subsumed.
Survey off (#100): no core change. #100 disabled the survey in extensions/copilot (surveyServiceImpl); that survives. Fork HEAD also kept all core survey registrations; core `survey.contribution` only opens on an extension trigger or a non-stable dev command (checked upstream 1.140: unchanged behaviour).
Tests re-derived (5c0012e9962 not re-applied): chatQuotaExceededPart, chatQuotaNotification, chatSetupGrowthSession, chatStatusDashboard (incl. aria-label selector), chatStatusEntry, promptValidator, modelPickerItems, chatErrorMessages, chatModelsWidget. Result: all pass except the one below.

## B5b patent-input-placeholders (#117 95176f3f8f6): re-applied, 076bc4c559c
Patent-voice per-mode placeholders at upstream's placeholder seam in chatInputEditorContrib (exported helper, test added); Problems status-bar counter not registered in patent mode. "No lone environment chip" is in sessions (sessionTypePicker): NOT done.

## B5c letterpress-and-open-in-agents (b4f7c37a75a): re-applied, cc8fe21e367
editorGroupWatermark.ts, 4 letterpress SVGs, openInAgents.css unchanged upstream since the fork point -> carry the fork version. editorgroupview.css: 80px sizing edited on upstream's file. Open in Agents widget: robot codicon class added. Chat Debug icon + copilot.png are in extensions/copilot (survive); product.json change survives.

## B5d robot-custom-agent-icon (59915b316fa): re-applied, b3668c466b4

## B6a mcp-gallery-flowleap-registry (#113 1a78cff4600): re-applied, 9ab6a3b275d + 8a1e1c9c62b
Product gallery negotiates the API version (FlowLeap registry serves v0); MCP "Learn more" -> flowleap.co/en/mcp. product.json keys survive. Upstream now owns mcpGalleryService.test.ts: the version-negotiation test is added as a new suite; the fork's `file:` fixture test is not re-added. McpGallery: 30 pass.

## B6b flowleap-default-marketplace (#114 b739038a3ac + 3e5305ded55 + 1d4f0fc5aca): re-applied, 3d3d5877156
Upstream has one seam `DEFAULT_PLUGIN_MARKETPLACE` (setting default + built-in source of the new unified customization marketplace). Set to `flowleap-ai/flowleap-plugins`; `isDefaultMarketplaceReference` pre-trusts it (after the strict-policy allowlist, so enterprise strict mode still wins); "Browse Skill Packs" button on the Skills section header; Open Marketplace defaults to Plugins (works with both the unified marketplace and plugin browse). Trust test added; customizationMarketplaceWorkbenchService.test re-pointed at the constant. Marketplace/customization suites: 518 pass.

## B6c customization-list-clipping (#144 ea8b26da9fd): partly (mostly subsumed), e203e9794ed
Subsumed: upstream sizes the customization, MCP, plugin lists and tools tree from `clientHeight` via `getCustomizationTreeContentHeight`. Only the tools gallery list still used the passed-in height: one-line fix.

## B6d mcp-list-action-state (#146 2a0e34af2c1 + 372009241b3): partly, ee93b3cd528
Re-applied: `getServerItemContextMenuActions` drops McpServerActions whose `hidden` is set (test added). Subsumed: inline start control (upstream rows render an inline Start button for stopped servers plus management actions and status). NOT done: mcp.json inputs load in sessions configurationService (sessions tree).

## B6e mcp-tools-in-tools-section (#147 6eef477e03e): re-applied, 752f196bb0e
The restored fork file `agentHostCustomizationToolSets.ts` was unwired. Tools section now renders from `getCustomizationToolSets` and counts the same list; `countEnabledCustomizationTools` skips sets by the shared `isCustomizationToolSet` rule (so the Agents Window counters, which pass the raw list, also count MCP groups). MCP rows: server label + MCP detail; header sentence. Widget's duplicate CLI tool list dropped (identical to the helper's). Count test added.

## Tests (final combined run of all touched suites)
1568 pass, 1 fail: ChatStatusDashboard "Enterprise Managed — PRU with credits used (compact)" asserts "Resets May 31 at" (date/timezone). It fails the same way without my changes (checked with a stash).
Plus separately: ChatModelsWidget / Model picker destinations / LanguageModels / ChatListRenderer / ChatSetup: 720 pass.

## Decisions needed
- B4a Configure Snippets: the fork replaced upstream's snippet picker with the patent prompt-template picker for command `workbench.action.openSnippets`. Re-applied as-is. Option: keep upstream's snippet picker and register the template picker as a separate command. Current choice = app behaves as today.
- B5a scope: remaining upstream "Copilot" strings (list below) left in place. Founder choice whether to extend the rule to the agent-host/Copilot-SDK settings descriptions in chat.shared.contribution.ts (~30) even though those settings are inert here.

## Unclassified fork changes
None. Every non-port fork commit since b0b6062a946 that touches a file I changed is on list A or B. Marker check (FlowLeap/patent lines at fork HEAD vs now) shows only items owned by other groups: B9 personal Claude skills / CLAUDE.md defaults in chat.shared.contribution.ts; B2 chatSetupContributions gates; B3 chatWidget BYOK nudges.

## Findings outside scope
- Sessions parts of my intents, for the Agents Window agent: #82 Terminal menu gate in sessions/browser/parts/menubar.contribution.ts; #117 lone environment chip in sessions sessionTypePicker; #146 mcp.json inputs via reload() in sessions/services/configuration/browser/configurationService.ts (+ test); #147 sessions counters (aiCustomizationOverviewView, customizationsToolbar.contribution) should pass `getCustomizationToolSets(...)` so the CLI Agent reference set is counted too; #76/6fa2c27dbee sessions strings.
- Remaining user-visible "Copilot" localize strings outside keep-out code (scan: 165 in 47 files, from 181 before). Most are in surfaces tied to kept-out or external features: agent-host / Copilot SDK settings descriptions (chat.shared.contribution ~30, agentSessionsConfiguration 5), voice mode (voiceSessionController 16, needs a Copilot plan), Copilot connectors (copilotConnectorsService 10, customizationMarketplaceInstallService 6), Copilot-home MCP migration (customizationMigration* 10, aiCustomizationManagementEditor 2), Copilot Global MCP config (platform/mcp 8, mcp contrib 4, refers to the real Copilot CLI files), agent-host harness intro/survey (copilotHarnessIntroduction, chatHarnessSwitchFeedbackSurveyService, agentHost*), chatEntitlementService plan names (9, fork left them too), terminal Copilot CLI hint (fork left), hookSchema (fork left), chatAccessibilityHelp (4), chatSpeechToText enterprise message, byokUtilityModelDefault "GitHub Copilot" option, gettingStartedContent Copilot setup step (hidden by !patentIdeMode). onboardingVariationA (3) belongs to the onboarding agent; `toggle.chatSignIn` "Copilot Sign In" belongs to #99 (onboarding/auth agent).
- `workbench/contrib/modernUI` (renamed styleOverrides): none of B4/B5/B6 touch it.
- `npm run valid-layers-check` aborts (V8) in this environment; direct run with `NODE_OPTIONS=--max-old-space-size=12288` passes.

# PRD 0027 PR B (1.146.0) — group `brand`

Branch `port/1146-brand`, checkpoint `932e66ca19e`. Upstream reference 69047191fc4 (1.146.0). One commit per intent plus a `kit — <id>` commit; patches regenerated from the committed diff.
tsgo: 53 errors, none in brand paths (all in agenthost/aw/chat files). `node build/checker/layersChecker.ts` (12 GB heap): pass; `pnpm run valid-layers-check` aborts on the tsc errors in `platform/agentHost/node/flowleapChatMirrorAgent.ts` (agenthost). eslint on every touched file: clean.

## B2 FlowLeap sign-in only — re-anchored (31-reapply-13)
Seam moved: the Accounts "Sign in to use GitHub Copilot" `when` is now the exported `ChatSetupFromAccountsWhen` constant (upstream 403b47d6984 dropped `completed.negate()`/`signedOut` from it); `PatentIdeContextKeys.Mode.negate()` appended there. The other seven gates (setup command, title-bar Sign In, Upgrade, Budget, editor Explain/Fix/Review, toggle label) applied with offsets. The `workbench.common.main.ts` registration of `patentAuth.contribution` is aw's (see Registrations).

## B1 onboarding wizard + walkthrough — re-derived (31-reapply-14)
Upstream's 4 commits on `onboardingVariationA.ts` (Microsoft sign-in probe, GHE host list via `services/accounts/common/githubEnterprise`) and the 268 new test lines are all inside the GitHub sign-in step the fork deleted, so the fork's five files are carried as-is (`onboardingVariationA.ts`, `onboardingTypes.ts` incl. its dead GHE helpers, `variationA.css`, the rewritten browser test, the fork-only `test/common/onboardingTypes.test.ts`). Upstream's css delta (microsoft provider mark) belongs to the deleted step: dropped. `patentWalkthrough.contribution` registration is aw's.

## B1b / B8a / B8b / B8c — applied as-is (31-reapply-18/15/16/17)
Verified on 1.146: `app.ts` channel registration still sits next to `sandboxHelper`; `paneCompositeBar.ts` ctor gained no new positional args (ActivityBarCompositeBar passes `productService` through; PaneCompositePart creates it via DI); `globalCompositeBar.ts` still decides Accounts/Manage by id (upstream's Codex account actions untouched).

## B4a patent context key — re-anchored (31-reapply-32)
18 of 22 files applied as-is. Re-anchored: `chatWidget.ts` (import moved, welcome titles block intact), `testing.contribution.ts` (three `when`s), `timeline.contribution.ts` (upstream removed the pane descriptor's `when`; the fork gate is now `readonly when = Mode.toNegated()` on `TimelinePaneDescriptor`), `gettingStartedContent.ts` (upstream deleted the "Generate New Workspace" entry; the other gates, the `patentSearchPriorArt` entry and the walkthrough gates re-applied).

## B4b / B4c — applied as-is (31-reapply-33/34); B4c's extensions.contribution hunk sits on top of B4a's keybinding gate.

## B4d custom agent icon — re-derived (31-reapply-35)
`icon` is now one more row in `customAgentAttributes` (schema-driven validation) plus `allAttributeNames[agent]` and the `getAttributeDescription` switch; `PromptHeader.icon`, `ICustomAgent.icon`, `CustomAgent.fromParsedPromptFile` spreads it; `CustomChatMode` keeps an `_iconObservable` (constObservable(undefined) gone). Tests: autocompletion list, "Supported:" hint, new "header with icon" case.

## B5a rebrand runtime strings — re-derived as a key-table sweep (31-reapply-36; 46 and 37-d7 subsumed)
`tools/rebrand-strings.json` (160 key→string rows extracted from the three 1.140 patches) and `tools/rebrand-strings.ts` rewrite literals by nls key: 98 applied, 8 reworded (3 a11y-help strings re-voiced by hand; 5 `signIn` keys are now upstream's neutral "Sign In"), 17 gone (deleted picker/handoff/settings keys), 46 skipped in aw/agenthost files (`chat.shared.contribution.ts` 45 of which, `sessionTypeAvailability.ts`, `agentSessionsConfiguration.ts`, sessions, platform/agentHost). New upstream reachable string re-voiced: `chat.modelPicker.noModelsUpgradeMessage`. Left: "Copilot Fusion {0}" tier label (Copilot-only routing), the ~160 Copilot strings in kept-out surfaces listed in the 1.140 notes. `chatSetup.test.ts` upgrade-URL expectations (product.json `flowleap.patent-ai`) folded into this commit; `33-test-rederive.patch` untouched (sessions customizationsToolbar = aw/B6e-subsumed; agentSessionsDraftHandoff strings gone upstream; sessionTargetPickerActionItem depends on aw's `sessionTypeAvailability` strings).

## B5b patent input placeholders — re-anchored (31-reapply-37)
Fork-only `chat/common/widget/patentInputPlaceholder.ts` is the helper (03800aba03c); one line at the 1.146 placeholder seam in `InputEditorDecorations.updateInputPlaceholderDecoration` plus the injected `IContextKeyService`; fork test suite re-added on upstream's test file; Problems counter early return in `markers.contribution.ts` applied as-is.

## B5c letterpress + Open in Agents — re-derived (31-reapply-38)
Upstream's watermark redesign (icon action bar, keybinding required per row). Fork intent re-expressed: `openChat` without the chat-setup gate, new `showExplorer` entry, "Search Files", empty window = Open Chat / Open Recent / Show Files / Search Files, workspace = Open Chat / Show Files / Search Files / Find in Files / Show All Commands; `WatermarkActionViewItem` takes an optional keybinding (no keybinding filter). 80px letterpress on upstream's css (the `.part-grid-slot-watermark` selectors kept); fork SVGs carried; robot codicon on the title-bar widget (`openInAgents.css` fork block on upstream's new file).

## B5d robot custom agent icon — applied as-is (31-reapply-39).
## B17 FlowLeap account avatar (d48dfc464d4) — applied as-is by hand (31-reapply-53): `getDefaultAccountAvatarIcon` falls back to the `flowleap` provider account; test added.
## B16 hosted web client (#547/#548/#520) — re-anchored (31-reapply-52)
The fork hunks on `web.api.ts` (`IHostedUserDataOptions`, `hostedUserData`, `remoteAccessViewer`), `web.main.ts`, `code/browser/workbench/workbench.ts` (+`callback.html`), `secretStorageService.ts`, `storageService.ts` (protected `workspace`/`logService`, `createStorageDatabase` hook, exported `IIndexedDBStorageDatabase`), `fileUserDataProvider.ts` (+test) and the three `server/node` files all apply on 1.146 with offsets (upstream's `BrowserResourceService`/`CanonicalUriService` additions sit elsewhere in `web.main.ts`). Restored fork-only files (`hostedStorageService.ts`, `hostedSecretStorageProvider.ts`, `secretStorageCrypto.ts`, tests, `correlatingInMemoryFileSystemProvider.ts`) compile unchanged. `workbench.web.main.ts` registration of `patentHostedSession.web.contribution` is aw's.
## B18 `flowleapVersion` product field (1e5232dd7f2) — applied (31-reapply-54), asked for by agenthost.
## D7 media-preview — done (11-media-preview-core.sh): extension deleted, build lists/workspace/changedFiles updated, worker entry restored, `extensions/pnpm-lock.yaml` refreshed; core `mediaPreview.contribution` is registered by upstream's `workbench.common.main.ts`.
## Build leftovers (12-build-leftovers.sh): i18n drops `welcomeAgentSessions` (patent/flowleapCli/remoteAccess kept; `vs/workbench/contrib/mediaPreview` already present); product.json webview host pinned to 69047191fc4 — CDN `index.html`/`fake.html` byte-identical to `pre/`, `service-worker.js` is the minified build of the same source. `linuxDesktopName`: gulpfile falls back to `applicationName` (`flowleap`), names unchanged, nothing set.
## Not done
- `pnpm run export-policy-data`: transpiles, then launches the app twice and both exports exit 1 (built-in extensions have no `out/` in this worktree: git-base, emmet, flowleap… fail to activate). Needs a built product; `policyData.jsonc` left as PR A regenerated it.
