# PRD 0009: FlowLeap Marketplace v1 — curated MCP registry, plugin marketplace, and website hub

Decision record: `docs/adr/0006-curated-free-marketplace-v1.md`. Vocabulary: see
`CONTEXT.md` → "Marketplace & ecosystem" (FlowLeap Marketplace, Plugin Marketplace,
MCP Registry, Skill Pack).

## Problem Statement

A patent professional using FlowLeap Patent IDE has no way to extend their agent beyond
what ships in the box. The Agent Customizations window shows an MCP Servers tab whose
"Browse Marketplace" button returns nothing, and a Plugins tab whose defaults point at
GitHub Copilot's plugin repos — content built for a different product, with the wrong
harness conventions and the wrong branding. A user who wants a new capability (a Google
Drive connector, a persona-tuned workflow, extra skills) has nowhere to look inside the
product and nowhere on flowleap.com to discover what exists. FlowLeap, in turn, has no
distribution channel of its own: no way to ship new skill content between app releases,
and no ecosystem surface to grow the product around.

## Solution

Launch the FlowLeap Marketplace: a curated, free-to-install ecosystem with three
coordinated surfaces.

1. **In-app MCP Registry**: the existing Browse Marketplace UI lights up against a
   FlowLeap-hosted registry endpoint (standard MCP Registry v0 API served by the
   website), listing vetted third-party MCP servers useful for patent work plus
   FlowLeap's own MCP server. Install works with the machinery already in the app; the
   servers reach Claude sessions through the existing MCP gateway.
2. **In-app Plugin Marketplace**: the app's default plugin marketplace becomes the
   public FlowLeap plugins monorepo (pre-trusted), launching with 3–5 Skill Packs
   repackaged from the proven multi-harness CLI skill families (personas, recipes,
   FlowLeap CLI tools). Installs, updates, and uninstalls use the marketplace machinery
   already in the fork.
3. **Website marketplace hub**: browsable, SEO-indexed `/marketplace` pages on
   flowleap.com for both catalogs, with one-click plugin install deep links into the app
   and open-in-app CTAs for MCP servers.

A user discovers a capability on the web or in the app, clicks install, confirms once,
and their next agent session can use it. FlowLeap gains a PR-reviewed publishing channel
that ships content daily without an app release.

## User Stories

