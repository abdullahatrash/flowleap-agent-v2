# Invalidity Analysis charts the Fallback Ladder and loops until every fallback is covered or the search is exhausted

**Status:** accepted (2026-10-17)

A UPC litigator answered the founder's outreach question ("how do you check that the search did
not miss the one document that matters?") with the method practitioners actually use: you search,
you judge whether the documents you have take care of the claims **and all of the fallbacks you
can imagine**, and if they do not, you go back to the search. The bundled `invalidity-analysis`
skill does the first half. It charts each independent claim element by element against validated
quotes, and it names the gaps. It charts no dependent claim, it never charts an amendment the
proprietor can draw from the description, and its "Gaps" section is advice to the reader, not a
step the agent takes. A demo to that litigator would show a chart that stops where his work
starts. We decide to make the fallback judgment and the loop part of the deliverable, and to make
both checkable in code.

## The decisions

1. **The Fallback Ladder is computed in code from the challenged patent's own claims.** The
   writer reads the per-claim sources that `get_patent_details` recorded for the challenged
   publication in the execution ledger, parses each dependent claim's reference ("according to
   claim 1", "of any one of claims 1 to 3", "nach Anspruch 1", "selon la revendication 1") and
   builds, per independent claim, the ordered tree of dependent claims with the limitation each
   one adds. The model never types the ladder. A chart whose ledger holds no per-claim sources
   for the challenged publication is refused with "fetch the challenged patent's claims first".
   This is the **Verified-Data Contract** applied to the claim set, the way ADR 0010 applied it to
   citations. Rejected: letting the model list the dependent claims (it drops the ones it did not
   read, which are exactly the ones a proprietor retreats to).
2. **Every rung of the ladder is a charted row or a named omission.** A fallback row
   (`kind: 'fallback'`) charts only the limitation the dependent claim adds, with the same
   evidence fields, quote validation, element map and second read as an element row. The writer
   refuses an invalidity chart in which a dependent claim of a charted independent claim has
   neither a fallback row nor an entry in `fallbacksNotCharted` with a reason. The report renders
   the claim's own text from the ledger beside the row, never the model's paraphrase.
3. **Description-supported fallbacks are model-proposed rows, each anchored to a validated quote
   of the challenged patent.** A proprietor can also amend from the description. The model may
   add a fallback row with no claim number whose `basis` quotes the passage of the challenged
   patent's description that supports the amendment; the writer validates that quote against the
   ledger text as it validates evidence quotes. These rows are optional and are never required
   for a chart to save. Rejected: generating candidate amendments in code (no code can say which
   description feature a proprietor would choose; only a validated quote keeps a proposed one
   honest).
4. **Fallback Coverage is a count, and "not covered" is a valid result.** Per independent claim
   the report states "n of m elements disclosed; fallbacks: k of j covered; not covered: claims
   3, 5". Covered means the fallback row is `supported`, partly covered means `partial`, not
   covered means `unresolved`. The wording stays the chart's ("disclosed in the cited art", "not
   found in the cited art"), with no X/Y tag and no anticipation or obviousness statement; the
   legal reading stays in the practitioner's prose, as it does today. Rejected: a model-rated
   "fallback strength" (the fabrication mode fixed in #174/#175 under a new name).
5. **The loop is a Search Round the writer can see.** After a save that leaves fallbacks not
   covered, the skill runs a **Search Round** aimed at those limitations only: new Discriminating
   Terms for the added limitation, the search ladder of the skill (reformulate, other office,
   NPL, web), and a re-save. The round is recorded in the chart as `rounds[]`, each query of which
   must match a tool execution in the ledger or the writer refuses the save. The writer's receipt
   line carries the counts (`fallbacksNotCovered`, `rounds`); the completion guard nudges one
   Search Round when fallbacks are not covered and no round has run, and accepts an honest "not
   covered after round 2" as final. Rejected: a loop with no upper bound (it repeats searches
   merely to pass validation, the failure the guard's own text forbids), and a loop the skill
   text alone promises (nothing would show whether it ran).
6. **It lives inside Invalidity Analysis, on the typed-tool surface first.** The litigator
   described the invalidity method, not a new deliverable; the chart template stays
   `invalidity-claim-chart`, Find Better stays on independent claims (ADR 0010). The editor
   Patent Agent chat, where the validated writer runs, is the demo surface. The CLI skill text
   and the Agents Window copy follow the usual sync. Rejected: a separate "Fallback Coverage"
   deliverable (a fourth report type to keep in sync, with no new input).

## Consequences

- `patentCandidateReview` gains the ladder derivation, the fallback row checks and the
  description-basis check; `invalidity-claim-chart` gains a "Fallback coverage (generated)"
  section per independent claim and a "Search rounds" section; the receipt and the completion
  guard carry the loop. The prior-art and find-better templates do not change.
- The invalidity skill's Phase 4 becomes ladder + loop + stop rule and its "Gaps" section becomes
  the loop's input. The skill stays about five steps with the detail in reference files.
- Acceptance uses public answer keys: an EP patent maintained in amended form after opposition
  (the fallback the proprietor retreated to is on the record) and the Cuozzo IPR (claims 10, 14,
  17), compared against the chart's covered / not covered verdicts.
- A claim set that reaches the ledger unsegmented (claim numbers not established) has no ladder;
  the writer says so in the report and refuses nothing. Multiple dependency ("any one of claims
  1 to 3") is a rung under each parent it names.
- The litigator's answer came in a private message. No public material names him without his
  written consent.

## Amendment 2026-10-17: the expert steers each round

The first live runs (US6778074B1, EP1809422B1) showed a gap in decision 5. The code triggers the
one Search Round only when a rung is `unresolved`. On EP1809422 four of five rungs were `partial`,
so no round ran, and the chart's stopping rationale said searching stopped because every row had
partial support. The litigator's rule is "if the documents do not take care of all fallbacks, go
back to search". Partly covered is not taken care of. The same run made five more decisions alone
that belong to the expert: the search scope, an intermediate document, drawing-only evidence, a
failed search. The user of this product is an expert. The chart is a conversation with that
expert, not a one-shot deliverable.

7. **After every save the agent writes a Round Report and waits.** The Round Report is the
   receipt plus the open points of the saved chart, each as a numbered question with the agent's
   recommended next step, so the expert can answer with numbers, "all", or a steer of their own.
   The open points come from the record, not from the model: rungs `partial` or `unresolved`,
   independent-claim elements `unresolved`, cited documents outside the searched scope, cited
   documents published after the critical date, rows that rest on a drawing, searches that
   failed. A Search Round runs only on the expert's answer and is aimed at the points the expert
   chose. "Stop after one round" becomes "one round per answer": the expert ends the loop, and
   the cost stays bounded. The Investigation Brief (ADR 0009) asks at the start of a matter;
   the Round Report asks at the end of each round, with evidence in hand. The jurisdiction gate
   (default to both offices, do not ask first) is unchanged: the Round Report asks after the
   first result, not before the search.
   Rejected: a round the agent runs on its own for `partial` rungs (it spends the expert's
   budget on the agent's guess of what matters); a report that asks without recommending (the
   expert then does the agent's work); a Round Report typed from the model's reading of the chart
   (the writer already knows every open point and prints them, so the model cannot omit one).

Consequence for decision 5: the completion guard no longer nudges a round. It nudges the Round
Report when the agent saved and ended its turn without one. The writer's receipt gains the open
points. A re-save round must answer at least one open point the expert chose, checked the same way
#725 checks that a round ran after the previous save.

