# Changelog

All notable changes to FlowLeap Patent AI are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and version numbers follow [Semantic Versioning](https://semver.org/).

## [0.2.0] - 2026-08-09

### Patent analytics over PATSTAT

- **Portfolio analytics** — aggregate a named applicant's filings by CPC/IPC
  class, office, year, family, and grant status, with harmonized entity
  resolution. Every figure carries its PATSTAT Data Edition.
- **Guarded SQL** — write read-only `SELECT` queries against the `flowleap.*`
  semantic views for landscapes, grant rates, citation impact, and inventor
  analytics that the typed commands do not cover.
- **Graph analytics** — six graph operations over the worldwide DOCDB citation
  network: who cites a patent (examiner versus applicant origin), citation and
  family paths between two patents, family coverage, and an applicant's
  co-applicant network. Every edge is tagged with a confidence level and a
  PATSTAT row reference.
- The agent now routes between keyword analytics, structured aggregation, and
  graph traversal on the shape of the question rather than its wording.

### Provider-key handling

- The agent knows which patent-provider keys are connected and adapts instead
  of stalling: it does the work that needs no key, tells you exactly which key
  a blocked step wants, and resumes that step once you connect it.
- Key state is shown in the chat surface, so a missing EPO OPS or USPTO ODP
  credential is visible before a search fails.

### Bundled skills

- Updated to FlowLeap CLI v0.6.0 — refreshed provider-key setup guidance,
  authentication states, and search recipes.
- Added the `flowleap-patstat-graph` skill for the new graph analytics.

### Fixed

- Chat output panels no longer go blank when a streamed response re-renders.
- A patent lookup by number no longer drops its only matching record.
- An empty result set now reports that it is empty instead of reporting a
  size overrun, and a large result that is trimmed says so plainly.
- Class-based landscape questions route to portfolio analytics instead of
  free-text search.
- The GitHub Copilot walkthrough no longer appears in patent mode.

## [0.1.0] - 2026-07-24

First public release of **FlowLeap Patent AI** — an AI patent agent for
patent professionals, built on the VS Code platform.

### Patent research agent

- Chat-driven patent agent with 28 typed tools against the FlowLeap backend:
  EPO patent search (CQL, with natural-language query building), USPTO Open
  Data Portal search, applications and continuity chains, file-wrapper and
  office-action documents, enriched citation data (backward and forward, with
  X/Y/A relevance tagging), patent-law reference search (MPEP, EPC, EPO
  Guidelines), academic and non-patent literature search, claim analysis and
  comparison, patent details and figures, portfolio analytics, and report
  writing.
- 25 bundled patent skills covering the full lifecycle — invention disclosure,
  prior-art and novelty search, claim drafting and analysis, office-action
  response, freedom-to-operate, invalidity analysis, infringement charting,
  patent landscaping, maintenance-fee checks, and formatted patent reports.
- Project templates for common patent workflows.

### Bring your own key

- Model access is BYOK: connect your own API key (Anthropic, OpenRouter, and
  other providers) — prompts and documents go directly from your machine to
  your model provider.
- Dedicated settings page for managing model and patent-provider credentials
  (EPO OPS, USPTO ODP).

### Documents

- Built-in PDF viewer with OCR text extraction for prior-art documents and
  office actions.
- DOCX viewer and Markdown-to-PDF export for work products.

### Platform

- FlowLeap account sign-in for backend access, with a free tier for patent
  data.
- Agent sessions window for long-running, reviewable agent work.
- macOS builds (Apple Silicon and Intel) are code-signed, notarized, and
  stapled. Windows installers (system and per-user) are Authenticode-signed.
