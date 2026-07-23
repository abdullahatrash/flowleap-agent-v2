# PRD 0011: Code mode v1 — disposable dashboards and the generated typed client

Thesis: for aggregate patent questions, the best "tool" is a small code-execution
surface over verified backend data. The agent writes ordinary code against typed
capabilities; the user gets a bespoke, provenance-stamped dashboard instead of a
fixed UI we would otherwise have to build and maintain. This PRD ships the
CLI-first slice of that thesis (Phases 1+2). The IDE exec tool and any slimming
of the tuned 28-tool catalog are explicitly parked (see Out of Scope).

## Problem Statement

PATSTAT analytics is landing on the backend (`/v1/patstat/portfolio`, #146):
grounded aggregates for "show me {company}'s portfolio" questions, each response
carrying a `data_edition` provenance field and a quotable `summary`. But the
product has no presentation layer for aggregate data, and building one the
traditional way means committing to fixed dashboards that answer yesterday's
question — the next user wants the same data split by CPC class, or compared
against a competitor, and the fixed UI is wrong again.

Meanwhile the agent-facing data surface is fragmented. The backend already owns
a single agent-first facade — the tool registry behind `/v1/tools` (27 tools:
name, description, zod schema, handler, plus discovery and an OpenAPI export) —
but PATSTAT is not in it, no typed client exists for code written against it,
and when an agent presents aggregate numbers today those numbers pass through
the model's "hands": the model reads JSON and re-types figures into prose,
where transcription errors and hallucinated values are possible and provenance
is lost.

## Solution

Two coordinated pillars, both riding surfaces that already exist.

1. **Disposable dashboards (skills + templates).** A new dashboard-craft recipe
   skill teaches any bash-capable harness the pattern: fetch data via the
   FlowLeap CLI (`--json`), compute every aggregate *in code*, and emit a
   self-contained HTML dashboard (inline SVG charts, no external resources)
   with a mandatory provenance footer and a raw-JSON sidecar for audit. The
   user refines conversationally ("now split by office") and the agent
   regenerates in seconds. Starter templates for the four highest-value shapes
   (portfolio, filing trends, landscape white-space, citation impact) make the
   first render good instead of generic.

2. **PATSTAT in the facade + a generated typed client.** PATSTAT portfolio
   joins the tool registry (so `/v1/tools`, the MCP server, and `flowleap tools
   call` all reach it uniformly), the CLI gains a dedicated `flowleap patstat`
   verb, and a TypeScript client is *generated* from the registry — one source
   of truth, drift-checked in CI — so dashboard scripts and future exec
   surfaces write `client.patstatPortfolio({applicant})` instead of hand-rolled
   fetch calls.

The contract that makes "always verified data" honest rather than marketing:
the model decides *what program to write*; code computes every number from
fetched JSON; the dashboard displays where each dataset came from (endpoint,
parameters, data edition, timestamp) and ships with the data that produced it.

## User Stories

1. As a patent professional, I want to ask "show me Siemens's patent portfolio as a dashboard" and get an interactive HTML page, so that I don't need a BI tool or a fixed product dashboard.
2. As a patent professional, I want to refine a dashboard conversationally ("split by office", "add Bosch for comparison"), so that the presentation always matches my current question.
3. As a patent professional, I want every figure on a dashboard computed by code from backend responses, so that no number was re-typed (or invented) by a language model.
4. As a patent professional, I want a provenance footer on every dashboard (data edition, endpoints called, query parameters, generation time), so that I can cite it and a colleague can verify it.
5. As a patent professional, I want the raw JSON that fed a dashboard saved next to it, so that the numbers are auditable after the fact.
6. As a patent professional, I want dashboards to open and render with no network access, so that I can archive, email, or present them anywhere.
7. As a patent professional preparing a filing-strategy meeting, I want a landscape dashboard (CPC × year with white-space highlighting) from a single request, so that analysis that used to need an analyst takes minutes.
8. As an agent in any bash-capable harness (Claude Code, Cursor, the IDE's sessions window), I want a recipe skill that teaches the fetch → compute → render pattern, so that dashboard quality doesn't depend on improvisation.
9. As an agent, I want starter templates for common dashboard shapes, so that a working, well-designed program is my starting point instead of a blank file (stabilized mode: successful programs become the default path).
10. As an agent, I want `flowleap patstat portfolio <applicant> --json` as a first-class verb, so that portfolio data is one call with the same auth, error envelope, and output conventions as every other verb.
11. As an agent, I want an ambiguous applicant name to return the candidate list (the backend's 422), so that I can ask the user which entity they mean instead of silently merging companies.
12. As an agent composing multi-step analysis in TypeScript, I want a typed client generated from the tool registry, so that the compiler catches malformed calls before the backend does.
13. As FlowLeap (the platform), I want the registry to stay the single source of truth for tool names, descriptions, and schemas, so that the client, the manifest, and the docs can never disagree with the implementation.
14. As FlowLeap (the platform), I want PATSTAT reachable through `/v1/tools` and the MCP server, so that every harness gains portfolio analytics without per-harness work.
15. As FlowLeap (the business), I want the dashboard experience to ship as skill content, so that it improves through the plugins channel without app releases.

## Implementation Decisions

**Backend: PATSTAT registry entry — owned by the PATSTAT workstream (dependency, not scope)**
- The `patstat_portfolio` registry entry is implemented by the PATSTAT workstream (#141/#146), not this PRD. The registry entry is the contract between the two workstreams: this PRD's CLI verb, skills, and generated client key off its name and schema. Entry spec handed to that workstream: wrap `src/lib/patstat/portfolio.ts` directly (registry handlers call libs, never HTTP self-calls), input schema mirrors the route's (applicant, fromYear, toYear), feature gating reuses `isPatstatConfigured`, `PatstatUnavailableError` maps to a typed `ToolError` in the same envelope as the route.
- The PATSTAT workstream likewise owns any IDE typed tools and the prompt routing-tree update encoding the Topic/Portfolio Analytics split (see CONTEXT.md). This PRD makes zero agent-v2 code changes.
- Sequencing: the client generator, dashboard-craft skill, and Topic-Analytics-backed templates ship independently of PATSTAT; only the `patstat` CLI verb and Portfolio-Analytics-backed templates block on the entry landing.

**Backend: generated TypeScript client**
- A generator script in the backend repo walks the registry and emits a small client package: one typed method per tool (zod schema → TS input/output types via zod's type inference where handlers are typed, `zod-to-json-schema` for the manifest), plus a thin fetch core handling base URL, auth header, the unified error envelope, and 401/402/422 typed errors.
- Generated output is committed, and CI runs the generator and fails on diff (the same drift-protection pattern as the skills `sync.json`/`check-drift.mjs` loop). No hand edits to generated files.
- Distribution v1: the package lives in the backend repo (consumable via file/git reference). Publishing to npm is a follow-up decision, not part of this PRD.
- The existing `/v1/tools/openapi.json` export remains the language-neutral manifest; the generator does not replace it.

**CLI: `flowleap patstat` verb**
- New `patstat` command family (Rust, `src/commands/patstat.rs`) with `portfolio <applicant> [--from-year] [--to-year]`, following the citation/legal command conventions: hardened client, unified error rendering, `--json` for agents, human table output otherwise, exit codes per the existing contract.
- The 422 ambiguous-applicant response renders the candidate list explicitly in both output modes — it is an interaction step, not an error to retry.
- `flowleap tools call patstat_portfolio` works automatically once the registry entry lands; the dedicated verb exists for ergonomics and skill-writing.

**Skills: dashboard craft (canonical at flowleap-cli/skills, synced to plugins)**
- New `flowleap-patstat` data-access skill: when to reach for aggregate analytics vs. search, the ambiguity flow, `data_edition` semantics, feature-gated availability (the `patstat_unavailable` error means the backend has no PATSTAT database — say so, don't retry).
- New `recipe-custom-dashboard` craft skill — the heart of the PRD. Its rules:
  - **Numbers only from code.** Every figure in the HTML is computed by the script from fetched JSON. The model never types a data value into the output.
  - **Provenance footer mandatory**: data edition, each backend call with parameters, generation timestamp, CLI/backend versions.
  - **Self-contained HTML**: inline CSS and inline SVG charts rendered by the script; no CDN, no external fonts, no runtime JS dependencies. Opens from disk, emails, archives.
  - **Sidecar audit file**: the raw JSON responses are written next to the HTML; the footer links to it.
  - **Reproduce block**: the exact CLI commands (or script) that produced the data, so any run is repeatable (aligns with `recipe-audit-report`).
  - **Iterate in place**: refinements regenerate the same file; the script is the artifact to edit, not the HTML.
- Starter templates in the skill's `references/`: portfolio (filings by year × office, grant ratio), filing trends (multi-applicant comparison), landscape white-space (CPC × year heatmap), citation impact (forward-citation distribution). Each is a complete small script + HTML skeleton with an inline SVG chart helper (bars, lines, heatmap) and the design rules (readable axes, colorblind-safe palette, dark/light-agnostic) baked in — templates are pack-safe (no absolute paths, no repo-relative references).
- Templates that need search/citation data use existing verbs; only portfolio-shaped templates depend on PATSTAT. The recipe must degrade gracefully when PATSTAT is unavailable (state which templates are usable, don't fail the whole recipe).

**IDE: no code changes**
- The sessions window already runs bash-capable Claude harness sessions; the skill pack reaches it through the existing plugin/skills path. The BYOK chat's 28 typed tools are untouched.

## Testing Decisions

- Backend: registry-entry unit tests following the existing registry test patterns (happy path, ambiguity 422 passthrough, unavailable gating); generator drift check in CI (regenerate + fail on diff); a generator unit test pinning one representative tool's emitted signature.
- CLI: `patstat portfolio` integration tests against the mocked backend (success, 422 candidates rendering, `patstat_unavailable`, auth failure), matching the existing command test harness; `--json` output shape snapshot.
- Skills: the pack validator covers the two new skills; template scripts get a smoke run in CLI CI (execute against recorded fixture JSON, assert the HTML contains the provenance footer and at least one `<svg>`; no live backend in CI).
- Acceptance (HITL): in a fresh workspace with the pack installed and a PATSTAT-configured backend, ask "show me {company}'s patent portfolio as a dashboard". Verify: the HTML opens from disk with no network, every displayed number matches a direct `flowleap patstat portfolio --json` call, the provenance footer and JSON sidecar exist, and a follow-up refinement ("split by office") regenerates rather than starting over.

## Out of Scope

- **Phase 3 — the IDE exec tool and catalog slimming.** One exec surface in the copilot extension replacing/augmenting the 28 typed tools is deliberately parked: that catalog + prompt was just tuned to a 7/8 trajectory-eval win (map 0002), and any transport change there must ship additively and beat the tool catalog on evals before anything is removed. This PRD creates its prerequisite (the generated typed client) but makes no IDE change.
- Fixed dashboards on flowleap.com or in the app.
- npm publication of the generated client (follow-up decision).
- Live/self-updating dashboards (artifact runtime capabilities); v1 output is static HTML.
- PATSTAT ETL, hosting, and edition management (owned by #146's parent, #141).
- New PATSTAT analytics beyond portfolio.
- Write-path or destructive capabilities of any kind; the whole surface is read + render.

## Further Notes

- Origin: the "code mode" thesis (agents writing code against typed capabilities beats per-action tool calls; enforce security below the model). Our shape is unusually favorable: the domain is ~all reads, provider credentials already live server-side behind the facade, and the CLI + bash already constitutes the execution surface in every harness we target — so v1 needs no sandbox work at all.
- The security boundary is unchanged: backend auth (session/org token), BYOK provider keys never leave the server, and the generated client adds no new capability — it is a typed view of `/v1/tools`.
- Stabilized-mode flywheel: dashboards users keep asking for become new templates in the skill's `references/` via the normal plugins channel — measured demand, not speculation, grows the template library.
- Cross-repo footprint: flowleap-backend (registry entry + generator), flowleap-cli (verb + skills), flowleap-plugins (sync). No agent-v2 code changes; this PRD lives here as the system-of-record for planning, matching PRD 0002's cross-repo precedent.
