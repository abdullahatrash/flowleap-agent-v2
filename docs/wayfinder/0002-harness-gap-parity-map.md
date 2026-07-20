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
- [Root-cause attribution](tickets/H3-root-cause-attribution.md) — the outage-independent gap
  is **model-dominated** (Sonnet 4→5 on the same stack closed 2/2 clean-task gaps; zero clean
  losses for Sonnet 5). Every give-up was a **model choice after a tool result**, never a
  loop-forced death — this **refutes H2's #1 suspect** (transient model-fetch death: 0/16
  sessions) and promotes a new top cause: web fallback is endorsed only for no-tool
  jurisdictions, so on R1 the weak model quit claiming "no web search capabilities" while
  `fetch_webpage` sat unused. H1's "residual stack effect" is an outage + test-cap artifact,
  not a same-model loop deficiency. Fixes raise the *weaker-model floor*; six slices
  graduated to **H5–H10**. Full table + evidence in [attribution asset](assets/H3-attribution.md).

- [Citation tools — empty-result strings that route forward↔backward](tickets/H7-citation-tool-routing-strings.md) —
  both citation tools' zero-result strings now lead with the sibling-tool + key-chain hint
  (forward→`search_citations` on the US **application** number via
  `get_patent_family`→`get_continuity`, and the symmetric pointer back), with the
  `citation_api_guide` pointer demoted below; targets the S3 route Sonnet 4 never found.
  Two tool files + spec updated; uncommitted in tree.

- [Design the trajectory eval gate](tickets/H4-trajectory-eval-gate-design.md) — extend the
  #27 promptfoo tree with a multi-turn **replay provider** driving the loop against scripted
  mock tools (canned EMPTY/5xx/TRUNCATED fixtures from H3 transcripts; model pinned so the
  gate fires on prompt/tool/skill drift, not model choice); assertions are
  trajectory-structural (`reactedAfter`/`reachedTool`) plus a thin LLM-judge for narrated
  give-ups; 8 cases T1–T8 incl. a bounded-grind negative control; R1/S3/R4 verified to fail
  red. Shares prompt-render + drift machinery with W7, separate axes. Full spec in
  [gate design asset](assets/H4-trajectory-gate-design.md). Wiring = fog.

- [Typed-tool errors — actionable transient-error shape](tickets/H8-transient-backend-error-shape.md) —
  new `TransientBackendError` (any 5xx after the retry budget, + client timeouts) fills the
  empty recovery-hint branch: raw nginx HTML/exception text replaced by a short status line
  plus a "this is transient, not a coverage limit — wait and retry, or try USPTO meanwhile"
  hint; flows to all tools via the existing `handlePatentToolError` path, no
  `patentToolError.ts` change needed. 43/43 client tests pass incl. new transient cases;
  uncommitted in tree.

- [Truncation — single-record lookups no longer dropped](tickets/H9-single-record-truncation-offload.md) —
  root cause was the formatter pre-emptively draining the sole-record array to `[]` BEFORE
  the harness's existing >8KB disk-offload (`read_file` pointer, default on) could catch it;
  fix = a `singleRecord` mode (narrow `isSingleRecordDocumentLookup` predicate for
  `grants/{n}` / fulltext / enrich lookups) that returns the record intact so the offload
  engages, plus an honest by-number notice replacing the nonsense "narrow the date range".
  Missing-field path (map 0001 F1/W8) untouched and test-covered; 12/12 formatter tests
  pass; uncommitted in tree.

- [Prompt — persistence/escalation ladder](tickets/H5-prompt-persistence-escalation-ladder.md) —
  new `PatentPersistenceRules` element (priority 790): before any hand-back the agent must
  exhaust reformulate → alternate office/route → web fallback; branch L re-scoped to
  backend-route-exhausted with always-available `fetch_webpage` named ("you are NOT without
  web capability" — the direct antidote to R1); transient-5xx-vs-clean-zero rule split;
  stop-and-disclose lines rewritten to retrieve-first; jurisdiction gate now
  default-comprehensive/non-blocking for prior-art/FTO-class asks (removes the S1 stall).
  Eval fixture `system-prompt.txt` regenerated — **40/40 promptfoo baseline needs a
  re-grade**. Single file + fixture; uncommitted in tree.

- [Skills — adaptive failure branches + citation routing](tickets/H6-skill-adaptive-failure-branches.md) —
  the five search-recipe skills (prior-art, FTO, invalidity, landscape, office-action) each
  gained a compact "When a search fails" 3-rung ladder echoing H5 verbatim (clean-zero →
  reformulate; 5xx → retry not coverage-limit; exhausted → `fetch_webpage` fetch-and-verify),
  voiced to each skill's stakes (e.g. FTO: a clean zero is not clearance until searched both
  ways); H7's forward-vs-backward citation routing mirrored into the four citation-discussing
  skills. No descriptions changed (routing signal preserved); uncommitted in tree.

