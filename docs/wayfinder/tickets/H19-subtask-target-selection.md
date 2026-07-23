---
id: H19
title: Prompt — sub-task target selection: act on the item the answer names as most relevant
type: task
status: closed
assignee: abdullahatrash
blocked-by: []
---

## Question

On S4 ("find DeepMind protein-structure applications, and show the continuity chain of the most
relevant one") the main window ran `get_continuity` on a *different* application than the one its
own answer called most relevant, and delivered no chain. What rule keeps a multi-part task
coherent — when a follow-up sub-task references "the most relevant / top one", operate on the
specific item just selected, and actually deliver that sub-result rather than offering to?

### Evidence
[H15 VERDICT](../assets/H15-acceptance-run/VERDICT.md) task S4 (bench picked the AlphaFold
continuation and pulled its real chain). Smallest of the four follow-ups; likely a short prompt
clause about carrying the selected entity into the dependent step. Surface: `patentAIPrompt.tsx`.

## Resolution (2026-07-20)

**Rule added — CARRY THE SELECTED TARGET**, as the third bullet of the new
`PatentDeliverableRules` element (`extensions/copilot/src/extension/prompts/node/agent/patentAIPrompt.tsx`,
priority 775, after `PatentEvidenceRules`). Shares the element with [[H18]] because both are
"deliver exactly what the user asked." Verbatim:

> • CARRY THE SELECTED TARGET: in a multi-part task, when a dependent sub-task refers to "the most
>   relevant / top / best one" (or similar), operate on the SPECIFIC entity your own answer just
>   named — carry that exact application/publication number into the sub-task; do not silently
>   switch to a different item. And actually deliver the sub-result (e.g. run and show the
>   continuity chain), never merely offer to do it or report that it could be done — the sub-task
>   is done only when its own output is present in your answer.

Targets S4 directly, both failure halves: (1) continuity was run on a *different* application than
the answer named most relevant → "carry that exact number into the sub-task, do not silently
switch"; (2) no chain was delivered, only an offer to verify → "actually deliver the sub-result …
never merely offer to do it."

**Home.** Co-located with H18 in `PatentDeliverableRules` rather than in `PatentEvidenceRules`
(which is citation/grounding-scoped) — one shared deliverable-discipline element, the smallest of
the four follow-ups expressed as a single clause as the ticket predicted.

**Coordination.** Orthogonal to [[H16]] (effort) and [[H17]] (grounding): it constrains *which
item* the dependent step operates on and *whether the step's output is present*, not how hard to
retrieve or what may be asserted. Sits beside H18's completeness bullet — together they make the
element "deliver the right target, completely."

**Verification.** `npx tsgo --noEmit -p extensions/copilot/tsconfig.json` → no errors in
patentAIPrompt.tsx. Fixture regenerated offline (466→480 lines; block at line 336) +
`check-prompt-drift.ts` → "no drift detected". **Re-grade note:** the 51/52 model-graded baseline
was NOT re-run — needs a re-grade with H16+H18+H19 before release.
