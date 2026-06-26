---
name: citation-analysis
description: Analyze office action citations - examiner prior art references with X/Y/A categories
user-invocable: true
---

# Citation Analysis

Deep-dive into office action citations — what prior art examiners used and why.

## Tool Chain
1. `citation_api_guide` action="list" → see available citation endpoints
2. `citation_api_guide` action="endpoint" endpoint="[type]" → get curl template
3. `run_in_terminal` → execute curl to `/v1/citation-search`

## Citation Categories

| Category | Legal Basis | Meaning |
|----------|------------|---------|
| **X** | 35 USC 102 (novelty) | Single reference destroys novelty — the reference alone anticipates the claim |
| **Y** | 35 USC 103 (obviousness) | Combined with other Y refs, makes claims obvious |
| **A** | Background | State of the art, not blocking — cited for context |
| **D** | In application | Document cited by the applicant themselves |
| **E** | Earlier filing | Earlier application with later publication date |

## Workflows

### "What prior art was cited against patent/application X?"
1. `citation_api_guide` action="endpoint" endpoint="citations" → get curl
2. Run curl with the patent/application number
3. Categorize results by X/Y/A ratings
4. For X-rated citations: these are the most damaging — analyze in detail

### "Find novelty-destroying references"
1. `citation_api_guide` action="endpoint" endpoint="novelty"
2. Run curl → returns only X-rated citations
3. For each X citation: fetch claims via ops_api_guide to compare

### "Who cites this patent?" (forward citations = impact measurement)
1. `citation_api_guide` action="endpoint" endpoint="forward"
2. Run curl → returns all patents that cite the target
3. High forward citation count = important/foundational patent

### "Build a citation network"
1. Get backward citations (what this patent cites)
2. Get forward citations (who cites this patent)
3. For key nodes: get their citations too (2-hop network)
4. Map the technology evolution through citation chains

## Analysis Template

### Citation Summary for [Patent Number]
| Cited Reference | Category | Relevant Claims | Key Teaching |
|----------------|----------|-----------------|--------------|
| US7,123,456 | X (novelty) | Claims 1-3 | Anticipates core method |
| EP1234567 | Y (obvious) | Claims 1, 5 | Combined with US'789 |
| WO2020/123 | A (background) | — | General state of art |

### Examination Timeline Correlation
For EP patents, correlate citations with examination events:
1. `ops_api_guide` action="endpoint" endpoint="register-events" → curl `/v1/ops/register/events?doc=EP...`
2. Match citation dates with examination report dates to understand which citations were raised at which stage

### Impact Analysis
- **Forward citations**: [count] — indicates [low/moderate/high] influence
- **Key citing patents**: [list of important patents that cite this one]

## Rules
- Only report citation categories returned by the API
- Note: not all patents have examiner citations in the database
- X citations are most critical for validity challenges
- Y citations must be considered in combination (not alone)
