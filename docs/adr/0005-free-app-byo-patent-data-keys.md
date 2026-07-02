# Free app, BYO keys, monetize the ecosystem (Pro)

The FlowLeap app is **free to use, forever**. Inference is already BYOK (ADR 0004); we
extend the same "bring your own key" model to **patent data** — the user supplies their own
EPO OPS and USPTO credentials through a friendly in-app UI. The backend stays as the
value-add transformer and its patent-data path is **free forever and uncapped** (abuse-level
rate limits only). A **card-free 7-day trial** runs on FlowLeap-owned shared keys and
previews the paid tier. The paid product is **Pro — the ecosystem around the app**: a
growing library of patent skills, a curated prompt library, and a fast signed update
channel. The per-request **subscription gate on patent data** (ADR 0002) is **re-pointed,
not retired**: Polar billing stays, but it gates ecosystem routes instead of data routes.

There are no existing users; this model is written with complete freedom, no migration or
compatibility story owed to a prior paid tier.

## Context

The migration (PRD 0001) shipped a working product with two value gates:

1. **Inference** — BYOK, client-side, the user's own LLM key (ADR 0004). No FlowLeap cost or
   liability. Working and verified end-to-end (#23).
2. **Patent data** — a paid backend (Clerk auth + Polar subscription) that holds
   **FlowLeap-owned EPO OPS and USPTO credentials** and proxies the ~20 patent-data tools,
   adding real value: EPO OPS / USPTO search, citation analysis (X/Y/A tagging), legal/MPEP
   search, details/figures, claim analysis, academic search, patent-family dedup, and the
   `curlToApiRequest` normalization. Gated per request at the single `IPatentBackendClient`
   seam.

That model makes FlowLeap carry the cost and liability of every user's EPO/USPTO usage, and
bounds adoption behind a subscription. EPO OPS offers a free weekly quota and USPTO ODP keys
are free, so an individual patent professional can run on **their own keys at little or no
cost**. And the defensible, monetizable asset is not the API relay — it is FlowLeap's
patent-domain expertise, productized as skills and prompts that grow over time.

An earlier draft of this ADR monetized only a signed update channel. That bet was weak on
its own: the base is Code-OSS (MIT), so anyone can rebuild from source, and updates alone do
not justify recurring billing. Skills and prompts are **proprietary content** — no licensing
ambiguity, and a growing library is exactly what recurring billing is for. The update
channel becomes a component of Pro, not the product.

Two facts make the pivot cheap to build:

- The `IPatentBackendClient` seam already isolates every patent-data call (PRD 0001,
  #11–#17). Switching from FlowLeap-owned keys to user-supplied keys is a change *at that
  seam*, not in 20 tools.
- The backend's Polar billing (webhooks, checkout, portal, entitlement) is live and stays;
  only *what the gate protects* changes.

## Decision

- **Keep the backend as the value-add transformer; its data path is free forever.** The
  backend continues to own curation (family dedup, relevance tagging, MPEP/legal,
  normalization) so that logic stays server-side and defensible, and the 20 tools need no
  rewrite. The data path is uncapped and will not be re-gated — only abuse-level rate
  limits, keyed by identity. We reject calling EPO/USPTO directly from the extension: it
  would force porting all curation client-side and expose it.

- **BYO patent-data keys, stored client-side.** The user's EPO OPS consumer key+secret and
  USPTO ODP key live in **SecretStorage** (like the BYOK LLM key), are **forwarded per
  request over TLS** through the `IPatentBackendClient` seam, and are **never persisted
  server-side**. The backend performs the **EPO OPS OAuth2 token exchange** from the user's
  consumer key+secret; USPTO ODP keys pass straight through.

- **A free account is required for data calls.** `requireAuth` stays on the transformer
  routes; only the subscription check comes off. Identity-keyed rate limiting is the abuse
  defense for shared infrastructure, powers trial tracking, and is the channel to announce
  Pro. BYOK chat works signed out; onboarding sign-in stays soft/skippable (ADR 0003).

- **Card-free 7-day trial, tracked by FlowLeap, previewing Pro.** Sign-in (no card) grants 7
  days of FlowLeap's shared EPO/USPTO keys **plus the full Pro library**, so day one is the
  best version of the product. Trial state is FlowLeap's own per-identity window (Polar's
  card-required `trialing` is not used). On expiry the user faces two deliberately
  **decoupled** asks: *add your own keys* (free path, never framed as a paywall) and *keep
  the library* (Pro checkout, no second trial).

- **Pro: skills library + prompt library + fast update channel + priority support.** Polar
  gates these ecosystem routes. Pro launches **only when the shelf is real** — on the order
  of 8–10 patent skills and ~30 curated prompts with a committed monthly addition cadence —
  and the free+BYO path ships first. Working price anchor **~$29/mo (~$290/yr)**; the actual
  price is decided at Pro launch (this ADR records the model, not the number).

- **Updates: fast channel for Pro, stable + security for Free.** Pro receives every release
  seamlessly via the signed in-app auto-update channel. Free receives security patches
  immediately (non-negotiable for a tool handling confidential patent data) and periodic
  stable rollups on the download page. Free users are never insecure, just behind.

- **Synced content is keep-forever.** A lapsed Pro subscriber keeps everything already
  synced; lapsing stops new items, updates to existing ones, and the fast channel. The gate
  is purely on the backend sync endpoint — no client-side entitlement enforcement, no DRM
  theater.

- **Two distinct 402 vocabularies.** Patent-data routes answer
  `data_keys_required` / `trial_expired` ("add your keys" UX); ecosystem routes answer
  `subscription_required` ("go Pro" UX). They must never be conflated — the client's
  seam-level 402 handling and tool hints (#41, kept 402-neutral) branch on the code.

## Consequences

- **Supersedes the subscription parts of [ADR 0002](0002-consolidate-auth-to-clerk-template-token.md)**
  for the *data path*: the single Clerk provider stays, backing identity + trial. Polar
  itself survives, re-pointed at ecosystem routes.
- **Requires a mirroring backend ADR** (flowleap-backend ADR 0007): the backend's accepted
  ADR 0004 declares Polar the gate on patent data, and the backend's *own* ADR 0005 is an
  unrelated rejected proposal — the numbering collision must be called out explicitly so
  agents in either repo don't implement against stale or wrong-numbered doctrine.
- The backend's hosting cost drops to pure transformation (no LLM spend, no patent-API
  spend); FlowLeap's only metered cost is trial usage on its shared keys.
- **The load-bearing risk moves from licensing to content cadence.** The licensing pass
  (#36) shrinks to trademark protection of the FlowLeap-branded build; the new commitment
  is a visibly growing library — if the shelf stagnates, Pro churns.
- **New abuse surface:** trial abuse on shared keys (per-identity windows + rate limits) and
  correct handling of user data-keys in transit (never log, never persist).
- Tier name "Pro" is a working name. Team/enterprise features are explicitly out of scope.
- Work spans **two repos**: `flowleap-agent-v2` (keys UI, seam wiring, trial UX, onboarding
  reframe, library browse/sync surface, update channels) and `flowleap-backend`
  (key forwarding, EPO token exchange, trial tracking, gate re-pointing, skills/prompt
  registry endpoints).
