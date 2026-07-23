---
id: W7
title: Design the CLI-skill regression gate (golden cases + invariants)
type: grilling
status: open
assignee:
blocked-by: []
---

## Question

What does the regression gate that locks CLI-skill deliverable quality look like — which golden
cases, which structural invariants, and how is it wired so quality doesn't decay on the next
skill edit?

Every quality claim in the evaluation rests on hand-review. A promptfoo baseline exists for
panel chat (#27) but nothing asserts the *deliverable structure* of CLI-skill outputs. Without a
gate, the ~9 decays with drift (exactly the #150 stale-skill / removed-flag cascade pattern).

### Scope of this ticket (design only)
Decide, via `/grilling` + `/domain-modeling`:
- The invariants to assert on a recipe deliverable: **X/Y/A tags present per feature**,
  **one-row-per-family dedup**, **effective-date / priority reasoning present**,
  **all-elements FTO columns (literal + DoE)**, no tooling-caveat when the data is now retrievable.
- The golden case set (~a dozen: prior-art + FTO across US/EP, incl. a zero-hit case and a
  multi-member-family case that would catch F2/F3 regressions).
- The harness (extend the #27 promptfoo setup vs a new one) and the assertion style
  (structural/regex vs LLM-judge).

### Boundary
This ticket **designs** the gate. *Wiring it into CI and making it green* is fog in the map's
Not-yet-specified — it's blocked on this design plus the data + ergonomics fixes it asserts against.
