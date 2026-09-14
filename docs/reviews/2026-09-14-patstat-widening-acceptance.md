# PATSTAT widening wave — acceptance run (issue #347)

Date: 2026-09-14
Branch: `feat/patstat-widening-vendor-acceptance`
Canonical skill pin: `flowleap-ai/flowleap-cli@7a8eecfa86e5da3236a00728a0ebe73d90800a4c` (main, pre-release)
Backend: `https://api.flowleap.co` — `data_edition` **PATSTAT 2026 Spring** on every query below.

## Where this run happened, and why it is not the IDE chat

The issue asks for the acceptance pass **in the IDE chat** with a BYOK model in a
fresh empty workspace. That was not possible in this task, and the honest reason
matters more than the workaround:

- A fresh worktree has no `node_modules` and no `out/`, so running Code OSS from
  it needs a full `npm install` plus a full compile of the fork. The main working
  tree, which has both, is checked out on another agent's branch and must not be
  disturbed.
- Even with a build, the run would stop at authentication. The chat's patent
  tools reach the backend through the signed-in FlowLeap token; `configService.ts`
  offers `PATENT_API_URL` as the only environment override and there is **no**
  token or API-key environment override in the extension. A throwaway profile
  cannot receive the `flowleap://` OAuth callback (recorded from the earlier L4
  acceptance), so sign-in in a throwaway profile fails and every `patstat_query`
  call would return 401.

So this run is the sanctioned fallback: the same four questions executed as
guarded SQL through `flowleap patstat query` (CLI v0.8.5, authenticated as the
repo owner). **What this proves and what it does not:** it proves the backend
serves the widened views, that the vendored recipes' SQL runs unmodified, and
that the measured numbers in the recipes reproduce live. It does **not** prove
the model's routing in the IDE chat — that a prompt actually produces a
`patstat_api_guide` call followed by `patstat_query`, and that no document text
is presented as the answer. That half of the acceptance remains open and needs a
built app with a signed-in profile.

## Results

| # | Question | Path | rowCount | data_edition | Verdict |
|---|---|---|---|---|---|
| 1 | Which applications descend from EP application 905384508, and how many are divisionals? | `flowleap.priorities` + `flowleap.continuations`, 2 hops | 41 | PATSTAT 2026 Spring | PASS |
| 2a | Which EP legal-event codes mean "opposition"? | `flowleap.legal_event_codes` | 69 | PATSTAT 2026 Spring | PASS |
| 2b | How many EP oppositions were filed against BASF's grants per year since 2015? | `flowleap.legal_events` on the curated code list | 11 | PATSTAT 2026 Spring | PASS |
| 3 | Which CPC codes dominate "solid state battery" filings? | `flowleap.application_texts` ⋈ `flowleap.classifications` | 30 | PATSTAT 2026 Spring | PASS |
| 4 | Where does the extended family of application 16277555 reach? | `flowleap.inpadoc_family_members` | 40 | PATSTAT 2026 Spring | PASS |
| 4b | Count-versus-cover check on the same anchor | `inpadoc_family_members` ⋈ `family_members` | 1 | PATSTAT 2026 Spring | PASS |

No query returned document text. Every response carried `data_edition`.

### 1. Chains — descent from application 905384508

SQL: the vendored `chain_descent_two_hops` recipe, byte-identical, anchor
substituted. 41 grouped rows; 337 applications in total across the two hops, 281
of them at hop 1. Broken out by `reached_via`: 72 applications are reached by a
`divisional` edge, 55 by a `continuation` edge, the rest by priority only. The
top rows:

```
hop 1  continuation,priority  US  47 applications   9 families
hop 1  divisional,priority    EP  26 applications   6 families
hop 1  divisional,priority    AU  17 applications   5 families
hop 1  priority               US  17 applications  10 families
```

