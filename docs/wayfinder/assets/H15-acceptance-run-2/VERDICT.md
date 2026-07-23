# Second acceptance head-to-head — verdict (2026-07-21)

**Result: destination REACHED (with one confound noted).** Post-H16–H19 main window vs
bench, both `anthropic/claude-sonnet-5`, clean empty workspace (`Acceptance Run 2`), 8-task
corpus, blind-judged per task. **Main window: 6 wins, 1 tie, 1 loss** → **7/8 win-or-tie**,
clearing the map's "win-or-tie a clear majority" bar. Run 1 was 2/8.

## Per-task (OVERALL, decoded)

| Task | Winner | vs run 1 | Why |
|---|---|---|---|
| S1 obscure prior art | **TIE** | loss→tie | bench owns the CPC pivot; main owns verifiability + clean X/Y/A deliverable; main's one untraceable cite gone vs run 1 |
| S2 coined term | **main** | loss→win | main decomposed the coined term + delivered 3 grounded candidates; **bench produced a non-answer (stalled at a consent prompt, 0 searches)** ⚠ |
| S3 X-citations | **main** | loss→win | main demonstrated the forward→backward citation recovery (H7) + withheld 2 unverifiable records (H17 grounding); both correct |
| S4 DeepMind continuity | **main** | loss→win | main cracked the assignee syntax directly + delivered chain for the named target (H19); bench hit repeated 0-result assignee failures |
| R1 US claims verbatim | **bench** | loss→loss | both delivered verbatim claims (main's paraphrase gone — H18 working), but main took a 30-call detour discovering `enrich=claims`; bench found FreePatentsOnline cleanly |
| R2 nonexistent patent | **main** | win→win | main's bounded cross-route + web verification beat bench's single-source null |
| R3 222KB description | **main** | loss→win | both cleared the paging trap; main's per-bullet paragraph citations were tighter-grounded |
| R4 analytics grind | **main** | win→win | main answered all 3 sub-questions with traceable numbers; **bench never got past setup (blocked mkdir/terminal, 0 findings)** ⚠ |

## The confound — be honest about it

Two of main's six wins (**S2, R4**) are inflated by **bench harness failures**, not pure main
outperformance: the headless `claude -p` bench stalled at a consent prompt on S2 (0 searches
run) and thrashed on blocked `mkdir`/terminal-redirect on R4 (0 findings). These are almost
certainly artifacts of the bench *test harness* (allowed-tools / scratch-dir sandbox friction I
introduced), since the same bench ran S2 in 23 calls and R4 in 94 calls cleanly in run 1. They
are not fair evidence of main > bench.

**Conservative read, excluding S2 + R4 entirely:** of the remaining 6 tasks main wins S3, S4,
R2, R3, ties S1, loses R1 = **5/6 win-or-tie**. Still a clear majority. The destination holds
whether or not the two confounded tasks are counted.

## What changed since run 1 — the fixes worked

Every task main LOST in run 1 that it now wins or ties maps to a specific fix:
- **S1 loss→tie**: the untraceable #5-patent fabrication is gone (H17 grounding).
- **S2 loss→win, S3 loss→win**: over-grinding down (S2 82→46 calls, S3 43→21), still complete (H16).
- **S4 loss→win**: operated on the named target and delivered the chain, not an offer (H19).
- **R3 loss→win**: full paging + grounded bullets (H18 completeness).
- **R1 loss→loss BUT paraphrase→verbatim**: H18 fixed the completeness; the residual is
  efficiency (enrich=claims discoverability) → new ticket H22.

Across all 16 transcripts: **zero give-ups, zero flagged fabrications on the main side** (judges
explicitly credited main withholding unverifiable records on S3 and disclosing weak seams on R4).
The original give-up gap is gone; the run-1 over-claim/over-grind class is largely closed; one
efficiency rough edge (R1) remains and is charted.

## Caveats carried

- **Blinding**: stacks identifiable by tool names (CLI verbs vs typed tools) — judged on cited
  evidence, not brand.
- **Bench harness confound** on S2/R4 (above) — an airtight number would re-run those two bench
  tasks with fixed sandbox/allowed-tools; the verdict does not depend on it.
- Integrity: all 16 transcripts prompt-matched, model-matched (claude-sonnet-5), no cross-task
  contamination; the workspace-contamination that invalidated the first attempt was fixed by the
  fresh `Acceptance Run 2` workspace.
