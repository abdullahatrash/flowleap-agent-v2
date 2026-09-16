# PRD 0015 — ETSI standard-essential patent declarations as a data source

Status: proposed, 2026-09-14. Two phases; phase 1 is a skill, phase 2 is a Postgres table on the PATSTAT server. Issues: agent-v2 #348 (phase 1), backend #363 (phase 2), backend #364 (cutover view re-pointing).

## Problem

Questions about declared standard-essential patents ("how big is Huawei's declared 4G
portfolio, as a share of all 4G-declared families") cannot be answered from PATSTAT.
PATSTAT knows who filed what; it has no field that says a family was declared essential to
a standard. Those declarations live in the ETSI IPR database.

On 2026-09-14 the agent worked the question to an answer on its own: it found ETSI's
public bulk export, downloaded 147 MB into the workspace, streamed a 2.4 GB CSV of
4,977,907 rows in Python, and produced a chart. That is the behaviour we want. The result
was still wrong in a way nothing could catch: it counted the column `DIPG_ID` as "a
family". The same file gives three answers depending on which column is the family:

| Key | 4G families | Huawei | Share | Huawei rank |
| --- | --- | --- | --- | --- |
| `DIPG_ID` (declared group), what the agent used | 62,536 | 5,540 | 8.9% | 1st |
| `DIPG_PATF_ID` (ETSI family) only | 38,892 | 3,530 | 9.1% | 3rd |
| `DIPG_PATF_ID`, else `DIPG_ID` where the family id is blank | 47,905 | 5,006 | 10.5% | 1st |

One ETSI family holds up to 40 declared groups; 9,013 4G declared groups carry no family
id at all. The column semantics live nowhere the agent can read them, and every session
that asks the question re-downloads the file and re-decides the key.

## Goal

Every answer about declared SEPs uses the same, documented definition of "family",
"declarant" and "generation", states which one it used, and names the export it came from.

Phase 1 puts the definitions where the agent reads them. Phase 2 puts the data where a
query takes a second and the definitions are enforced in code.

## Non-goals

- Essentiality assessment. Declarations are self-reported; ETSI checks nothing. No
  output may call a declared patent "essential".
- Mapping declared patents to DOCDB families. ETSI's `DIPG_PATF_ID` is ETSI's own family
  grouping; joining it to PATSTAT families is a later, separate piece of work.
- Other standards bodies (IEEE, ITU, ISO). ETSI covers the cellular questions people ask
  most; the others have different exports and come later if asked for.
- The SEP triage workflow (backend doc `SEP_LANDSCAPE_TRIAGE_AGENT_FEATURE.md`,
  2026-06-26). This PRD supplies the curated data source that document deferred; it does
  not build the triage report.

## The source

| Item | Value |
| --- | --- |
| URL | `https://docbox.etsi.org/IPR/Open/ISLD-export.zip` (no login; the search UI at `ipr.etsi.org` is not needed) |
| Companion | `GD-export.zip` (12 KB, general IPR declarations without patent lists) at the same path |
| Size | 147 MB zip, one file `ISLD-export.csv` of 2.4 GB, ~5.0 million rows (2026-09-14) |
| Refresh | Daily, `Last-Modified` around 05:00 UTC |
| Format | Semicolon-separated, double-quoted fields, header row, UTF-8 |
| Grain | One row per (declaration, standard version, patent) — a family appears many times |

### Column dictionary (from the 2026-09-14 export)

| Column | Meaning | Counting note |
| --- | --- | --- |
| `IPRD_ID`, `IPRD_REFERENCE` | The declaration (form) and its ETSI reference, e.g. `ISLD-200010-001` | Not a patent key |
| `IPRD_SIGNATURE_DATE`, `Reflected_Date` | Date the declarant signed; date ETSI recorded it | Use `IPRD_SIGNATURE_DATE` for "declared before" questions |
| `COMP_LEGAL_NAME` | Declarant, as written on the form | Spellings vary: Huawei has three, Nokia has two entities. Merge through a maintained mapping |
| `DIPG_ID` | Declared IPR group: one entry of a declaration's patent list | **Not a family.** A family holds up to 40 of these |
| `DIPG_PATF_ID` | ETSI patent family id | **The family key.** Blank on ~9,000 4G groups; report those separately, never silently drop or merge them |
| `Patent_Type` | `Basis Patent` or `Family Member` | Members are listed explicitly; do not infer them |
| `PATT_APPLICATION_NUMBER`, `PUBL_NUMBER` | Application number; publications separated by ` \| ` (`CN102238152 A \| CN102238152 B`) | A publication key is the finest grain; split on the pipe |
| `Original_Application_Number`, `Original_Publication_Number` | The numbers as typed before ETSI normalised them | Provenance only |
| `Normalized_Patent` | `Yes`, `No`, `Error` — whether ETSI could normalise the number | Filter `Error` rows out of publication counts and say so |
| `Country_Of_Registration` | Office of the listed patent, e.g. `US UNITED STATES` | First two characters are the office code |
| `PBPA_PRIORITY_NUMBERS`, `PBPA_APP_DATE`, `PBPA_TITLEEN` | Priority numbers (pipe-separated), application date, English title | Bibliographic |
| `Standard`, `WI_Type`, `WOIT_*` | The ETSI deliverable declared against (`TS 102 223`, `ES 201 488 … version 1.1.1`) | ETSI-native standards |
| `3GPP_Type`, `TGPP_NUMBER`, `TGPV_VERSION` | The 3GPP specification (`TS`, `38.211`, version) | Cellular standards; `TGPP_NUMBER` series 36 is LTE, 38 is NR |
| `ETPR_ID`, `ETPR_ACRONYM`, `Ess_To_Project` | ETSI project (`LTE`, `Smart Card`, …) | |
| `2G`, `3G`, `4G`, `5G` | Generation flags, `1`/`0`/blank | **The generation key.** Filter on the flag, not on the standard text; 709,420 rows carry no flag |
| `Ess_To_Standard`, `DECL_IS_PROP_FLAG`, `LICD_*` | Essentiality claim, proprietary flag, licensing-terms flags (FRAND commitment) | `LICD_REC_CONDI_FLAG` is the FRAND undertaking |
| `Explicitely_Disclosed`, `Illustrative_Part` | Whether the declaration named the standard sections; which ones | Rarely filled |

Reference figures for regression (4G flag = 1, export of 2026-09-14): 1,548,408 rows;
38,892 families with a family id; 9,013 declared groups without one; Huawei under three
spellings 3,530 families (9.1%); Samsung 3,351; ZTE 3,271; Qualcomm 2,333 by family id.

## Phase 1 — a skill (agent-v2 and the CLI skill pack)

A bundled skill `sep-declarations` under `extensions/copilot/assets/skills/`, with a
mirrored copy in the CLI skill pack (the bundled skills are drift-checked against it).

Routing description: questions about declared or standard-essential patents, ETSI or 3GPP
declarations, SEP portfolio size or share, FRAND commitments by declarant. Points
"is this patent essential" questions at claim-analysis, and technology-share questions
with no declaration angle at patent-landscape.

Body, in order:

1. **Where the data is and how to get it.** The URL, the size, the refresh; download with
   the terminal into the session's analysis folder, stream the CSV from the zip, never
   load it whole. State the export's `Last-Modified` date as the data edition.
2. **The three keys**, from the dictionary above, and which question each answers:
   family (`DIPG_PATF_ID`) for "how many families", declared group (`DIPG_ID`) for "how
   many declaration entries", publication for "how many patents". "Count each family
   once" means the family id, with the blank-id groups reported on their own line.
3. **Declarant merging.** The known spellings table, and the rule to list the names that
   were merged.
4. **Generation and standard filters.** Flags for generation; `TGPP_NUMBER` series or
   `ETPR_ACRONYM` for a standard; `IPRD_SIGNATURE_DATE` for time windows.
5. **What to report.** The key used, the export date, the row count processed, the
   merged names, the count of groups without a family id, and the script saved beside the
   artifact (the rule PR #346 added to the analytics skills).
6. **What not to say.** Declared is not essential; ETSI's family is not DOCDB's; a share
   of declarations is a share of self-reported claims, and over-declaration is documented.

Acceptance: the 2026-09-14 question, asked fresh, produces a chart whose headline uses
the family id, whose caption states the key, the export date and the blank-id count, and
whose figures match the reference table above. The terminal runs behind it appear in the
data-provenance section of the artifact (PR #346).

Cost: one day. No backend change.

## Phase 2 — a backend source (flowleap-backend, PATSTAT server)

Trigger: the phase 1 skill is used more than a few times a month, or a user asks for the
answer inside a report that also draws on PATSTAT, where a 150 MB download per session
is not acceptable.

### Hosting decision (2026-09-14, after checking both servers)

| | API box | PATSTAT box |
| --- | --- | --- |
| CPU / RAM | 2 / 3.7 GB, no swap | 24 / 125 GB |
| Disk free | 65 GB | 819 GB |
| Runs | backend container, Valkey | Postgres 17, PATSTAT 866 GB |

The ingest streams a 2.4 GB CSV; it does not run on the API box. The data goes into
Postgres on the PATSTAT box, next to PATSTAT, which the backend already reaches through
the guarded SQL tool. That removes the need for a dedicated tool on day one and makes
the DOCDB join a SQL join on the same server.

Editions there are blue/green by schema (`patstat_2026_spring` today; the autumn edition
loads into a new schema, the read role is re-pointed, the old schema is dropped two weeks
later). Non-edition reference data already lives outside those schemas: the CPC scheme is
a real table in `patstat_ref`, exposed through a view in `flowleap`, the schema the SQL
gate allows. The ETSI table follows that precedent, so an edition cutover cannot drop it.

### Ingest

A script on the PATSTAT box, on the pattern of `load-edition.sh`: fetch `ISLD-export.zip`
when `Last-Modified` changes (daily, ~05:00 UTC), `COPY` the CSV into
`patstat_ref.etsi_isld` with typed columns and an `export_date`, split the
pipe-separated publication lists into `patstat_ref.etsi_isld_publication` (one row per
publication), and load the declarant name mapping `patstat_ref.etsi_declarant`. Swap
tables atomically (load into `_next`, rename) so a query never sees a half-loaded day.

### Surface

Views in `flowleap`: `sep_declarations` (one row per declared group with family id,
declarant, merged declarant, generation flags, standard, signature date, export date),
`sep_declaration_publications`, and `sep_publication_family` joining declared publication
numbers to `tls211_pat_publn` for a DOCDB family id. The guarded SQL tool serves them as it
serves PATSTAT; `patstat_api_guide` documents the views, the three counting keys and the
export-date column; every answer must state `export_date` the way PATSTAT answers state
`data_edition`.

A dedicated `sep_declarations` facade tool (inputs: generation, standard, declarant,
`count_by` = family | declared_group | publication, date window, top N) is optional and
comes only if the SQL surface proves awkward for the model.

### Skill update

Phase 1's skill gains a first step: query the views; fall back to the download route
only when `export_date` is older than seven days or the query fails.

### Cutover housekeeping (found while checking)

The `flowleap` views name the edition schema explicitly and are re-pointed by hand at
each cutover; `cutover.sh` does not do it. Add that step before the autumn edition. The
ETSI join view is one more view on that list.

Cost: two to three days.

## Out of scope for both phases, noted

- Comparing a SEP share with a PATSTAT technology share on one basis (the phase 2 join view
  makes it possible; the method is its own piece of work).
- The SEP landscape triage report, which can consume this source once it exists.
- IEEE, ITU and ISO declaration databases.