- [Default/recommend the stronger main-window model](tickets/H10-stronger-default-model.md) —
  code-level recommended default in core `src/vs` (`findRecommendedDefaultModel`, newest
  Sonnet by display-name compare since BYOK versions are uniform), inserted as
  `configuredModel ?? recommended ?? findDefaultModel` at the single fallback choke point in
  `chatInputPart` — fires only when the user has neither configured nor picked a model, so
  explicit picks always win. Bonus finding: the old fallback was `models[0]` =
  alphabetically-first = **Haiku**, the weakest tier — that's where the reversion class
  landed. Sonnet not Opus (BYOK price tier). Typecheck 0 errors + 4-case unit suite;
  uncommitted in tree.

- [Backend — root-cause the 502/504/HTML error surfaces](tickets/H11-backend-error-root-causes.md) —
  all three surfaces are genuine backend defects distinct from the EPO outage: the `trim`
  502 is missing input validation (non-string `q` TypeErrors during cache-key construction,
  `patent-search-uspto.ts:252`, should be a 400); the raw nginx 504 HTML exists because
  `opsFetch` has NO timeout (bare `fetch()`, unlike the bounded USPTO path) so hung EPO
  sockets outlive `proxy_read_timeout`; EPO retry/backoff exists but no breaker/timeout/
  health probe and the route's 503 branch is dead. Ranked fixes F1–F6 in the
  [H11 asset](assets/H11-backend-error-root-causes.md); no H3 re-attribution — the
  model-vs-stack split stands. Fixes execute in `flowleap-backend` (PRD 0010 workstream 4).

