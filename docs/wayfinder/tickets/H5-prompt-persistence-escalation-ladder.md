---
id: H5
title: Prompt — persistence/escalation ladder + web-fallback-on-exhaustion + search-error rule
type: task
status: closed
assignee: abdullahatrash
blocked-by: []
---

## Question

The patent system prompt lets the model hand back ("would you like me to retry?" / "consult
qualified counsel" / "use commercial databases") as readily as it retries, and its only
web-fallback rule is scoped to offices with no dedicated tool — never to the case where a
backend route *exists but has no data*. That combination produced the corpus's single
biggest failure (R1: the model asserted it had "no web search capabilities" and quit while
`fetch_webpage` sat unused). What is the minimal set of prompt rules that raises the give-up
threshold to match the harness without over-forcing retries?

### What to change (from [H3 attribution](../assets/H3-attribution.md), fix slice 1)

In `extensions/copilot/src/extension/prompts/node/agent/patentAIPrompt.tsx`:

- **Escalation ladder.** Before any hand-back or "retry?" offer, the agent MUST have
  exhausted: (i) query reformulation, (ii) an alternate office/tool, (iii) the web fallback.
- **Web-fallback-on-exhaustion.** Broaden the web rule (currently branch L, scoped to
  CN/JP/KR-style no-tool jurisdictions at `:193,:284`) to cover *backend-route-exhausted*.
  Name the always-available `fetch_webpage` built-in alongside the model-conditional
  `web_search` (`:28`); endorse Google Patents / freepatentsonline as fetch-and-verify
  sources (the exact route the harness and Sonnet 5 used to deliver R1).
- **Search-error rule** distinct from the zero-result rule: a transient 5xx / gateway /
  timeout means retry / back off, not disclose a coverage limit.
- **Demote stop-and-disclose** (the co-endorsed `:578`, `:300-301` lines) and add a
  patent-specific persistence cue (today the only one is the generic coding base line).
- **Soften the jurisdiction gate** (`:161-188`) to default-comprehensive / non-blocking when
  the request is clearly comprehensive, so it stops being a stall the headless harness lacks.

### Expected effect on corpus

Flips R1; raises the give-up threshold on S3/R4/S2; removes the S1 stall. Highest single
lever. Verify against the H5-relevant trajectory cases once [H4](H4-trajectory-eval-gate-design.md)
lands. One agent session; single file.

## Resolution (2026-07-17)

All changes landed in `extensions/copilot/src/extension/prompts/node/agent/patentAIPrompt.tsx`
(single file, as scoped). Typecheck clean (`npx tsgo --noEmit -p tsconfig.json` → 0 errors
across the whole extension). Design stance held: outcome-specs, not path-rules; the ladder
raises the give-up bar without mandating retry counts or forcing a fixed number of attempts.

**Rule-by-rule (line anchors are post-edit):**

1. **Escalation ladder — NEW `PatentPersistenceRules` element** (`:460-487`, registered at
   `priority={790}` between CriticalRules(800) and EvidenceRules(780) so it survives flex
   pruning). Before any hand-back / "would you like me to retry" / "coverage is limited" /
   pointing the user to commercial DBs (Derwent/PatBase/Orbit) or to counsel *as a substitute
   for doing the work*, the agent MUST have exhausted, in order: (i) reformulate (synonyms,
   broader/narrower CPC/IPC, drop a filter, different number format), (ii) alternate
   office/tool/route (USPTO grants for a US number 404ing on OPS, `get_patent_summary` when
   `get_patent_details` is empty, sibling citation tool, another family member), (iii) web
   fallback. Only after all three does it disclose a gap, naming what it tried — targets R1's
   "use commercial databases … would you like me to?" and S3's "consult qualified counsel".

2. **Web-fallback-on-exhaustion — branch L, both ternary branches** (`:283-303`). Header
   re-scoped from "CN/JP/KR + academic papers" to "CN/JP/KR patents, NPL, OR any document a
   backend route cannot return". Both branches now name the ALWAYS-available `fetch_webpage`
   alongside the model-conditional `web_search`. Absolute "DO NOT use web_search for US/EP/WO"
   flipped to "dedicated route is FIRST RESORT; fall back to the web only once it is exhausted,
   not instead of it". Google Patents (`patents.google.com/patent/NUMBER`) and
   freepatentsonline.com endorsed as fetch-and-verify sources (quote only returned text,
   spot-check number/title). The no-web-search branch's opening line now states plainly
   "`fetch_webpage` IS available … you are NOT without web capability" — the direct antidote to
   R1's hallucinated "no web search capabilities". Persistence cue also names the same web
   fallback in ladder rung (iii).

3. **Search-error rule distinct from zero-result** (in `PatentPersistenceRules`, `:482-484`).
   Transient backend error (5xx / 502-503-504 / gateway timeout / connection reset / truncated
   response) = OUTAGE → back off and retry the same call, then switch office/route; NEVER report
   a coverage limit or "the patent doesn't exist" on an errored call. Clean zero-result
   (successful call, no hits) = REFORMULATE before concluding — explicitly separated.

4. **Demoted stop-and-disclose + persistence cue.** Evidence rule (`:608`) changed from "if not
   retrieved, say so and offer to search" → "retrieve it (working the escalation ladder) rather
   than offering to; disclose a gap only after the ladder is exhausted, naming what you tried".
   The no-web-search branch's old "state that limitation explicitly instead of guessing" line
   (`:302`) rewritten to fetch-and-verify first, disclose only after that also fails. Critical
   rule 5's CN/JP/KR "no web-search tool — state the coverage gap" line (`:452`) rewritten to
   "use fetch_webpage against Google Patents before reporting any coverage gap". The
   patent-specific persistence cue is the ladder's opening line ("Patent data lives across
   offices, number formats, and routes — a dead or empty route for ONE office rarely means the
   fact is unavailable"), replacing the previously generic-only coding-base persistence line.

5. **Jurisdiction gate softened to default-comprehensive / non-blocking** (`:174`). The hard
   "Do NOT make any search tool calls until you receive the jurisdiction answer" reframed as a
   brief clarification that is NOT a stall: when the task itself implies comprehensive coverage
   (prior-art / novelty / patentability / FTO / invalidity / landscape), default to Both
   (comprehensive) and PROCEED without asking — the carousel is reserved for a genuine
   single-office-vs-both narrowing, not a reflex before every search. Removes the S1/S2 stall
   the headless harness never has.

**Eval-fixture note.** Regenerated the promptfoo system-prompt fixture offline via
`npx tsx evals/prompts/render-system-prompt.tsx` (465 lines; new blocks confirmed present);
`npx tsx evals/scripts/check-prompt-drift.ts` → "no drift detected". **The 40/40 baseline was
NOT re-graded** — that requires paid model-graded runs, which were deliberately not run here.
The 40/40 green needs a re-grade after this change before release.

**Deliberately NOT added (to avoid over-forcing retries):** no fixed retry count or max-attempt
number (the ladder is a floor on *exhaustion*, not a mandate to loop N times); no automatic
retry on clean zero-results (those route to reformulate, not retry); no removal of the
legal-advice disclaimer (critical rule 6) — the ladder only forbids offering counsel/commercial
DBs as a *substitute for doing the work*, it does not suppress the genuine not-legal-advice note;
jurisdiction carousel kept for genuinely ambiguous single-vs-both cases rather than deleted
outright. Skill-surface echoes of this policy are H6's scope (blocked-by H5), left untouched here.
