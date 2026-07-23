---
id: W6
title: CLI & backend ergonomics batch (envelope, flags, aliases, schema, doctor)
type: task
status: open
assignee:
blocked-by: []
---

## Question

Apply the agent-ergonomics fixes from the evaluation that live in the CLI/backend layer (not the
skills). These are the per-run friction tax (~4–7 wasted turns of ~40).

Batch (findings F7, F9, F10, F11, F12, F13, F17):
- **F7** — flag whiplash: `patent search` requires `--query` and rejects a positional; `legal search`
  requires a positional and rejects `--query`. Accept both forms on every search verb (aligns with
  the existing #154 ergonomics direction).
- **F9** — search enrichment degrades with volume: `patent search --json` returned null
  title/abstract/applicants for 3/10 hits, 20/50 at `--limit 50`, and MCP `search_patents` returned
  all-null biblio where the CLI enriched fine at low limits. Root-cause the parser; it must not
  partially fail by row.
- **F10** — MCP `search_patents` schema marks all five params `required` though all but `query` are
  defaulted, and `limit`/`offset` say "uspto only" yet are required for `epo_ops`. Mark only `query`
  required; document provider-specific params as optional.
- **F11** — `legal search --jurisdiction` accepts office codes (uspto/epo/eu/wipo) but rejects the
  `US`/`EP` a practitioner writes. Accept jurisdiction aliases.
- **F12** — `doctor` reports the wrong latest CLI version (showed 0.3.1 vs npm 0.3.4) and
  `recorded: 1` undercounts installed skills. Fix the version source and the recorded-count query.
- **F13** — facade `tools run get_claims` wants `KEY=VALUE` (not `--arg`) and `patent_number` (not
  the `docId` the `ops` CLI uses). Accept `docId` as an alias; document arg syntax in facade help.
- **F17** — `get_family` is not a tool name (it is `get_patent_family`); minor discoverability.

### Definition of done
Fixes merged (surface named per item), `cargo test` green, exit-code/JSON contracts consistent
across search verbs.
