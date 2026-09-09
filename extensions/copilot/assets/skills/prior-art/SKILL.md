---
name: prior-art
description: Systematic multi-jurisdiction prior art search using the USPTO broad-to-narrow methodology, with concept-synonym tables, classification mapping, and a full audit trail. Use when the user wants prior art for an invention, a patentability or novelty search, or asks "is my idea new" or "has this been done before". For a quick patent lookup use patent-search instead; for assessing retrieved passages against claim text use patent-examination.
user-invocable: true
---

# Prior Art Search

Systematic prior art search within the user-confirmed jurisdictions, sources, and date basis. Separate a focused candidate review from a patentability opinion; provide the requested depth and record unsearched coverage.

For CPC/IPC section tables, common codes, and classification search syntax, see [references/cpc-classification.md](references/cpc-classification.md).

## Phase 1: Invention Analysis (USPTO 3-Sentence Technique)

### 1a. Three-Sentence Description
Describe the invention three different ways (ask the user, or derive from their description): 1. structure/components, 2. function/use case, 3. novelty/differentiation. Review all three for **repeated words and phrases** — these are the core concepts. If the user is describing THEIR OWN invention, decompose it yourself with the `claim-analysis` skill (Step 3b) — it turns the claim into keywords, synonyms and classification codes. Their unfiled invention text never leaves the machine.

### 1b. Concept-Synonym Table (MANDATORY)
Build a table of every concept with synonyms, technical equivalents, and related terms:

| Concept | Synonyms & Variations |
|---------|----------------------|
| [Primary concept] | [synonym1], [synonym2], [technical term] |

Use dictionaries, technical manuals, and `web_search` (when available) to discover terms. Aim for **at least 3 variations per concept**.

### 1c. Classification Mapping
Identify **2-3 CPC/IPC codes** covering the invention (see [references/cpc-classification.md](references/cpc-classification.md)). Note both broad parent codes and specific subgroups.

### 1d. Critical Date & Prior Art Scope
- **Critical date**: priority or filing date — all prior art must predate this
- **Prior art includes** (per 35 USC 102): patents and published applications (US and foreign); printed publications (journals, manuals, websites); public use or on sale (trade shows, demos, launches); otherwise available to the public (talks, social media, videos)
- Ask the user: was the invention publicly demonstrated, sold, or shown anywhere before filing?

## Phase 2: Broad-to-Narrow Search (USPTO Core Methodology)

### 2a. Build Search Sets
Start broad, narrow progressively. Keep a running audit after each call: exact input query, separate countries/date/range parameters, effective query returned by the backend, total matches, documents returned, and documents/passages reviewed. Label unavailable values as unavailable. Total matches are not the number reviewed; retain each failed call as an error, not zero hits.

Use this planning table, then replace planned sets with the actual execution log:

| Set | Query | Purpose |
|-----|-------|---------|
| X1 | [Primary concept] OR synonyms | Broadest — primary concept |
| X2, X3 | [Other concepts] OR synonyms | Each remaining concept |
| X4 | X1 AND X2 | First narrowing |
| X5 | X4 AND X3 | Second narrowing → reviewable set |

**Primary concept** = the single concept ALL relevant results must contain.

### 2b. EPO OPS (worldwide bibliographic index)
For EP/WO scope, pass `countries="EP,WO"` to `search_patents` or explicitly constrain publication authority in CQL. Record the effective query the backend echoes; the database name alone does not establish an authority filter.
1. Write the CQL from the concept-synonym table — see `patent-search` for the field reference
2. `search_patents` with the CQL → record result count
3. Test different synonym combinations and classification refinements. For each next query, name the unresolved feature or coverage gap it tests. When variants repeat reviewed documents, synthesize; further searches need a distinct unresolved question, not a target query count. Update the todo phase when switching to document analysis or writing.
4. For top 3-5 results: `get_patent_details` → full claims and description

### 2c. USPTO (US)
1. Write the ODP Lucene query from the concept-synonym table — see `patent-search`; `uspto_api_guide` gives the body shape
2. `patent_api_request` (POST) with the generated body → record hit counts
3. Run keyword + CPC + assignee variations; filter to before the critical date
4. For endpoint details beyond search: `uspto_api_guide` action="list"

