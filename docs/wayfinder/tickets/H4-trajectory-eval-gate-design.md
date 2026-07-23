---
id: H4
title: Design the trajectory eval gate (loop-behavior cases the promptfoo suite can't see)
type: grilling
status: closed
assignee: abdullahatrash
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

## Resolution (2026-07-17)

**Harness:** extend the #27 promptfoo setup with a new *multi-turn replay provider*
(`trajectory-provider.ts`) that runs the agent loop locally against a **scripted mock tool
table** — reusing the existing prompt renderer, `tool-definitions.json`, BYOK provider auth,
model pin (`gemini-2.5-pro`, held fixed so the gate fires on prompt/tool/skill drift, not model
choice), drift check, and baseline-compare; adding only the loop driver + fixture executor.
Rejected: driving the real workbench headless (can't script 504s/truncation deterministically —
that's the acceptance run's job), a standalone runner (loses shared machinery + risks diverging
prompts from W7), and LLM-judge-as-primary (non-deterministic).

**Assertion style:** primarily **trajectory-structural** (`reactedAfter` / `reachedTool`
predicates over the ordered tool-call sequence: did a *different* call N+1 happen after mock-result
N was tagged EMPTY / 5xx / TRUNCATED, before any give-up text), with a thin **LLM-judge** layer
for the one linguistic fact structure can't see — whether `finalText` narrates a give-up /
coverage limitation. A give-up case fails red on **either**; the H3 give-ups fail on both. All
failure conditions are canned fixtures copied from H3 transcripts — never live.

**Eight cases (T1–T8)**, each grounded in an H3 row and citing the corpus task it catches:
T1 backend-route-exhausted→web fallback [R1]; T2 empty citation→sibling tool + app-number chain
[S3/H7]; T3a/b transient 5xx→retry not disclose [R4/S2/H8]; T4 multi-step chain→don't stop at step
1 [S3/S4]; T5 single-record truncation-drop ≠ no-data [R1/H9]; T6 true zero-hit→reformulate
[H2#2]; T7 negative control: correct-null, no infinite retry [R2/R3/S4 — guards against rewarding
grinding]; T8 (optional) jurisdiction-gate non-block on comprehensive requests [S1/H5e].

**Would-it-have-caught check:** R1, S3, and R4's give-up leg each fail red (double-red on
structure + judge); confounded S2 is correctly **not** forced red (its loss was a 25-min-cap
artifact per H3, protected by the T7 bounded-grind control) — the honest outcome.

**Coordination with W7:** shares the `evals/` tree, BYOK auth, `render-system-prompt.tsx` +
drift check (both gates must assert the same rendered prompt), `tool-definitions.json`,
`compare-baseline.ts`, and the invented-tool guard. Separate: the loop driver + mock executor +
`fixtures/trajectory/` are H4-only; W7 grades deliverable *structure*, H4 grades tool-call
*trajectory* under scripted failure. Two axes, one machine.

Full design (case table, mock/fixture format, provider sketch, risk register) in
[H4-trajectory-gate-design.md](../assets/H4-trajectory-gate-design.md).
