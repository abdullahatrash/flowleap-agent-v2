---
id: W9
title: Country-code router on get_claims/get_description (OPS for EP/WO, new source for US/DE)
type: task
status: closed
assignee: wayfinder-session (this session)
blocked-by: [W8]
resolution: flowleap-backend PR #118 (not merged); DE routing returns clean FULLTEXT_UNAVAILABLE pending W10
---

## Question

Make the facade `get_claims`/`get_description` provider-agnostic: a country-code resolver that
keeps EPO OPS for EP/WO and routes US/DE (and other codes OPS rejects with `InvalidCountryCode`)
to the new full-text sources — so `get_claims(US…)` and `ops claims <US>` stop 404ing.

Graduated from [Source of record for US & DE claim/description full-text](W1-us-de-claim-text-source.md).
This is the seam that closes finding F1 at the tool contract; the underlying US source is
[Extend the Google Patents BQ slice…](W8-bq-slice-us-claim-text.md), which this depends on
(routes to it). DE routing lights up once
[DPMAconnectPlus connector…](W10-dpma-de-claim-text.md) lands.

### Definition of done
`get_claims`/`get_description` (and the `ops claims`/`ops description` CLI paths) return text for
US publications via the new source, EP/WO via OPS unchanged, with a clean "not available for
<code>" contract for still-unsupported offices (no raw OPS XML). Regression: the two eval repro
docs (US 2026/0069159, US 2025/0241553) now return claims.
