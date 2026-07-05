# PRD 0004 · Remove the agentHost runtime and dead GitHub surfaces

Status: ready-for-agent · Tracker: #60 (umbrella) · Prerequisites: PRD 0003 (decouple wave, executed), #60 first pass (commits `588287d25a6`…`e6865267bab`)

## Problem Statement

FlowLeap Patent AI still ships the entire GitHub Copilot CLI runtime (`platform/agentHost`, ~1,026 TypeScript files) plus GitHub-dependent surfaces (PR review comments, PR checks, PR icons/hovers, cloud-agent listing, dev-tunnel transport) that **cannot function in this product**: the auth service reports no GitHub sessions by design and `getCopilotToken()` throws. Today this machinery is only *neutralized* — setting defaults keep it dormant (`chat.agentHost.enabled` false, Copilot picker rows hidden, tunnel toggle deleted). For the user nothing works behind those remnants; for maintainers and agents the dead tree slows builds and searches, invites accidental reactivation, keeps Copilot-branded strings alive, and makes every future Agents-window change reason about code paths that can never run.

## Solution

Delete the agentHost runtime and the GitHub-dependent session surfaces in independently landable slices, preserving the working core of the Agents window: Claude sessions on native Claude credentials, the Local (BYOK) session type, git worktree isolation, branch picker, Changes/Files panes, apply-commits-to-parent-repo, and the sessions terminal. Because setting defaults already keep all removed machinery dormant, a correct slice produces **zero visible behavior change** — the acceptance bar is "nothing changed, minus the dead weight".

## User Stories

