---
status: ready-for-agent
relates-to: docs/adr/0001-port-patent-agent-into-builtin-copilot-extension.md, docs/adr/0002-consolidate-auth-to-clerk-template-token.md, CONTEXT.md
---

# PRD: Migrate the Patent Agent into flowleap-agent-v2 (clean, single-repo)

## Problem Statement

Today the FlowLeap Patent IDE is built from two separate repos glued together by a fragile
one-way build script. The Patent Agent is developed in a standalone `vscode-copilot-chat`
fork and `sync-to-vscode.sh` copies a built artifact into the older VS Code fork
(`vscode`, 1.121), which has to **delete the upstream built-in copilot extension on every
merge** and scrub residual files to make room for it. On top of that sit several accreted
hacks: two unrelated sign-in flows fighting over one auth-provider id, a dead inference
proxy kept "just in case," patent customizations scattered into unrelated parts of the
workbench, and ~40 overlapping design docs.

As the maintainer, I want to start clean on a **current** VS Code base (1.127, where Copilot
Chat now ships in-tree) without re-importing any of that cruft — and I cannot do the whole
migration in one sitting, because the change spans hundreds of files across a 16-version
copilot gap and the work has to be reviewable in independent slices.

As a patent professional (the end user), I should not notice the plumbing change at all: the
same FlowLeap Patent IDE, the same sign-in, the same ~70 patent tools and Patent Skills, the
same BYOK model choice, and a seamless auto-update from my current install.

## Solution

A single clean fork, **flowleap-agent-v2**, on current VS Code. The Patent Agent is ported
**directly into the built-in `extensions/copilot` extension** as an additive `patentai`
overlay (ADR 0001), eliminating the second repo and the sync script entirely. Inference stays
**BYOK** (the user's own LLM key, no proxy); the paid **Patent-data Backend** (Clerk auth +
Polar subscription) is preserved and still gates the patent-data tools. Authentication is
collapsed to the **single Clerk template-token path** (ADR 0002). Product identity is reused
verbatim so existing installs auto-update in place.

The migration is delivered in **four independently-reviewable layers**, each sized to be
grabbed and executed by a separate agent in a fresh context, each ending at a compiling,
committable checkpoint:

- **Layer 1 — Shell & Brand:** product identity, FlowLeap Navy theme, FlowLeap UI Shell,
  language-extension pruning, icons/codicon glyphs.
- **Layer 2 — Patent Agent:** port `patentai`, the ~70 tools, the patent Skills, the agent
  intent, the patent system prompt, BYOK model surface, and the consolidated auth, onto
  copilot 0.55.
- **Layer 3 — Core Customizations:** patent context keys, patent prompt templates, the
  onboarding sign-in gate, and the final `product.json` chat/auth wiring, onto vscode 1.127.
- **Layer 4 — Verify:** build, launch, sign-in, and a patent chat turn end-to-end.

## User Stories

### Patent professional (end user)

