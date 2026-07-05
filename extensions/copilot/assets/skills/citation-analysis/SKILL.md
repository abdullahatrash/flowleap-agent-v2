---
name: citation-analysis
description: Analyze examiner citations from office actions — prior art cited against applications with X/Y/A categories, forward-citation impact, and citation networks. Use when the user asks what prior art was cited against a patent or application, wants novelty-destroying (X) references, asks "who cites this patent", or wants a citation network or impact analysis. For classifying NEW prior art yourself use patent-examination.
user-invocable: true
---

# Citation Analysis

Deep-dive into office action citations — what prior art examiners used and why.

## Tools (typed tools FIRST)

- `search_citations` — **primary** for backward citations: prior art cited by examiners AGAINST a USPTO application. Input: application number; supports X/Y/A category filter and examiner-cited filter.
- `search_forward_citations` — **primary** for forward citations: patents that CITE a given document (impact analysis). Input: cited document number.
- `citation_api_guide` + `patent_api_request` — ONLY for cases the typed tools don't cover: citation statistics, the novelty-only convenience endpoint, or date-range filtering.

## Citation Categories

| Category | Legal Basis | Meaning |
|----------|------------|---------|
| **X** | 35 USC 102 (novelty) | Single reference destroys novelty — alone anticipates the claim |
| **Y** | 35 USC 103 (obviousness) | Combined with other Y refs, makes claims obvious |
| **A** | Background | State of the art, not blocking — cited for context |
| **D** | In application | Document cited by the applicant themselves |
| **E** | Earlier filing | Earlier application with later publication date |

Same X/Y/A scheme as EPO search reports — for the full classification methodology, use the patent-examination skill.

## Workflows

### "What prior art was cited against patent/application X?"
1. `search_citations` with the application number
2. Categorize results by X/Y/A ratings
3. For X-rated citations (most damaging): fetch their claims via `get_patent_details` and analyze in detail

### "Find novelty-destroying references"
1. `search_citations` filtered to category X
2. For each X citation: compare claims side by side (`get_patent_details` for the text; patent-examination skill for the analysis)

### "Who cites this patent?" (impact measurement)
1. `search_forward_citations` with the document number
2. High forward citation count = important/foundational patent

### "Build a citation network"
1. Backward citations (`search_citations`) + forward citations (`search_forward_citations`)
2. For key nodes: get their citations too (2-hop network)
3. Map technology evolution through the citation chains

### Examination timeline correlation (EP)
1. `ops_api_guide` action="endpoint" endpoint="register-events" → `patent_api_request`
2. Match citation dates with examination report dates to see which citations were raised at which stage

## Analysis Template

| Cited Reference | Category | Relevant Claims | Key Teaching |
|----------------|----------|-----------------|--------------|
| US7,123,456 | X (novelty) | Claims 1-3 | Anticipates core method |
| EP1234567 | Y (obvious) | Claims 1, 5 | Combined with US'789 |
| WO2020/123 | A (background) | — | General state of art |

Impact analysis: forward citation count → low/moderate/high influence, plus the key citing patents.

## Rules
- Only report citation categories returned by the API
- Note: not all patents have examiner citations in the database
- X citations are most critical for validity challenges
- Y citations must be considered in combination (never alone)
