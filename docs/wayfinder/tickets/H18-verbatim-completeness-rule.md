---
id: H18
title: Prompt — verbatim-completeness: "full text" means all of it, not a paraphrase/mirror
type: task
status: open
assignee:
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
