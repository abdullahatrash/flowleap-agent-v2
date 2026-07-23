---
id: W8
title: Extend the Google Patents BQ slice to serve US + worldwide claim/description text
type: task
status: closed
assignee: wayfinder-session (this session)
blocked-by: []
resolution: flowleap-backend PR #118 (not merged); building the table + setting PATENTS_BQ_FULLTEXT_TABLE is a one-time op step
---

## Question

Return US (and worldwide-where-present) claim & description full-text by publication number,
sourced from Google Patents BigQuery, exposed as a lookup the facade can call.

Graduated from [Source of record for US & DE claim/description full-text](W1-us-de-claim-text-source.md)
(see [research asset](../assets/W1-claim-text-source-research.md)).

### VERIFY STEP DONE (2026-07-12) — approach corrected

Investigated the backend (`flowleap-backend`). The verify step's answer flips the original plan:

- **Do NOT extend the analytics slim slice.** `src/lib/duckdb/schema.ts` carries an explicit
  `EXCLUDED_TEXT_COLUMNS = [claims, claims_localized, description, description_localized]` deny-list
  with a schema test enforcing it, and `analyticsSlim.ts` documents that scanning full-text
  columns "made the live BigQuery analytics cost dollars per query" — a design they **retired**.
  Adding full-text to the slice would re-break analytics cost. Leave the slice alone.
- **Build a SEPARATE point-lookup path instead.** Reuse the existing general
  `getBigQueryClient()` (`src/lib/bigquery/client.ts`) to query
  `patents-public-data.patents.publications` (the same source `scripts/etl-patents-parquet.ts`
  reads) filtered by `publication_number = @x`, selecting `claims_localized`/`description_localized`
  (localized arrays — pick language). One document at a time, not a corpus scan.

### COST QUESTION SETTLED (2026-07-12, measured via ADC — $0 actual spend)

Probed `patents-public-data.patents.publications` (DDL + dry-runs, both free):
- **The table is NEITHER partitioned NOR clustered.** A `WHERE publication_number = @x` point
  lookup therefore scans the whole selected column: **claims + description = 1,253 GB (~$7.83)
  per single lookup**; claims-only = 125 GB (~$0.78). A direct per-document lookup is **unviable**.
- **`claims_localized`/`description_localized` are US-only** (DDL: *"For US publications only"*).
  → Google BQ contributes **nothing** for DE; DE full-text is entirely on
  [DPMAconnectPlus (W10)](W10-dpma-de-claim-text.md), which is now mandatory, not a fallback.

### Decision — build a materialized, clustered US full-text lookup table

`CREATE TABLE <flowleap_dataset>.us_fulltext CLUSTER BY publication_number AS SELECT
publication_number, claims_localized, description_localized FROM patents-public-data.patents.publications
WHERE country_code='US' AND ARRAY_LENGTH(claims_localized) > 0`. Point lookups then hit the
clustered copy and prune to ~MB (sub-cent). The one-time build scans the full-text columns once
(~$8–10), refreshed on the **same quarterly cadence as the analytics slice** — slots into the
existing ETL (`scripts/refresh-patent-analytics.sh` / `scripts/etl-patents-parquet.ts`). The
analytics slim slice stays untouched (full-text-free, per its schema test).

### DESIGN VALIDATED end-to-end (2026-07-12, ~$0.90 total probe spend, artifacts cleaned up)

Built a throwaway clustered sample and measured:
- **Clustering pruning confirmed:** a point lookup on the `CLUSTER BY publication_number` sample
  read **10 KB** (vs 125 GB on the raw table) — sub-cent per lookup. The materialized-table
  design works as intended.
- **Full text present & complete:** control `US-7650331-B1` returned clean, complete claims
  (~10K chars, English). The pipeline returns usable claim text for in-corpus US docs.
- **Freshness is NOT a blocker (reverses the earlier worry):** the corpus's freshest US
  `publication_date` is **2026-04-21**, newer than any eval reference (22.0M US rows). Recent US
  pubs are covered as a class → the Tier-2 USPTO-bulk backfill is likely **not** needed for
  freshness; keep it as fog only for authoritative-text edge cases.
- **New implementation requirement surfaced — publication-number normalization.** BQ uses DOCDB
  form `US-YYYYNNNNNN-A1` (e.g. `US-2026072719-A1`); incoming numbers like `US20260069159.A1`
  won't match without normalization, and US pre-grant serial width differs from the naive form.
  The backend lookup MUST normalize to BQ DOCDB before querying (also relevant to
  [W9](W9-facade-country-code-router.md)). This was the sole cause of the "row absent" false alarm.

### Definition of done
A backend lookup returns US claim + description text by publication number from the materialized
clustered table (not a live scan of `publications`, not the analytics slice), **normalizing the
input number to BQ DOCDB form** first. Quarterly-refresh step added to the existing ETL. Regression:
the two eval repro docs resolve to complete claims once normalized. Feeds the
[country-code router](W9-facade-country-code-router.md).