The 337 total reproduces the number recorded in the recipe ("158 of 337
applications are reached twice"), which is the check that the dedupe on
`application_id` is doing its job — counting raw edge rows would inflate by ~47%.

Backend warning: `patstat_sql_expensive`, estimated plan cost 1,605,854 against a
warn threshold of 1,500,000 and a reject ceiling of 5,000,000. The query ran.
This is the documented WARN band for a two-hop descent, and it is why the recipe
forbids a third hop.

### 2. Legal events — EP oppositions against BASF, by year

Step 0 first, as the skill requires: enumerating `flowleap.legal_event_codes` for
`office = 'EP'` with `description ILIKE '%opposition%'` returns **69** codes.
That is the whole point of the rule — "opposition" is not one category. The list
includes `26` (OPPOSITION FILED), `26N` (NO OPPOSITION FILED), `26D`, `26U`,
`27C`, `27O`, `NLR1` (a national mirror of the same EPO act) and the whole `PLA*`
/ `PLB*` INPADOC stream. Aggregating on any category would mix filings with their
opposites.

The aggregate then filters to the curated list `('26', 'PLBI', 'R26')` and counts
DISTINCT applications by the year of first opposition:

| Year | Grants opposed | Event rows |
|---|---|---|
| 2015 | 50 | 154 |
| 2016 | 64 | 186 |
| 2017 | 40 | 125 |
| 2018 | 47 | 142 |
| 2019 | 36 | 96 |
| 2020 | 23 | 55 |
| 2021 | 27 | 73 |
| 2022 | 12 | 36 |
| 2023 | 11 | 33 |
| 2024 | 21 | 57 |
| 2025 | 11 | 25 |

`event_rows` runs at roughly 2.5-3× `grants_opposed`, which is the inflation the
rule predicts: `26` and `PLBI` both fire on one opposition, so row counting would
have roughly tripled the answer. These numbers are as of edition; current status
belongs to the `get_legal_status` tool.

### 3. Text discovery — concept to CPC codes

SQL: the vendored `concept_to_cpc_codes` recipe with the exact indexed idiom
`to_tsvector('english', tx.title) @@ plainto_tsquery('english', 'solid state battery electrolyte') AND tx.title_lang = 'en'`,
bounded by `ipr_type = 'PI'` and `earliest_filing_year >= 2015`. 30 rows, and the
documented trap reproduces exactly:

| Rank | Code | Families | Share of hits | Title |
|---|---|---|---|---|
| 1 | Y02E60/10 | 2040 | 86.7% | Energy storage using batteries |
| 2 | H01M10/0562 | 1211 | 51.5% | Solid materials |
| 3 | H01M10/052 | 1102 | 46.8% | Li-accumulators |
| 4 | H01M10/0525 | 1046 | 44.5% | Rocking-chair batteries |
| 5 | H01M10/0565 | 702 | 29.8% | Polymeric materials, e.g. gel-type or solid-type |

Rank 1 is the Y-scheme tag on 86.7% of hits and the real answer is rank 2 — the
86.7% figure the recipe records is reproduced to the decimal. Taking the mode
would give the wrong code. The answer is codes and counts; no abstract or title
text was returned as the answer.

### 4. INPADOC coverage — extended family of application 16277555

40 offices in the extended family. The count-versus-cover check on the same
anchor returns `extended_members = 67`, `docdb_families_inside = 6`,
`offices = 40` — again exactly the numbers the recipe and the backend semantic
model record for EP05820528. Counting inventions over the extended family would
overstate by 6×. Per-office rows carry `granted_members` as of edition, with
lapse history left to `flowleap.legal_events` and current status to
`get_legal_status`.

Backend warning: `patstat_sql_expensive`, estimated plan cost 2,850,148 against
the 1,500,000 warn threshold. Both INPADOC queries ran, both are under the
5,000,000 reject ceiling.

## Backend gap found: two recipe families are not in the served examples yet

`patstat docs --section examples` returns **17** examples. Chains
(`chain_ancestry`, `chain_descent_two_hops`, the divisional share) and legal
events (`legal_event_codes_for_concept`, `ep_oppositions_by_year`, the lapse
recipe) are all served. **Text discovery (`concept_to_cpc_codes`,
`concept_top_applicants`) and INPADOC coverage (`inpadoc_family_coverage`,
`inpadoc_family_scope`) are not.**

This is a serving gap, not a data gap: all 16 views are deployed and the
`semantic-model` section already carries the full `text_discovery` guidance (the
exact idiom and all three traps, including the Y02E60/10 measurement) and the
`families` count-versus-cover rule. So a chat agent that fetches the semantic
model still gets the rules; what it does not get from the backend is ready-made
SQL for those two families. Until the examples ship, the vendored
`references/patstat-recipes.md` is where that SQL lives for the Agents window,
and the two demoted CPC references in this PR carry the `concept_to_cpc_codes`
SQL inline for the panel chat, which has no patstat skill of its own.

## Open

- The IDE-chat half of the acceptance — routing, tool-call order, and the
  no-document-text rule — is still unrun, for the two reasons at the top.
- Backend: serve the text-discovery and INPADOC examples from
  `/v1/patstat/docs?section=examples`.
