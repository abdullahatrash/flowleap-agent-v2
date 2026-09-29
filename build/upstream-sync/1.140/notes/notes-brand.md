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
