---
name: audit-report
description: Generate traceable audit trail documenting all searches, sources, and AI decisions
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
- After ANY prior art search
- After FTO analysis
- After landscape analysis
- After any research that may be relied upon for legal decisions

## Audit Report Structure

### Section 1: Research Summary
```markdown
## Research Summary
- **Date**: [date of research]
- **Objective**: [what was being researched and why]
- **Requested by**: [user/client context if provided]
- **AI Tool Used**: Patent AI Agent (FlowLeap)
- **Databases Searched**: [list all databases]
```

### Section 2: Search Log (MOST CRITICAL)
Document EVERY search executed:

```markdown
## Search Log

| # | Database | Query/Parameters | Results Count | Date Executed |
|---|----------|-----------------|---------------|---------------|
| 1 | EPO OPS | pa=Samsung and ic=H01M and pd>=2023 | 47 | 2025-02-23 |
| 2 | USPTO | assignee=Samsung, cpcCode=H01M, dateRange.from=2023 | 89 | 2025-02-23 |
| 3 | Google Patents (CN) | site:patents.google.com/patent/CN "Samsung" "battery" | ~120 | 2025-02-23 |
| 4 | Semantic Scholar | "solid state battery electrolyte" | 34 | 2025-02-23 |
```

### Section 3: Sources Cited
For every patent/reference cited in the analysis:

```markdown
## Sources Cited

| Reference | Source Database | How Retrieved | Verified |
|-----------|---------------|---------------|----------|
| EP3875305 B1 | EPO OPS search #1 | search_patents → biblio curl | ✅ Claims retrieved |
| US11,234,567 | USPTO search #2 | /v1/patent-search-uspto | ✅ Abstract confirmed |
| CN115432109A | Google Patents #3 | web_search | ⚠️ Machine-translated |
```

### Section 4: Data NOT Retrieved
Document what you could NOT verify:

```markdown
## Limitations
- CN/JP/KR patents: machine-translated only, not verified by human translator
- Legal status: checked for EP/US only, not verified for CN/JP/KR
- Claims: full text retrieved for top 5 EP patents only
- Time period: searched 2020-2025 only
```

### Section 5: AI Disclosure
```markdown
## AI Tool Disclosure
This research was conducted using Patent AI Agent (FlowLeap), an AI-assisted
patent search tool. The following AI capabilities were used:
- Natural language to CQL query conversion (build_patent_query)
- Patent search execution (EPO OPS, USPTO PatentsView)
- Claim text retrieval and analysis
- [list other tools used]

All patent numbers, dates, and claim text cited in this report were retrieved
from the respective patent databases. No patent data was generated or inferred
by the AI system.
```

## How to Build the Audit Report

During research, track everything in a structured way:
1. Before each tool call, note what you're about to search
2. After each result, note the count and key findings
3. When citing any reference, note which search returned it
4. At the end, compile into the audit report format above

CREATE the audit report as a separate markdown file alongside the main research report.
Name it: `[topic]-audit-trail-[date].md`

## Rules
- NEVER skip the audit report when doing substantive research
- Every citation must trace back to a specific search in the log
- Be honest about limitations — what you didn't search is as important as what you did
- Include the AI disclosure section in every audit report
