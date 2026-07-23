# W1 research — source of record for US & DE claim/description full-text

Resolves ticket [Source of record for US & DE claim/description full-text](../tickets/W1-us-de-claim-text-source.md).
Investigated 2026-07-12 against primary sources (Google Patents Public Data, USPTO ODP/bulk, DPMA).

## The gap being closed

`ops claims`/`ops description` and the facade `get_claims`/`get_description` all proxy EPO OPS,
which 404s `CLIENT.InvalidCountryCode` for **US and DE** publications (finding F1); `uspto grant`
returns prosecution metadata, no claim text. EP/WO full-text works. We need a route that returns
US and DE claim + description text by publication number.

## Candidate sources evaluated

| Source | Covers | Access shape | Freshness | Cost / ToS | Verdict |
|---|---|---|---|---|---|
| **Google Patents Public Data (BigQuery)** `patents-public-data.patents.publications` | US full-text + ~17 offices; DE biblio since 2013, DE full-text **partial** | SQL by `publication_number` (clustered); `claims_localized`/`description_localized`/`abstract_localized` | ~**quarterly** refresh | Public dataset; full-text columns are huge (~2.74 TB) — must project/filter, never full-scan. **Backend already ingests a quarterly slice** for `patent_analytics` | **Tier 1 — US + worldwide baseline** |
| **USPTO Bulk Data** `PTGRXML` (grants), `APPXML` (applications) | US granted + published apps, authoritative full-text | Bulk XML download, ingest & host | **weekly** (fresh) | Free, US-gov public domain; ODP sign-in (USPTO.gov account) required since 2026-06-18 | **Tier 2 — fresh/authoritative US** (closes the recent-pub lag) |
| **DPMA DPMAconnectPlus** (successor to DEPATISconnect) | DE, DD, EP, WO — claims displayable, XML + PDF | SSL REST per-document + weekly bulk packages; Go client `dpma-connect-plus` exists | current-week from publication day | Registration required; German patent text public — confirm redistribution ToS | **Tier 3 — authoritative DE** |
| EPO OPS (current) | EP/WO full-text only | already wired | — | already used | keep for EP/WO |
| PatentsView API | — | — | — | **DEAD since 2026-03** (see `patent-mcp-landscape-2026-07`) | rejected |

## Key finding — the US baseline is mostly in-house already

The backend's `patent_analytics` tool runs over "a quarterly-refreshed slice of Google Patents
public data," so the BigQuery ingestion pipeline **already exists**. Extending that slice to
materialize `claims_localized`/`description_localized` (keyed by `publication_number`) and
exposing it behind the facade is a low-marginal-cost path to US (and worldwide-where-present)
claim text — no new external dependency for the majority case.

> ⚠️ To verify at build time: whether the existing slice already carries the full-text columns
> or only bibliographic fields, and the exact projection cost.
>
> **VERIFIED 2026-07-12 (corrects the above):** the backend's slim slice **deliberately excludes**
> full-text — `src/lib/duckdb/schema.ts` has an `EXCLUDED_TEXT_COLUMNS` deny-list + enforcing test,
> because scanning those columns for analytics "cost dollars per query" (a retired design). So the
> claim-text path must be a **separate point-lookup** against `patents-public-data.patents.publications`
> (reusing the existing `getBigQueryClient()`), NOT an extension of the analytics slice. The open
> cost question — does a `publication_number` point lookup avoid a full-text full-scan — is settled
> by a free `bq query --dry_run`; if not, materialize a full-text lookup table keyed by pub number.
> Detail in ticket [W8](../tickets/W8-bq-slice-us-claim-text.md).
>
> **MEASURED 2026-07-12 (settles it):** `patents.publications` is neither partitioned nor
> clustered → a point lookup scans the whole column (claims+description = **1,253 GB / ~$7.83
> per lookup**), so the direct lookup is out; W8 builds a **materialized clustered `us_fulltext`
> table** refreshed by the quarterly ETL. Also confirmed: `claims_localized`/`description_localized`
> are **US-only** per the DDL, so BQ gives **no DE full-text** — DPMAconnectPlus (W10) is DE's sole
> source, now mandatory. All checks were free (dry-runs scan nothing).

## Freshness caveat (why Tier 2 exists)

The evaluation's closest prior-art hits were **2026 publications** (e.g. Onda Vision, pub
2026-03). A quarterly BigQuery slice can lag the freshest 1–3 months — exactly the most
decision-relevant art. So Google BQ alone is a strong baseline but not sufficient as the sole US
source; USPTO bulk full-text (weekly) backfills the recent tail and is the authoritative US
text. Whether Tier 2 is needed *now* or can wait is a data-driven call — validate at the
second-pass FTO re-run and only build it if the BQ lag actually drops recent references.

## DE nuance

Google BQ's DE **full-text** coverage is partial (its full-text strength is US). For reliable
DE-national claim/description text, DPMAconnectPlus is the source of record. Note the scope
boundary carried from the map: *retrieving* DE text by number is in scope; *searching* DPMA for
DE-only rights (Gebrauchsmuster discovery) is out of scope.

## Recommended integration & the shape it graduates into

Route **behind the existing facade** so `get_claims`/`get_description` become provider-agnostic:
a country-code resolver keeps OPS for EP/WO and routes US/DE (and other OPS-rejected codes) to
the new sources. This makes `get_claims(US…)` stop 404ing without changing the tool contract.

Graduates the F1 implementation into:
1. **Extend the Google Patents BQ slice to serve US + worldwide claim/description text** (Tier 1 baseline).
2. **Facade country-code router on `get_claims`/`get_description`** (OPS → EP/WO, new source → US/DE).
3. **DPMAconnectPlus connector for authoritative DE text** (Tier 3).
- *Fog retained:* USPTO bulk fresh-US ingestion (Tier 2) — build only if the BQ freshness lag is
  shown to drop recent references at the second-pass re-run.

## Sources

- [google/patents-public-data (BigQuery datasets)](https://github.com/google/patents-public-data)
- [Google Patents Public Data schema](https://github.com/google/patents-public-data/blob/master/tables/dataset_Google%20Patents%20Public%20Datasets.md)
- [Programmatic Patent Searches Using Google's BigQuery (AIPLA)](https://www.aipla.org/list/innovate-articles/programmatic-patent-searches-using-google-s-bigquery-public-patent-data)
- [USPTO Patent Grant Full-Text Data (PTGRXML)](https://data.uspto.gov/bulkdata/datasets/PTGRXML)
- [USPTO Patent Application Full-Text Data (APPXML)](https://data.uspto.gov/bulkdata/datasets/appxml)
- [USPTO Open Data Portal — getting started](https://data.uspto.gov/apis/getting-started)
- [DPMA DPMAconnectPlus](https://www.dpma.de/english/search/data_supply_services/dpmaconnect/index.html)
- [DPMA data supply services](https://www.dpma.de/english/search/data_supply_services/index.html)
