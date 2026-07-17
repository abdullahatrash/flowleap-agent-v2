---
id: H1
title: Build the head-to-head repro corpus (tasks + captured transcripts)
type: task
status: open
assignee:
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

> **Note from [Map the main-window agent loop vs the Claude Code loop](H2-loop-behavior-map.md)
> (2026-07-17):** the two surfaces run *different skill packs* — the bundled patent
> skills are deliberately filtered out of Claude sessions (`claudeSkills.ts:64-75`),
> which get the CLI/plugin-dir pack instead. Record which skills each run actually
> loaded; the tally should treat skill content as a variable alongside model.

### Resolution records

Task list, per-run transcript locations, and a first-pass tally of where each side
iterated/recovered vs gave up/errored. No attribution yet — that's
[Root-cause attribution](H3-root-cause-attribution.md).
