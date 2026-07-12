# Handoff: FlowLeap Patent Ecosystem — end-to-end evaluation & release drive

Written 2026-07-12 at the end of the marketplace build-out session. Audience: a fresh
agent session (and the founder) taking over to evaluate the ecosystem end to end and
drive the release. Read `CONTEXT.md` (domain glossary) and `docs/adr/0006` before acting.

## 1. The strategy you are executing

**CLI + MCP first.** The release bet: a patent professional opens ANY harness — Claude
Code, Cursor, Codex, Claude Desktop, a terminal — and FlowLeap works there: `flowleap`
CLI (npm, binary-download, sha256-verified), `flowleap mcp` (26 backend tools over
stdio), and the skill packs (`npx skills add abdullahatrash/flowleap-plugins`). The
FlowLeap IDE (this repo's fork) is ONE harness among many, not the center. Evidence this
works: all verified live on 2026-07-12 (see §5).

**The moat is patent-focused content + data, not the shell.** No patent office publishes
an official MCP server (researched 2026-07-11; PatentsView is dead since 2026-03). The
FlowLeap MCP Registry is currently the only curated patent-work MCP catalog.

## 2. Ecosystem map (repos, surfaces, seams)

| Piece | Where | State |
|---|---|---|
| FlowLeap IDE (VS Code fork) | `abdullahatrash/flowleap-agent-v2` | builds/runs; marketplace wired (product.json `mcpGallery` → registry; default plugin marketplace pre-trusted) |
| Patent backend (Express+TS, Clerk, Polar, Drizzle) | `abdullahatrash/flowleap-backend` | prod at api.flowleap.co; `/v1/tools` facade = 26 tools; data gated on auth+subscription (single flat plan, internal enum `basic`, public name "FlowLeap Plan") |
| CLI + MCP server (Rust) | `abdullahatrash/flowleap-cli` | v0.3.1 on npm (`flowleap`); `flowleap mcp` serves the 26 tools; `mcp --check` = onboarding diagnostics; skills/ = CANONICAL home of all 33 skills (12 recipes incl. 6 tier-2, 4 personas, 12 tool skills, umbrella + shared) |
| Plugin marketplace (skills distribution) | `abdullahatrash/flowleap-plugins` | 3 packs / 22 skills, synced copies of CLI skills pinned by `sync.json` + CI drift check; consumed by the IDE (pre-trusted default) AND `npx skills add` |
| Website (TanStack Start on Vercel) | `abdullahatrash/flowleap-website-v2` | www.flowleap.co (www canonical); MCP Registry v0 API at `/api/mcp` (10 servers, CORS-enabled); `/marketplace` hub + detail pages + guide; MCP page with 10 verified harness snippets |

Key seams (don't rediscover): app gallery = standard MCP Registry v0 client
(`mcpGalleryService`); installs write profile `mcp.json` (`identifier@version`, pinned
by design — supply-chain); MCP reaches Claude sessions via a local HTTP gateway; skills
reach Claude sessions via SDK plugin dirs (`ClaudePluginService`; bundled extension
chatSkills are FILTERED OUT of sessions by design — they call panel-chat typed tools);
plugin installs/updates = git clone of the marketplace repo (~8h cache/~24h auto-update).

**Skill precedence trap (#150):** user-scope `~/.claude/skills` SHADOWS same-name
plugin/marketplace skills. `flowleap skills install` writes there with no version
marker. This silently defeated updates on the founder's machine (stale skills taught a
removed `--source` flag → cascading 400s that looked like model drift). Before
diagnosing ANY skill misbehavior: check which copy loaded (`ls -la ~/.claude/skills/`,
grep for a version fingerprint like `--focus broad` / X/Y/A).

## 3. Open work (as of this handoff)

**In flight (agents running, PRs expected):**
- #147 Tools section: surface MCP server tools + fix sidebar count (app)
- #149 Skill hardening, 5 items incl. localhost de-emphasis (canonical skills; needs
  flowleap-plugins re-sync after merge: bump `sync.json` ref + re-copy per drift-check workflow)
- #150 CLI slice: version-stamped `skills install --update` + staleness warning in doctor/check
- #151 Contributor guide: CONTRIBUTING + template + drift-check coexistence + website Submit-a-skill

**Post-release queue (deliberately deferred):** #141 (Learn-more links + 2 startup
warnings), #142 (plugin-skill attribution in Skills tab), #148 (Claude session wedges on
SDK resume-miss; forensics live in `~/.claude/projects/-Users-abdullahatrash-FlowLeap-Projects-test-agent-v2/`,
session d0f3194c…), #145 (auto-bump registry version on CLI release; needs cross-repo
PAT secret), #150 app slice (shadowing warning in Skills tab), #138 (tier-2
prosecution/litigation pack — content exists in CLI skills already; must pass the review
rubric + restore FTO's charting cross-ref).

