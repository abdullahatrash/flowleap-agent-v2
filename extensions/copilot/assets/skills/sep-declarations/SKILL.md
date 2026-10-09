---
name: sep-declarations
description: Count and rank ETSI standard-essential patent declarations: portfolio size, share of a generation, FRAND commitments, who declared most against a 3GPP specification. Use when the user asks about declared or standard-essential patents, SEPs, ETSI or 3GPP declarations, or a company's 2G to 5G declared portfolio. For whether a patent is actually essential use claim-analysis; for technology share with no declaration angle use patent-landscape.
user-invocable: true
---

# ETSI SEP declarations

Declarations are self-reported. ETSI checks no essentiality, and over-declaration is documented: a share of declarations is never a share of essential patents. Say "declared", never "essential".

The ETSI export is loaded weekly into the `flowleap.sep_*` views that `patstat_query` reads. They are not PATSTAT: their edition is the export_date column. View columns and a sanity-check table: [references/etsi-isld-columns.md](references/etsi-isld-columns.md).

1. Fetch `patstat_api_guide` action="section" section="semantic-model" and apply interpretation_conventions.sep_declarations; fetch section="examples" and reuse the verified query sep_share_of_4g_families_by_declarant. Done when you have named the counting key the question asks for.
2. Query the views with `patstat_query`, and select MAX(export_date) in each query. Done when every figure has its key and its export date, and the declared groups with no family id are on their own line.
3. For each declarant you quote, query the raw spellings that declarant_merged combined. Done when each quoted declarant lists its spellings.
4. Take the fallback path when `patstat_query` is unavailable, the views give an error or no rows, or MAX(export_date) is more than 9 days old: follow [references/fallback-download.md](references/fallback-download.md). Done when the fallback gives a row count and an edition date, or when the views were used.
5. Save the SQL (or the script) beside the artifact and state in the report: the export date, the key, the merged spellings and the no-family-id count. Done when a reader could rerun the number from the report alone.
