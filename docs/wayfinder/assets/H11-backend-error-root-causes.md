# H11 — Backend root causes for the corpus's 502 / 504 / raw-HTML error surfaces

> Asset for ticket [Backend error root causes](../tickets/H11-backend-error-root-causes.md)
> (map 0002, harness-gap parity). Read-only cross-repo investigation of
> `flowleap/flowleap-backend` (main `src/` tree at `c7f1bc6`; deployed `api.flowleap.co`
> may lag — its main has unpushed commits). Every root cause cites backend `file:line`
> and the corpus transcript it explains. Recommendations are for later charting; **no code
> was changed.** Companion to [H3 attribution](H3-attribution.md), whose H7/H8 fix slices
> these root causes feed.

## Headline

All three surfaces are **backend-side error-shape defects**, distinct from the upstream
EPO/USPTO outage itself:

1. The **502 `odpRequest.q?.trim is not a function`** is a missing input-validation crash:
   a non-string `q` reaches `q?.trim()` (which guards only null/undefined, not wrong type),
   throws a `TypeError`, and the generic error-mapper leaks the internal exception text as a
   502. It should be a 400 with a schema message.
2. The **raw nginx `504 Gateway Time-out` HTML** reaching clients is because the EPO OPS
   fetch (`opsFetch`) uses a bare `fetch()` **with no AbortController/timeout**, so a hung
   EPO socket makes the request outlive nginx's `proxy_read_timeout`; nginx answers with its
   own HTML while Node is still awaiting. The backend never emits a structured JSON 504/503.
3. **EPO outage behavior**: there *is* retry + exponential backoff (3 attempts, respects
   `Retry-After`), but **no circuit breaker, no per-fetch timeout, and no cheap EPO health
   signal** — so each request independently grinds a 3-attempt × up-to-25-doc fan-out, and a
   transient EPO 5xx surfaces as a generic **502** (not a 503+Retry-After), giving the agent
   no transient-vs-permanent steer.

---

## Surface 1 — `502 … odpRequest.q?.trim is not a function` (R1 round 2)

### What the agent sent (corpus citation)
`runs/R1/main-usual/session.jsonl`, tool call `toolu_bdrk_016u4i6X31PjRgGmisJjdiYw` —
`POST /patent-search-uspto/search` with body:

```json
{"q": {"match": {"patentNumber": "10958080"}}, "fields": ["patentNumber","patentTitle","claims"], "size": 1}
```

`q` is an **object** (the agent guessed an Elasticsearch-style query DSL). Result returned to
the agent:

```
Backend error 502: {"success":false,"error":{"code":"upstream_error","message":"odpRequest.q?.trim is not a function"},"status":502}
```

### Root cause (file:line)
- `src/routes/patent-search-uspto.ts:240` — `const rawBody = (req.body || {}) as ODPSearchRequest & {…}`. The body is **type-cast, never validated at runtime.** `q` is typed `string` but nothing enforces it.
- `src/routes/patent-search-uspto.ts:252` — `q: odpRequest.q?.trim()` inside the `getCacheKey(...)` call. The optional-chain `?.` short-circuits only on `null`/`undefined`. For an object/array/number, `q.trim` is `undefined`, so calling it throws `TypeError: odpRequest.q?.trim is not a function`. **This throws before any upstream call — during cache-key construction**, so it is not an "upstream" failure at all.
- `src/routes/patent-search-uspto.ts:283-289` — the route's catch-all runs `mapProviderError(error)` on the `TypeError`.
- `src/lib/cached-provider-read.ts:176-180` — the `TypeError` matches none of the typed classes, so it falls to the final branch: `envelope(502, 'upstream_error', error.message)`. This is why a **client input error is reported as a 502 upstream error** and why the internal variable name `odpRequest.q?.trim` leaks to the model.

### Why it matters for the trajectory
The agent got a cryptic 502 that reads like a backend outage, not "your `q` must be a Lucene
string." A 400 with a schema hint (`"q must be a Lucene query string, e.g.
applicationMetaData.patentNumber:10958080 — not an object"`) would have redirected the agent
to the correct format it already knew (it used the string form two calls earlier). Note any
non-string non-null `q` hits this: object, array, or number all crash identically.

---

## Surface 2 — raw nginx `504 Gateway Time-out` HTML reaching clients (R4, S2)

### Corpus citation
`runs/R4/main-usual/session.jsonl` and `runs/R4/main-claude5/session.jsonl`, from the
`search_patents` (EPO OPS) tool:

```
Error: Patent search backend returned 504: <html>
 <head><title>504 Gateway Time-out</title></head>
 <body> <center><h1>504 Gateway Time-out</h1></center>
 <hr><center>nginx/1.26.3 (Ubuntu)…
```

