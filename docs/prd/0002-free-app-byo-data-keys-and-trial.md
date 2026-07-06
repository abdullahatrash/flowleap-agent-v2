---
status: rejected (2026-07-06 — free-app/ecosystem-upsell model abandoned; see ADR 0005 status note)
relates-to: docs/adr/0005-free-app-byo-patent-data-keys.md, docs/adr/0004-byok-inference-routing.md, docs/adr/0002-consolidate-auth-to-clerk-template-token.md
---

# PRD: Free app, BYO keys, and a Pro ecosystem tier

## Problem Statement

FlowLeap today gates patent-data access behind a Clerk + Polar **subscription**, while the
backend carries **FlowLeap-owned EPO OPS and USPTO credentials** and pays for every user's
patent-API usage. This bounds adoption behind a paywall and saddles the business with the
cost and liability of third-party API consumption — even though EPO OPS has a free weekly
quota and USPTO ODP keys are free, so an individual patent professional could run on **their
own keys at little or no cost**.

As the founder, I want the **app itself to be free forever** and both key types — LLM
inference (already shipped, ADR 0004) and patent data — to be **bring your own key**,
entered through a friendly in-app UI, so adoption is frictionless and FlowLeap stops
carrying API cost and liability. I want to monetize **the ecosystem** instead: a **Pro
subscription** for a growing patent skills library, a curated prompt library, and a fast
signed update channel — proprietary content that compounds, unlike an API relay. I still
want newcomers to **try the product instantly**: a **card-free 7-day trial** on FlowLeap's
shared keys that also previews Pro.

There are no existing users; there is no migration story to honor.

As a patent professional, I should get the full product for free, try it immediately with
zero setup, paste my own EPO/USPTO keys when ready and keep working free forever — and
subscribe only if the skills/prompt library and fast updates earn it.

## Solution

Extend "bring your own key" from inference (ADR 0004) to **patent data** (ADR 0005). The
backend stays the **value-add transformer** (curation, family dedup, relevance tagging,
MPEP/legal, normalization); its data path becomes **free forever and uncapped** (abuse-level,
identity-keyed rate limits only — a free account is required for data calls). It **stops
holding FlowLeap's data keys**: user-supplied keys are forwarded per request through the
existing `IPatentBackendClient` seam, stored client-side in **SecretStorage**, never
persisted server-side. The backend performs the **EPO OPS OAuth2 token exchange**; USPTO ODP
keys pass through.

**Polar billing is re-pointed, not retired.** The subscription gate comes OFF the patent-data
routes and onto new **ecosystem routes**: a skills/prompt-library registry and the fast
update channel. Two 402 vocabularies keep the stories separate: data routes answer
`data_keys_required` / `trial_expired` ("add your keys"); ecosystem routes answer
`subscription_required` ("go Pro").

A **card-free 7-day trial** (Clerk identity, FlowLeap-tracked window — not Polar's
card-required `trialing`) grants shared data keys **plus the full Pro preview**. On expiry
the two asks stay decoupled: add your keys (free) / keep the library (Pro checkout, no
second trial).

**Sequencing: the free+BYO path ships first.** Pro launches only when the shelf is real
(~8–10 patent skills, ~30 curated prompts, monthly cadence committed). Price is decided at
Pro launch (working anchor ~$29/mo). Synced content is keep-forever; lapsing stops growth
and the fast channel only. Updates: Pro = every release via signed auto-update; Free =
immediate security patches + periodic stable rollups.

Delivered in independently-reviewable slices spanning two repos (`flowleap-agent-v2` client,
`flowleap-backend`), each ending at a compiling, committable checkpoint.

## User Stories

### Patent professional (end user)

1. As a patent professional, I want to install and use the entire app for free forever, so
   there is no purchase decision before I see value.
2. As a new user, I want a card-free 7-day trial that works immediately on FlowLeap's keys
   with **zero setup** — including the Pro library — so day one is the best version of the
   product.
3. As a trialing user, I want a clear, non-nagging indication of trial time left, so I am
   never surprised when it ends.
4. As a user whose trial ended, I want two separate, honest prompts — **add my own keys**
   (free forever) and **subscribe for the library** — so the free path never feels like a
   paywall.
5. As a user, I want a friendly UI to enter my **EPO OPS consumer key + secret** and **USPTO
   ODP key**, with a "test connection" affordance, so I know my keys work before I rely on
   them.
6. As a privacy-conscious user, I want my keys stored **only on my machine** and sent only
   to reach the services they authenticate, so I trust the product with my credentials.
7. As a user, I want EPO OPS token minting/refresh handled for me, so I never deal with
   OAuth2 expiry by hand.
8. As a Pro subscriber, I want a growing library of patent skills (office-action response,
   claim charting, FTO memo, IDS prep, …) and curated prompts, synced into the app, so my
   subscription visibly compounds in value.
9. As a Pro subscriber, I want every release delivered seamlessly via the signed update
   channel, so I'm always current without reinstalling.
