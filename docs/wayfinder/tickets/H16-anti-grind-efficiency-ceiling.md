---
id: H16
title: Prompt/skill — anti-grind ceiling: stop hammering a route already proven dead
type: task
status: closed
assignee: abdullahatrash
blocked-by: []
---

## Question

The H5 persistence ladder cured give-up but overshot into wasteful grinding: in the H15
acceptance run the main window ran 82 calls on S2 (redundant single-term searches, duplicate
summaries), 43 on S3 (local grep detours to a result the bench got in 12), and ~40 futile
`search_forward_citations` calls on R4 *after* `citation_api_guide` had already confirmed the
EP route returns 0. What rule bounds the effort — "a route confirmed empty/dead is not retried
in the same shape; escalate or conclude" — without reintroducing premature give-up?

### Evidence
[H15 VERDICT](../assets/H15-acceptance-run/VERDICT.md) tasks S2/S3/R4; contrast the bench's
23/12 clean trajectories. Surface: `patentAIPrompt.tsx` persistence rules (the H5 ladder) + the
recipe skills' "When a search fails" branches ([[H6]]). The ladder needs a *ceiling* to match
its *floor*: once reformulation + alternate route + web are each tried once and a route is
confirmed dead, stop — don't loop it.

## Resolution (2026-07-20)

**Rule added — EFFORT CEILING**, extending the H5 `PatentPersistenceRules` element
(`extensions/copilot/src/extension/prompts/node/agent/patentAIPrompt.tsx`, priority 790,
appended right after the SEARCH-ERROR / zero-result block). Verbatim opening:

> **EFFORT CEILING — the ladder is a floor to reach, not a loop to spin.** Exhausting the ladder
> means trying each DISTINCT rung (reformulate → alternate route → web) a small, bounded number of
> times, then stopping to conclude or disclose — it does NOT mean repeating any one rung.
> Persistence is reaching the web fallback, not firing the same call dozens of times:
> • A route, query shape, or citation direction already confirmed to return nothing for this
>   document — whether by a `*_api_guide` or by a prior empty/errored-then-cleared call — is NOT
>   re-run in the same shape. Reformulate once, try one alternate route; if both come back empty,
>   treat it as dead and move on. Do not keep firing a route a guide already said yields 0 (e.g.
>   dozens of `search_forward_citations` after `citation_api_guide` confirms the EP forward route
>   returns nothing).
> • Do not re-retrieve or re-summarize a record you already have — one successful summary/detail
>   fetch per document is enough.
> • Prefer one well-formed query (`build_patent_query` / `build_uspto_query` with combined terms
>   and filters) over many redundant single-term probes, and no local grep/file detours to
>   re-derive a result a tool already returned.
> • Once each distinct rung has genuinely been tried, STOP and conclude or disclose the gap —
>   continuing past that point is grind, not diligence.

Directly targets the H15 patterns: R4's ~40 futile `search_forward_citations` after the guide
confirmed 0 (bullet 1), S2's 82 calls of duplicate summaries + single-term probes (bullets 2–3),
S3's 43 calls of local-grep detours (bullet 3).

**How the H16↔H5 floor/ceiling tension was resolved (same rule from both ends).** The H5 floor
says "exhaust ALL THREE rungs before any hand-back." The ceiling reframes *exhaust* as "try each
**distinct** rung a bounded number of times, then stop" — so both hold without contradiction: you
still MUST reach the web rung (no premature give-up), but reaching it is done by advancing through
the three distinct rungs once each, not by repeating any single rung. "Distinct rungs" is the
hinge word that lets floor and ceiling coexist. Note the ceiling deliberately does **not** impose a
numeric call cap (that would reintroduce premature give-up), matching H5's "no fixed retry count".

**Coordination with H17/H18.** The coherent stance across the three landed rules is: retrieve
efficiently (this ceiling), reproduce completely what was asked ([[H18]]), assert only what you
retrieved ([[H17]]). The ceiling caps *effort*; it never licenses skipping a distinct rung or
under-delivering — H18's completeness rule still governs what the answer must contain.

**Verification.** `npx tsgo --noEmit -p extensions/copilot/tsconfig.json` → no errors in
patentAIPrompt.tsx. Fixture regenerated offline (`render-system-prompt.tsx`, 466→480 lines; block
at line 312) + `check-prompt-drift.ts` → "no drift detected". **Re-grade note:** the 51/52
model-graded baseline was NOT re-run (paid evals deliberately skipped) — needs a re-grade with
H16+H18+H19 before release.
