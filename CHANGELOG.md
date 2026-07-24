# Changelog

All notable changes to FlowLeap Patent AI are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and version numbers follow [Semantic Versioning](https://semver.org/).

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
