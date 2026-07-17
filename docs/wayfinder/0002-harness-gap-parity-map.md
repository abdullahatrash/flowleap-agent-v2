<!-- wayfinder:map -->
# Map: Close the Claude-harness vs Patent AI agent trajectory gap

> Local-markdown wayfinder tracker (same conventions as map 0001). Tickets live in
> `./tickets/` with `H`-prefixed ids. Front-matter: `type`, `status` (open|closed),
> `assignee` (empty = unclaimed), `blocked-by` (list of ticket ids). The **frontier** =
> open + unblocked + unassigned tickets. **Never resolve more than one ticket per
> session.** Refer to tickets by name, not id.

## Destination

The main-window Patent AI agent **wins-or-ties the Claude harness** (agents window,
flowleap CLI + skills) on **tool strategy** (iterates, reformulates queries, recovers from
errors/empty results) and **execution reliability** in a **same-model, blind-judged
head-to-head** over the repro corpus — and an **automated trajectory eval gate** asserts
loop behavior so this gap class can't ship green again. We arrive when the judged
head-to-head shows win-or-tie on a clear majority of tasks and the trajectory gate is
designed and grounded in the diagnosed failure modes.

## Notes

- **Observed gap (2026-07-17, founder report):** Claude in the agents window (Claude Code
  harness + flowleap CLI + CLI skills) finds better results than the main-window Patent AI
  agent (28 typed tools + 25 bundled skills). Gap dimensions: **tool strategy** and
  **execution reliability** — NOT synthesis quality, NOT raw data recall. The comparison
  ran on **different models** (agents window = Claude-class; main window = other BYOK
  model), so model effect must be separated from stack effect before any fix.
- **Why evals stayed green:** the promptfoo suite (#27, 40/40 on gemini-2.5-pro) grades
  one-shot tool *selection* at prompt level; it never measures loop persistence, retry,
  or error recovery. See memory `promptfoo-evals-ported-byok`.
- **Fix scope:** anything in the fork — agent loop, prompt, typed tools, skills,
  retry/error handling, including borrowing loop behaviors from the Claude harness.
  Wholesale rebuild of the main window on the CLI stack is OUT of scope (separate
  converge decision).
- **Adjacent effort:** map 0001 (data layer / deliverable quality) — its
  [regression-gate ticket W7](tickets/W7-regression-gate-design.md) gates CLI *deliverable
  structure*; this map's gate targets main-window *trajectory* behavior. Coordinate
  harness choices, don't merge them.
- **Skills to consult per session:** `/diagnose` (attribution), `/grilling`,
  `/domain-modeling` (eval-gate design), `/launch` (drive the main window for repro runs).
- **Standing preference:** every comparative claim must come from captured transcripts,
  not memory; the same-model control (main window on a Claude model via BYOK Anthropic
  key) is mandatory in every head-to-head.

## Decisions so far

<!-- one line per closed ticket; the ticket holds the detail -->

- [Build the head-to-head repro corpus](tickets/H1-repro-corpus.md) — 24 verified runs
  (8 tasks × bench/Sonnet-4/Sonnet-5) prove the gap reproduces: as-shipped Sonnet 4 ties
  the harness on only 4/8, all losses on strategy/reliability; the **model control shows a
  large model effect** (Sonnet 5 on the same stack wins-or-ties 5/8, flipping 3 losses) on
  top of a **residual stack effect** (Sonnet 5 still loses S1/S2/R4 to the harness's
  sustained-retry grind). Cleanest case R1: same dead US-claims route, Sonnet 4 quits at 12
  calls, Sonnet 5 recovers via web-fallback at 26. Evidence base + tally in
  `assets/H1-repro-corpus/`. Caveat: EPO search outage confounds S1/S2/R4.
- [Map the main-window agent loop vs the Claude Code loop](tickets/H2-loop-behavior-map.md) —
  the loop skeleton is NOT the divergence (both sides feed tool errors back to the model
  and persist); the gap candidates are transient-fetch death outside autopilot, dead-end
  zero-hit strings + absent zero-result/error rules in prompt & skills, hint-less generic
  backend errors, and a skill-pack mismatch between surfaces — ranked list in the
  [behavior-map asset](assets/H2-loop-behavior-map.md).

## Not yet specified

- **The fix slices** — which layers get patched (loop retry policy? tool error shapes?
  empty-result contracts? prompt rules? skill routing?) is unknowable until
  [Root-cause attribution](tickets/H3-root-cause-attribution.md) lands; expect one ticket
  per indicted layer.
- **Wiring the trajectory gate** — running the designed gate in CI and making it green is
  downstream of the gate design and the fix slices it asserts against.
- **The acceptance head-to-head** — the final same-model judged re-run that declares the
  gap closed; specifiable only once fixes exist.
- **Feed-in to the converge decision** — if attribution shows the Claude Code loop is
  structurally unmatchable from inside the fork, that evidence hands off to a separate
  convergence effort (it does not widen this map).

## Out of scope

- **Rebuilding the main window on the CLI stack** — the "one brain, two surfaces"
  convergence question is a separate effort; this map fixes the existing typed-tools
  agent in place.
- **Synthesis / report quality** — the observed gap is strategy + reliability; write-up
  depth is not the patient here.
- **Raw recall / data-layer gaps** — claim full-text, family reporting, zero-hit
  contracts belong to map 0001.
- **Improving the Claude/agents-window side** — it's the benchmark, not the patient.