1. As a patent professional, I want to click "Browse Marketplace" in the MCP Servers tab and see a curated list of servers, so that the button does something useful instead of showing an empty state.
2. As a patent professional, I want to search the MCP marketplace by name or capability, so that I can find a specific connector quickly.
3. As a patent professional, I want each MCP marketplace entry to show a description, publisher, and what it needs from me (e.g. an API key), so that I can judge whether to install it before committing.
4. As a patent professional, I want to install an MCP server from the in-app gallery in a couple of clicks, so that I don't have to hand-edit JSON config files.
5. As a patent professional, I want an installed MCP server's tools to be available in my next Claude agent session, so that installation actually changes what my agent can do.
6. As a patent professional, I want to see FlowLeap's own MCP server in the registry, so that I can also wire FlowLeap patent data into other MCP clients I use.
7. As a patent professional, I want the Plugins tab to show FlowLeap's marketplace instead of GitHub Copilot's, so that everything offered is built for my product and my workflows.
8. As a patent professional, I want to install a Skill Pack (personas, recipes, CLI tool skills) from the Plugins tab, so that I can extend my agent's patent workflows without waiting for an app update.
9. As a patent professional, I want skills from an installed Skill Pack to appear in my Claude agent sessions and in the Skills tab, so that installed content is immediately visible and usable.
10. As a patent professional, I want installing FlowLeap's own marketplace content to skip the scary "plugins can run code" warning, so that the golden path has no false alarm.
11. As a patent professional, I want the full trust warning to still appear when I add a third-party marketplace myself, so that I'm protected from unvetted code.
12. As a patent professional, I want installed plugins to update automatically on the existing cadence, so that fixes and improvements arrive without my involvement.
13. As a patent professional, I want to uninstall or disable a plugin per workspace, so that I control what runs where.
14. As a patent professional browsing the Skills tab, I want a "Browse Skill Packs" action, so that discovering installable skills doesn't require knowing they live under Plugins.
15. As a prospective customer, I want to browse flowleap.com/marketplace without an account, so that I can evaluate the ecosystem before downloading the app.
16. As a prospective customer, I want each marketplace entry to have its own web page with details and install instructions, so that search engines index it and colleagues can link to it.
17. As a website visitor with the app installed, I want an "Install in FlowLeap" button on a plugin page to open the app and start the confirm-gated install, so that web-to-app installation is one click.
18. As a website visitor with the app installed, I want an MCP server page to open the app's marketplace view and give me a copyable config snippet as fallback, so that I can complete installation either way.
19. As a website visitor without the app, I want marketplace pages to route me to the download page, so that discovery converts to installation.
20. As FlowLeap (the curator), I want publishing a new plugin to be a PR to one public monorepo, so that review, history, and rollback are ordinary git operations.
21. As FlowLeap (the curator), I want CI on the plugins monorepo to validate every manifest and skill before merge, so that a bad manifest can never reach users' apps.
22. As FlowLeap (the curator), I want to add or edit an MCP registry entry in one schema-validated data module, so that the API and the web pages can never disagree.
23. As FlowLeap (the curator), I want the website's plugin pages generated from the plugins monorepo at build time, so that plugin metadata has exactly one source of truth.
24. As FlowLeap (the business), I want v1 content free and public per ADR 0006, so that ecosystem adoption grows now while Pro-gated packs remain possible later on a separate channel.
25. As a Claude Code CLI user, I want FlowLeap Skill Packs authored in the Claude plugin format, so that the same packs work outside the IDE too.
26. As an agent operating the app, I want marketplace-installed skills and MCP servers to load through the same discovery paths as existing content, so that no special-casing is needed downstream.

## Implementation Decisions

**MCP Registry (website-hosted)**
- The website serves the standard MCP Registry v0 API (server list with `search`/cursor/limit params, plus latest-version and by-version lookups) as server routes, following the same handler pattern as the existing download/update/auth JSON routes.
- Registry entries live in one zod-validated typed data module in the website repo — the single source of truth consumed by both the API routes and the marketplace web pages. PR review is the curation gate.
- Launch content: a small vetted set of third-party MCP servers relevant to patent work, plus FlowLeap's own MCP server as an npm-package entry (the CLI's npm distribution, invoking its MCP subcommand over stdio).
- Response payloads conform to the official MCP registry server JSON schema, including package metadata (registry type, identifier, transport) and environment-variable declarations so the in-app installer can prompt correctly.

**App: MCP gallery activation**
- Set the product definition's MCP gallery service URL to the website registry endpoint; set the item web URL so gallery entries link out to their marketplace pages on flowleap.com. No UI changes — the existing gallery, search, and install flows activate as-is.
- The MCP tab's "Learn more" link is repointed to FlowLeap's marketplace docs page as part of a small branding sweep.

**Plugin Marketplace (public monorepo)**
- New public repo `abdullahatrash/flowleap-plugins`: a marketplace manifest at the root and one directory per plugin. GitHub transfer redirects cover a future org move.
- Plugins are authored in the Claude plugin manifest format (the format the app's adapter set and the Claude Code CLI both understand), so packs are usable beyond the IDE.
- Launch packs (3–5) repackage the multi-harness CLI skill families: a Personas pack (patent attorney, IP analyst, researcher, startup founder), a Recipes pack (prior-art, FTO, landscape, claim analysis, patent-to-report, literature review), and a FlowLeap CLI tools pack. These skills operate through the FlowLeap CLI / backend facade, so they work inside Claude sessions — unlike the bundled Patent Skills, which stay bundled and panel-chat-only.
- The app's default marketplaces setting is replaced: both upstream Copilot repos removed, the FlowLeap monorepo added as the sole default, pre-seeded as trusted. Marketplaces the user adds keep the existing trust confirmation flow.
- CI in the plugins repo validates the marketplace manifest, every plugin manifest, and every skill's frontmatter on each PR (validator pattern borrowed from the CLI repo's example validator).

