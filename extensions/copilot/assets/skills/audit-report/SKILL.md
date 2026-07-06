---
name: audit-report
description: Generate a traceable audit report documenting every search, source, limitation, and AI decision in a research session. Use after any substantive patent research (prior art, FTO, landscape) or when the user asks for an audit trail, search methodology documentation, due-diligence records, or AI-usage disclosure for patent-office or law-firm requirements.
user-invocable: true
---

# Audit Report Generation

Create a comprehensive audit trail of all patent research activities for governance and compliance.

## Why Audit Trails Matter
- Patent offices (USPTO, EPO) increasingly require disclosure of AI tool usage
- Law firms need documented search methodologies for due diligence
- Reduces hallucination risk — forces verification of every data point
- AIPPI recommends comprehensive audit trails for all AI-assisted patent work

## When to Generate
After ANY prior art search, FTO analysis, landscape analysis, or research that may be relied upon for legal decisions.

## Audit Report Structure

### Section 1: Research Summary
Date, objective, requested-by context, "AI Tool Used: Patent AI Agent (FlowLeap)", and the list of databases searched.

### Section 2: Search Log (MOST CRITICAL)
Document EVERY search executed:

| # | Database | Tool + Query/Parameters | Results Count | Date Executed |
|---|----------|------------------------|---------------|---------------|
| 1 | EPO OPS | search_patents: pa=Samsung and ic=H01M and pd>=2023 | 47 | [date] |
| 2 | USPTO ODP | build_uspto_query → patent_api_request (Samsung, H01M, 2023-) | 89 | [date] |
| 3 | Google Patents (CN) | web_search: site:patents.google.com/patent/CN "Samsung" "battery" | ~120 | [date] |
| 4 | Academic | search_academic: "solid state battery electrolyte" | 34 | [date] |

### Section 3: Sources Cited
For every patent/reference cited in the analysis:

| Reference | Source Database | How Retrieved | Verified |
|-----------|---------------|---------------|----------|
| EP3875305 B1 | EPO OPS search #1 | search_patents → get_patent_details | ✅ Claims retrieved |
| US11,234,567 | USPTO search #2 | build_uspto_query → patent_api_request | ✅ Abstract confirmed |
| CN115432109A | Google Patents #3 | web_search | ⚠️ Machine-translated |

### Section 4: Limitations (what was NOT retrieved)
Be explicit, e.g.:
- CN/JP/KR patents: machine-translated only, not verified by a human translator
- Web-based sources: `web_search` was not available on this model — Google Patents/PATENTSCOPE sweeps not run, CN/JP/KR covered via patent-family expansion only
- Legal status: checked for EP/US only
- Claims: full text retrieved for top 5 EP patents only
- Time period searched

### Section 5: AI Disclosure
```markdown
This research was conducted using Patent AI Agent (FlowLeap), an AI-assisted
patent search tool. AI capabilities used: [list the tools actually used, e.g.
natural-language query conversion (build_patent_query/build_uspto_query),
patent search execution (EPO OPS, USPTO ODP), claim retrieval and analysis].

All patent numbers, dates, and claim text cited in this report were retrieved
from the respective patent databases. No patent data was generated or inferred
by the AI system.
```

## How to Build It

During research: before each tool call note what you're searching; after each result note the count; when citing a reference note which search returned it. At the end, compile into the format above.

Save via `write_patent_results` as a separate file alongside the main research report, named `[topic]-audit-trail-[date].md`.

## Rules
- NEVER skip the audit report when doing substantive research
- Every citation must trace back to a specific search in the log
- Be honest about limitations — what you didn't search is as important as what you did
- Include the AI disclosure section in every audit report
