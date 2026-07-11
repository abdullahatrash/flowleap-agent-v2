# Curated free marketplace v1: public git plugin monorepo + website-hosted MCP registry

The FlowLeap Marketplace launches FlowLeap-curated and free to install, deliberately reusing
the fork's existing distribution machinery unchanged: plugins (and the skill packs inside
them) distribute from one public git monorepo (`abdullahatrash/flowleap-plugins`, shipped as
the app's only default marketplace, pre-trusted), and MCP servers from a public MCP Registry
v0 endpoint served by `flowleap-website-v2` (`mcpGallery.serviceUrl` in product.json). We
chose this over Pro-gating content from day 1 — even though the Pro subscription is positioned
around skills/prompts/fast updates — because gating requires an authenticated distribution
channel that none of the existing plumbing supports, and adoption of the ecosystem matters
more now than monetizing it.

## Consequences

- Nothing placed in the public plugin monorepo or MCP registry can later become paid content —
  premium packs must arrive over a separate authenticated channel (e.g. backend-served,
  token-gated), not by locking down these surfaces.
- Skills have no standalone install path by design: a "skill marketplace" entry is always a
  plugin carrying `skills/<name>/SKILL.md`. Built-in patent skills stay bundled with the app.
- The default marketplace ref and registry URL are baked into shipped app builds; moving the
  repo to a GitHub org later relies on GitHub transfer redirects, and moving the registry
  requires keeping the old URL serving.

## Considered options

- **Pro-gated marketplace from day 1** — rejected: needs authenticated distribution now,
  real backend work before anything ships.
- **Open third-party publishing** — rejected for v1: needs submission review, moderation, and
  a trust policy; premature for the current user base.
- **MCP registry on the Express backend or as static JSON** — rejected: the backend mixes
  public content into the billing/data API; a static file can't honor the v0 API's
  `?search=`/cursor params that the in-app gallery sends.
