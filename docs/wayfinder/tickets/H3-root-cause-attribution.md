---
id: H3
title: Root-cause attribution — split the gap across model / loop / tools / skills / prompt
type: grilling
status: closed
assignee: abdullahatrash
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

---

## Resolution (2026-07-17)

Full attribution: **[assets/H3-attribution.md](../assets/H3-attribution.md)** — the
per-failure attribution table (with transcript + `file:line` evidence and confidence), the
model-vs-stack split, the H2-suspect reckoning, and the ranked fix list.

**Answer in brief.** The measurable, outage-independent gap is **model-dominated**: on the
four clean corpus tasks, swapping only Sonnet 4 → Sonnet 5 on the identical fork stack closed
**both** gaps (R1, S3) and left Sonnet 5 with **zero** clean-task losses. Every main-window
give-up was a **model choice narrated after a tool result** — never a loop-forced turn death.
This **refutes H2's #1 suspect** (transient model-fetch death: zero instances in 16 sessions)
and promotes a **new** top cause not in the H2 list: the prompt endorses web fallback only for
no-tool jurisdictions, never for *backend-route-exhausted*, so on R1 the weak model asserted
it had "no web search capabilities" and quit while `fetch_webpage` sat unused (the strong
model used it and delivered). H1's "residual stack effect" (Sonnet 5 losing S1/S2/R4) does
**not** survive scrutiny: all three are the EPO-outage-confounded tasks, and the losses are
outage + 25-min test-driver-cap artifacts, not demonstrated same-model loop deficiencies.

The fork-side fixes are still warranted — they raise the *weaker-model floor* (the map's
destination is same-model win-or-tie). Six fix slices graduated to tickets:

- **[H5](H5-prompt-persistence-escalation-ladder.md)** — prompt escalation ladder +
  web-fallback-on-exhaustion + search-error rule (highest lever; flips R1).
- **[H6](H6-skill-adaptive-failure-branches.md)** — skill failure branches + citation routing
  (blocked-by H5).
- **[H7](H7-citation-tool-routing-strings.md)** — citation empty-result strings that route
  forward↔backward + name the US-app-number chain (flips S3).
- **[H8](H8-transient-backend-error-shape.md)** — actionable transient-error hint for generic
  5xx/gateway/timeout (confirms H2 #3; outage-confounded magnitude).
- **[H9](H9-single-record-truncation-offload.md)** — offload/paginate single-record document
  lookups instead of dropping the whole item (helps R1; coordinate map 0001 F1).
- **[H10](H10-stronger-default-model.md)** — default/recommend the stronger model (biggest
  real-world lever, but does **not** close the same-model gap; H5–H9 do).

Unblocks [H4](H4-trajectory-eval-gate-design.md): the eval gate now has the diagnosed failure
modes to encode.
