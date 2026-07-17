---
id: H4
title: Design the trajectory eval gate (loop-behavior cases the promptfoo suite can't see)
type: grilling
status: open
assignee:
blocked-by: [H3]
---

## Question

What does the automated trajectory eval gate look like — the multi-turn cases and
assertions that would have caught this gap, and the harness they run in?

### Why it's blocked

The cases must encode the *diagnosed* failure modes from
[Root-cause attribution](H3-root-cause-attribution.md), not guessed ones — otherwise the
gate asserts behaviors that were never the problem.

### Scope of this ticket (design only)

Decide, via `/grilling` + `/domain-modeling`:

- **Case classes** (grounded in H3's attribution table), expected to include at least:
  empty result → must reformulate; tool error → must retry or fall back; N-step task →
  must not stop at step 1.
- **Assertion style:** trajectory-structural (did a second tool call happen after an
  empty result?) vs LLM-judge on the transcript — and how tools get mocked/replayed so
  cases are deterministic.
- **Harness:** extend the #27 promptfoo setup vs something new; coordinate with map
  0001's [CLI-skill regression gate](W7-regression-gate-design.md) so the two gates share
  machinery where sensible but stay separate axes (deliverable structure vs trajectory).

### Boundary

This ticket **designs** the gate. Wiring it into CI and making it green stays in the
map's Not-yet-specified, blocked on this design plus the fix slices it asserts against.
