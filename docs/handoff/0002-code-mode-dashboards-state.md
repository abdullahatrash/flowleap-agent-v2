# Handoff 0002: Code mode + disposable dashboards (PRD 0011) — execution state

Written 2026-07-23. Spec: `docs/prd/0011-code-mode-disposable-dashboards.md` (this
branch). Vocabulary: `CONTEXT.md` → Topic Analytics vs Portfolio Analytics, Data
Edition, Verified-Data Contract. Issue trail: flowleap-cli #32/#33/#34,
flowleap-backend #161 — each carries a resolution comment with branch + SHA.

## SHIPPED 2026-07-23 (same day) — state below updated post-ship

All three repos merged to main and pushed: agent-v2 e817eba140a, flowleap-cli
4825098 (+ version bump 877e8fe, tag v0.3.6 — GitHub release live with 7
binaries), flowleap-backend b3741ce. Issues #32/#33/#34/#161 closed. Plugins
synced to v0.3.6 and pushed (flowleap-plugins b1ece53): +flowleap-patstat,
+recipe-custom-dashboard (first skill shipping its references/ tree; drift
check guards SKILL.md only), plugin versions 1.1.0, full 24-skill re-sync.
Slice branches and session worktrees deleted after merge.

OPEN ITEMS: (1) RESOLVED — npm token rotated, rerun succeeded, flowleap@0.3.6
live on the registry.
(2) Backend main not yet DEPLOYED — data_slice provenance activates on deploy.
(3) In-app sessions-window HITL (final PRD acceptance) once the app picks up
plugin 1.1.0. (4) PATSTAT server-side (other workstream) lights up portfolio/
filing-trends templates.

## What existed pre-merge (historical)

| Repo | Branch | Head | Contents |
|---|---|---|---|
| flowleap-agent-v2 | `code-mode-dashboards-0011` | (this branch) | PRD 0011, CONTEXT.md glossary terms, this handoff. Zero code changes — deliberate. |
| flowleap-cli | `code-mode-dashboards-0011` | `8ea7eb3` | INTEGRATION branch: merges the three slice branches below + integration commit (patstat example fence flipped to `bash`, `flowleap-patstat` added to dashboard-skill requires, goldens regenerated once over the merged tree). 175 tests green, fmt/clippy clean. |
| flowleap-cli | `code-mode-0011-patstat-verb` | `eb4dd81` | #32 `flowleap patstat portfolio` (never auto-picks 422 candidates; typed unavailable rendering). |
| flowleap-cli | `code-mode-0011-skills-wiring` | `0f43a9a` | #34 `flowleap-patstat` skill + Visual-deliverable cross-links (landscape, audit-report, academic-lit-review; deliberate non-links recorded on the issue). |
| flowleap-cli | `code-mode-0011-dashboard-skill` | `cabc193` | #33 `recipe-custom-dashboard` + 4 templates + fixtures + smoke (cargo-wrapped for CI). |
| flowleap-backend | `code-mode-0011-slice-stamp` | `38d5d08` | #161 `data_slice` corpus-slice identity on patent_analytics + cache-namespace-v2 fix (stale-shape poisoning; regression-tested). 808 vitest green. |

The slice branches are already merged into the integration branch — merge the
integration branch, not the slices. Session worktrees under the scratchpad are
disposable; the branches above are the durable artifacts.

## Verified so far

- Founder live test 2026-07-23, fresh workspace `~/flowleap/prd-0011-test`:
  - `patstat portfolio "Siemens"` against api.flowleap.co → correct typed
    `patstat_unavailable` rendering (PATSTAT not yet deployed server-side).
  - Claude Code + skill → real **ml-landscape dashboard** from live Topic
    Analytics (N+1 calls: 1 broad + 8 scoped CPC rows). Contract checks all
    passed on the artifact: bundle (`generate.mjs` + `dashboard.html` +
    `data/` ×9), 3 inline SVGs, zero external URLs, provenance footer with
    honest "dataset identity unavailable" rows, sidecar↔HTML number
    traceability (spot value 674), reproduce block with pinned scope.

## Remaining work, in order

1. **Founder sign-off → merge to main**: flowleap-cli `code-mode-dashboards-0011`
   → main; flowleap-backend `code-mode-0011-slice-stamp` → main. Close #32,
   #33, #34, #161.
2. **Deploy the backend branch** — activates `data_slice` so Topic Analytics
   footer rows flip from "dataset identity unavailable" to a real stamp. The
   cache namespace bump (`patent-analytics-v2`) makes old cache entries a
   guaranteed miss on rollout; no migration needed.
3. **Plugins sync** (flowleap-plugins repo: `sync.json` + `scripts/check-drift.mjs`)
   — AFTER the CLI branch is on main, so the plugin channel never ships content
   main doesn't have. This is what delivers the two new skills to the app's
   sessions-window agent (Claude sessions load plugin skills, not
   extension-bundled ones — the `source !== 'extension'` filter).
4. **In-app sessions-window HITL** (final PRD acceptance): fresh workspace in
   the FlowLeap app, synced plugin installed, FlowLeap CLI on PATH, ask "show
   me {company}'s patent portfolio as a dashboard"; verify per the PRD's
   Testing Decisions.
5. **PATSTAT dependency (other workstream, backend #141/#146)**: when the
   `patstat_portfolio` registry entry + `PATSTAT_DATABASE_URL` deploy, the
   portfolio and filing-trends templates light up with zero changes here. The
   entry spec is in PRD 0011 → Implementation Decisions. That workstream also
   owns IDE typed tools + prompt routing for the Topic/Portfolio split.

## Standing decisions a future agent must not silently reverse

- **Phase 3 is parked and eval-gated**: the chat agent's `PATENT_TOOLS`
  allowlist (`extensions/copilot/src/extension/agents/vscode-node/agentTypes.ts`)
  deliberately excludes `run_in_terminal`. Adding exec to the tuned chat agent
  requires beating the 28-tool catalog on the map-0002 evals first. The
  generated-TS-client is Phase 3's first slice (cut from 0011 on YAGNI).
- **Verified-Data Contract is absolute inside artifacts** (including prose) —
  see CONTEXT.md. Never weaken to "charts only".
- **Never auto-pick a 422 applicant candidate**, anywhere, ever. Resolution is
  pinned as a constant in `generate.mjs`.
- **Dashboards are local-by-default, never auto-published** (pre-filing
  confidentiality).
- **Goldens + plugins sync are integration-time operations** — per-branch
  regeneration/sync is self-invalidating across concurrent slices.
- **Topic vs Portfolio Analytics routing** is by criteria shape (free text vs
  structured) — CONTEXT.md is canonical; skill text uses it verbatim.
