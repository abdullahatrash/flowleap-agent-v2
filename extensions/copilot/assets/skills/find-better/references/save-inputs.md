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
   file at `baselinePath` (written by the `examiner_baseline` tool or the
   CLI). The writer states the source: "Examiner Baseline source: file
   <path>" or "inline".
   Each cell shows the category and the cited claims with the citing
   publication beside them, never equated with the granted claims.
3. **Gaps in the offices' records**: each `gaps[]` entry, as a gap, never as
   "nothing cited".
4. **Claim-by-claim comparison**: per independent claim, a table
   `element | examiner's best art | best art found`, then the line
   "examiner's best art: disclosed n of m · best art found: disclosed n of m",
   then the result sentence ("better art found" or "No better art found for
   claim N; the examiner's best art remains <pub>").
   - The header and the sentence name only the examiner's best art that an
     examiner-side row cites. The other `examinerBestArt` entries go on a
     line "Examiner's best art named but not scored: …".
   - A document without an X or Y category shows its basis in the header,
     for example "US3980041 (examiner-cited, no category)".
   - An examiner document with a P or E category, or published after the
     earliest date in `objective`, gets "(published after the critical date;
     not prior art for this claim unless the priority claim fails)".
   - If a track has no query, or Track 1 has no `hop: 2` query, the sentence
     is "Search incomplete for claim N: …" instead of "No better art found".
     The report still saves.
5. **Tracks log**: every track and every query from `tracks`, including
   zeros. Track 1 rows show "(hop 1)" or "(hop 2)".
6. Retrieved-but-not-cited, limitations and the working-record pointer.

## The Baseline input

- Pass `baselinePath`, the workspace path of the unedited file that the
  `examiner_baseline` tool or the CLI wrote. Do not paste the matrix inline;
  a large family has more than 1,600 documents.
- Give exactly one of `baselinePath` and `baseline`. The writer refuses both,
  and refuses a file that is not JSON.
- The writer refuses a Baseline that carries `_truncation`, or whose
  `documents[]` holds fewer citations from a publication than its
  `membersWalked[].publications[].citedCount`. Re-run the `examiner_baseline`
  tool or the CLI; never copy a Baseline out of a `patent_api_request` result.

## The examiner's best art and Track 1

- An `examinerBestArt` document needs an X or Y category in some office.
- When no X or Y citation exists (a US-origin family often has none), take
  the documents with `citedBy: "examiner"`, then the documents a US office
  action rejected claims with (`source: "uspto_enriched"`). The writer refuses
  only a document that the applicant alone cited, with no category and no
  rejection.
- Track 1 starts from the same documents: the X or Y documents, or, when none
  exists, the examiner-cited documents.
- Mark each Track 1 query with `hop: 1` or `hop: 2`. If hop 1 found no
  document outside the Baseline, log one `hop: 2` entry that says so, with
  count 0.

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
