---
name: patent-search
description: Run patent searches across EPO OPS (EP/WO) and USPTO Open Data Portal (US) — query building, execution, and refinement. Use when the user wants to find patents by topic, applicant, or classification ("search patents for X", "what has company Y filed", "find EP patents about Z"). For a documented prior-art hunt against an invention use prior-art; for filing statistics and trends use patent-landscape.
user-invocable: true
---

# Patent Search

Comprehensive patent search across EPO OPS (EP/WO) and USPTO Open Data Portal (US).

## Jurisdiction Gate (MANDATORY)

Before ANY search, determine jurisdiction. If not specified by the user, ask (via the `vscode_askQuestions` tool):
- "US patents only" → USPTO path
- "European/International (EP/WO)" → EPO OPS path
- "Both (comprehensive)" → run both

## EPO OPS Search (EP/WO Patents)

### Tool Chain
1. `build_patent_query` with the invention/topic description → returns CQL
2. `search_patents` with the CQL → returns EP/WO results
3. `get_patent_details` for full claims/description of interesting hits
4. Other detail endpoints (family, legal, register): `ops_api_guide` → execute with `patent_api_request`

### CQL Syntax Quick Reference
- Applicant: `pa=Samsung` or `pa="Samsung Electronics"`
- Title/Abstract: `ti=battery or ab=battery`
- IPC/CPC codes: `ic=H01M` or `cpc=G06N` (for the technology-area → code mapping, see the CPC reference below — do not guess codes)
- Date: `pd>=2024`
- Combined: `pa=Tesla and ic=H01M and pd>=2023`

Common CPC/IPC codes by domain: see the prior-art skill's `references/cpc-classification.md`, or `web_search "cpc scheme [term]"` (when `web_search` is available).

## USPTO Search (US Patents)

The USPTO API is the **Open Data Portal (ODP)** with Lucene query syntax. Legacy PatentsView parameters (`query`/`assignee`/`cpcCode`/`dateRange`) **no longer exist** — never hand-write them.

### Tool Chain
1. `build_uspto_query` with a natural-language description → returns the current ODP Lucene search body
2. `patent_api_request` (POST) with the generated body → results
3. For other ODP endpoints (patent by ID, applications, continuity chains): `uspto_api_guide` action="list", then `patent_api_request`

`uspto_api_guide` is the single source of truth for current ODP request shapes.

## Search Refinement
- Too many results (>10,000): add a date filter, narrow the CPC code
- Too few results (<10): try synonyms, remove filters, use the parent CPC class
- Try subsidiary companies: Google → also Alphabet, DeepMind, Waymo
- Try keyword variations: "machine learning" → "neural network", "deep learning"

## Output
- Save results via `write_patent_results`
- Include: patent number, title, applicant, date, relevance summary
- Use tables for >5 results
- Reference the saved file in your response