10. As a free user, I want security patches immediately and periodic stable releases, so
    using the free tier is never unsafe — just behind on features.
11. As a lapsed subscriber, I want everything I already synced to keep working, so
    subscribing was never a hostage situation.

### Founder / maintainer

12. As the founder, I want FlowLeap to stop paying for and carrying liability on users'
    EPO/USPTO usage, so the backend's only metered cost is trial usage on shared keys.
13. As the founder, I want Polar billing kept and re-pointed (not ripped out), so the
    ecosystem tier reuses live checkout/webhooks/portal with minimal new code.
14. As the founder, I want the curated backend logic to stay server-side, so the product's
    value-add is not exposed by going client-direct.
15. As the founder, I want the data-path change isolated to the `IPatentBackendClient` seam
    (client) and a key-forwarding layer (backend), so the 20 patent tools need no rewrite.
16. As the founder, I want a free account required for data calls, so rate limiting is
    identity-keyed and I have a channel to announce Pro to free users.
17. As the founder, I want a trademark-focused licensing pass on the FlowLeap-branded build,
    so the update channel's protection rests on branding, not on the MIT base.

### Trial / abuse

18. As the business, I want trial windows tracked per identity with rate limits on the
    shared keys, so trial abuse cannot drain FlowLeap's EPO/USPTO quota.
19. As the business, I want user secrets never logged or persisted server-side, so a breach
    of the backend cannot leak customer EPO/USPTO credentials.

## Implementation Decisions

### Architecture (governing ADR)

- **ADR 0005** governs: free app + free data path forever, BYO patent-data keys
  (backend-proxy-with-user-keys, not client-direct), client-side SecretStorage, backend EPO
  OPS token exchange, card-free FlowLeap-tracked trial with Pro preview, Polar re-pointed to
  ecosystem routes, Pro = skills + prompts + fast updates (launch gated on a real shelf),
  keep-forever lapse policy, two 402 vocabularies.
- Builds on ADR 0004 (BYOK inference) as the symmetric precedent. Supersedes the
  data-path-subscription parts of ADR 0002. Requires the mirroring **backend ADR 0007**
  (the backend's ADR 0004/0005 currently say Polar gates patent data — numbering collision
  called out there).

### Seams (prefer existing, highest seam)

- **Client:** all patent-data key handling rides the existing `IPatentBackendClient` seam
  (per-request key attachment via a registry mirroring `patentTokenRegistry`). Key storage
  reuses the BYOK SecretStorage pattern. The 402 handling branches on the new error codes;
  the tool hints (#41) already carry 402-neutral copy.
- **Backend:** guard chain on data routes drops `requireActiveSubscription` only
  (`requireAuth` + abuse limiter stay); a key-forwarding layer does the EPO OPS
  client-credentials exchange (short-lived caching, never persisting the secret) and passes
  USPTO keys through; trial windows tracked per identity; new ecosystem routes
  (skills/prompt registry, fast-channel update feed) sit behind the existing Polar gate.

### Repos & boundaries

- `flowleap-agent-v2` — keys UI + test connection, seam wiring, trial UX, onboarding
  reframe, library browse/sync surface, update-channel wiring.
- `flowleap-backend` — user-key forwarding, EPO OPS token exchange, trial tracking, gate
  re-pointing + new 402 codes, skills/prompt registry endpoints. (Linked but separately
  tracked.)

### Out of Scope

- Re-introducing any FlowLeap-owned-key default path beyond the explicit 7-day trial.
- Client-direct EPO/USPTO calls (rejected in ADR 0005).
- Final pricing/packaging (anchor ~$29/mo; decided at Pro launch).
- Team/enterprise features, seat licensing.
- Client-side entitlement enforcement / DRM on synced content (rejected: keep-forever).
- Observability (#26) and evals (#27) — tracked separately.

## Testing Decisions

- A trial user with no keys gets real patent data AND the Pro library on day 1 with zero
  setup beyond sign-in; after day 7, data tools prompt "add your keys" (no payment
  language) and library sync prompts "go Pro" — two distinct prompts, never conflated.
- A user with valid EPO OPS + USPTO keys gets real data with their own keys; an invalid key
  surfaces a clear, actionable error at the `IPatentBackendClient` seam, distinct from
  auth/subscription errors.
- Keys never appear in client or backend logs; backend persists no user secret.
- Dropping the data-path subscription gate does not break any of the 20 patent tools
  (seam-level test); ecosystem routes reject non-subscribers with `subscription_required`.
- A lapsed Pro subscriber's synced skills/prompts still load and run.

## Further Notes

- No existing users → no migration/grandfathering work anywhere in this PRD.
- The load-bearing commitment is **content cadence**: Pro launch is gated on ~8–10 skills +
  ~30 prompts and a monthly addition rhythm. If that commitment isn't credible, Pro should
  not launch.
- "Pro" is a working tier name; the trademark-focused licensing pass (#36) protects the
  branded build and update channel.