1. As a patent professional, I want the app to launch branded as "Flow Leap" (window title, dock/taskbar, about box), so that it feels like the product I installed, not Code-OSS.
2. As a patent professional, I want the FlowLeap Navy theme available and the FlowLeap layout (activity bar on top, sidebar on the right, minimap off), so that the workspace matches the patent-focused experience.
3. As a patent professional, I want the FlowLeap sidebar (Projects), Home dashboard, and chat panel present, so that I can manage patent projects and converse with the agent.
4. As a patent professional, I do not want programming-language tooling for languages I never use (Go, Rust, Java, C++, C#, etc.) cluttering the IDE, so that the product stays focused on patent work.
5. As a patent professional, I want to sign in once through the FlowLeap website (Clerk) and have the app remember me, so that I can reach my subscription and patent-data tools.
6. As a patent professional, I want a single, unambiguous sign-in — not two competing "sign in" actions — so that I never end up half-authenticated.
7. As a patent professional, I want to bring my own LLM key (Anthropic, OpenAI, Gemini, etc.) and have inference run with it, so that I control my model and my inference costs.
8. As a patent professional, I want all ~70 patent tools available to the agent (EPO OPS search, USPTO search, citation analysis, legal/MPEP search, patent details/figures, claim analysis, PDF reading, academic search, write-results), so that I get the full research capability.
9. As a patent professional, I want the Patent Skills (Prior-Art Search, Claim Analysis, Freedom-to-Operate, Patent Landscape, Legal Research, Citation Analysis, Patent Translation, Audit Report, Patent Examination, Figure Analysis) invocable, so that I can run deep analysis workflows that produce deliverables.
10. As a patent professional, I want a Prior-Art Search to dedup by Patent Family and surface Relevance Categories (X/Y/A, plus P/E date-status), so that results read like real prior-art search output.
11. As a patent professional running a patent-data tool without an active subscription, I want a clear "start trial / upgrade" prompt rather than a silent failure, so that I understand why a result is gated.
12. As a patent professional whose session token has expired, I want the app to prompt me to sign in again transparently, so that my workflow resumes without cryptic errors.
13. As a patent professional, I want my existing install to auto-update into flowleap-agent-v2, so that I move to the new version without a manual reinstall.
14. As a patent professional, I want the first-run onboarding to require sign-in but always be cancelable (spinner + Cancel, never a trapped modal), so that I am never stuck on launch.

### Maintainer / developer

15. As the maintainer, I want the Patent Agent to live in one repo as an additive `patentai` overlay on the built-in copilot extension, so that there is no second repo and no sync step.
16. As the maintainer, I want `sync-to-vscode.sh` and the whole sync model gone, so that I stop maintaining the package.json minify-restore, the per-merge deletion of `extensions/copilot`, and the residual-file scrubbing.
17. As the maintainer, I want patent changes concentrated at a few well-named registration seams (tools registry, agent types, prompt include), so that upstream VS Code merges conflict in predictable, small places.
18. As the maintainer, I want patent core customizations placed in a dedicated patent area, not scattered into unrelated workbench contribs, so that the next merge and the next reader can find them.
19. As the maintainer, I want exactly one auth mechanism (the Clerk template token surfaced by one provider), so that nobody has to reason about a second OAuth-PKCE flow ever again.
20. As the maintainer, I want the dead inference proxy left behind entirely (not ported as a "no-key last resort"), so that there is no path by which inference could leave the user's machine.
21. As the maintainer, I want product identity reused verbatim (bundle id, `flowleap://` scheme, app GUIDs, asset names), so that the live backend, website, and Clerk redirect config need zero changes.
22. As the maintainer, I want the migration split into four layers that each compile and commit independently, so that no single agent session has to hold the whole change in context.
23. As the maintainer, I want a single consolidated documentation set (CONTEXT.md, ADRs, AGENTS.md) instead of ~40 overlapping design docs, so that the new repo starts with a clean source of truth.
24. As the maintainer, I want the version gap reconciled by re-applying the patent delta onto the newer base (not copy-pasting 0.39-era files), so that I inherit 16 versions of copilot improvements rather than fighting them.

### Migration agent (per-layer executor)

25. As a migration agent grabbing Layer 1, I want a precise prune-set computed by diffing the old fork's `extensions/` against v2's, so that I remove exactly what the old fork removed and keep what it kept.
26. As a migration agent, I want each "do not port" hack named explicitly with its clean replacement, so that I don't faithfully reproduce a bug.
27. As a migration agent grabbing Layer 2, I want the `patentai` overlay treated as self-contained, with the cross-version reconciliation limited to named seams, so that I know where 0.39→0.55 drift will actually bite.
28. As a migration agent grabbing Layer 3, I want the existing onboarding-gate state machine and auth/backend unit tests carried over as the regression net, so that I can prove behavior is preserved across the vscode version jump.
29. As a migration agent, I want a clear definition of done per layer (compiles, layer-check passes, relevant unit tests green, commit), so that I can hand off cleanly to the next layer.

### Billing / subscription

30. As the business, I want inference to be 100% BYOK with no proxy, so that we never pay for or carry liability on user inference.
31. As the business, I want the Patent-data Backend to remain subscription-gated via Clerk + Polar, so that the paid product (patent-data access) is what the subscription buys.
32. As the business, I want the 402-subscription-required and 401-reauth behaviors preserved at the single backend client seam, so that gating UX is consistent across every patent-data tool.

## Implementation Decisions

### Architecture (governing ADRs)

- **Single-repo overlay (ADR 0001).** The Patent Agent is ported into the built-in copilot
  extension as a `patentai` folder plus minimal touch-points. `vscode-copilot-chat` and
  `sync-to-vscode.sh` are retired and are **not** build inputs to the new fork.
- **One auth mechanism (ADR 0002).** `PatentAIAuthService` (Clerk template token) is the only
  sign-in. It is surfaced to the VS Code Accounts menu by a single `flowleap` auth provider.
  The FlowLeap UI Shell reads sign-in state via `vscode.authentication.getSession('flowleap')`;
  its `flowleap.signIn` becomes an alias of `patent-ai.signIn`.
- **BYOK inference, paid data backend.** Inference runs client-side through VS Code's native
  BYOK subsystem. The Patent-data Backend (Clerk + Polar) stays and gates the patent-data
  tools per request.
- **Reused identity.** product.json identity fields are copied verbatim; the existing GUIDs in
  v2 already match the old fork, so no GUID regeneration is needed.

### Clean-work mandates (do NOT port these hacks)

- **The sync model.** No `sync-to-vscode.sh`, no separate `extensions/patent-ai-agent`, no
  per-merge deletion of `extensions/copilot`, no package.json minify-restore. The agent *is*
  the copilot extension now.
- **The dual auth stack.** Do not port the FlowLeap UI Shell's independent `authProvider`
  (its own keychain, OAuth-PKCE against `/oauth/authorize`, `vscode://vscode.flowleap/callback`).
  Delete it; consume the one Clerk-backed provider instead. No two providers may register the
  same `flowleap` id.
- **The dead inference proxy.** Do not carry the retired `PatentAIChatEndpoint` →
  `/v1/chat/completions` (410) path, even as a fallback. BYOK only.
- **A custom chat vendor.** Do not reintroduce a bespoke "flowleap vendor" or a `claude-code`
  participant shim (the source of the old "UNKNOWN vendor" error). Use the native BYOK
  vendor/provider surface.
- **The GitHub-auth bypass as scattered fakes.** The agent must still not require GitHub
  sign-in, but implement the bypass cleanly at the auth-service seam, not as fake-token returns
  sprinkled across many methods.
- **Scattered core customizations.** Patent context keys and patent prompt templates must live
  in a dedicated patent area, not injected into unrelated contribs (e.g. snippets).
- **Doc sprawl.** Do not copy the ~40 `docs/patent-ai/*` and root `PATENT_IDE_*.md` files.
  Start from CONTEXT.md + ADRs + a single AGENTS.md.

### Module boundaries & seams (prefer existing, highest seam)

- **Patent overlay seam:** the `patentai` module is self-contained (config, models, backend
  client, endpoint/model providers, auth service, skills). External coupling is limited to:
  the **tools registry** (register patent tools), **agent types** (patent tool-sets + the
  patent research agent), the **prompt include** (patent system-prompt adaptation), and the
  **package.json contributions** (`languageModelTools`, `chatSkills`, commands, settings).
- **Auth seam:** one `IAuthenticationService`-shaped surface backed by `PatentAIAuthService`;
  the backend client centralizes 401→reauth and 402→trial so every tool inherits it.
- **product.json wiring seam (Layer 3):** decide per-field whether the in-tree copilot keeps
  the GitHub `defaultChatAgent`/entitlement wiring or has it neutralized for the BYOK+Clerk
  model, and grant the FlowLeap UI Shell `trustedExtensionAuthAccess` to the `flowleap`
  provider. This is the one place where "the agent is the copilot extension" diverges from the
  old fork (which pointed everything at a separate `FlowLeap.patent-ai-agent`).
- **Onboarding seam (Layer 3):** the first-run modal drives sign-in by executing
  `patent-ai.signIn`; gate control logic stays a pure state machine.

### Version-gap reconciliation

- Isolate the **true patent delta** by diffing each old repo against its own upstream base
  (old `vscode-copilot-chat` vs its microsoft upstream; old `vscode` vs its microsoft tag),
  then re-apply that delta onto v2 (copilot 0.55 / vscode 1.127). Do not diff old-fork-vs-v2
  directly — that conflates patent changes with 16 versions of upstream churn.

### Delivery in layers (each = one grabbable slice, fresh context)

- **L1** depends on nothing. **L2** depends on L1 (extension present, branding). **L3** depends
  on L2 (auth/tools exist to wire). **L4** depends on L3. Each ends compiling + committed.

## Testing Decisions

A good test here asserts **external behavior**, not internals: what the user or the build
observes, not how a method is wired. Prefer seams that already exist in the source repos.

- **Structural gate (every layer):** the `VS Code - Build` watch task compiles core +
  extensions with zero errors, and `valid-layers-check` passes. This is the primary
  per-layer definition of done. No layer is "done" on a red build.
- **FlowLeap UI Shell (L1):** the extension compiles via its own tsconfig in isolation; smoke
  that the theme, sidebar, dashboard, and chat panel contributions register. Behavior, not
  implementation.
- **Auth & backend (L2):** carry over the existing `patentAuthService` and `patentBackendClient`
  unit tests as the regression net. Test external behavior only: token stored on callback and
  returned on read; a 401 from the backend triggers a re-sign-in; a 402 triggers the trial
  prompt; sign-out clears state. The GitHub-bypass is verified by "agent works with no GitHub
  session present," not by asserting which methods return mocks.
- **Tool registration (L2):** one assertion at the registry seam that the expected patent tool
  set is registered (names + count), so a dropped tool fails loudly. Prior art: existing
  tools-registry tests.
- **Onboarding gate (L3):** keep the pure `onboardingSignInGate` state-machine unit test
  (close/Escape/overlay-dismiss blocked until signed in; in-flight → spinner+Cancel →
  Try-Again on cancel/fail). It is already a pure, unit-tested state machine — preserve and
  extend it rather than introduce a new seam.
- **Integration smoke (L4, highest behavioral seam):** launch the dev build, complete Clerk
  sign-in via the `flowleap://` callback, and issue one patent chat turn that (a) runs
  inference under BYOK and (b) invokes one patent-data tool against the backend (or a stubbed
  backend). This is the end-to-end acceptance test for the whole migration.

## Out of Scope

- **`flowleap-backend` and `flowleap-website-v2` changes.** They are unchanged; reused identity
  means their redirect/asset/Clerk config stays put. (If product.json wiring in L3 forces a
  redirect tweak, that is a separate, explicitly-flagged change — not assumed here.)
- **New patent features or new tools** beyond parity with today's ~70 tools and Skills.
- **Release-pipeline improvements** (notarization stapling automation, Windows code-signing
  automation, dual-upload automation). Tracked separately.
- **The `flowleap://` → 127.0.0.1 loopback redirect (RFC 8252)** auth hardening — deferred;
  reused identity keeps `flowleap://` for now.
- **Polar billing logic** and subscription product changes.
- **Completions/inline-suggest** behavior tuning; this PRD covers chat/agent + tools.

## Further Notes

- **Version-gap risk** is concentrated in three places: the agent-intent/prompt assembly
  (prompt-tsx evolved across 16 copilot versions), the tools-registry registration shape, and
  the onboarding workbench contrib (6 vscode versions). These are the "go slow, diff first"
  areas; the rest of `patentai` is additive and low-risk.
- **Dev deep-link collision:** because identity is reused, a packaged old-fork app and a v2 dev
  build both claim `flowleap://`; run only one at a time (or re-point with `lsregister`) during
  transition. Production users have a single install, so it cannot happen there.
- **Glossary discipline:** use the terms in CONTEXT.md throughout — Patent Agent vs FlowLeap UI
  Shell, Model Path vs FlowLeap Session, Patent-data Backend, Patent Skill vs
  Workspace-Assistance Command — so issues and code stay precise.
- **Next step after approval:** run `/to-issues` to split each layer into tracer-bullet,
  independently-grabbable issues once a tracker destination is chosen (GitHub Issues are
  currently disabled on the fork; `gh` is authed to git.epo.org).
