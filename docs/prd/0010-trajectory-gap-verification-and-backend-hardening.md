# PRD 0010 · Trajectory-gap verification: eval gate wiring, baseline re-grade, acceptance head-to-head, and backend error-surface hardening

Source: wayfinder map 0002 ([docs/wayfinder/0002-harness-gap-parity-map.md](../wayfinder/0002-harness-gap-parity-map.md)), tickets H1–H10 resolved 2026-07-17 on branch `wayfinder-0002-h1-h2` (`fe2df66e28d`); backend root-cause investigation H11 (in flight — see Further Notes). Every claim below traces to a captured transcript or a file:line finding in the map's assets.

## Problem Statement

The founder observed the Claude harness (agents window, flowleap CLI + skills) out-searching the main-window Patent AI agent despite a green 40/40 promptfoo baseline. A 24-run controlled head-to-head (8 tasks × bench / Sonnet-4 / Sonnet-5) proved the gap real and attributed it: **model-dominated** (the fork's fallback default was literally the alphabetically-first model — Haiku; swapping to Sonnet 5 on the identical stack closed every clean-task gap), with fork-side affordance gaps that lower the weaker-model floor (give-up-inviting prompt rules, dead-end zero-result strings, hint-less transient errors, a formatter that threw away oversized single records).

Six fix slices plus a trajectory-eval-gate design have now **landed** (H4–H10, all uncommitted work since pushed). What remains is the part that makes the fix trustworthy and durable — and it is currently missing entirely:

1. **Nothing asserts trajectories.** The promptfoo suite grades one-shot tool *selection*; it stayed 40/40 through the whole regression. The gate that would have caught it (H4's design: replay provider, cases T1–T8) exists only as a design asset.
2. **The existing baseline is stale.** H5 rewrote the rendered system prompt (`evals/prompts/system-prompt.txt` regenerated); the 40-example tool-selection baseline has not been re-graded against it, so today the eval suite proves nothing.
3. **The gap has not been re-measured post-fix.** H1's corpus run was confounded on 3 of 8 tasks by an EPO live-search outage and a 25-minute test-driver cap. The map's destination — same-model, blind-judged win-or-tie — has no post-fix evidence yet.
4. **The backend still emits the error shapes the agent had to learn to survive.** The corpus captured a `502 … odpRequest.q?.trim is not a function` TypeError leaking internal exception text, raw nginx `504 Gateway Time-out` HTML bodies reaching the model, and pass-through EPO flakiness with no backoff. H8 taught the *client* to react well; the *source* is unfixed (H11 is root-causing it in `flowleap-backend`).

## Solution

Four independent workstreams, each sliceable to one agent session unless noted:

- **Trajectory gate implementation** — build H4's design in the `evals/` tree: a multi-turn replay provider driving the agent loop against a scripted mock tool table, fixtures canned from the H1 transcripts (EMPTY / 5xx / TRUNCATED), cases T1–T8 with structural `reactedAfter`/`reachedTool` assertions plus the thin LLM-judge give-up check, model pinned to the eval model so the gate fires on prompt/tool/skill drift. Green against the landed H5–H9 fixes; the T7 bounded-grind negative control must also pass (no infinite-retry reward).
- **Baseline re-grade** — re-run the 40-example tool-selection suite against the regenerated system prompt; fix any routing regressions the H5 edits introduced; commit the new baseline. Cache makes assert-only iteration cheap; one paid grading pass is expected.
- **Acceptance head-to-head** — re-run the 8-task corpus per the H1 protocol (`assets/H1-repro-corpus/conditions.md`), bench vs post-fix main window at the same Claude-class model, transcripts captured, blind-judged on the two gap dimensions. Hard protocol requirements learned from H1: verify the EPO live-search endpoint is healthy for the whole run window, remove the 25-minute driver cap, verify the recorded `modelId` in every capture (picker choices historically didn't stick). Destination declared iff win-or-tie on a clear majority.
- **Backend error-surface hardening** — fix the three surfaces at the source in `flowleap-backend` (root-caused with file:line evidence in the [H11 asset](../wayfinder/assets/H11-backend-error-root-causes.md); tree `c7f1bc6`), ranked:
  - **F1 — validate `q` → 400** (small): `patent-search-uspto.ts:252` guards only null/undefined; a non-string `q` (the R1 agent sent `{"match":{…}}`) TypeErrors during cache-key construction and `mapProviderError` turns it into a 502 leaking the internal variable name. Validate the body (`:240` is a type-cast today) and answer 400 with a schema hint.
  - **F2 — AbortController timeout on `opsFetch`** (small, highest reliability leverage): `ops/fetch.ts:52-56` is a bare `fetch()` with no timeout, unlike the bounded USPTO path (`fetch-with-retry.ts:115`); a hung EPO socket makes the up-to-25-doc `Promise.all` fan-out (`ops/direct.ts:707-714`) outlive nginx's `proxy_read_timeout`, so nginx answers with HTML.
  - **F3 — structured transient 503 + Retry-After** (medium): EPO 5xx currently throws a plain `Error` → generic 502; the route's 503 branch (`ops/search.ts:168`) is dead. Map EPO 5xx/timeouts to a JSON 503 with Retry-After; strip upstream HTML.
  - **F4 — EPO circuit breaker**, **F5 — `/v1/ops/health` cheap probe**, **F6 — server-level `requestTimeout` backstop** (`server.ts:250`): follow-ups once F1–F3 land.

  These execute in the backend repo and coordinate with map 0001's W3 zero-hit contract rather than duplicating it (H11 flagged for W3: OPS and USPTO return inconsistent zero-hit shapes, and the `count:1`-with-empty-bag truncation phantom belongs to F1/H9's territory).

## User Stories

### Trajectory gate

1. As a maintainer editing the patent prompt or a tool string, I want a gate that replays scripted empty-result/5xx/truncation turns and fails red if the agent gives up without working the escalation ladder, so that the trajectory-gap class can never ship green again.
2. As a maintainer, I want the gate's failure fixtures copied verbatim from real captured transcripts, so that red means "the real regression came back", not "a synthetic case drifted".
3. As a maintainer, I want the gate to include a bounded-grind negative control, so that raising the give-up bar never silently rewards infinite retries.
4. As a reviewer, I want the gate runnable with one npm script sharing the existing evals machinery (prompt render, drift check, BYOK auth), so that running it costs nothing to learn.

### Baseline re-grade

5. As a maintainer, I want the 40-example tool-selection baseline re-graded against the post-H5 rendered prompt, so that a green eval suite is evidence again instead of a stale artifact.
6. As a maintainer, I want any routing regression introduced by the persistence-ladder edits caught and fixed in the same pass, so that the persistence gains don't cost tool-selection accuracy.

### Acceptance head-to-head

7. As the founder, I want the 8-task corpus re-run at the same model on both surfaces after the fixes, blind-judged, so that "the gap is closed" is a measured claim, not a vibe.
8. As the judge of that run, I want every capture to record the actual resolved model id and the EPO endpoint's health during the window, so that no verdict rests on a confounded run again.

### Backend hardening

9. As an agent (any harness) sending a malformed search body, I want a structured 400 naming the bad field, so that I can self-correct instead of reading a 502 with a stack fragment.
10. As an agent during an EPO wobble, I want the backend to answer with structured JSON (status, retry-after) within a bounded time, so that I never parse nginx HTML and never mistake an outage for a coverage limit.
11. As a maintainer, I want upstream flakiness absorbed by bounded backend retry/backoff, so that transient blips don't reach users as failures at all.

## Implementation Decisions

- **Gate lives in the existing `evals/` tree** and shares `render-system-prompt` + drift check with the tool-selection suite and (by design) map 0001's W7 deliverable-structure gate — one machine, separate axes. The replay provider and `fixtures/trajectory/` are gate-private.
- **The gate's model stays pinned** (the established eval model, currently gemini-2.5-pro). It measures prompt/tool/skill drift at a fixed model; it is explicitly *not* the same-model acceptance instrument.
- **Structural assertions are primary; the LLM judge is a thin secondary** for narrated give-ups only. A case fails red on either.
- **Acceptance protocol reuses H1's assets** (`corpus.md`, `conditions.md`, `probes.md`) unchanged except: EPO health pre-check per task batch, no driver time cap, per-capture model-id verification. Judged blind on tool strategy + execution reliability, same rubric as the H1 tally.
- **Backend fixes execute in `flowleap-backend`**, not the agent repo; the client-side `TransientBackendError` (H8) stays as defense-in-depth regardless. Backend slices are enumerated by the H11 asset (`docs/wayfinder/assets/H11-backend-error-root-causes.md`) and must respect the deployed-vs-tree distinction (backend main has unpushed commits).
- **W3 boundary:** zero-hit *contract* design belongs to map 0001's W3; this PRD's backend work touches error paths (4xx/5xx/timeouts), not the shape of successful empty results.

## Testing Decisions

- The trajectory gate is itself the test artifact of workstream 1; its own acceptance is: all T1–T8 red against the pre-fix prompt (checked out from history into a scratch render), green against the landed fixes.
- The baseline re-grade's acceptance is a committed new baseline file with ≥ the prior pass-rate, plus the drift check green.
- The acceptance head-to-head produces the same artifact set as H1 (per-run transcripts + tally) committed to the map's assets; the verdict line lands on the map as the closing decision.
- Backend fixes ship with route-level tests for the 400/504-JSON/backoff behaviors in the backend repo's own test suite.

## Out of Scope

- Rebuilding the main window on the CLI stack (the standing converge decision; map 0002 Out-of-scope).
- Synthesis/report quality and data-coverage gaps (map 0001 owns claim full-text, family parity, zero-hit contract W3).
- Improving the Claude/agents-window side — it remains the benchmark.
- CI scheduling/wiring of the gate beyond an npm script (workflow files are deliberately minimal in this fork; wiring into the PR gate is a follow-up decision once the gate is stable).

## Further Notes

- Map of record: [docs/wayfinder/0002-harness-gap-parity-map.md](../wayfinder/0002-harness-gap-parity-map.md). Key assets: [H3 attribution](../wayfinder/assets/H3-attribution.md), [H4 gate design](../wayfinder/assets/H4-trajectory-gate-design.md) (authoritative spec for workstream 1), [H1 corpus](../wayfinder/assets/H1-repro-corpus/corpus.md).
- **H11 landed** (closed 2026-07-17): workstream 4's F1–F6 slices above are its ranked output, file:line-anchored against backend tree `c7f1bc6`. Notably it confirmed **no re-attribution** of H3's verdicts — the model-vs-stack split stands; the backend defects are floor-raising fixes, not corrections to who lost which task.
- Workstreams 1, 2, and 4 are mutually independent and agent-grabbable immediately; the acceptance head-to-head (3) must run **last**, after 1/2 prove the tree healthy and 4's fixes are deployed or explicitly excluded from the run's scope note.
