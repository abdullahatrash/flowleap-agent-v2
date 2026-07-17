<!-- wayfinder:map -->
# Map: Tooling-complete patent deliverable (7 → 9.2)

> Local-markdown wayfinder tracker (no `docs/agents/issue-tracker.md` in this repo, and
> public-repo issue creation is guardrail-blocked). Tickets live in `./tickets/`. Each
> ticket carries front-matter: `type`, `status` (open|closed), `assignee` (empty = unclaimed),
> `blocked-by` (list of ticket ids). The **frontier** = open + unblocked + unassigned tickets.
> **Never resolve more than one ticket per session.** Refer to tickets by name, not id.

## Destination

An agent, in any harness, produces a **filing-adjacent US + EP prior-art / FTO deliverable
with zero capability caveats** — every "the tool can't retrieve/resolve X" limitation from the
2026-07-12 evaluation is closed, and a regression gate keeps the quality from decaying. This is
the agent-validated ceiling (~9.2). We arrive when a fresh re-run of the FTO recipe on a US+EP
product yields a deliverable that carries no tooling-forced caveat.

## Notes

- **Domain & findings:** `docs/reviews/2026-07-12-ecosystem-evaluation-findings.md` (findings F1–F17),
  `CONTEXT.md` (patent glossary), `docs/handoff/0001` (strategy & release gate).
- **Verdict driving this map:** reasoning is a 9, the data layer feeding it is a 5. This map
  raises the data layer and locks quality; it does **not** touch the reasoning/recipe logic
  except for measured-drift edits.
- **Cross-repo:** fixes span `flowleap-backend`, `flowleap-cli`, and the canonical CLI skills
  (which resync to `flowleap-plugins` via `sync.json` — the established review→fix→resync loop).
  Tracked here with the surface named in each ticket.
- **Skills to consult per session:** `/grilling`, `/domain-modeling`, `/prototype`, `/diagnose`
  (for the family/enrichment parse bugs), `/research` (for the claim-text and EP-validation sources).
- **Standing preference:** skill/recipe edits are made at the canonical `flowleap-cli`, never
  directly in `~/.claude/skills` or `flowleap-plugins` (resync handles propagation).

## Decisions so far

<!-- one line per closed ticket; the ticket holds the detail -->

- [Source of record for US & DE claim/description full-text](tickets/W1-us-de-claim-text-source.md) —
  tiered, facade-behind. **US** = a **materialized clustered `us_fulltext` table** refreshed by
  the quarterly ETL (measured 2026-07-12: `publications` is unclustered, so a live point lookup
  costs ~$7.83/call — unviable; and the analytics slice is deliberately full-text-free, so don't
  touch it; + USPTO bulk for the fresh tail if needed). **DE** = DPMAconnectPlus is the *sole* DE
  source (BQ full-text is US-only per the DDL). A country-code router keeps OPS for EP/WO.
  Graduated W8/W9/W10.
  [[research asset]](assets/W1-claim-text-source-research.md)
- **W8 + W9 — US claims via BigQuery + office router** — **PR #118 (merged)** + **PR #119
  (claims-only + fixes, open)**. US claims resolve through a materialized, `CLUSTER BY pub_key`,
  **claims-only** `us_fulltext` table (123GB/~$2.40/mo — description was ~90% of a 1.2TB build and
  isn't the critical path); a country-code router keeps OPS for EP/WO, serves US claims from
  BigQuery, and returns clean `FULLTEXT_UNAVAILABLE` for US description + DE (pending W10). Verified
  live: US-2026069159-A1→24 claims, ~22MB/lookup, cached. **Learning:** BigQuery `maximumBytesBilled`
  is checked against the pre-clustering estimate (full column), so a byte cap falsely rejects a
  clustered point lookup — don't cap; the guarded `pub_key` equality filter bounds it. Table built
  at `patent_analytics.us_fulltext`. **VERIFIED LIVE IN PROD 2026-07-12:** deployed `get_claims`
  facade returns 24 claims for US-2026069159-A1 (env var added to compose, container recreated).
  Closes finding F1 (US claims) end-to-end. **Follow-up PR #120 (open):** routes the
  `/v1/ops/fulltext` claims+description passthrough through the same router, so `ops claims US…`
  and the flowleap-ops skill work too (not just the tools facade). After it merges+deploys, US
  claims are served on every CLI/MCP/recipe surface — no new env/ops step (reuses the same table).

## Not yet specified

<!-- in-scope fog; graduates to tickets as the frontier advances -->

- **USPTO bulk fresh-US full-text (Tier 2 of the claim-text route).** `PTGRXML`/`APPXML` weekly
  ingestion to backfill the recent 1–3 months the quarterly Google BQ slice
  ([Extend the Google Patents BQ slice…](tickets/W8-bq-slice-us-claim-text.md)) lags. Graduate
  to a ticket **only if** the second-pass re-run shows the BQ lag drops recent references —
  data-driven, so deliberately still fog.
- **Second-pass FTO re-run on real US claim text.** The destination check for the claim-text
  strand: re-run `recipe-freedom-to-operate` once US claims resolve and confirm the deliverable's
  US all-elements analysis no longer rests on a PCT proxy. Blocked on the
  [country-code router](tickets/W9-facade-country-code-router.md) being live.
- **Wire the regression gate into CI and make it green.** Blocked on the gate *design*
  ([Design the CLI-skill regression gate](tickets/W7-regression-gate-design.md)) plus the data +
  ergonomics fixes it asserts against.
- **End-to-end acceptance: a caveat-free US+EP deliverable.** The destination itself — one
  clean prior-art + one clean FTO run with no tooling caveat. Blocked on all data strands.

## Out of scope

<!-- ruled beyond the destination; never graduates -->

- **Human patent-attorney sign-off** of the deliverables (converts ~9.2 → ~9.5) — a downstream
  human-validation effort, not tooling.
- **DPMA / _Gebrauchsmuster_ (utility-model) search coverage** for German-national-only rights.
  Note the boundary: *retrieving* DE claim text by number is in scope (part of W1); *searching*
  DPMA for DE-only rights is not.
- **Paid-tier / authenticated distribution channel** (ADR 0006 defers this to a separate effort).
