---
name: sep-declarations
description: Count and rank standard-essential patent declarations from the ETSI IPR database — portfolio size, share of a generation, FRAND commitments, who declared most against a 3GPP specification. Use when the user asks about declared or standard-essential patents, SEPs, ETSI or 3GPP declarations, or a company's 2G/3G/4G/5G declared portfolio. Route "is this patent actually essential" to claim-analysis, and technology share with no declaration angle to patent-landscape.
user-invocable: true
---

# ETSI SEP declarations

Declarations are self-reported. ETSI checks no essentiality, and over-declaration is documented: a share of declarations is never a share of essential patents.

1. Download the export to the workspace analysis folder and read its `Last-Modified` header as the data edition: `curl -sSLD headers.txt -A "Mozilla/5.0" -o ISLD-export.zip https://docbox.etsi.org/IPR/Open/ISLD-export.zip` (~148 MB; one semicolon-separated CSV of ~5 million rows). Cloudflare answers 403 to the default curl agent, so the browser agent is required, not optional. Done when the zip is on disk and the edition date is written down.
2. Stream the CSV out of the zip row by row and never load it whole. Done when a row count is printed.
3. Count on the key the question asks for, and report the groups that carry no family id on their own line — the keys, the column dictionary and the declarant spellings are in [references/etsi-isld-columns.md](references/etsi-isld-columns.md). Done when the chosen key is named in the output alongside every count.
4. Filter a generation on its flag column, never on the standard text, and merge the declarant spellings from the reference file. Done when the merged names are listed with the count they produced.
5. Save the script beside the artifact and state the edition date, the rows processed, the key, the merged names and the no-family-id count in the report itself. Done when a reader could rerun the number from the report alone.
