---
id: W1
title: Source of record for US & DE claim/description full-text
type: research
status: closed
assignee: wayfinder-session (this session)
blocked-by: []
---

## Question

What is the authoritative, programmatically-reachable source for **US and DE-national
claim and description full-text**, and what does reaching it cost (API vs bulk download,
auth/keys, rate limits, ToS on server-side use + caching)?

Today `ops claims`/`ops description` and the facade `get_claims`/`get_description` all proxy
EPO OPS, which 404s `CLIENT.InvalidCountryCode` for US and DE pubs; `uspto grant` returns
prosecution metadata with no claim text (finding F1). EP/WO full-text works. This is the
keystone gap — all-elements claim mapping is impossible for the two markets the product targets.

### Deliverable
A `/research` markdown summary (linked from this ticket) that names the chosen source(s) for
US and for DE, the access shape (endpoint/bulk, keys needed, limits, caching terms), and a
recommended integration point behind the existing facade so `get_claims`/`get_description`
become provider-agnostic. Candidates to evaluate: USPTO Patent Public Search / USPTO bulk
full-text / PatentsView-successor (US); DPMA DEPATISnet / EPO for DE-national text (DE).

### Why it blocks
The F1 *implementation* (in the map's Not-yet-specified) cannot be specified until this resolves
— the build shape depends entirely on which source and access model we pick.

---

## Resolution (2026-07-12)

Research asset: [W1 — source of record for US & DE claim/description full-text](../assets/W1-claim-text-source-research.md).

**Answer — a tiered, facade-behind integration, not a single source:**
- **US baseline: extend the Google Patents BigQuery slice the backend already ingests** (it
  powers `patent_analytics`) to serve `claims_localized`/`description_localized` by
  publication number. Low marginal cost — infra exists. Caveat: full-text columns are huge
  (~2.74 TB) so project/filter, never full-scan; and the slice refreshes ~quarterly.
- **US freshness/authority: USPTO bulk full-text** (`PTGRXML`/`APPXML`, weekly, free, public
  domain) backfills the recent 1–3 months the quarterly BQ slice lags — the eval's closest
  hits were 2026 pubs, so this tail matters. Build only if the lag proves to drop recent refs.
- **DE authoritative: DPMAconnectPlus** (SSL REST + weekly bulk; DE claims retrievable). Google
  BQ's DE full-text is only partial, so DE needs its own source of record.
- **Integration seam:** a country-code resolver behind the facade — keep OPS for EP/WO, route
  US/DE (and other OPS-rejected codes) to the new sources, so `get_claims(US…)` stops 404ing.
- Rejected: PatentsView (dead since 2026-03).

Graduated three implementation tickets (W8, W9, W10); USPTO-bulk fresh-US (Tier 2) retained as
fog pending the second-pass re-run. **Build-time check flagged in the asset:** confirm whether
the existing BQ slice already carries the full-text columns or only bibliographic fields.
