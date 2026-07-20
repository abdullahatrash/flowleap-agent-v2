---
id: H15
title: Acceptance head-to-head — bench vs post-fix main window, same model, blind-judged
type: task
status: closed
assignee: abdullahatrash
blocked-by: []
---

## Resolution (2026-07-20)

**Destination NOT reached: main window won 2 of 8** (R2, R4) vs bench, same model
(claude-sonnet-5), EPO healthy, F1–F3 deployed. Full per-task tally + integrity + blinding
caveat: [VERDICT.md](../assets/H15-acceptance-run/VERDICT.md). Transcripts under
`runs/<task>/{bench,main}/`.

**But the gap transformed.** The entire H1 failure class is gone — zero give-ups, zero
error-deaths, zero commercial-DB deflection across all 8 post-fix runs; H5–H10 all did their
job (H9's offload visibly delivered US claims on R1). The judges penalized a new, milder,
prompt-surface class: over-grinding a route already proven dead (S2/S3/R4 → [[H16]]),
asserting patent numbers/text not traceable to a tool result (S1/R1/R4 → [[H17]]),
paraphrasing when verbatim was asked (R1 → [[H18]]), and operating on the wrong target for a
sub-task (S4 → [[H19]]). Four follow-up fix tickets graduated. The map's destination bar is
unchanged; these are the remaining route to it.

## Question

The closing measurement of map 0002: re-run the 8-task corpus (`assets/H1-repro-corpus/corpus.md`)
with **bench** (Claude harness + flowleap CLI + skills, Sonnet-class) vs the **post-fix main
window** (current tree: H5–H10 applied) at the **same model** (Sonnet 5 via OpenRouter BYOK),
blind-judged on tool strategy + execution reliability. Destination declared iff the main window
wins-or-ties a clear majority.

Hard protocol rules (H1 lessons + PRD 0010): EPO live-search health verified before each task
batch; **no 25-minute cap**; recorded `modelId` verified in every capture; transcript integrity
checks (prompt match, model match, no cross-task contamination) before any tallying.

Run split: the human drives the 8 interactive main-window runs (defaults on carousels, allow
tools for session); bench runs headless; capture, integrity checks, first-pass tally, and
anonymized judging happen afterward from the stored transcripts. Runbook:
[H15 runbook](../assets/H15-acceptance-run/RUNBOOK.md). Scope note requirement: state whether
backend F1–F3 (`flowleap-backend` branch `fix/backend-error-shapes`, unpushed) were live on the
backend both sides hit, or excluded.
