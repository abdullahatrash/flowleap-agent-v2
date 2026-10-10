# The ETSI declaration views, column by column

Source: the ETSI ISLD export (`https://docbox.etsi.org/IPR/Open/ISLD-export.zip`),
reloaded weekly into the PATSTAT server and read through `patstat_query`. Every row
carries `export_date`, the export's `Last-Modified` date: state it in every answer.
It is not a PATSTAT edition; an answer that also uses PATSTAT views states both
`export_date` and `data_edition`.

| View | Grain |
| --- | --- |
| `flowleap.sep_declarations` | One CSV row: declaration × standard version × patent. A family repeats hundreds of times. |
| `flowleap.sep_declaration_publications` | One row per (declared group, publication): `PUBL_NUMBER` split on ` \| `. Reach it with a semi-join, `declared_group_id IN (SELECT declared_group_id FROM flowleap.sep_declarations WHERE …)`. |
| `flowleap.sep_publication_family` | Declared publications matched to PATSTAT; `family_id` is the DOCDB family. The only bridge to the PATSTAT views. About 96% match; report the matched share. |

## The three counting keys

| Question | Key | View | CSV column (fallback) |
| --- | --- | --- | --- |
| How many families | ETSI family | `COUNT(DISTINCT etsi_family_id)` | `DIPG_PATF_ID` |
| How many declaration entries | declared group | `COUNT(DISTINCT declared_group_id)` | `DIPG_ID` |
| How many patents | publication | `COUNT(DISTINCT (declared_group_id, publication_number))` on `sep_declaration_publications` | `PUBL_NUMBER`, split on ` \| ` |

"Count each family once" means the ETSI family id. One family holds up to 84 declared
groups across generations, so counting groups overstates families by roughly a third.
About 9,000 4G declared groups carry no family id: report them on their own line,
never drop them and never merge them into one bucket. The ETSI family is not the DOCDB
`family_id` of the PATSTAT views.

## Columns of `sep_declarations`

| View column | CSV column | Counting note |
| --- | --- | --- |
| `declaration_id`, `declaration_reference` | `IPRD_ID`, `IPRD_REFERENCE` | Not a patent key |
| `signature_date`, `recorded_date` | `IPRD_SIGNATURE_DATE`, `Reflected_Date` | Use the signature date for "declared before" questions |
| `declarant` | `COMP_LEGAL_NAME` | As written on the form; spellings vary |
| `declarant_merged` | (none) | The grouping column; holds the maintained spelling merge |
| `declared_group_id` | `DIPG_ID` | Not a family |
| `etsi_family_id` | `DIPG_PATF_ID` | The family key; NULL on ~9,000 4G groups |
| `patent_type` | `Patent_Type` | `Basis Patent` or `Family Member`; never infer members |
| `application_number` | `PATT_APPLICATION_NUMBER` | |
| `office` | first two characters of `Country_Of_Registration` | |
| `normalized_patent` | `Normalized_Patent` | Drop `Error` rows from publication counts and say so |
| `gen_2g` … `gen_5g` | `2G`, `3G`, `4G`, `5G` (`1` / `0` / blank) | The generation key; 709,420 rows carry no flag |
| `standard`, `project` | `Standard`, `ETPR_ACRONYM` | |
| `tgpp_type`, `tgpp_spec`, `tgpp_version` | `3GPP_Type`, `TGPP_NUMBER`, `TGPV_VERSION` | Series 36 is LTE, 38 is NR: `tgpp_spec LIKE '38.%'` |
| `frand_commitment` | `LICD_REC_CONDI_FLAG` | The FRAND undertaking |

## Declarant merges

`declarant_merged` holds the mapping (Huawei's three spellings, Nokia Technologies Oy +
Nokia Corporation = `Nokia`, QUALCOMM Inc, Sharp, NTT DOCOMO, Xiaomi, InterDigital and
others). Query the spellings behind each name you quote. A family can have more than
one declarant (1,578 4G families on 2026-10-09), so per-declarant shares can add up to
more than 100%.

## Known figures, for a sanity check

From the export of 2026-10-09, 4G flag set, counted on the ETSI family:

| Measure | Value |
| --- | --- |
| Rows in the export | 4,984,299 |
| Rows with the 4G flag | 1,548,699 |
| Distinct 4G families | 38,941 |
| 4G declared groups with no family id | 9,026 |
| Huawei, three spellings merged | 3,543 (9.1%) |
| Samsung Electronics Co, LTD | 3,349 (8.6%) |
| ZTE Corporation | 3,269 (8.4%) |
| LG Electronics Inc. | 2,709 (7.0%) |
| Nokia, two spellings merged | 2,568 (6.6%) |
| Qualcomm, two spellings merged | 2,502 (6.4%) |

Huawei leads only once its three spellings are merged. Under the main spelling alone it
holds 3,208 families and ranks third, behind Samsung and ZTE.

A later export moves these numbers. Treat them as a check that the key and the filter are
right, not as an answer to quote.
