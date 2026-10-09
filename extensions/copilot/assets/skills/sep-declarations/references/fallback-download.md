# Fallback: count the ETSI export yourself

Use this path only when `patstat_query` is unavailable, the `flowleap.sep_*` views give an
error or no rows, or their MAX(export_date) is more than 9 days old (the weekly load has
stopped).

1. Download the export to the workspace analysis folder:
   `curl -sSLD headers.txt -A "Mozilla/5.0" -o ISLD-export.zip https://docbox.etsi.org/IPR/Open/ISLD-export.zip`
   (~150 MB). Cloudflare answers 403 to the default curl agent, so the browser agent is
   required. The `Last-Modified` header in headers.txt is the edition date.
2. The zip holds one semicolon-separated, double-quoted UTF-8 CSV of ~5 million rows with a
   header row. Stream it row by row out of the zip; never load it whole. Print the row count.
3. Apply the same keys and rules as the views, with the CSV column names in the
   "CSV column" column of [etsi-isld-columns.md](etsi-isld-columns.md). The family key is
   `DIPG_PATF_ID`, the declared group `DIPG_ID`; the generation flags `2G` … `5G` hold
   `1` / `0` / blank.
4. There is no merged declarant column. Merge at least these spellings of
   `COMP_LEGAL_NAME`, scan for near-matches of the name asked about, and list every
   spelling you merged:

   | Declarant | Spellings on the forms |
   | --- | --- |
   | Huawei | `Huawei Technologies Co., Ltd.`, `Huawei Technologies Co., Ltd`, `Huawei Technologies Co. Ltd.` |
   | Nokia | `Nokia Technologies Oy`, `Nokia Corporation` |
   | Qualcomm | `Qualcomm Incorporated`, `QUALCOMM Inc` |

5. In the report, also state the rows processed and that the numbers come from a direct
   download. Delete the zip when the counts are in; keep the script, its printed output and
   headers.txt.