1. As a patent professional, I want the Agents window to contain no GitHub Copilot remnants (labels, quota strings, permission hovers, sign-in affordances), so that the product never asks me for an account that cannot work.
2. As a patent professional, I want the session-type picker to only ever offer working harnesses (Claude, Local), so that I cannot select a dead end.
3. As a patent professional, I want the workspace picker free of GitHub-repository browse entries, so that I am not led into cloud sessions that require Copilot.
4. As a patent professional, I want the session list free of PR icons, PR check rows, and PR review banners that always render empty, so that the UI communicates only what the product can do.
5. As a patent professional, I want no background agent-host process ever spawned on my machine, so that the app uses less memory and exposes no unused local server.
6. As a patent professional, I want the settings UI free of agent-host / Copilot-CLI settings that do nothing, so that configuration stays comprehensible.
7. As a FlowLeap maintainer, I want `platform/agentHost` deleted rather than gated, so that a settings flip or experiment override can never resurrect a Copilot runtime in a shipped build.
8. As a FlowLeap maintainer, I want the sessions GitHub layer (API client, PR models, icon caches, review service, checks view model) deleted, so that no code depends on GitHub auth that the auth service can never grant.
9. As a FlowLeap maintainer, I want the dev-tunnel transport and shared-process tunnel channels removed, so that the shared process hosts no services that require GitHub/Microsoft tokens.
10. As a FlowLeap maintainer, I want the main-process agent-host starter and its debug-port plumbing (`--inspect-agenthost`) removed, so that launch configuration matches what actually runs.
11. As a FlowLeap maintainer, I want the session model's GitHub-info surface neutralized at one seam, so that adapters and change-sets stop threading PR state that is always undefined.
12. As a FlowLeap maintainer, I want each slice independently landable and revertable, so that concurrent agents can share the working tree without conflicts (stage only your slice's files).
13. As an implementing agent, I want an explicit keep-list, so that I never over-delete the features that make the window valuable (isolation, Changes/Files, terminal, Local + Claude types).
14. As an implementing agent, I want compile gates plus a scripted live smoke per slice, so that I can prove "no behavior change" without a human in the loop.
15. As an implementing agent, I want Copilot-branded strings in surviving machinery rebranded to FlowLeap voice in a final pass, so that string churn does not conflict with deletion slices.
16. As a future agent reading git history, I want each slice's commit message to name what was deleted and why it was unreachable, so that archaeology stays cheap.

## Implementation Decisions

- **Slice order** (each slice = one issue, independently landable; later slices depend on earlier ones only where stated):
  1. **Sessions-window agent-host providers** — delete the local and remote agent-host sessions providers, their contributions, skill buttons, GitHub-info helper, and tests. They never register (`chat.agentHost.enabled` defaults false). Removes many consumers of the GitHub layer ahead of slice 5.
  2. **Workbench agent-host UI** — delete the agent-host chat contribution, terminal contribution, working-directory resolver, delegation participant, prompt contribution, session-target-picker branches, and the input-picker width entries that reference agent-host actions. The editor-window chat must keep working with Local + Claude only.
  3. **Process wiring** — remove the electron-main agent-host starter, shared-process agent-host + tunnel channels, the tunnel relay transport, and the `--inspect-agenthost` CLI/debug plumbing.
  4. **Platform tree deletion** — delete `platform/agentHost` entirely, including its configuration registration (the settings this wave made default-off) and policy wiring. After this slice no source file may import from the tree.
  5. **Sessions GitHub layer** — delete the sessions GitHub contribution (API client, PR models/fetchers, icon status/cache, PR actions/hover), the code-review service (PR review comments), the Changes-view checks (CI status) view model and actions, and the GitHub dependencies of session input banners and change-sets. Neutralize the session model's GitHub-info surface at the session-interface seam (drop the field and its plumbing rather than returning permanent undefined).
  6. **String rebrand** — surviving sessions machinery drops Copilot-branded user-visible strings (provider labels already done; quota strings, permission hovers, misc). All user-visible strings stay externalized via the localization framework.
- **Keep-list (explicit, out of every slice's blast radius):** git worktree isolation + isolation picker, branch picker, Changes/Files panes, apply-commits-to-parent-repo, sessions terminal contribution (its agent-host task runner goes in slice 2), Local session type (BYOK chat), Claude session type and everything under the Claude chat-sessions implementation, the Customizations sidebar panes driven by the Claude customization provider.
- **No dead-config reintroduction:** defaults change in code registration only. `configurationDefaults` in product.json is inert on desktop (verified 2026-07-05) and must not be used.
- **`getCopilotToken()` keeps throwing** by design; no slice may add a dependency on it.
- Deletion of a registered setting must remove the registration and any policy reference together, so the settings UI and policy checker stay consistent.
- Where the multi-window sessions layer imports from `vs/workbench`, deletions must respect the layering rule (sessions may import workbench, never the reverse); run the layer checker on every slice.

## Testing Decisions

- A good test observes external behavior at the highest seam: the running Agents window (picker contents, a live Claude turn, session list state) and the running editor-window chat — not internal service wiring.
- **Per-slice gates (all required):** core typecheck, layer-validity check, extension typecheck **and esbuild** when the built-in extension is touched (typecheck does not catch bundler breakage), and the existing unit suites nearest the slice (sessions provider suite, sessions list/layout suites, Claude agent specs).
- **Per-slice live smoke (required, scripted via the repo launch skill):** launch the Agents window in a throwaway profile; verify the picker offers exactly Claude (default) + Local; run one live Claude turn and verify the rendered response **via screenshot or DOM query — never via accessibility snapshot alone** (a11y snapshots serve stale content for this window); verify no new console errors (pre-existing `listFromProviders … Canceled` noise excepted). For slice 2 also launch the normal workbench window and drive one editor-chat turn.
- Update, don't delete, count-style assertions in surviving suites (prior art: the session-type count assertions adjusted when the Cloud type was removed).
- Tests deleted with their subject need no replacement; tests of surviving behavior must keep passing unmodified wherever possible — a needed modification is a signal the slice changed behavior.

## Out of Scope

- Patent-session UX (PRD 0005).
- The `github.copilot.*` settings-namespace rename (deliberately deferred, separate PRD).
- Completions/NES folder deletion inside the built-in extension (pre-sliced plan lives with the decouple-wave issue).
- Any backend, website, or FlowLeap CLI changes.
- Langfuse/promptfoo observability rework.

## Further Notes

- Sizing: `platform/agentHost` ≈ 1,026 TS files with ~60 workbench and ~52 code/sessions referencing files — comparable to the PRD 0003 wave; do not attempt as a single change.
- Already landed ahead of this PRD (2026-07-05): Copilot picker rows hidden via code-level setting defaults, Claude un-gated from Copilot sign-in, Cloud session type + GitHub Repositories browse removed, sessions tunnel toggle + workbench tunnel-host service deleted, dormant Claude BYOK proxy + `/terminal` command deleted, orphaned repo picker deleted.
- The live Claude turn is proven working end-to-end (see #61's closing analysis) — a slice that breaks it is regressing, not surfacing pre-existing breakage.