- [Backend F1–F3 — validate q→400, opsFetch timeout, structured 503](tickets/H14-backend-error-shape-fixes.md) —
  landed in `flowleap-backend` via
  [PR #149](https://github.com/abdullahatrash/flowleap-backend/pull/149), **merged +
  deployed to production 2026-07-20** (deploy green; F1 live-verified: object-`q` →
  structured 400 on `api.flowleap.co`): non-string `q` → structured 400 before the cache-key builder (pattern
  unique to that handler, siblings audited); `opsFetch` bounded at 30s/attempt with no
  retry-on-timeout (would exceed nginx's window); new `UpstreamUnavailableError` → JSON
  503 + Retry-After with upstream HTML stripped, wired through all OPS routes. 566 tests
  green. Minor H11 correction: the 503 branch wasn't fully dead — the real gaps were
  timeouts (no throw at all) and non-503 5xx.

- [Re-grade the promptfoo baseline post-H5](tickets/H13-promptfoo-baseline-regrade.md) —
  graded live on gemini-2.5-pro (grader not downgraded): **51/52 (98.08%), zero prompt
  edits — H5's policy survived untouched**. Both "failures" were stale assertions (Path A
  now legitimately opens with `analyze_claim` under the softened gate; the Samsung case was
  the known pre-existing flake, fixed outcome-over-path). Drift check green
  (fixture byte-identical). One documented residual red: the known excess-claims
  single-turn-ungradeable case. New baseline in tree, uncommitted.

- [Implement the trajectory eval gate](tickets/H12-trajectory-gate-implementation.md) —
  built per the H4 spec in `evals/`: replay provider (loop vs scripted mock table, model
  pinned, injectable for tests), fixtures **verbatim from H1 transcripts**, cases T1–T8,
  shared plain-JS predicates so promptfoo and the offline vitest proof run identical logic
  (26 tests, incl. the offline red-check). Against the fixed tree: **8/9 deterministic
  green; T5 genuinely flaky ~50%** — the model still sometimes reads the pre-H9 truncation
  drop as "enough info" (assertion deliberately NOT loosened; run T5 advisory until the
  fixture adopts H9's offload shape or H10's stronger floor). Judge layer live via
  OpenRouter, swappable. Run: `npm run eval:trajectory`; offline proof via vitest. Also
  surfaced: pre-existing stale `extractTools.spec.ts` (asserts 20 tools, tree has 28).

- [Acceptance head-to-head](tickets/H15-acceptance-head-to-head.md) — **destination NOT reached:
  main window won 2/8** (R2, R4) vs bench at the same model (claude-sonnet-5), EPO healthy, F1–F3
  deployed. BUT the original gap class is **gone** — zero give-ups / error-deaths / commercial-DB
  deflection across all 8 runs (H5–H10 worked; H9's offload delivered US claims on R1). Losses are
  a new, milder, prompt-surface class: over-grinding a dead route (S2/S3/R4), asserting untraceable
  patent numbers/quotes (S1/R1/R4), paraphrasing when verbatim asked (R1), wrong sub-task target
  (S4). Four fixes graduated (H16–H19). Full tally: [VERDICT](assets/H15-acceptance-run/VERDICT.md).

- [Prompt — answer-grounding / anti-fabrication](tickets/H17-answer-grounding-anti-fabrication.md) —
  the trust-critical H15 fix, done solo: one `FINAL-ANSWER GROUNDING` bullet added to the
  existing `PatentEvidenceRules` element — before sending, sweep the answer and confirm every
  patent/application number, claim quote, citation, **count**, and figure traces to a real tool
  result (a lone unverified `fetch_webpage` count doesn't count); unverifiable items get omitted
  or marked "unverified", never stated as fact. Coordinates with H5 (persist to retrieve, then
  assert only what you retrieved) — no persistence line weakened. Fixture regenerated, drift
  clean; **51/52 baseline needs re-grade**. Scoped to one element to leave room for H16/H18/H19
  on the same file.

- [Prompt — H16/H18/H19 in one coherent pass](tickets/H16-anti-grind-efficiency-ceiling.md) —
  the three co-located answer/effort-discipline fixes, designed together so they don't fight:
  **H16** effort ceiling appended to `PatentPersistenceRules` (a confirmed-dead route/shape isn't
  re-run — reformulate once, one alternate, then stop; no re-summarizing a held record; one
  well-formed query over many probes) — the floor/ceiling contradiction with H5 dissolved by
  "exhaust = try each DISTINCT rung a bounded number of times"; **H18 + H19** in a new
  `PatentDeliverableRules` element (priority 775, after H17): [verbatim-completeness](tickets/H18-verbatim-completeness-rule.md)
  (reproduce every item in full or hand back the H9 offload path — no "claims 11–16 mirror 2–7")
  and [carry-the-selected-target](tickets/H19-subtask-target-selection.md) (operate on the entity
  your own answer just named, deliver the sub-result, don't merely offer). Coherent stance:
  retrieve efficiently (H16), reproduce completely (H18), assert only what you retrieved (H17).
  Fixture regenerated (466→480 lines), drift clean; **51/52 baseline needs re-grade**.

## Not yet specified

- **Second acceptance run** — after H16–H19 land, re-run the corpus (same protocol: EPO health
  check, no cap, model-id verify) to re-test the majority bar. The gap is now efficiency +
  answer-discipline, not persistence, so the rubric weight shifts accordingly.

- **Prompt precondition reconciliation** — H5 softened the top jurisdiction gate but the
  `toolDecisionTree` precondition prose (branches A/B/D/H) still says "FIRST action is the
  vscode_askQuestions carousel"; models resolve the conflict inconsistently. Suite
  tolerates both readings; reconciling the prose is a deliberate prompt-design decision
  (flagged by [H13](tickets/H13-promptfoo-baseline-regrade.md)).

- **Backend follow-ups F4–F6** — EPO circuit breaker, `/v1/ops/health` probe,
  server-level `requestTimeout` backstop; specifiable once
  [H14](tickets/H14-backend-error-shape-fixes.md)'s F1–F3 land and prove the shape.
- **The acceptance head-to-head** — the final same-model judged re-run that declares the
  gap closed; specifiable once the fix slices land. NB: the acceptance re-run must avoid the
  two artifacts that muddied H1 — capture during an EPO-search outage, and the 25-min driver
  cap that truncated legitimate grinds (see [attribution asset](assets/H3-attribution.md)).
- **Feed-in to the converge decision** — attribution found the loop is **not** structurally
  unmatchable (the gap is model + prompt/tool affordances, all fixable in-fork), so no
  hand-off to a separate convergence effort is triggered *yet*; revisit only if the same-model
  gate can't be made green with H5–H9.

<!-- The "fix slices" fog graduated on H3 close (2026-07-17): H5 (prompt escalation ladder),
     H6 (skill failure branches), H7 (citation routing strings), H8 (transient-error shape),
     H9 (single-record truncation offload), H10 (stronger default model). See
     assets/H3-attribution.md for the ranked list and sizing. -->


## Out of scope

- **Rebuilding the main window on the CLI stack** — the "one brain, two surfaces"
  convergence question is a separate effort; this map fixes the existing typed-tools
  agent in place.
- **Synthesis / report quality** — the observed gap is strategy + reliability; write-up
  depth is not the patient here.
- **Raw recall / data-layer gaps** — claim full-text, family reporting, zero-hit
  contracts belong to map 0001.
- **Improving the Claude/agents-window side** — it's the benchmark, not the patient.
