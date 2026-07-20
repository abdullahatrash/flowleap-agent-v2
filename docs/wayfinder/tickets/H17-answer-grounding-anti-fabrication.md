---
id: H17
title: Prompt — answer-grounding: every patent number / quote must trace to a tool result
type: task
status: open
assignee:
blocked-by: []
---

## Question

Across the H15 run the main window repeatedly asserted data not traceable to any tool result:
S1's #5 patent (US12168819B2) + a cited "family member" appeared in no summary/result call; R1's
answer paraphrased claim text of uncertain provenance; R4's top-5 citation counts rested on a
single suspect `fetch_webpage`. What prompt rule enforces that every patent number, claim quote,
and figure in the final answer traces to a specific tool result — and that unverified items are
explicitly marked as such rather than stated flat?

### Evidence
[H15 VERDICT](../assets/H15-acceptance-run/VERDICT.md) fabrication notes on S1/R1/R4 (bench was
consistently cleaner — grounded picks in retrieved claims). This is the highest-trust-risk
finding: a filing-adjacent tool that fabricates patent numbers is worse than one that grinds.
Surface: `patentAIPrompt.tsx` (an evidence/citation-discipline rule; the existing EvidenceRules
element is the natural home). Pairs with [[H16]] (grind) and [[H18]] (completeness).
