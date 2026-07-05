# PRD 0005 · Patent research sessions: bundled patent skills + workflow templates in the Agents window

Status: ready-for-agent · Builds on: #59 (Claude-native Agents window), ADR 0005 (BYO patent data keys), PRD 0004 (removal wave — independent, can proceed in parallel)

## Problem Statement

The Agents window is now a working Claude parallel-sessions manager — but a *generic coding* one. A patent professional who opens it gets an empty composer ("What will you create?") and a Claude session that knows nothing about patents: no prior-art search capability, no FTO recipe, no access to the FlowLeap backend's patent data. The patent capabilities that exist today (the FlowLeap CLI plus the flowleap-*, recipe-*, and persona-* skills) only reach a session if the user manually installed them into their personal Claude configuration — which no product user will have done. The product vision is parallel *patent research* sessions — one per prior-art axis, per FTO question, per claim chart — whose outputs are report files the user reviews in the session's Files/Changes panes. None of that is discoverable or possible out of the box.

## Solution

Ship the FlowLeap patent skill set inside the product as bundled Claude Code plugins, so **every** Claude session in the Agents window has patent capabilities with zero setup. Surface them: the new-session composer offers patent workflow starters (prior-art search, freedom-to-operate, landscape, claim analysis, patent-to-report) that seed the first prompt from the corresponding recipe; the Customizations sidebar lists the bundled skills; composer strings adopt patent voice. Sessions run on the user's Claude credentials (no BYOK requirement), call the FlowLeap backend through the FlowLeap CLI using the user's BYO data keys, and write reports into the workspace where the Files/Changes panes already make them reviewable. The window stays a fully capable coding surface — patent capability is additive.

## User Stories

1. As a patent researcher, I want a brand-new install to offer patent research capabilities in every Claude session, so that I never have to install or configure skills myself.
2. As a patent researcher, I want to start a "Prior-art search" session from a template in the new-session composer, so that I don't have to know skill names or write a prompt from scratch.
3. As a patent attorney, I want a "Freedom-to-operate" template that walks the FTO recipe against my product description, so that I get a structured FTO report without prompt engineering.
4. As an IP analyst, I want a "Patent landscape" template for a technology area, so that landscape analysis is one click plus a topic.
5. As a patent attorney, I want a "Claim analysis" template that extracts and analyzes claims of a given patent number, so that claim charts start from a known-good workflow.
6. As a patent researcher, I want a "Patent-to-report" template that extracts all data from a patent into a structured report, so that documentation work is automated.
7. As a patent researcher, I want to run several research sessions in parallel — one per prior-art axis — each in its own session row, so that I can fan out an investigation and monitor progress in the sessions list.
8. As a patent researcher, I want each research session to write its findings as report files in the session workspace, so that I can review them in the Files pane like any other artifact.
9. As a patent attorney, I want changed/created report files surfaced in the Changes pane, so that reviewing an agent's research output works like reviewing code.
10. As a startup founder, I want persona-guided sessions (founder, attorney, analyst, researcher personas), so that the agent frames its analysis for my role.
11. As a patent researcher, I want the bundled patent skills listed in the Customizations sidebar's Skills pane, so that I can discover what the agent can do.
12. As a patent researcher, I want the agent to reach the FlowLeap backend (patent search, USPTO, EPO OPS, citations, legal references, academic literature) from inside a session, so that research uses live data rather than model memory.
13. As a patent researcher without the FlowLeap CLI installed, I want the session to tell me clearly that the CLI is missing and how to install it, so that the first failed lookup is self-explanatory rather than mysterious.
14. As a signed-out user, I want backend-dependent skills to guide me through FlowLeap sign-in (or BYO data keys per ADR 0005), so that auth problems surface as instructions, not errors.
15. As a patent professional, I want the composer placeholder and welcome copy to speak to patent workflows, so that the window communicates its purpose.
16. As a patent professional, I want research sessions titled after the research task, so that the sessions list reads like a research program, not a chat log.
17. As a developer-user, I want plain coding sessions to keep working exactly as before, so that patent capability never gets in the way of general use.
18. As a FlowLeap maintainer, I want the bundled skill set to be a vendored snapshot updated by a script (single source of truth), so that skill updates ship with app releases deterministically.
19. As a FlowLeap maintainer, I want bundling to reuse the existing plugin-location seam that already feeds session plugins, so that no new distribution mechanism is invented.
20. As a Pro subscriber (future), I want the bundled baseline to coexist with Pro-delivered skill updates, so that the Pro skills registry (separate effort) can layer on top without conflict.