The HTML `nginx/1.26.3` body proves **nginx**, not the Node app, produced the response — the
backend request was still in flight when the proxy's read timeout fired.

### Root cause (file:line)
- `src/lib/ops/fetch.ts:52-56` — `opsFetch` (the shared EPO OPS fetch used by **all** OPS
  reads, including search) calls `await fetch(fullUrl, { method, headers, body })` with **no
  `signal`, no AbortController, no timeout.** A stalled EPO connection (socket open, no bytes)
  makes this `await` hang **indefinitely**. Contrast `src/lib/fetch-with-retry.ts:115-116`,
  which wraps every attempt in a 60 s AbortController — the USPTO ODP path uses that
  (`src/lib/uspto-odp/patent-search.ts:100,147`) and is therefore bounded; **EPO OPS is not.**
- `src/lib/ops/direct.ts:684` then `:707-714` — `searchPatents` with `details=true` (the OPS
  route default, `src/routes/ops/search.ts:113`) fans out a per-document biblio call via
  `Promise.all` over up to 25 docIds, each `searchDetailItem → getBiblio → fetchOpsXml →
  opsFetch`. Any one hung `opsFetch` blocks the whole `Promise.all`, so the entire request
  hangs.
- `src/server.ts:250` — the HTTP server is started with no `server.requestTimeout` /
  `server.timeout` / `headersTimeout` override, so Node imposes no ceiling inside nginx's
  window.
- `src/server.ts:236-242` — the Express global error handler only catches synchronous throws
  / `next(err)`. A hung async handler never reaches it, so **no JSON error is ever produced**;
  nginx times out first and emits HTML.
- Secondary: even when `opsFetch` *does* fail (EPO 5xx), it throws a **plain `Error`**
  (`src/lib/ops/fetch.ts:77` `throw new Error("OPS error 503: …")`, `:103`), not an `APIError`
  / `UpstreamError`. That propagates through `searchPatents`'s `fetchFresh` →
  `cachedProviderRead` catch → `mapProviderError` generic branch
  (`src/lib/cached-provider-read.ts:176-180`) → **502 `upstream_error`**, never a 503 with
  `Retry-After`. The OPS route's own 503 branch (`src/routes/ops/search.ts:168-171`) is
  effectively dead for `opsFetch`-thrown errors because they arrive as a mapped 502, not a 503.

### Net
Under an EPO hang the client gets nginx HTML (unparseable, no `code`, no `Retry-After`);
under an EPO error it gets a generic JSON 502. Neither tells the agent "transient — retry."

---

## Surface 3 — EPO live-search outage behavior (retry / backoff / circuit-breaking)

