---
name: legal-research
description: Search patent law - MPEP (USPTO), EPC articles, and EPO examination guidelines
user-invocable: true
---

# Patent Legal Research

Search and cite patent law using the hybrid semantic + keyword legal search engine.

## Tool Chain
1. `legal_search_guide` action="list" → see available endpoints
2. `legal_search_guide` action="endpoint" endpoint="search" → get curl template
3. `run_in_terminal` → execute curl to `/v1/legal-search`

## Search Parameters

| Parameter | Options | Description |
|-----------|---------|-------------|
| `query` | any text | Natural language or keyword query |
| `jurisdiction` | "USPTO", "EPO", "EU", "WIPO", "all" | Which law to search |
| `comprehensive` | true/false | true = full section text for quoting |
| `search_mode` | "hybrid", "semantic", "keyword" | Search approach |

## Common Legal Research Tasks

### Patentability (35 USC 101 / EPC Art. 52)
- USPTO: `query="subject matter eligibility software", jurisdiction="USPTO"`
- EPO: `query="software patentability technical effect", jurisdiction="EPO"`
- Key MPEP sections: 2106 (101 analysis), 2106.04 (abstract ideas)
- Key EPC: Art. 52(2)(c) — programs for computers

### Novelty (35 USC 102 / EPC Art. 54)
- MPEP 2131 (anticipation), 2132 (102(a)(1) prior art)
- EPC Art. 54 — novelty requirements
- `query="novelty anticipation single reference", jurisdiction="USPTO"`

### Obviousness (35 USC 103 / EPC Art. 56)
- MPEP 2141-2144 (obviousness framework, Graham factors, TSM test)
- EPC Art. 56 — inventive step, problem-solution approach
- `query="obviousness motivation to combine", jurisdiction="USPTO"`
- `query="inventive step problem solution approach", jurisdiction="EPO"`

### Written Description / Enablement (35 USC 112)
- MPEP 2161-2164 (112(a) requirements)
- `query="written description requirement functional claim", jurisdiction="USPTO"`

### Claim Construction
- MPEP 2111 (broadest reasonable interpretation)
- `query="broadest reasonable interpretation claim construction", jurisdiction="USPTO"`

## Citation Format

When quoting legal sources:
- **MPEP**: "MPEP § 2143 states: '[actual text from response]'"
- **EPC**: "EPC Article 56 provides: '[actual text]'"
- **EPO Guidelines**: "EPO Guidelines G-VII, 5.4 states: '[actual text]'"

## Rules
- NEVER paraphrase legal text as if it's a direct quote
- ALWAYS use `comprehensive=true` when you need to quote sections
- Cite the exact section number returned by the search
- If legal_search doesn't have the answer, say so — don't make up law
