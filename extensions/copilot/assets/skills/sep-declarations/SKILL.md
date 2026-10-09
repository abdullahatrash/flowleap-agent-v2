---
name: sep-declarations
description: Count and rank ETSI standard-essential patent declarations: portfolio size, share of a generation, FRAND commitments, who declared most against a 3GPP specification. Use when the user asks about declared or standard-essential patents, SEPs, ETSI or 3GPP declarations, or a company's 2G to 5G declared portfolio. For whether a patent is actually essential use claim-analysis; for technology share with no declaration angle use patent-landscape.
user-invocable: true
---

# ETSI SEP declarations

Declarations are self-reported. ETSI checks no essentiality, and over-declaration is documented: a share of declarations is never a share of essential patents. Say "declared", never "essential".

The ETSI export is loaded weekly into three views that `patstat_query` reads: `flowleap.sep_declarations`, `flowleap.sep_declaration_publications` and `flowleap.sep_publication_family`. They are not PATSTAT: their edition is the export_date column, not data_edition. Views, keys and known figures: [references/etsi-isld-columns.md](references/etsi-isld-columns.md).

1. Read the rules first: `patstat_api_guide` action="section" section="semantic-model" (interpretation_conventions.sep_declarations) and section="examples" (the verified query sep_share_of_4g_families_by_declarant; reuse it). Done when you have named the counting key the question asks for: ETSI family (etsi_family_id), declared group (declared_group_id) or publication.
2. Query the views with `patstat_query`, one SELECT per figure, and select MAX(export_date) in the same query. Filter a generation on gen_2g … gen_5g, never on the standard text. Count with COUNT(DISTINCT …) on the key, never COUNT(*). Group by declarant_merged. Done when every figure has its key, its export_date, and the count of declared groups with no family id (etsi_family_id IS NULL) on its own line.
3. Name the merges: for each declarant you quote, query SELECT DISTINCT declarant FROM flowleap.sep_declarations WHERE declarant_merged = '<name>'. With shares, say that one family can have more than one declarant, so the shares can add up to more than 100%. Done when every quoted declarant lists the raw spellings behind its count.
4. Fallback, only when `patstat_query` is unavailable or the views give an error or no rows: download the export and count it by script. Run `curl -sSLD headers.txt -A "Mozilla/5.0" -o ISLD-export.zip https://docbox.etsi.org/IPR/Open/ISLD-export.zip` (~150 MB; Cloudflare answers 403 without the browser agent) and use the `Last-Modified` header as the edition. Stream the CSV row by row out of the zip, never load it whole, and apply the same keys and rules with the CSV column names and the merge list in the reference file. Done when a row count and the edition date are printed.
5. Save the SQL (or the script) beside the artifact and state in the report: the export date, the key, the merged spellings and the no-family-id count. On the fallback path also state the rows processed, delete the download, and keep the script, its output and headers.txt. Done when a reader could rerun the number from the report alone.
