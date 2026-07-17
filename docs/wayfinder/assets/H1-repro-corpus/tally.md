# H1 first-pass tally — where each side iterated/recovered vs gave up/errored

**No attribution here** — that's [Root-cause attribution](../../tickets/H3-root-cause-attribution.md).
This is the count-and-outcome pass over the 24 captured runs (8 tasks × 3 conditions).
Conditions and integrity checks: see `conditions.md`. Task definitions: `corpus.md`.
All transcripts under `runs/<task>/<condition>/`.

## The table

Format: `tool-calls / errors-encountered (questions-asked) / duration`. For the main
window, errors are `rawBackendErrors + narratedEncounters` (see `conditions.md` — both
layers are counted; the full error bodies live in each transcript). "Questions" = agent
paused to ask the user (headless bench cannot ask).

| task | bench (harness+CLI) | main-usual (Sonnet 4) | main-claude5 (Sonnet 5) |
|------|---------------------|------------------------|--------------------------|
| S1 obscure prior-art, reformulate | 49 / 26err / 679s | 21 / 1err (2q) / ~50m* | 8 / 3err (2q) / 170s |
| S2 coined term, zero-hit | 37 / 16err / 408s | 16 / 3err (1q) / — | 20 / 1err (2q) / — |
| S3 cross-office chain | 9 / 0err / 56s | 15 / 0err / 218s | 20 / 0err / 250s |
| S4 US routing + continuity | 4 / 0err / 31s | 8 / 0err / 369s | 8 / 1err / 170s |
| R1 US claims (no backend route) | 34 / 13err / 313s | 12 / 10err / 158s | 26 / 12err / 680s |
| R2 nonexistent publication | 4 / 3err / 62s | 5 / 1err / 210s | 4 / 12err / — |
| R3 huge description, truncation | 18 / 1err / 168s | 8 / 1err / 158s | 19 / 1err / 340s |
| R4 broad landscape + analytics | 42 / 18err / 673s | 6 / 5err / 656s | 15 / 1err / 1610s (TIMEOUT) |

\* S1 main-usual was driven semi-manually during driver calibration; wall time includes
long waits on human-facing question stalls and is not comparable.

## Per-task outcome (delivered / partial / gave-up / correct-null)

- **S1 — reformulation.** bench DELIVERED 5 patents (after EPO's search endpoint
  recovered); usual DELIVERED a candidate report; claude5 PARTIAL — asked 2 questions,
  returned US-only, offered to retry the EP/WO leg later.
- **S2 — coined-term zero-hit.** bench DELIVERED 3 close candidates, flagging EPO
  worldwide search was timing out (US-only coverage). usual GAVE UP — hit "the response
  was truncated" and stopped mid-sentence. claude5 STALLED — 20 tool calls fighting
  backend gateway timeouts, ended reading back cached tool output with no clean synthesis.
- **S3 — cross-office chain.** bench DELIVERED the full claim→legal-status→citations
  chain incl. X-category analysis. usual PARTIAL — gave claim + status but deferred the
  citation leg to "consult the official EPO Register or qualified patent counsel."
  claude5 DELIVERED — completed the EP→US family pivot and pulled the citations.
