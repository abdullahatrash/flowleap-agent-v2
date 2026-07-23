---
id: H21
title: Second acceptance head-to-head — post H16–H19, re-test the majority bar
type: task
status: closed
assignee: abdullahatrash
blocked-by: []
---

## Resolution (2026-07-21)

**Destination REACHED: main window 6 wins / 1 tie / 1 loss = 7/8 win-or-tie** vs bench, same
model (claude-sonnet-5), clean `Acceptance Run 2` workspace, EPO healthy, F1–F3 deployed.
Run 1 was 2/8. Full per-task tally + the confound: [VERDICT.md](../assets/H15-acceptance-run-2/VERDICT.md).

Every task main lost in run 1 that it now wins/ties traces to a fix: S1 loss→tie (H17
anti-fabrication), S2/S3 loss→win (H16 anti-grind: 82→46, 43→21 calls, still complete),
S4 loss→win (H19 target selection), R3 loss→win (H18 completeness), R1 paraphrase→verbatim
(H18) though still a loss on efficiency → **new ticket [[H22]]** (enrich=claims discoverability
+ readable claims offload). Zero give-ups, zero flagged main-side fabrications across all 16.

**Confound (honest):** 2 of 6 wins (S2, R4) are inflated by bench *harness* failures (headless
consent-prompt stall / blocked mkdir), not main outperformance. Excluding both, main is still
5/6 win-or-tie — the destination holds either way. An airtight number would re-run those 2 bench
tasks with fixed sandbox/allowed-tools.

First contaminated attempt (main re-read run-1 report files from the shared "My First
Investigation" workspace) was discarded; the fresh empty workspace fixed it.

## Question

Re-run the 8-task corpus (bench vs post-H16–H19 main window, same model claude-sonnet-5)
after the four answer/effort-discipline fixes + the 52/52 re-grade. Did efficiency +
answer-discipline improve enough to move the H15 result (main 2/8) toward the destination's
win-or-tie-a-majority bar? Rubric shifts vs H15: persistence is solved, so weight
efficiency (H16 anti-grind), answer-grounding (H17), completeness (H18), target selection
(H19) — the exact loss modes H15 surfaced.

Protocol (same as [H15](H15-acceptance-head-to-head.md)): EPO health verified before the
run; fresh bench in the same session; main window on the **rebuilt** post-fix tree (a stale
build tests the OLD prompt); Sonnet 5 both sides; no time cap; recorded modelId verified;
integrity checks before tallying; anonymized per-task blind judging. Assets under
`assets/H15-acceptance-run-2/`.
