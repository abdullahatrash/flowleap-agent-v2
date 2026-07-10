---
name: legal-research
description: Search patent law — MPEP (USPTO), EPC articles, and EPO examination guidelines — with exact-quote citations. Use when the user asks a patent-law or procedure question, needs the statutory basis for patentability, novelty, obviousness, or written description (35 USC 101/102/103/112, EPC Art. 52/54/56), or wants MPEP sections or EPO Guidelines looked up and quoted.
user-invocable: true
---

# Patent Legal Research

Search and cite patent law using the hybrid semantic + keyword legal search engine.

## Tools (typed tool FIRST)

- `search_legal` — **primary** for legal lookups. Searches MPEP, EPC, and EPO Guidelines; supports a jurisdiction filter ("USPTO", "EPO", "EU", "WIPO", "all") and `comprehensive` mode (full section text for quoting).
- `legal_search_guide` + `patent_api_request` — ONLY for advanced cases: restricting to specific sources (e.g. MPEP only), semantic-only or keyword-only search modes, or semantic-weight/similarity-threshold tuning.

## Common Legal Research Tasks

### Patentability (35 USC 101 / EPC Art. 52)
- USPTO: `search_legal` query="subject matter eligibility software", jurisdiction="USPTO"
- EPO: query="software patentability technical effect", jurisdiction="EPO"
- Key MPEP sections: 2106 (101 analysis), 2106.04 (abstract ideas)
- Key EPC: Art. 52(2)(c) — programs for computers

### Novelty (35 USC 102 / EPC Art. 54)
- MPEP 2131 (anticipation), 2152 (AIA 102(a)(1) prior art — 2132 is the PRE-AIA section, wrong for first-inventor-to-file applications); EPC Art. 54
- query="novelty anticipation single reference", jurisdiction="USPTO"

### Obviousness (35 USC 103 / EPC Art. 56)
- MPEP 2141-2144 (obviousness framework, Graham factors, TSM test)
- EPC Art. 56 — inventive step, problem-solution approach
- query="obviousness motivation to combine", jurisdiction="USPTO"
- query="inventive step problem solution approach", jurisdiction="EPO"

### Written Description / Enablement (35 USC 112)
- MPEP 2161-2164 (112(a) requirements)
- query="written description requirement functional claim", jurisdiction="USPTO"

### Claim Construction
- MPEP 2111 (broadest reasonable interpretation — examination of PENDING applications only; granted patents in litigation/IPR use the *Phillips* ordinary-meaning standard)
- query="broadest reasonable interpretation claim construction", jurisdiction="USPTO"

## Citation Format

When quoting legal sources:
- **MPEP**: "MPEP § 2143 states: '[actual text from response]'"
- **EPC**: "EPC Article 56 provides: '[actual text]'"
- **EPO Guidelines**: "EPO Guidelines G-VII, 5.4 states: '[actual text]'"

## Rules
- NEVER paraphrase legal text as if it's a direct quote
- ALWAYS use `comprehensive=true` when you need to quote sections
- Cite the exact section number returned by the search
- If the legal search doesn't have the answer, say so — don't make up law
