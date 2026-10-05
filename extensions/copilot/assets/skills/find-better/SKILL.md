---
name: find-better
description: Find Better for a granted patent — read the code-computed Examiner Baseline (every document cited across the family, by office), run three logged expansion tracks (two-hop backward citations, inventor and author networks, classifications with Discriminating Terms), and score the examiner's best art and the art found on the same claim elements as "disclosed n of m". Use when the user asks whether earlier or closer prior art exists than the examiners cited, or what the examiners missed on a granted patent. Not for a pre-filing novelty search (prior-art) or for venue, grounds and invalidity charts (invalidity-analysis).
user-invocable: true
---

# Find Better

Given a granted patent, find prior art earlier or closer than the art the
examining offices cited. Show, per independent claim, the examiner's best art
beside the best art found, as element counts. "No better art found" with the
full Examiner Baseline and the full tracks log is a complete result.

Find Better makes no invalidity statement and gives no model-rated score. The
only comparison is a count over quoted element rows.

## Step 1: Baseline

The Examiner Baseline is computed in code. Do not build it yourself. Get it
from one of these two sources:

1. **The `examiner_baseline` tool**, when it is in your tool list. It writes
   the full Baseline to `references/<granted-publication>.examiner-baseline.json`
   and returns a short summary with that path. Read the file with `read_file`
   for your own reasoning.
2. **The FlowLeap CLI**, with `run_in_terminal`:
   `flowleap --json patent examiner-baseline <granted-publication> > references/<granted-publication>.examiner-baseline.json`.
   If the installed CLI has no `examiner-baseline` verb, use
   `flowleap --json tools run examiner_baseline --input '{"publication":"<granted-publication>"}' > references/<granted-publication>.examiner-baseline.json`.

Keep the file unedited: Step 5 passes its path to the writer as
`baselinePath`. Never fetch the Baseline through `patent_api_request`: its
character budget drops rows, and the writer refuses a Baseline that is
missing rows.

If neither source is available (no tool, no `flowleap` command, not signed
in), stop and tell the user that Find Better needs the Examiner Baseline.
Do NOT assemble the Baseline from family, bibliography, US grant or citation
calls: that drops members, merges offices, and cannot say what was absent.

Read `documents[]`, `gaps[]` and `membersWalked[]` (field guide:
[references/baseline-json.md](references/baseline-json.md)). Record the
critical date: the earliest priority date from `get_patent_details`.

**Claim concordance.** The claim numbers in a citation (`relevantClaims`)
belong to the claim set that office SEARCHED: the EP application claims on an
A3 search report, the pending US claims on an office-action row. They are not
the granted claims. Map each number to a granted independent claim by
comparing claim text, and always show `citing` beside the claim numbers. A
searched claim with no granted counterpart goes under "searched claims not
granted".

The **examiner's best art** for an independent claim is every document with an
X or Y category on a citation that reaches that claim, whatever its `citedBy`
says (only an examiner assigns a category). Rank X before Y, then by how many
offices cite it, then by how many independent claims it reaches. When no X or
Y citation exists (a US-origin family often has no categories), take the
documents with `citedBy: "examiner"`, then the documents a US office action
rejected claims with (`source: "uspto_enriched"`). The report shows that basis
beside each document. Never take a document that only the applicant cited.
Each entry in `gaps[]` goes in the report as a gap, never as "nothing cited".

Done when every independent claim has its examiner's best art list, or the
words "no X or Y citation reaches this claim", and every gap is recorded.

## Step 2: Claims

Decompose each independent claim of the granted publication into elements
(method: the `claim-analysis` skill). Give each element its **Discriminating
Terms** (see the `patent-search` skill).

Done when each independent claim is an element list with its Discriminating Terms.

## Step 3: Tracks

Run all three tracks. Each one is mandatory. Use the tool calls in
[references/tracks.md](references/tracks.md).

1. **Backward citations, two hops** from every document of the examiner's
   best art (the X or Y documents, or, when none exists, the examiner-cited
   documents from Step 1).
2. **Inventor and author networks**: the target's inventors, the inventors of
   the X/Y patents, and the authors of the X/Y non-patent documents.
3. **Classification co-occurrence**: the classifications of the target and of
   its X/Y documents, combined with the Discriminating Terms.

Keep only documents published before the critical date. Log every query with
its count, empty results too.

Done when each track has its log, and each kept candidate has its claims or
full text pulled.

## Step 4: Compare

For each independent claim, score the top examiner's art and each candidate on
the SAME element rows from Step 2. A row counts as disclosed only with a quoted
passage and its anchor (claim, paragraph, column and line, or figure). Write
"disclosed n of m" for each document.

"Better" means more elements disclosed, or the same count with an earlier date.
If no candidate beats the examiner's art, write "no better art found" for that
claim. That is a complete result.

Done when every independent claim has both columns scored on the same rows.

## Step 5: Record

Save with `write_patent_results`, `template: 'find-better-report'`, as a
structured save: leave `content` empty and supply:

- `challengedPublication`: the granted patent. `objective`: the critical-date
  basis, with the critical date as `YYYY-MM-DD`.
- `baselinePath`: the path of the Baseline file from Step 1, for example
  `references/<granted-publication>.examiner-baseline.json`. Do not paste the
  matrix inline: a large family has more than 1,600 documents.
- `examinerBestArt`: per independent claim, `{ claimNumber, publications }`
  from Step 1. Each publication must be in `baseline.documents[]` with an X or
  Y category, or, when none exists, an examiner citation or a US rejection.
- `tracks`: one entry per track, `{ name, queries: [{ query, tool, count }] }`,
  with every query, including the ones that returned 0. On each Track 1 query
  add `hop: 1` or `hop: 2`. If hop 1 found no document outside the Baseline,
  log one `hop: 2` entry that says so, with count 0.
- `coverage`: one row per element of each independent claim (`feature`,
  `claimNumber`, `kind: 'feature'`), plus one `kind: 'combination'` row per
  claim. Each row has two sides, `examiner` and `found`. Each side has
  `status`, `sourceAnchors`, `evidence`, `elements` and `gap`. The `elements`
  are literal fragments from the prior art, never from the target. The row's
  own `status`, `sourceAnchors` and `gap` are not used for this template: send
  `status: "unresolved"`, `sourceAnchors: []` and `gap: ""`.

The writer validates the quotes and counts "disclosed n of m" from the rows.
Do not pass a score. What the writer renders from these inputs is in
[references/save-inputs.md](references/save-inputs.md).

Done when the report holds every independent claim, every gap and every track log.

## Rules

- No invalidity conclusion and no "strong" or "weak" rating. For grounds and
  venue, hand the report to the `invalidity-analysis` skill.
- NEVER invent a reference or stretch a teaching. Quote only text a tool returned.
- Close with: "AI-assisted analysis for review by a registered patent attorney — not legal advice."
