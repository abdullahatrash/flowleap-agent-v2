---
id: H11
title: Backend — root-cause the corpus's 502/504/HTML error surfaces in flowleap-backend
type: research
status: closed
assignee: abdullahatrash
blocked-by: []
---

## Question

The corpus's execution-reliability failures surfaced three backend error shapes the agent
side has now learned to *survive* (H8) — but do they have backend-side root causes that
should be fixed at the source? Specifically: the `502 … odpRequest.q?.trim is not a
function` TypeError (R1 round 2), raw nginx `504 Gateway Time-out` HTML bodies reaching
clients (R4/S2), and the intermittent EPO live-search outage behavior. Cross-repo:
`flowleap/flowleap-backend` (same parent folder).

### Scope

Read-only investigation of the backend repo (main tree, not its worktrees): the
`patent-search-uspto` route's `odpRequest.q` handling; upstream EPO/USPTO timeout and
retry policy; whether error paths return structured JSON or hang until nginx emits HTML;
zero-hit response shapes (coordinate map 0001 W3, don't duplicate it). Deliverable:
findings asset + recommended backend fix list — no code changes.

## Resolution (2026-07-17)

All three surfaces root-caused in the backend `main` tree (`c7f1bc6`) — they are
backend error-shape defects, distinct from the upstream EPO outage itself. Full evidence
(file:line + corpus citations + ranked fixes) in
[H11 asset](../assets/H11-backend-error-root-causes.md).

**In brief:**

1. **502 `odpRequest.q?.trim is not a function`** — missing input validation. The agent
   sent `q` as an object (`{"match":{"patentNumber":…}}`, R1 round 2); `q?.trim()` at
   `patent-search-uspto.ts:252` guards only null/undefined, so a non-string `q` throws a
   `TypeError` *during cache-key construction, before any upstream call*. The body is
   type-cast, not validated (`:240`). `mapProviderError`
   (`cached-provider-read.ts:176-180`) has no branch for a plain `TypeError`, so it
   becomes a generic **502** that leaks the internal variable name. Should be a **400**
   with a schema hint.
2. **Raw nginx 504 HTML** — `opsFetch` (the EPO OPS fetch, `ops/fetch.ts:52-56`) uses a
   bare `fetch()` with **no AbortController/timeout**, unlike the bounded USPTO path
   (`fetch-with-retry.ts:115`). A hung EPO socket makes `searchPatents`'s up-to-25-doc
   `Promise.all` fan-out (`ops/direct.ts:707-714`) hang past nginx's `proxy_read_timeout`;
   nginx emits its own HTML (R4/S2) because Node has no request timeout (`server.ts:250`)
   and the async hang never reaches the global error handler (`server.ts:236`).
3. **EPO outage behavior** — there **is** retry + exponential backoff + `Retry-After`
   (`ops/fetch.ts:34-101`, 3 attempts), but **no circuit breaker, no per-fetch timeout,
   no cheap EPO health signal**. Transient EPO 5xx throws a plain `Error` →
   generic **502**, never a structured **503 + Retry-After**; the OPS route's 503 branch
   (`ops/search.ts:168`) is effectively dead.

**Top fixes (ranked in asset):** F1 validate `q` → 400 (small); F2 add AbortController
timeout to `opsFetch` (small, highest reliability leverage); F3 structured transient
503+Retry-After for EPO 5xx/timeout, strip HTML (medium); F4 EPO circuit breaker; F5
`/v1/ops/health` cheap probe; F6 server-level `requestTimeout` backstop.

**Re-attribution:** no H3 outcome flips agent→backend — the model-vs-stack split stands.
But Surfaces 1 (trim 502→400) and 2/3 (raw-HTML 504 / generic 502 → structured 503) are
genuine backend defects that degrade the weaker-model trajectory; both were already routed
by H3 to its H8 slice, now confirmed and located. No changes made to `flowleap-backend`
or any other ticket/map.
