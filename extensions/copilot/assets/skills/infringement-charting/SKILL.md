---
name: infringement-charting
description: Evidence-of-use (EoU) claim charting — map a patent's claims element-by-element onto an accused product or service to assess infringement, with cited evidence per element. Use when the user owns or asserts a patent and asks whether a specific product infringes it, wants an EoU or infringement claim chart, or is preparing licensing or enforcement. For the reverse question — clearing your OWN product against many patents — use freedom-to-operate; for attacking the patent's validity use invalidity-analysis.
user-invocable: true
---

# Infringement Charting (Evidence of Use)

One patent, one accused product, element-by-element. FTO in reverse: there, the product is yours and the patents are the threat; here, the patent is yours and the product is the target.

## IMPORTANT DISCLAIMER
Always include: "This claim chart is for informational purposes only and does not constitute legal advice or an infringement opinion. Consult a registered patent attorney before any enforcement or licensing action."

## Phase 1: The Patent

1. `get_patent_details` with the publication number → claims and description
2. **In-force check first**: `ops_api_guide` endpoint="family-legal" → `patent_api_request`, plus expiry (filing + 20 years). An expired or lapsed patent ends the analysis — say so and stop.
3. Pick the **assertion claims**: the broadest independent claims. Chart independents first; dependents only where the independent charts cleanly.
4. **Construction notes** before mapping:
   - Prosecution history (`ops_api_guide` endpoint="register-events" → `patent_api_request`; `search_citations` for US): arguments and amendments made to win allowance NARROW how elements can be read now — note each constraint
   - Means-plus-function elements: identify the corresponding structure in the spec; the accused product must have that structure or an equivalent
   - Pull `get_patent_figures` where claim terms are structural

## Phase 2: The Product Evidence

Gather evidence for each claim element — the chart is only as strong as its citations:
- From the user: teardowns, internal analysis, product samples
- `web_search`: datasheets, user manuals, developer docs, marketing pages, FCC filings, standards-compliance declarations ("supports 802.11ax" can evidence every element a standard mandates)
- `read_pdf` for datasheets and manuals
- Log every source with URL/document + date. Distinguish **public evidence** from **inference** — never present inference as evidence.

## Phase 3: The Chart

Element-by-element per asserted claim (the all-elements rule: EVERY element must be present):

| Claim 1 Element | Accused Product | Evidence | Status |
|-----------------|-----------------|----------|--------|
| "a housing enclosing..." | Model X enclosure | Teardown p.4, photo | ✅ shown |
| "a processor configured to..." | Runs firmware v2 doing [function] | User manual §3.2 | ⚠️ inferred |
| "wirelessly transmitting..." | Wi-Fi 6 radio | FCC filing 2ABCD-123 | ✅ shown |

- ✅ = public evidence directly shows the element
- ⚠️ = likely present but inferred (needs discovery/teardown to confirm) — for these, also note the **doctrine-of-equivalents** angle (same function, same way, same result), flagging any prosecution-history estoppel from Phase 1.4 that blocks it
- ❌ = absent or no evidence — one ❌ on an element defeats literal infringement of that claim

## Phase 4: Assessment

- **Per claim**: literal infringement (all ✅), probable (✅/⚠️ mix), or not chartable (any ❌)
- **Best claims**: which chart cleanest — these lead a licensing discussion
- **Missing evidence list**: exactly what a teardown or discovery would need to confirm (the ⚠️ rows)
- **Design-around exposure**: which element the accused party could most easily remove

## Output

Save via `write_patent_results`: patent status summary and construction notes, the chart per asserted claim with evidence citations, the assessment, missing-evidence list, and the disclaimer. For diligence-grade work, add the audit-report skill's trail.

## Rules
- Verify the patent is in force BEFORE charting
- Every ✅ needs a citable source; inference is always marked ⚠️ — never upgraded silently
- Apply prosecution-history constraints when reading elements — the broadest reading is not automatically available
- One missing element = no literal infringement of that claim; report it plainly
