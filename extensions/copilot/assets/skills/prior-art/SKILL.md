---
name: prior-art
description: Systematic multi-jurisdiction prior art search using the USPTO broad-to-narrow methodology, with concept-synonym tables, classification mapping, and a full audit trail. Use when the user wants prior art for an invention, a patentability or novelty search, or asks "is my idea new" or "has this been done before". For a quick patent lookup use patent-search instead; for assessing retrieved passages against claim text use patent-examination.
user-invocable: true
---

# Prior Art Search

Systematic prior art search across all available databases using USPTO-recommended broad-to-narrow methodology with full documentation.

For CPC/IPC section tables, common codes, and classification search syntax, see [references/cpc-classification.md](references/cpc-classification.md).

## Phase 1: Invention Analysis (USPTO 3-Sentence Technique)

### 1a. Three-Sentence Description
Describe the invention three different ways (ask the user, or derive from their description): 1. structure/components, 2. function/use case, 3. novelty/differentiation. Review all three for **repeated words and phrases** — these are the core concepts. If the user is describing THEIR OWN invention, run `analyze_claim` first — it extracts keywords, synonyms, and IPC/CPC codes automatically.

### 1b. Concept-Synonym Table (MANDATORY)
Build a table of every concept with synonyms, technical equivalents, and related terms:

| Concept | Synonyms & Variations |
|---------|----------------------|
| [Primary concept] | [synonym1], [synonym2], [technical term] |

Use dictionaries, technical manuals, and `web_search` to discover terms. Aim for **at least 3 variations per concept**.

### 1c. Classification Mapping
Identify **2-3 CPC/IPC codes** covering the invention (see [references/cpc-classification.md](references/cpc-classification.md)). Note both broad parent codes and specific subgroups.

### 1d. Critical Date & Prior Art Scope
- **Critical date**: priority or filing date — all prior art must predate this
- **Prior art includes** (per 35 USC 102): patents and published applications (US and foreign); printed publications (journals, manuals, websites); public use or on sale (trade shows, demos, launches); otherwise available to the public (talks, social media, videos)
- Ask the user: was the invention publicly demonstrated, sold, or shown anywhere before filing?

## Phase 2: Broad-to-Narrow Search (USPTO Core Methodology)

### 2a. Build Search Sets
Start broad, narrow progressively. Document hit counts at every step:

| Set | Query | Purpose |
|-----|-------|---------|
| X1 | [Primary concept] OR synonyms | Broadest — primary concept |
| X2, X3 | [Other concepts] OR synonyms | Each remaining concept |
| X4 | X1 AND X2 | First narrowing |
| X5 | X4 AND X3 | Second narrowing → reviewable set |

**Primary concept** = the single concept ALL relevant results must contain.

### 2b. EPO OPS (EP/WO)
1. `build_patent_query` with the concept-synonym table → CQL
2. `search_patents` with the CQL → record result count
3. Run at least **3 query variations** with different synonym combinations; combine with CPC: `ic=[CPC] AND (kw1 OR kw2)`
4. For top 3-5 results: `get_patent_details` → full claims and description

### 2c. USPTO (US)
1. `build_uspto_query` with the invention description → ODP Lucene search body (do NOT hand-write legacy PatentsView parameters — they no longer exist)
2. `patent_api_request` (POST) with the generated body → record hit counts
3. Run keyword + CPC + assignee variations; filter to before the critical date
4. For endpoint details beyond search: `uspto_api_guide` action="list"

### 2d. Google Patents / WIPO / Asian Offices
Use `web_search` for coverage the APIs miss:
- Full text: `site:patents.google.com "[phrase]" "[kw2]"` (add CPC code to narrow)
- PCT applications: `site:patentscope.wipo.int "[kw1]" "[kw2]"`
- CN/JP/KR: `site:patents.google.com/patent/CN "[kw1]"` (likewise /JP, /KR) — see the patent-translation skill for the full multi-language strategy

### 2e. Non-Patent Literature (NPL)
Prior art is NOT limited to patents:
1. `search_academic` for papers (Scholar, arXiv, PubMed)
2. `web_search` targeted: `site:arxiv.org`, `site:pubmed.gov`, `site:ieee.org`
3. Consider conference proceedings, standards, product manuals, YouTube demos

### 2f. Family & Citation Expansion
- Family with biblio in one call: `ops_api_guide` action="endpoint" endpoint="family-biblio" → `patent_api_request`
- Forward citations of key results: `search_forward_citations` → more recent related art
- Backward citations: `search_citations` for USPTO applications; follow 2 hops for key nodes

For very broad sweeps, `patent_search_subagent` can run the multi-database search autonomously — still document its queries and counts in the audit trail.

## Phase 3: Relevance Assessment

For each reference, map elements (✅ teaches / ⚠️ similar / ❌ missing) against each claim element, then classify:
- **102 (Novelty)**: ANY single reference disclosing ALL elements → X document
- **103 (Obviousness)**: 2+ references combined covering all elements, with motivation to combine → Y documents
- **Background**: same field, different approach → A document

For rigorous feature-by-feature classification, use the **patent-examination** skill.

## Phase 4: Report

Save via `write_patent_results`: search summary (3-sentence output, critical date, CPC codes), the concept-synonym table, broad-to-narrow set documentation with hit counts, every query executed per database (audit trail), results table with ratings and source database, element-by-element analysis of the top 3-5 references, NPL findings, novelty conclusion with potential 102/103 issues, and databases searched. Then generate the companion audit report (see the audit-report skill).

## Rules
- NEVER invent patent numbers — only cite what search tools returned
- ALWAYS include publication dates (critical for 102/103)
- ALWAYS build the concept-synonym table before searching
- Document ALL queries and hit counts — this is the audit trail
- Note which database each result came from
- Consider non-patent prior art (public use, on sale, demos), not just publications