**Website marketplace hub**
- A `/marketplace` hub with sections for Plugins & Skills and MCP Servers, plus a detail page per entry, reusing the tools-hub layout, zod frontmatter validation, sitemap and flip-gate SEO machinery.
- Plugin page data is synced from the plugins monorepo at build time (fetch script committed to the website repo); MCP page data comes from the registry data module directly.
- Plugin detail pages carry an "Install in FlowLeap" deep link using the app's existing confirm-gated plugin-install URL handler. MCP detail pages carry an open-in-app link targeting the marketplace view plus a copyable config snippet; pages detect no protocol handler and fall back to the download page.

**App: discoverability + cleanup**
- The Skills section of the Agent Customizations window gets a "Browse Skill Packs" action that opens the Plugins section in marketplace browse mode.
- The existing open-marketplace command is wired to the same destination, and remaining Copilot-pointing marketplace defaults/links in the customizations surfaces are swept.

## Testing Decisions

Good tests here assert external behavior at three seams — one per repo — and avoid
poking at the marketplace machinery's internals, which are upstream-tested.

- **App — config/product defaults seam.** The marketplace machinery natively accepts
  `file:`-scheme sources: gallery service tests run against a local fixture registry
  payload, and plugin discovery tests run against a `file://` fixture marketplace
  directory, asserting that entries enumerate, install metadata parses, and the
  pre-trusted default skips the confirmation while a user-added ref does not. Prior
  art: existing MCP gallery and plugin service unit tests in the fork.
- **Website — shared schema seam.** Contract tests on the registry routes assert
  schema-valid v0 responses (list, search filtering, latest-version lookup) validated
  against the official MCP registry server schema; the build-time sync script is tested
  by running it against a fixture plugins repo. Prior art: existing API route tests and
  Playwright e2e suite.
- **Plugins repo — CI validation seam.** The validator itself is the test surface:
  malformed manifests and frontmatter must fail CI; the shipped packs must pass.
- **HITL acceptance smoke** (per repo-standard practice for chat surfaces): from a
  clean profile — browse and install one MCP server in-app and see its tools in a
  Claude session; install one Skill Pack and invoke one of its skills in a session;
  drive both website CTAs end-to-end (plugin deep link, MCP open-in-app); confirm no
  Copilot marketplace content appears anywhere.

## Out of Scope

- Pro gating, entitlements, or any authenticated distribution channel (ADR 0006: later,
  separate channel; nothing in v1's public surfaces may become paid).
- Third-party publishing: submission pipeline, review workflow, moderation policy.
- One-click MCP install deep links from the website (the in-app URL handler exists
  upstream — verified — but wiring and hardening it is a fast-follow, not v1).
- A standalone skill installer or any skill distribution outside plugins.
- Unbundling the built-in Patent Skills into marketplace packs.
- Backend (Express) involvement — no new backend routes; the registry is public website
  content in v1.
- GitHub org creation/migration; hooks/agents/instructions marketplace sections.

## Further Notes

- The decisive discovery: the fork already contains the complete marketplace machinery
  for both surfaces. The MCP gallery is dark only because the product definition lacks a
  service URL; the plugin marketplace is live but pointed at Copilot's repos. v1 is
  therefore mostly content, hosting, and defaults — not new app subsystems.
- Update cadence is inherited: marketplace fetches are cached ~8h with ~24h plugin
  auto-update; the registry endpoint is live-served, so MCP catalog edits appear on the
  next gallery query.
- The public MCP Registry endpoint doubles as discovery infrastructure for non-FlowLeap
  MCP clients, which is why FlowLeap's own server is listed despite overlapping the
  app's built-in typed tools.
- Work spans three repos (app, website, new plugins repo) and should be sliced so each
  issue is single-repo; the app issues depend on the registry endpoint and plugins repo
  existing, so those land first.
