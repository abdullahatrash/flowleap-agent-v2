---
id: H15
title: Acceptance head-to-head — bench vs post-fix main window, same model, blind-judged
type: task
status: open
assignee: abdullahatrash
blocked-by: []
---

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
