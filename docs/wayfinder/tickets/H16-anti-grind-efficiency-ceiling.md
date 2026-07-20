---
id: H16
title: Prompt/skill — anti-grind ceiling: stop hammering a route already proven dead
type: task
status: open
assignee:
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
