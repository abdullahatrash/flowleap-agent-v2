# Find Better save inputs

`write_patent_results` with `template: 'find-better-report'` renders the
deliverable from structured inputs. You supply the inputs; the writer renders
the tables and counts. The structure is the same as the CLI deliverable of
`recipe-find-better`, so keep the section order in mind when you fill the
inputs.

## What the writer renders

1. **Target summary**: the publication, the critical date (from `objective`),
   the family members walked and the offices.
2. **Examiner Baseline**: the cited document × office matrix, read from the
   file at `baselinePath` (the CLI JSON) or from inline `baseline` (the
   facade-tool result). The writer states the source: "Examiner Baseline
   source: file <path>" or "inline".
   Each cell shows the category and the cited claims with the citing
   publication beside them, never equated with the granted claims.
3. **Gaps in the offices' records**: each `gaps[]` entry, as a gap, never as
   "nothing cited".
4. **Claim-by-claim comparison**: per independent claim, a table
   `element | examiner's best art | best art found`, then the line
   "examiner's best art: disclosed n of m · best art found: disclosed n of m",
   then the result sentence ("better art found" or "No better art found for
   claim N; the examiner's best art remains <pub>").
5. **Tracks log**: every track and every query from `tracks`, including zeros.
6. Retrieved-but-not-cited, limitations and the working-record pointer.

## The Baseline input

- CLI source: pass `baselinePath`, the workspace path of the unedited
  `--json` file. Do not paste the matrix inline; a large family has more than
  1,600 documents.
- Facade-tool source (flowleap-backend#548): pass the result unedited as
  `baseline`.
- Give exactly one of the two. The writer refuses both, and refuses a file
  that is not JSON.

## Your inputs, per independent claim

- One `coverage` row per element and one `kind: 'combination'` row.
- On the `examiner` side: only the claim's examiner's best art (the writer
  refuses any other document).
- On the `found` side: the best candidate from the tracks, or an `unresolved`
  side with a `gap` that says no candidate disclosed the element.
- "Disclosed" needs a quoted, anchored passage (`elements` + `sourceAnchors`).

## Rules

- Score the examiner's art and the found art on the same element rows.
- Every track appears in `tracks`, with every query, including the ones that
  returned 0.
- "No better art found" is a result, not a failure. Keep the full Baseline and
  the full log with it.
- No similarity score, no "strong" or "weak" rating, no invalidity statement.
  The writer ignores numeric fields other than query counts.

## Working record

The working record holds what the deliverable leaves out: the claim
concordance (searched claim numbers to granted claims, with the citing
publication), every candidate seen and why it was dropped (date, of record, no
element match), the full text of each quote, and the calls that ran.