### What exists
- `src/lib/ops/fetch.ts:34-101` — `opsFetch` retries up to `maxRetries = 3`:
  - `:62-73` — 429/503 respect `Retry-After` (else exponential backoff + jitter).
  - `:75-78,86-100` — any other non-ok status throws, is caught, and retried with exponential
    backoff while attempts remain; network errors likewise retry.
  So there **is** retry + exponential backoff + jitter. (H2 suspect "flakiness passed straight
  through" is only half true — retries exist.)
- `src/lib/ops/throttle.ts` — proactive throttle-header backoff (`X-Throttling-Control`), a
  quota-politeness mechanism, **not** a failure circuit breaker.

### What's missing (the actual gaps)
- **No per-fetch timeout** (Surface 2's root cause) — a hang never even reaches the retry
  logic, because `fetch()` neither resolves nor rejects.
- **No circuit breaker / shared failure state.** Every request independently pays the full
  3-attempt × up-to-25-doc-fan-out cost. During a sustained EPO outage this multiplies:
  worst case a single search = 25 docs × 3 attempts × (throttle wait + backoff up to seconds +
  a possibly-hung fetch). This is exactly the multi-minute grind that produced R4/S2's
  repeated 504s. A breaker that fails fast after N consecutive EPO failures would convert a
  minutes-long hang into an immediate structured 503.
- **No cheap EPO health signal.** `src/server.ts:117-123,186` expose `/health`,
  `/health/cache`, `/v1/ocr/health`, but there is **no `/v1/ops/health`** that pings EPO
  (e.g. a lightweight `getAccessToken` token-endpoint check, `src/lib/ops/auth.ts`). The agent
  (or the extension) cannot cheaply ask "is EPO up?" before committing to a heavy fan-out
  search, so it discovers the outage only by eating a 504.

---

## Zero-hit shapes — flag for map 0001 W3 (not investigated here)

Seen in passing; **W3 owns the zero-hit contract**, do not action here:
- `src/routes/ops/search.ts:151-163` — EPO 404 `EntityNotFound` → `{success:true, data:{total:0,…,docs:[]}}` (clean, `success`-enveloped, `total`).
- USPTO ODP zero-hit → `{count:0, patentFileWrapperDataBag:[]}` (no `success` envelope, `count` not `total`). **Different shape from OPS.**
- The truncation "phantom zero" — `{count:1, patentFileWrapperDataBag:[], _truncation:{…}}` (`count:1` but empty bag) — belongs to map 0001 F1 / H9 (single-record 50 k drop), not W3.

---

## Ranked recommended backend fixes

Ordered by leverage × evidence strength. Each is a recommendation to chart later; sizes are
estimates. All stay inside `flowleap-backend`.

### F1 — Validate `q` (and body) before the cache-key crash → 400, not 502  *(small)*
**What/where.** `src/routes/patent-search-uspto.ts:240,252`. Add a runtime guard (a few lines,
or a zod/schema parse) at the top of `POST /search`: if `q` is present and not a string,
return `400 { code:'invalid_query', message:'q must be a Lucene query string (e.g.
applicationMetaData.patentNumber:10958080), not an object/array.' }`. Same for `/grants`,
`/applications`. **Why top:** turns the cryptic 502 into an actionable 400, directly fixes
R1 round 2, and stops leaking internal exception text. High confidence, tiny.

### F2 — Add an AbortController timeout to `opsFetch` → no more hangs past nginx  *(small)*
**What/where.** `src/lib/ops/fetch.ts:52-56`. Wrap the `fetch()` in a `~30 s` AbortController
(mirror `fetch-with-retry.ts:115-116`), treating `AbortError` as a retryable attempt. **Why:**
kills the root cause of the raw-HTML 504 (Surface 2) — the backend fails/​retries in bounded
time instead of hanging until nginx emits HTML. Highest reliability leverage. Pair with a
sensible nginx `proxy_read_timeout` (infra, out of repo) so the backend timeout is the one
that fires.

### F3 — Structured transient error for EPO 5xx/timeout (kill the raw HTML + generic 502)  *(medium)*
**What/where.** `src/lib/ops/fetch.ts:77,103` — throw a typed `APIError`/`UpstreamError`
carrying the real status (503/504) and a `retry_after`, instead of a plain `Error`; and
`src/lib/cached-provider-read.ts:176-180` — map generic upstream/timeout failures to a
`503 { code:'upstream_unavailable', message:'EPO OPS temporarily unavailable — retry the same
query shortly', retry_after }` with the `Retry-After` header, and strip any HTML from the
model-facing body. **Why:** gives the agent the transient-vs-permanent steer it never gets
today (feeds H3's H8 slice). Medium.

### F4 — Circuit breaker on EPO OPS  *(medium)*
**What/where.** New shared state around `opsFetch` (`src/lib/ops/fetch.ts` / a small breaker
module): after N consecutive EPO failures within a window, fail fast with the F3 structured
503 for a cooldown instead of grinding the full retry × fan-out. **Why:** converts a sustained
outage from minutes-long 504 grinds (R4/S2) into instant structured 503s; also protects the
EPO quota. Medium; depends on F2/F3.

### F5 — Cheap EPO health endpoint  *(small)*
**What/where.** Add `GET /v1/ops/health` that does a lightweight `getAccessToken`
(`src/lib/ops/auth.ts`) / token-endpoint check and returns `{ ok, upstream:'EPO OPS' }`
without a full search fan-out; register in `src/server.ts` alongside the other health routes.
**Why:** lets the extension/agent probe EPO availability cheaply before a heavy search and
degrade gracefully (H3's escalation-ladder + search-error rule can consult it). Small.

### F6 — Server-level request timeout as a backstop  *(small)*
**What/where.** `src/server.ts:250` — set `server.requestTimeout` (and align
`headersTimeout`/`keepAliveTimeout`) so a stuck handler is force-closed by Node with a 503
before nginx's HTML timeout, as defense-in-depth even if a future upstream forgets its own
timeout. **Why:** belt-and-suspenders behind F2; cheap.

---

## Re-attribution note (for H3)

**No H3 outcome flips from agent→backend.** H3's model-vs-stack split stands: R1's give-up was
a *chosen* model narration (Sonnet 5 recovered on the identical backend), and R4/S2 are
outage-and-cap artifacts. **But** two of the three surfaces are genuine backend defects that
degraded the trajectory and would mislead a weaker model, and both were already routed by H3
to its H8 slice — this asset confirms and locates them:
- the **trim 502** (Surface 1) should be a validated **400** (F1) — a backend bug independent
  of the outage;
- the **raw-HTML 504 / generic 502** (Surfaces 2–3) should be a structured JSON **503 +
  Retry-After** (F2/F3) — the EPO *outage* is upstream, but the *client-facing shape* is a
  backend defect (no fetch timeout, no typed transient error).

These are **floor-raising** fixes (make the good trajectory less model-dependent), consistent
with H3's framing — not corrections to who "lost" which task.