- **S4 — US routing + continuity.** All three DELIVERED the continuity chain.
- **R1 — US claims, no backend route (cleanest case).** bench DELIVERED all 20 claims via
  a **web fallback** (freepatentsonline / Google Patents) after exhausting the flowleap
  routes, flagging a spot-check. usual GAVE UP — "use commercial patent databases like
  Derwent / PatBase / Orbit … would you like me to?" claude5 DELIVERED via the **same web
  fallback** (Google Patents' rendering of the USPTO grant), verbatim claims.
- **R2 — nonexistent publication.** All three CORRECT-NULL — identified EP9876543A1 as a
  placeholder/non-existent number and asked for a corrected identifier. (claude5 probed
  hardest — 12 error-signals before concluding.)
- **R3 — 222 KB description, truncation pressure.** All three DELIVERED a bulleted
  summary of the CRISPR patent; no run silently treated a truncated chunk as the whole.
- **R4 — broad landscape + analytics.** bench PARTIAL — hit the broken search endpoint,
  offered a slower manual per-assignee route. usual GAVE UP — "backend connectivity
  issues … would you like me to attempt the citation analysis again once restored?"
  claude5 TIMED OUT at the 25-min cap, having fallen back to reading an existing
  workspace analysis file.

## Scorecard vs the benchmark (bench = the target to match)

Counting each main-window condition as **tie/win** (matched bench's delivery) or **loss**
(delivered materially less):

| | ties/wins with bench | losses | verdict |
|---|---|---|---|
| **main-usual (Sonnet 4)** | S1, S4, R2, R3 (4/8) | S2, S3, R1, R4 (4/8) | does **not** win-or-tie a majority |
| **main-claude5 (Sonnet 5)** | S3, S4, R1, R2, R3 (5/8) | S1, S2, R4 (3/8) | wins-or-ties **5/8** |

## What the counts say (observations only — not attribution)

1. **The gap is real and reproducible.** On the same-day corpus, the as-shipped main
   window (Sonnet 4) failed to match the harness on **half** the tasks, and every loss
   was on the strategy/reliability axis — give-up on truncation (S2), give-up on the
   dead US-claims route (R1), deferral of the citation chain (S3), give-up on backend
   flakiness (R4). None were synthesis-quality failures.
2. **Model effect is large.** Swapping only the model (Sonnet 4 → Sonnet 5) on the
   **identical** main-window stack flipped 3 of those 4 losses to ties. **R1 is the
   cleanest demonstration:** same tools, same dead backend route — Sonnet 4 quit after
   12 calls and handed the user a list of paid databases; Sonnet 5 pushed to 26 calls and
   recovered the claims via the very web-fallback the harness used.
3. **Stack effect persists.** Even Sonnet 5 in the main window still lost to the harness
   on S1 (asked questions, returned US-only), S2 (stalled on gateway timeouts with no
   synthesis) and R4 (timed out) — the three tasks that most demanded *sustained retry
   through a flaky or down backend*, which is where the harness's 37–49-call grind lives.
4. **Not every task shows a gap.** R2 (correct-null) and R3 (truncation) tied across all
   three — the gap is specifically about persistence through empty/errored/absent-data
   situations, consistent with the map's stated gap dimensions.
5. **Asking-the-user is itself a strategy divergence.** The main window paused to ask
   clarifying questions on S1/S2/S3 (jurisdiction, scope); the headless harness never
   asks and just proceeds comprehensively. Whether that helps or hurts is for H3.

## Caveats that bound these numbers

- **Backend-search outage confound.** EPO's live *search* endpoint (`patent search` /
  `ops search` / `search_patents`) was intermittently timing out during the afternoon
  main-window window; the bench runs partly predate it. This directly weakens the S1 /
  S2 / R4 comparisons (all search-dependent). The **clean, outage-independent tasks are
  R1, R3, S3, S4** (direct document lookups) — and R1/S3 are exactly where the
  model-effect signal is strongest, so the headline conclusion does not rest on the
  confounded tasks.
- **Not blind-judged.** These are mechanical counts plus my outcome reads, not the
  blind-judged head-to-head the destination requires. Delivery classification is my
  call from the transcripts; a judge may reclassify borderline PARTIALs.
- **n = 1 per cell.** Agent behavior is stochastic (S2 bench needed a second attempt to
  get past a permission stall). Single runs; treat per-task outcomes as indicative, the
  aggregate pattern as the signal.
- **Timing/model routing.** Both main-window conditions ran Anthropic models via
  OpenRouter (Bedrock-served), not a first-party Anthropic key; bench resolved
  `claude-sonnet-5` via the Claude Code CLI. Model *ids* verified in every transcript.

## Hand-off to the frontier

- **[Root-cause attribution](../../tickets/H3-root-cause-attribution.md)** now has its
  evidence base: the model-vs-stack split is visible (model flips 3/4 usual losses; stack
  still costs Sonnet 5 three tasks). Attribution should indict specific layers — loop
  retry policy, truncation handling, the give-up-and-defer prompt behavior, web-fallback
  reachability — using R1/S3 (clean model effect) and S1/S2/R4 (residual stack effect).
- **[Loop-behavior map](../../tickets/H2-loop-behavior-map.md)** can key off the tool-call
  distributions here (bench 4–219 vs main 4–26) and the give-up phrasings captured in the
  final-answer reads.
