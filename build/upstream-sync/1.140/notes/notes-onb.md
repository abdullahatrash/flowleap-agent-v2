# notes-onb — PRD 0017 v2 re-apply, groups B1, B2, B8

Branch `spike/0017-ra-onb` (worktree `branch spike/0017-ra-onb worktree`), base 443ed85db36.
tsgo after every commit: 1 error (base, `copilotCliSessionType.ts`, not mine). `layersChecker` passes
(needs `node --max-old-space-size=12000 build/checker/layersChecker.ts`; `npm run valid-layers-check` aborts on the default heap).

## B1 Onboarding and trial — re-applied
Commits: fe136431c56 `ra: B1 onboarding-wizard-and-walkthrough`, cad329e538c `ra: B1b flowleap-cli-main-service`.
Files: welcomeOnboarding/browser/onboardingVariationA.ts, common/onboardingTypes.ts, browser/media/variationA.css,
test/common/onboardingTypes.test.ts, test/browser/onboardingVariationA.test.ts, workbench/workbench.common.main.ts, code/electron-main/app.ts.
How: the fork rewrote these files (+809/-375 in onboardingVariationA.ts); upstream changed them only a little since the fork point
(remove the AgentSessions step, `_applyStepSelections` for the Personalize keymap, `_createInlineLink(href|undefined)` for the
GitHub disclaimer, semibold token). Every upstream delta touches code the fork intent removed or repurposed (GitHub sign-in hero +
disclaimer gone, Personalize not in the step list, AgentSessions kept as the patent "see it work" step). So the fork's intent files are
used as-is, plus upstream's one live delta (`font-weight: var(--vscode-fontWeight-semiBold)` on `.onboarding-a-theme-label`).
Covers role/trial/model/finale steps, finale copies the prompt, async sign-in + existing access, Trial filter, never touch the theme,
minimise for workbench UI, Subscribe offer (bbefeb5c7f1 src part), FlowLeap sign-in step (db5992d9a9c src part).
#92 (6776fe339c3): `patentWalkthrough.contribution` re-registered (command `flowleap.searchPriorArt`). The getting-started entry
list (remove New/Open Patent Project, keep "Search Prior Art...") lives in gettingStartedContent.ts, which B4 (f258aa3d2d2) owns; see
"Findings outside scope".
#66 (30d1f711c3f) non-sessions half: `IFlowLeapCliMainService` + `flowleapCli` IPC channel in app.ts (platform/flowleapCli files are
restored at the base). The renderer registration and the nudge are in sessions (other agent).
Keep-out move: `contrib/chat/browser/onboarding/modelPickerTryout.contribution` is not registered in workbench.common.main.ts. Reason:
its "Set Up Chat" button runs `CHAT_SETUP_ACTION_ID` (GitHub Copilot setup; `executeCommand` bypasses the B2 precondition) and its copy
sells Copilot premium-request billing. The tryout engine (`onboarding.contribution`, `onboardingTryout.contribution` web+desktop) and
`diffEditorTryout` stay registered: tryouts never auto-run (release-note / `tryout` URL only), do not collide with the wizard, and show
no sign-in.
Tests: `onboarding step ordering + visibility`, `roleToFirstInvestigation`, `decideTrialPoll`, `parseGheInstanceInput`: 28 pass.
Upstream `OnboardingVariationA` browser test asserted the GitHub sign-in disclaimer the fork removed; re-pointed to the FlowLeap seam
("opens on the Role step with the four role cards and no GitHub disclaimer"): pass. Grep "Onboarding|ChatSetup": 163 pass;
"onboarding|Onboarding|ModelPickerTryout": 237 pass, 0 fail.

