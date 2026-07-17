---
id: H14
title: Backend F1–F3 — validate q→400, opsFetch timeout, structured transient 503
type: task
status: closed
assignee: abdullahatrash
blocked-by: []
---

## Question

Execute H11's top three ranked fixes in `flowleap/flowleap-backend` (cross-repo, on a
feature branch off local main — its main is ahead of origin, unpushed): **F1** validate
`q` in `patent-search-uspto.ts` → structured 400 with schema hint (no more TypeError-502);
**F2** AbortController timeout on `opsFetch` mirroring the bounded USPTO path — highest
reliability leverage, kills the raw nginx HTML 504; **F3** map EPO 5xx/timeouts to a
structured JSON 503 + Retry-After, strip upstream HTML, revive the dead 503 branch.
Route-level tests for all three behaviors. F4–F6 are follow-ups, out of this ticket.
Evidence + file:lines: [H11 asset](../assets/H11-backend-error-root-causes.md). PRD 0010
workstream 4.

## Resolution (2026-07-17)

Implemented F1–F3 in `flowleap-backend` on branch `fix/backend-error-shapes`
(off local `main` @ `ab460ef`; **unpushed**, `main`/`origin` untouched). Two
scoped commits:

- **`3df6594`** — F1
- **`b6bcb0d`** — F2 + F3

### F1 — validate `q` → 400 (`src/routes/patent-search-uspto.ts`)
Added a runtime guard at the top of `POST /search`: a `q` that is present and
not a string now returns `400 { code: 'invalid_query', field: 'q', received:
'object'|'array'|'number', message: 'q must be a Lucene query string … not an
object, array, or number.' }` **before** the cache-key builder runs — killing
the `q.trim is not a function` TypeError that `mapProviderError` had been
leaking as a 502.

**Sibling routes (checked, no fix needed):** the crash pattern is unique to
this handler. `/grants/:patentNumber` builds `q` itself, `/applications/*` use
path params, and the OPS search route (`routes/ops/search.ts`) reads `q` from
the query string (`req.query.q` is always a string or undefined). The only
other `.q?.trim()` in `src/routes/` is the one fixed here.

### F2 — AbortController timeout on `opsFetch` (`src/lib/ops/fetch.ts`)
Each attempt is now bounded by an `AbortController` (`OPS_FETCH_TIMEOUT_MS =
30_000`, below a typical nginx 60s `proxy_read_timeout`; overridable via a new
`timeoutMs` option, used by tests). A timeout aborts fast and is **not**
retried (three 30s hangs would exceed nginx's window) — it throws the transient
error below instead of hanging indefinitely. The up-to-25-doc `Promise.all`
fan-out (`ops/direct.ts`) already settles hung biblios into placeholders
(`searchDetailItem` swallows `!ok`), so a bounded biblio fetch no longer stalls
the batch.

### F3 — structured transient 503 + Retry-After
- New typed `UpstreamUnavailableError` (`src/lib/fetch-with-retry.ts`):
  client status 503, carries `retryAfter` + `upstreamStatus`, message is a
  short HTML-free status line.
- `opsFetch` throws it for EPO 5xx (honoring the upstream `Retry-After`, else a
  30s default) and for timeouts — **stripping the upstream (nginx HTML) body**
  from the client-facing message. 4xx keep the historical status-carrying Error
  (404/429 still map to their codes).
- `mapProviderError` (`cached-provider-read.ts`) maps it to
  `503 upstream_unavailable` + a `Retry-After` header.
- `asEpoUpstreamError` (`ops/direct.ts`) passes it through untouched.
- The OPS search route's previously-dead `503` branch now fires; extended
  `toOpsErrorResponse` (`routes/ops/error-mapping.ts`) with a `503 →
  SERVICE_UNAVAILABLE` case so the **sibling** OPS routes surface the transient
  503 (they'd otherwise flatten it to 500). All OPS routes already
  `.set(result.headers)`, so the Retry-After rides through everywhere.

### Tests (all green; `npx tsc --noEmit` + eslint clean)
- `tests/routes/patent-search-uspto-search.test.ts` — object-`q` → 400
  `invalid_query`, no upstream call.
- `tests/routes/ops/search.test.ts` — transient upstream → 503
  `SERVICE_UNAVAILABLE` + `Retry-After: 42`, no `<html` in body.
- `tests/lib/ops/fetch.test.ts` (new) — 5xx HTML → transient error with clean
  message + default/honored Retry-After; timeout → transient error, bounded
  (no hang).
- Regression: 566 tests across `tests/lib`, `tests/routes`,
  `src/lib/*.test.ts` pass; no existing test changed behavior.

### Contradiction with H11
Minor: H11 called the OPS `503` branch fully dead. It was actually reachable
for an opsFetch throw whose message literally matched `OPS error 503:` (the
`/OPS error (\d{3})/` sniff in `asEpoUpstreamError` preserved the status). The
real gaps were **timeouts** (no throw at all → nginx HTML) and **non-503 5xx /
network errors** (→ generic 502/500). F2/F3 close those and make the 503 path
carry a clean message + Retry-After regardless of the upstream body.

**F4–F6 (circuit breaker, `/v1/ops/health`, server-level request timeout)
remain out of scope** per the ticket.