## Implementation Decisions

- **Distribution seam (decided):** bundled plugin directory. The Claude session already assembles SDK plugins from the plugin-location service, which enumerates skill locations including locations shipped inside the built-in extension. The patent skill set (flowleap-*, recipe-*, persona-* — currently ~21 skills) is vendored into the built-in extension's shipped assets and enumerated through that existing seam. No network fetch at runtime; a repo script refreshes the vendored snapshot from the skills' source of truth.
- **Templates, not a new session type:** patent workflow starters live in the new-session composer as pickable templates. A template is prompt text (invoking the corresponding bundled recipe skill with the user's parameters) plus a suggested session title. Sessions remain ordinary Claude sessions — no new provider, no new session type id, so the picker stays Claude + Local.
- **Five launch templates:** prior-art search, freedom-to-operate, patent landscape, claim analysis, patent-to-report — mirroring the existing recipe skills. Template copy is externalized/localized.
- **FlowLeap CLI is a runtime dependency, not bundled (v1):** backend data access goes through the `flowleap` CLI that the skills already target. The product detects its absence and shows an actionable install nudge; the skills' own guidance handles auth (`flowleap` OAuth or BYO EPO/USPTO keys per ADR 0005). Bundling the CLI is explicitly deferred.
- **Auth split stays as-is:** session inference bills the user's Claude credentials (Pro/Max or API key); patent data uses the user's FlowLeap account / BYO data keys via the backend. No BYOK model configuration is required for patent sessions; the BYOK utility-model nudge must not block or gate them.
- **Reports are plain workspace files:** recipes write Markdown reports into the session's working directory; the existing Files/Changes panes are the review surface. No new artifact viewer.
- **Strings:** composer placeholder, empty-state and welcome copy move to patent-forward FlowLeap voice (title-style capitalization for labels; localized).
- **Customizations sidebar:** no new work beyond verifying the bundled skills appear through the existing Claude customization provider (it already lists user-level skills).
- **Coexistence rule:** user-level skills with the same name shadow or duplicate bundled ones per the SDK's normal precedence; do not build a dedup layer in v1 — document the behavior.

## Testing Decisions

- A good test observes what a user gets, at the highest seam: a fresh profile's Claude session must expose the patent skills, and a template must produce a session whose first turn invokes the right recipe. Implementation details (how locations are enumerated) stay untested directly.
- **Unit (extension test runner):** the plugin-location service enumerates the bundled patent skill set on a fresh install (prior art: existing plugin-service and customization-provider specs). Template definitions produce the expected seeded prompt/title (pure functions, snapshot-style single assertions preferred per house rules).
- **Live smoke (repo launch skill, throwaway profile — i.e. genuinely fresh, no user-level skills):** Customizations → Skills lists the bundled patent skills; start a template session; verify the seeded prompt and session title; verify one live turn renders (screenshot or DOM query — never accessibility snapshot alone). Note: throwaway profiles cannot receive the `flowleap://` auth callback, so backend-authenticated flows are exercised in the default profile.
- **HITL acceptance (manual, once per release):** one real recipe run against the deployed backend with live data keys, report file reviewed in the Files pane.
- Extension changes require the esbuild gate in addition to typecheck (typecheck does not catch bundler breakage).

## Out of Scope

- A dedicated patent session provider bridging the patent agent + BYOK models (the "deep" option — a later layer on top of this one).
- Bundling or auto-installing the FlowLeap CLI binary.
- Backend/tool changes, website changes, and the Pro skills/prompt-library registry (tracked separately).
- Editor-window (main chat) changes — this PRD is Agents-window only.
- Multi-session orchestration (one command fanning out N axis sessions automatically) — a natural follow-up once templates exist.
- Langfuse/promptfoo observability rework.

## Further Notes

- Verified groundwork (2026-07-05): the Claude session flow works end-to-end on native Claude credentials (live turn + multi-turn, response rendering, status lifecycle) — see #61's closing analysis. The plugin seam is live: sessions already pass locally discovered skills as SDK plugins.
- The 21-skill set observed in a session whose user profile had the skills installed is the exact target inventory for bundling.
- Testing hazard recorded in project memory: the Agents window's accessibility snapshots go stale; UI assertions must use screenshots or DOM queries.
