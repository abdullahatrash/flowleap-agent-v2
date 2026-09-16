# The ETSI ISLD export, column by column

Source: `https://docbox.etsi.org/IPR/Open/ISLD-export.zip`, refreshed daily around 05:00 UTC.
Companion `GD-export.zip` at the same path holds general declarations with no patent list.
Format: semicolon-separated, double-quoted, header row, UTF-8. Grain: one row per
declaration, per standard version, per patent — a family repeats many times.

## The three counting keys

| Question | Key | Column |
| --- | --- | --- |
| How many families | family | `DIPG_PATF_ID` |
| How many declaration entries | declared group | `DIPG_ID` |
| How many patents | publication | `PUBL_NUMBER`, split on ` \| ` |

"Count each family once" means the family id. One family holds up to 40 declared groups,
so counting `DIPG_ID` overstates families by roughly a third. About 9,000 4G declared
groups carry no family id at all: report them on their own line, never drop them and
never merge them into one bucket.

## Every column

| Column | Meaning | Counting note |
| --- | --- | --- |
| `IPRD_ID`, `IPRD_REFERENCE` | The declaration form and its ETSI reference | Not a patent key |
| `IPRD_SIGNATURE_DATE`, `Reflected_Date` | Signed by the declarant; recorded by ETSI | Use the signature date for "declared before" questions |
| `COMP_LEGAL_NAME` | Declarant, as written on the form | Spellings vary — see the table below |
| `DIPG_ID` | One entry of a declaration's patent list | Not a family |
| `DIPG_PATF_ID` | ETSI patent family id | The family key; blank on ~9,000 4G groups |
| `Patent_Type` | `Basis Patent` or `Family Member` | Members are listed explicitly; never infer them |
| `PATT_APPLICATION_NUMBER`, `PUBL_NUMBER` | Application number; publications joined by ` \| ` | Split the pipe for a publication count |
| `Original_Application_Number`, `Original_Publication_Number` | The numbers as typed before ETSI normalised them | Provenance only |
| `Normalized_Patent` | `Yes`, `No`, `Error` | Drop `Error` rows from publication counts and say so |
| `Country_Of_Registration` | Office of the listed patent | First two characters are the office code |
| `PBPA_PRIORITY_NUMBERS`, `PBPA_APP_DATE`, `PBPA_TITLEEN` | Priority numbers, application date, English title | Bibliographic |
| `Standard`, `WI_Type`, `WOIT_*` | The ETSI deliverable declared against | ETSI-native standards |
| `3GPP_Type`, `TGPP_NUMBER`, `TGPV_VERSION` | The 3GPP specification and version | Series 36 is LTE, 38 is NR |
| `ETPR_ID`, `ETPR_ACRONYM`, `Ess_To_Project` | The ETSI project | |
| `2G`, `3G`, `4G`, `5G` | Generation flags, `1` / `0` / blank | The generation key; 709,420 rows carry no flag |
| `Ess_To_Standard`, `DECL_IS_PROP_FLAG`, `LICD_*` | Essentiality claim, proprietary flag, licensing terms | `LICD_REC_CONDI_FLAG` is the FRAND undertaking |
| `Explicitely_Disclosed`, `Illustrative_Part` | Whether the declaration named standard sections, and which | Rarely filled |

## Declarant spellings to merge

| Declarant | Spellings on the forms |
| --- | --- |
| Huawei | `Huawei Technologies Co., Ltd.`, `Huawei Technologies Co., Ltd`, `Huawei Technologies Co. Ltd.` |
| Nokia | `Nokia Technologies Oy`, `Nokia Corporation` |

Others appear; scan the declarant column for near-matches of the name asked about and
list the spellings that were merged.

## Known figures, for a sanity check

From the export of 2026-09-14, filtering the 4G flag on `1`, counted on `DIPG_PATF_ID`:

| Measure | Value |
| --- | --- |
| Rows in the export | 4,977,907 |
| Rows with the 4G flag | 1,548,408 |
| Distinct 4G families | 38,892 |
| Declared groups with no family id | 9,013 |
| Huawei, three spellings merged | 3,530 (9.1%) |
| Samsung | 3,351 |
| ZTE | 3,271 |
| Qualcomm | 2,333 |

A later export moves these numbers. Treat them as a check that the key and the filter are
right, not as an answer to quote.