### 2d. Google Patents / WIPO / Asian Offices
Use `web_search` for coverage the APIs miss (if `web_search` is not available on this model, skip this sweep, cover CN/JP/KR via patent-family expansion in 2f, and record the coverage gap in the audit trail):
- Full text: `site:patents.google.com "[phrase]" "[kw2]"` (add CPC code to narrow)
- PCT applications: `site:patentscope.wipo.int "[kw1]" "[kw2]"`
- CN/JP/KR: `site:patents.google.com/patent/CN "[kw1]"` (likewise /JP, /KR) — see the patent-translation skill for the full multi-language strategy

### 2e. Non-Patent Literature (NPL)
Prior art is NOT limited to patents:
1. `search_academic` for papers (Scholar, arXiv, PubMed)
2. `web_search` targeted: `site:arxiv.org`, `site:pubmed.gov`, `site:ieee.org` (if unavailable, `search_academic` in step 1 is the NPL source — note any remaining gap)
3. Consider conference proceedings, standards, product manuals, YouTube demos

### 2f. Family & Citation Expansion
- Family with biblio in one call: `ops_api_guide` action="endpoint" endpoint="family-biblio" → `patent_api_request`
- Forward citations — "who cites this?": `search_forward_citations` on the publication number → more recent related art
- Backward citations — the references cited AGAINST a patent: `search_citations` keyed on the US **application** number (resolve it via `get_patent_family` → `get_continuity`, not the publication number); follow 2 hops for key nodes

For very broad sweeps, `patent_search_subagent` can run the multi-database search autonomously — still document its queries and counts in the audit trail.

## When a search fails

Before handing back or recording a coverage gap in the audit trail, work the ladder in order:
1. **Clean zero result** (call succeeded, no hits): reformulate before concluding — swap synonyms from the concept table, broaden or narrow the CPC/IPC, drop a filter, try a different number format — then try the alternate office/route (`search_patents` ↔ `patent_api_request`, `get_patent_summary` when `get_patent_details` is empty).
2. **Search error** (5xx, gateway timeout, connection reset, truncated response): transient outage, not a coverage limit — back off and retry the same call, then switch office. NEVER record "no results" or "doesn't exist" from an errored call.
3. **Route exhausted** (both offices genuinely dry): fall back to the web — `fetch_webpage` is always available (even when `web_search` is not) against `patents.google.com/patent/NUMBER` or `freepatentsonline.com`; quote only text the page returned and spot-check the number and title.

Apply this ladder within the confirmed scope. Record an intentionally excluded source as not searched, and a focused review as incomplete coverage; neither requires an out-of-scope search. Log operational failures separately, naming what you tried.

## Phase 3: Relevance Assessment

For each feature, identify its exact supporting passage and scope: independent claim, dependent claim with its dependencies, embodiment, example, or background discussion. Preserve material identity, units, percentage denominator, and qualifiers. A numerical range overlap is partial support; an example or dependent-claim amount does not become a requirement of the whole publication.

Use supported / partial / not found in reviewed passages / uncertain. A negative finding describes the passages actually reviewed, not the whole technical field. Mark translations as translations and use only claim-specific links supplied by the source tool; if claims are not individually addressable, use the returned claims-section link and name the printed claim number in prose.

For a requested novelty/patentability assessment, apply the **patent-examination** skill to the retrieved evidence. A candidate review does not itself establish a novelty conclusion, and missing results do not establish patentability.

## Phase 4: Report

Save via `write_patent_results`: confirmed scope and cutoff basis, concept-synonym table, actual execution log, candidate summary, detailed feature evidence, and coverage limitations. Keep the candidate summary to four columns (publication, publication date, relevance, limitations); put filing dates, applicants, and feature mappings in per-candidate sections with exact source links. Include NPL findings and a novelty assessment only within the requested scope.

Before finalizing, reconcile each log row to its tool response, each feature label to its cited passage, and every generalization to the breadth of evidence reviewed. These checks apply equally to summary tables and saved files. Generate the companion audit report when requested (see the audit-report skill).

## Rules
- NEVER invent patent numbers — only cite what search tools returned
- ALWAYS include publication dates (critical for 102/103)
- ALWAYS build the concept-synonym table before searching
- Document ALL queries and hit counts — this is the audit trail
- Note which database each result came from
- Consider non-patent prior art (public use, on sale, demos), not just publications
