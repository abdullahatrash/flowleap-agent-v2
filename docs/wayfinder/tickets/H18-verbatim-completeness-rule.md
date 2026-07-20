---
id: H18
title: Prompt — verbatim-completeness: "full text" means all of it, not a paraphrase/mirror
type: task
status: closed
assignee: abdullahatrash
blocked-by: []
---

## Question

On R1 ("get me the full text of the claims of US10958080B2") the main window delivered claims
1/10/20 near-verbatim and paraphrased/"mirrored" the other ~15 ("11.–16., 18.–19. … mirror
claims 2–7"), despite the data being retrievable (bench delivered all 20 via OCR). What rule
teaches the agent that an explicit full-text / verbatim request must be answered completely —
reproduce every item or hand back the offloaded file — and never summarized to save space?

### Evidence
[H15 VERDICT](../assets/H15-acceptance-run/VERDICT.md) task R1. Note H9's offload already put the
full claims within reach (it delivered them on R1's retrieval leg); the shortfall is a *prompt*
instinct to compress, not a data gap. Surface: `patentAIPrompt.tsx`. Coordinate with [[H9]]
(the offloaded-file path is exactly what a complete answer should surface) and [[H17]].

## Resolution (2026-07-20)

**Rule added — VERBATIM-COMPLETENESS**, as the first two bullets of a NEW `PatentDeliverableRules`
element (`extensions/copilot/src/extension/prompts/node/agent/patentAIPrompt.tsx`). The element
renders at priority 775, slotted immediately after `PatentEvidenceRules` (780, where [[H17]]'s
grounding bullet lives) and before `PatentDataBoundaryRules` (770) — high enough to survive flex
pruning, and adjacent in render order to H17 so grounding→completeness read as one thought.
Verbatim:

> DELIVERABLE COMPLETENESS AND TARGETING:
> • VERBATIM-COMPLETENESS: when the user asks for the full text / verbatim text / the complete
>   claims or description / "the claims" as a whole (not a sample), reproduce EVERY item in full.
>   Never summarize, paraphrase, or "mirror" any item to save space — do not write "claims 11–16
>   mirror claims 2–7"; each claim or passage requested is reproduced in full. If the complete text
>   was offloaded to a file (oversized single-record lookups return a read_file path instead of
>   inline text), that file IS the complete answer — read it with the read_file tool at the path
>   the result reports and hand that path back, rather than transcribing a partial subset from the
>   inline result.
> • Reproduce full text only from what you actually retrieved — never reconstruct claim or
>   description text from model recollection (see the grounding rule). If retrieval returned only
>   part of the requested set, retrieve the remainder per the escalation ladder before answering;
>   if some items remain genuinely unavailable after that, state exactly which ones are missing
>   rather than paraphrasing over the gap.

Targets R1: "mirror claims 2–7" is called out by name; the fix forbids the compress-to-save-space
instinct on an explicit full-text request.

**Why a new element rather than a bullet in EvidenceRules.** `PatentEvidenceRules` is titled and
scoped to citation/grounding; stretching it to cover full-text completeness AND [[H19]]'s
target-selection would blur its theme. A single tight "deliverable discipline" element (the option
the parent named) holds H18 + H19 coherently — one new element, not many — while render-order
adjacency to EvidenceRules keeps the H17 coupling.

**Coordination.**
- With [[H9]]: the offloaded single-record file IS the complete answer — bullet 1 says hand back
  that read_file path instead of transcribing a partial inline subset, exactly matching H9's
  single-record offload notice ("read it with the read_file tool at the path this result reports").
- With [[H17]]: bullet 2 defers to the grounding rule — reproduce from the retrieved result, never
  reconstruct from memory. H17 says assert only what you retrieved; H18 says when full text is
  asked, reproduce ALL of what you retrieved. Complementary, no overlap: H17 caps over-claiming,
  H18 forbids under-delivering.
- With [[H16]]: "retrieve the remainder per the escalation ladder before answering" routes an
  incomplete set back through H5's ladder — and H16's ceiling still bounds that retrieval, so
  completeness and anti-grind don't fight (you retrieve the missing items, you don't loop a dead
  route to get them).

**Verification.** `npx tsgo --noEmit -p extensions/copilot/tsconfig.json` → no errors in
patentAIPrompt.tsx. Fixture regenerated offline (466→480 lines; block at line 332) +
`check-prompt-drift.ts` → "no drift detected". **Re-grade note:** the 51/52 model-graded baseline
was NOT re-run — needs a re-grade with H16+H18+H19 before release.