## B2 Auth and FlowLeap sign-in — re-applied
Commit: ca4cec7280e `ra: B2 flowleap-sign-in-only`.
Files: chat/browser/chatSetup/chatSetupContributions.ts, workbench/workbench.common.main.ts.
How: `patentAuth.contribution` (FlowLeap Accounts CTA on `flowleap.signedOut`) re-registered. `!patentIdeMode` added to the GitHub
setup command precondition, the Accounts "Sign in to use GitHub Copilot" entry, title-bar Sign In (upstream now uses
`UpdateTitleBarEditorVisibleContext`; gate appended), Upgrade to Copilot Pro, Manage Copilot Budget, and editor Explain/Fix/Code Review.
Title-bar toggle reads "FlowLeap Sign In" (05cd3a14f73 src part). The rest of 05cd3a14f73 and db5992d9a9c is in extensions/ (untouched).
Depends on B4: `patentIdeMode` is only bound in workbench/browser/contextkeys.ts by B4 (f258aa3d2d2); until B4 lands the key is
undefined and the gates are open.
Tests: `ChatSetup*` suites in the 163-pass run above.

## B8 Theme and developer-surface defaults — re-applied
Commits: a0ebe5d0bf6 `ra: B8a light-2026-default-native-chrome-follows-theme`, f48cff4c8ea `ra: B8b hide-developer-surfaces-for-new-users`,
41104fd8f84 `ra: B8c command-palette-activity-bar-icon`.
B8a: `workbench.colorTheme` default = Light 2026 on all platforms (themeConfiguration.ts); `window.systemColorTheme` default = `auto`
(themes.contribution.ts). Code registration, not product.json.
B8b: `IProductConfiguration.defaultHiddenViewContainers` (base/common/product.ts) + `PaneCompositeBar` unpins listed containers when no
cached state exists (IProductService injected; `ActivityBarCompositeBar` passes it through). The list is already in product.json;
`git.enabled=false` is in extensions/git (untouched).
B8c: Command Palette item (`list-selection` icon) at index 0 of `GlobalCompositeBar`. Upstream's `toggleAccountsActivity` now decides by
item count; re-pointed to find Accounts/Manage by id so the extra item is safe. The sessions project bar also uses GlobalCompositeBar,
so the Agents window gets the icon too (same as the fork).
styleOverrides: no fork commit touched contrib/styleOverrides and no product.json key references it; nothing to map to modernUI.
Tests: new test "toggles Accounts below a leading Command Palette item" in globalCompositeBar.test.ts. Grep
"GlobalCompositeBar|AccountsActivityActionViewItem|ActivitybarPart|ActivityBar|PaneComposite|Theme": 76 pass, 0 fail.

## Decisions needed
- modelPickerTryout keep-out (above). Alternative: register it but gate its `setup` on `!patentIdeMode` and rebrand copy. Chose
  keep-out (closest to "behaves as today": the fork had no tryouts). The sessions entry point `sessions.common.main.ts` also imports it
  (other agent's file).
- Upstream `OnboardingVariationA` browser test rewritten (not deleted) to the FlowLeap Role step.

## Unclassified fork changes
None. Fork commits since b0b6062a946 on my files that are not in lists A/B are all `port(...)` commits
(0f921632884, 1507611c653, 4aa332e4ebb, 5db95d9aed6, 6f9c7419f3d, ac59e28e5ce), subsumed by the copy.

## Findings outside scope
- B4 owner: gettingStartedContent.ts must carry only the "Search Prior Art..." patent start entry (command `flowleap.searchPriorArt`,
  registered by B1); the New/Open Patent Project entries were removed by #92. B4 must also bind `patentIdeMode` (contextkeys.ts) for the
  B2 gates to act, and restore the chatStatus patent-mode early return that c383eab50b8 relied on.
- Rebrand/chat owners (B5): new upstream GitHub/Copilot sign-in copy in `widget/input/modelPicker/modelPickerItemSections.ts`
  ("Sign in to use Copilot...") and `modelPickerWidget.ts` placeholder; the fork had rebranded the equivalent in `chatModelPicker.ts`.
  New upstream `agentHost/agentHostSignedOutModelsNotification.ts` / `agentHostSdkSetupNotification.ts` (agent host kept out; check
  registration).
- Accounts menu: upstream adds Codex account actions (`createCodexAccountMenuActions`), shown only when the Codex agent-host setting is on
  (off by default; agent host kept out). No action taken.
