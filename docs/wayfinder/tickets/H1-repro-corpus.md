---
id: H1
title: Build the head-to-head repro corpus (tasks + captured transcripts)
type: task
status: closed
assignee: abdullahatrash
blocked-by: []
---

## Question

Produce the evidence base the whole map runs on: a small corpus of gap-exercising tasks,
each run on both surfaces with transcripts captured — so the gap stops being anecdotal.

### What to build

- **~8 tasks** chosen to exercise the two observed gap dimensions:
  - **Tool strategy:** tasks where the first query plausibly returns nothing or the wrong
    slice, so success requires reformulating, chaining, or retrying (e.g. prior-art hunt
    with an obscure term, a search that needs CQL narrowing, a multi-step
    details→claims→citations chain).
  - **Execution reliability:** tasks known to brush against tool errors, empty results,
    or truncation in the main window.
- **Three runs per task:**
  1. Agents window (Claude harness + flowleap CLI + skills) — the benchmark.
  2. Main window Patent AI agent on its **usual BYOK model** — the as-observed condition.
  3. Main window Patent AI agent on the **same Claude-class model via BYOK Anthropic
     key** — the model control that separates model effect from stack effect.
- **Captured transcripts** for every run (full tool calls, errors, retries, final
  answer), stored as an asset directory linked from this ticket on resolution.

### Resolution records

Task list, per-run transcript locations, and a first-pass tally of where each side
iterated/recovered vs gave up/errored. No attribution yet — that's
[Root-cause attribution](H3-root-cause-attribution.md).

---

## Resolution (2026-07-17)

**24 runs captured and verified: 8 tasks × 3 conditions.** The gap is no longer
anecdotal — it reproduces, and the model control isolates a large model effect on top of
a residual stack effect.

### Assets (all under `../assets/H1-repro-corpus/`)

- **`corpus.md`** — the 8 tasks (S1–S4 tool-strategy, R1–R4 execution-reliability), each
  with the trap it exercises and ground-truth verified live against `api.flowleap.co`.
- **`conditions.md`** — the 3 run conditions, model ids, interaction policy, and the
  transcript-integrity checks (incl. two problems caught and re-run: a stdin-contaminated
  bench S2, and a main-window model-reversion that would have destroyed the control).
- **`probes.md`** — the backend ground-truth probes behind the task traps.
- **`tally.md`** — the first-pass tally: counts table, per-task outcomes, scorecard, and
  caveats (incl. the EPO-search-outage confound on S1/S2/R4).
- **`runs/<task>/{bench,main-usual,main-claude5}/`** — the raw transcripts. Bench =
  `transcript.jsonl` (Claude Code stream-json). Main window = `session.jsonl` (chat
  session store; full tool calls, error bodies, retries, final answer).

### Conditions (see `conditions.md` for detail)

1. **bench** — Claude Code harness + flowleap CLI 0.3.5 + skills, model `claude-sonnet-5`.
2. **main-usual** — main-window Patent AI agent, as-found model `Anthropic: Claude
   Sonnet 4` (OpenRouter BYOK).
3. **main-claude5** — same main-window stack, model `Anthropic: Claude Sonnet 5`
   (OpenRouter BYOK) — the control that separates model effect from stack effect.

### First-pass tally headline (full detail + caveats in `tally.md`)

- **main-usual (Sonnet 4) does NOT win-or-tie a majority** — ties bench on 4/8, loses on
  4/8, every loss on the strategy/reliability axis (gave up on truncation S2, on the dead
  US-claims route R1, deferred the citation chain S3, quit on backend flakiness R4).
- **main-claude5 (Sonnet 5) wins-or-ties 5/8** — swapping only the model on the identical
  stack flipped 3 of the 4 usual losses to ties.
- **Cleanest signal, R1 (US claims, no backend route):** same tools, same dead route —
  Sonnet 4 quit after 12 calls and handed the user a list of paid databases; Sonnet 5
  pushed to 26 calls and recovered the claims via the same web-fallback the harness used.
- **Residual stack effect:** even Sonnet 5 lost to bench on S1/S2/R4 — the tasks needing
  sustained retry through a flaky/down backend, where the harness's 37–49-call grind wins.

No attribution of *why* — that is [Root-cause attribution](H3-root-cause-attribution.md),
which now has its evidence base.

### Caveat carried forward

EPO's live *search* endpoint was intermittently timing out during the main-window run
window, confounding the search-dependent tasks (S1/S2/R4). The outage-independent tasks
(R1/R3/S3/S4) carry the headline conclusion; noted in `tally.md` and worth factoring into
H3.
