---
id: H8
title: Typed-tool errors — actionable transient-error shape + recovery hint for generic 5xx/gateway/timeout
type: task
status: closed
assignee: abdullahatrash
blocked-by: []
---

## Question

`patentBackendErrorRecoveryHint` returns an actionable "…then retry this tool" sentence for
every typed error (401/402/keys/429) but an empty string for the generic `PatentBackendError`
(`patentBackendClient.ts:137`, verified). So a transient `504 Gateway Time-out` reaches the
model as a raw nginx HTML body with no next step, and a `502 … odpRequest.q?.trim is not a
function` as a bare stack fragment. In the corpus the weak model gave up after three such
504s (R4) and the strong model burned six retries on them — neither could tell "transient,
back off and retry" from "permanently broken." What error shape fixes that?

### What to change (from [H3 attribution](../assets/H3-attribution.md), fix slice 4)

- Map generic 5xx / gateway / timeout responses to a typed **transient** error whose
  recovery hint reads, e.g., "The patent backend is temporarily unavailable (HTTP 504) — this
  is transient. Wait briefly and retry the same query, or try a different office (USPTO)
  meanwhile." Surfaces: `patentBackendClient.ts:118-138` (the empty branch at `:137`,
  `_throwForErrorResponse`) and `patentToolError.ts`.
- Strip raw nginx HTML / internal exception text from the model-facing body (keep a short
  status line).

### Expected effect on corpus

Reduces give-up and wasted retries under transient outage (R4 / S2, and R1 round 2's 502).

### Confidence caveat

The transcript evidence is **outage-confounded** (S1/S2/R4 ran during an EPO search outage),
so the *magnitude* is uncertain — but the empty-hint code gap is real, verified, and matches
H2 suspect #3. Pairs with the H5 search-error prompt rule (the prompt tells the model what to
do; this ticket makes the error text say it too). One agent session.

## Resolution (2026-07-17)

New typed error `TransientBackendError extends PatentBackendError` (`code = 'transient'`) at
`patentBackendClient.ts`, following the established 401→`AuthRequiredError` /
402→`SubscriptionRequiredError` pattern (typed class + hint in `patentBackendErrorRecoveryHint`,
UX in the client). It fills the empty `''` branch that generic `PatentBackendError` used to hit.

**Matched statuses / conditions** — raised from two seams, both *after* the client's existing
2-retry budget is spent so it only fires on a persistent failure:
- `_throwForErrorResponse`: any `5xx` (`500–599`, including gateway `502`/`503`/`504`).
- `_fetchWithRetry` timeout path: a client-enforced request timeout (`status = undefined`).

**Model-facing message is now a short status line** (`transientStatusLine`): e.g.
`The patent backend returned HTTP 502 (Bad Gateway).` — the raw nginx HTML body and any upstream
exception text (e.g. `odpRequest.q?.trim is not a function`) are dropped, not truncated-to-500.
Labels for 500/502/503/504; anything else `5xx` → `Server error`.

**Recovery hint (verbatim), status interpolated:**
`' The patent backend is temporarily unavailable (HTTP 504) — this is transient, not a coverage limit. Wait briefly and retry the same query, or try a different office (USPTO) meanwhile.'`
When status is unknown (timeout) the `(HTTP …)` clause is omitted:
`' The patent backend is temporarily unavailable — this is transient, not a coverage limit. …'`

**What the model sees for a 504, before vs after:**
- Before: `<html>… 504 Gateway Time-out …</html>` (raw body, truncated at 500 chars) **+ empty
  hint** → reads as a permanent dead end; weak model gives up, strong model burns blind retries.
- After: `The patent backend returned HTTP 504 (Gateway Timeout). The patent backend is temporarily
  unavailable (HTTP 504) — this is transient, not a coverage limit. Wait briefly and retry the
  same query, or try a different office (USPTO) meanwhile.`

`patentToolError.ts` needs no change — `handlePatentToolError` already routes every
`PatentBackendError` subclass through `patentBackendErrorRecoveryHint`, so the new hint flows to
tools automatically. The `502 …odpRequest…` and raw `504` bodies from the corpus (R4/S2, R1
round 2) are the exact cases now stripped and steered.

**Verification:** slice typecheck clean (`tsgo -p extensions/copilot/tsconfig.json`, no
patentBackendClient/patentToolError errors); `vitest run patentBackendClient` → 43/43 pass,
including a new transient-gate describe (persistent gateway 502 → body-free `TransientBackendError`
asserting the full message+hint and that `odpRequest` is stripped; timeout → transient with
`status = undefined`) and a `TransientBackendError` case in the recovery-hint describe.