**#116 HITL residue:** website deep-link CTAs from default profile; third-party
marketplace trust dialog; uninstall lifecycle; re-run of the prior-art recipe now that
`~/.claude/skills` is refreshed (verify X/Y/A table, family dedup, `uspto build-query`).

## 4. The evaluation charter (the new session's core job)

Evaluate the ecosystem END TO END **as patent work product, through a patent
professional's eyes** — not a developer's. The founder's explicit concern: everything so
far was authored and validated by coding agents; coding-agent bias is assumed present.

Matrix to cover (sample, don't exhaustively grind):
- **Harnesses:** Claude Code (CLI), FlowLeap IDE session, one non-Claude MCP client
  (Cursor or Codex), bare terminal (CLI only).
- **Content:** one persona (attorney), two recipes (prior-art, FTO), tool skills
  (patent/uspto/ops), MCP-only path (no skills — does `flowleap mcp` alone serve a
  usable workflow?).
- **Judging criteria (patent-professional lens):** Is the deliverable structured like
  real work product (X/Y/A tags, one-row-per-family, all-elements FTO reasoning,
  effective-date discipline per CONTEXT.md glossary)? Would an attorney accept the FTO
  memo? Are legal terms used correctly? Is anything phrased in dev idiom that should be
  practice idiom? Where does the agent waste turns (CLI friction = skill gaps — file as
  measured drift, the #149 pattern)?
- **Output:** a findings report → tiered fixes (the review→fix→resync loop is
  established: canonical edits in flowleap-cli → tag → sync.json bump in flowleap-plugins).
  Consider promptfoo-style evals for regressions (prior art: #27 baseline exists for
  panel chat; nothing yet for CLI-skill outputs).

## 5. What is already verified live (don't re-prove)

Registry v0 API (10 servers, CORS, version probe settles v0) · in-app gallery browse/
search/scroll/install · pre-trusted pack install (no dialog) · flowleap MCP server via
gateway returning real patent data in a session · `mcp --check` full green with stored
CLI auth + BYO keys · `npx skills add … --list` (22 skills) · website hub/detail/guide
pages + deep-link formats verified against handler source · plugin `env`+`inputs`
install shape + first-start prompts (post-#146) · sitemap/canonicals on www.

## 6. Release gate (proposed definition of done)

1. #149 + #150-CLI + #151 merged; flowleap-plugins re-synced (drift green); CLI released
   (vNEXT; the release checklist = tag==Cargo==npm, then merge the registry-bump PR —
   manual until #145).
2. #116 residue done by founder.
3. Evaluation charter (§4) run; must-fix findings applied; second pass clean.
4. Announce surfaces ready: skills.sh listing (repo is compatible — root skills/
   symlinks), MCP page, marketplace hub, Submit-a-skill path live.

## 7. Operating notes for the next session

- Tracker = this repo's issues; `ready-for-agent` label = dispatchable. All cross-repo
  work is tracked here with [repo] prefixes.
- Shared-tree rules for agent-v2 (concurrent agents, explicit-path commits), worktree
  isolation for same-repo parallel work in other repos.
- The founder reviews and merges ALL PRs; agents never merge. Public/outward actions
  (repo creation, releases) need explicit founder approval.
- Memory files in the Claude project dir carry deep per-decision context; the index
  is MEMORY.md (see `flowleap-marketplace-v1-prd-0009`, `skills-craft-review-and-sync-loop`,
  `patent-mcp-landscape-2026-07`, `business-model-pro-ecosystem` for naming rules).
- Plan-name rule: public = "FlowLeap Plan"; `basic` is internal-only; never in copy.
