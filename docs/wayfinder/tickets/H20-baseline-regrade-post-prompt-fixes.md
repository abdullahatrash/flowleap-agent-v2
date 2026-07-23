---
id: H20
title: Re-grade the promptfoo baseline after the H16–H19 + H17 prompt fixes
type: task
status: closed
assignee: abdullahatrash
blocked-by: []
---

## Question

Since H13's 51/52 re-grade, four fixes changed the rendered system prompt: H17
(FINAL-ANSWER GROUNDING bullet in PatentEvidenceRules) and H16/H18/H19 (effort ceiling in
PatentPersistenceRules + new PatentDeliverableRules element). The baseline is stale again.
Re-grade the tool-selection suite on the post-fix prompt; fix any routing regression these
rules introduced (minimal prompt edits — the fix policies stand); commit-ready baseline with
≥ prior 51/52 pass-rate and drift check green.

### Evidence
Same harness/recipe as [H13](H13-promptfoo-baseline-regrade.md) (that resolution documents
the exact scripts, grader = gemini-2.5-pro via OpenRouter — NOT flash, credential env var,
and the two stale-assertion fixes it already made). New surface: the H17 + H16/H18/H19
bullets. Watch specifically for the anti-grind ceiling (H16) or completeness rule (H18)
perturbing tool-selection routing, and confirm the H13 excess-claims residual is unchanged.

## Resolution (2026-07-20)

Re-graded the full 52-row main suite (`promptfooconfig.yaml`, `--no-cache`) against the
post-H16/H17/H18/H19 prompt on the default model-under-test `google/gemini-2.5-pro` via
OpenRouter (`OPENROUTER_API_KEY` present in env; grader left as configured — NOT downgraded
to flash; `EVAL_MODEL` unset so the provider default `google/gemini-2.5-pro` applied).

**Pass-rate:** before (H13 baseline) **51/52 = 98.08%** → after **52/52 = 100%**.
The `compare-baseline` gate is green (100.0% vs the new 100.0% baseline). No routing
regression from any of the four new rules.

**Prompt edits:** none. **Assertion edits:** none. The four fix policies survived untouched
— H17 (FINAL-ANSWER GROUNDING bullet in `PatentEvidenceRules`), H16 (effort ceiling in
`PatentPersistenceRules`), and H18/H19 (`PatentDeliverableRules` verbatim-completeness +
carry-selected-target) are all still in the rendered prompt as written and introduced no
mis-routing. Every tool-selection case, including the two H13 relaxed (Path A claim→prior-art
opener; Samsung EP outcome-over-path), still passes.

**Drift check:** green — `check-prompt-drift.ts` reports no drift; `system-prompt.txt` is
byte-identical to a fresh `render-system-prompt.tsx` render (the fix agents had already
regenerated it). `tool-definitions.json` re-extracted (33 defs) with no change.

**The H13 excess-claims residual flipped from red to green — not a new break, a beneficial
side-effect of the H16 effort ceiling.** The `filing-fees.yaml` excess-claims case previously
failed single-turn grading because the model double-called `search_legal` to "verify" the
EPO/USPTO thresholds before computing, so the graded turn never contained the `7`/`2` counts.
Under the H16 anti-grind ceiling the model now answers directly in text with **zero tool
calls** — computing 22−15=7 (EPO) and 22−20=2 (USPTO) with the required "verify amounts against
the official schedule" caveat — exactly what the user asked for ("just the counts"). All three
of that case's assertions (`excess_claims_epo_count_seven`, `excess_claims_uspto_total_count_two`,
`excess_claims_caveats_amounts`) now pass. The `excess_claims eval redesign` follow-up is
therefore no longer forced by a false-negative, though a dedicated multi-turn harness would
still be the robust long-term fix.

**Deliverables left in the tree (uncommitted; parent session commits):**
`evals/output/baseline.json` (updated to 52/52, passRate 1.0, notes rewritten for H20) and the
regenerated `evals/output/latest.json` run output (gitignored). No dataset or prompt files were
touched this round; the `search-strategy.yaml` / `tool-selection.yaml` / `system-prompt.txt`
diffs already in the working tree are the H13 assertion fixes and the H16–H19 render, not H20
edits.
