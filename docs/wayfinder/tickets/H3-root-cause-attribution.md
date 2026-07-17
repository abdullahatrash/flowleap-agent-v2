---
id: H3
title: Root-cause attribution — split the gap across model / loop / tools / skills / prompt
type: grilling
status: open
assignee:
blocked-by: [H1, H2]
---

## Question

Given the repro transcripts and the loop-behavior map, how much of the observed gap
belongs to each layer — **model**, **agent loop**, **typed-tool design/error shapes**,
**skill content/routing**, **system prompt** — and what is the ranked fix list?

### Method

- The model-control runs from the repro corpus (main window on a Claude-class model)
  isolate model effect first: whatever survives the same-model comparison is stack.
- Walk each main-window failure in the transcripts against the loop map: was the give-up
  forced by the loop (hit a stop condition), invited by an error shape (dead-end
  message), or chosen by the model despite retry being available (prompt/skill gap)?
- Use `/diagnose` discipline: every attribution needs a transcript citation, no
  theorizing past the evidence (see memory `patent-ai-disabled-by-chat-setup-migration` —
  probe, don't theorize).

### Resolution records

An attribution table (failure → layer → evidence) and a **ranked fix list** sized into
ticket-shaped slices. On resolution, graduate the fix slices out of the map's
Not-yet-specified into real tickets, and unblock
[Trajectory eval gate design](H4-trajectory-eval-gate-design.md).
