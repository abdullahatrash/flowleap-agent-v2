---
name: patent-search
description: Multi-jurisdiction patent search using EPO OPS and USPTO PatentsView APIs
user-invocable: true
---

# Patent Search

Comprehensive patent search across EPO OPS (EP/WO) and USPTO PatentsView (US) APIs.

## Jurisdiction Gate (MANDATORY)

Before ANY search, determine jurisdiction. If not specified by the user, ask using `askQuestions` tool:
- "US patents only" → USPTO path
- "European/International (EP/WO)" → EPO OPS path
- "Both (comprehensive)" → Run both

## EPO OPS Search (EP/WO Patents)

### Tool Chain
1. `build_patent_query` with invention description → returns CQL
2. `search_patents` with the CQL → returns EP/WO results
3. `ops_api_guide` action="endpoint" → get curl docs for detail endpoints
4. `run_in_terminal` → execute curl for biblio/claims/family

### CQL Syntax Quick Reference
- Applicant: `pa=Samsung` or `pa="Samsung Electronics"`
- Title/Abstract: `ti=battery or ab=battery`
- IPC codes: `ic=H01M` (batteries), `ic=G06N` (AI), `ic=A61K` (pharma)
- Date: `pd>=2024`
- Combined: `pa=Tesla and ic=H01M and pd>=2023`

### Common IPC Codes
| Code | Domain |
|------|--------|
| G06N | AI, machine learning, neural networks |
| G06F | Computing, data processing |
| H01M | Batteries, fuel cells |
| H02J | Power supply, charging |
| H04L | Data transmission, networks |
| H04W | Wireless communication |
| B60L | Electric vehicles |
| A61K | Pharmaceutical compositions |
| A61B | Medical diagnosis |
| C12N | Biotechnology, genetic engineering |

## USPTO Search (US Patents)

### Tool Chain
1. `uspto_api_guide` action="endpoint" endpoint="search" → get curl docs
2. `run_in_terminal` → execute curl to `/v1/patent-search-uspto`

### Key Parameters (JSON body, NOT in query string)
- `query`: keywords (do NOT put company names here)
- `assignee`: company name (separate parameter!)
- `cpcCode`: CPC classification
- `dateRange`: `{ from: "2024-01-01", to: "2025-12-31" }`
- `size`: number of results (default 25)

### Common Mistakes
- ❌ `query="Apple display"` — puts company in keyword search
- ✅ `query="display", assignee="Apple"`

## Search Refinement
- Too many results (>10,000): add date filter, narrow CPC code
- Too few results (<10): try synonyms, remove filters, use parent CPC
- Try subsidiary companies: Google → also Alphabet, DeepMind, Waymo
- Try keyword variations: "machine learning" → "neural network", "deep learning"

## Output
- Always CREATE a markdown file with search results
- Include: patent number, title, applicant, date, relevance summary
- Use tables for >5 results
- Reference the saved file in your response
