---
name: freedom-to-operate
description: Freedom-to-operate (FTO) analysis — find active blocking patents for a product or technology in target markets, map claims against product features, and verify legal status. Use when the user asks about FTO, infringement risk, blocking patents, or "can I sell/launch/build X without infringing". Always includes the not-legal-advice disclaimer. For the reverse — asserting YOUR patent against a product — use infringement-charting; for general novelty searching use prior-art.
user-invocable: true
---

# Freedom-to-Operate Analysis

Determine whether a product or technology infringes active patents in target markets.

## IMPORTANT DISCLAIMER
Always include: "This FTO analysis is for informational purposes only and does not constitute legal advice. Consult a registered patent attorney for formal FTO opinions."

## Phase 1: Product/Technology Decomposition

Ask the user (via the `vscode_askQuestions` tool):
1. **What is the product/technology?** — detailed technical description
2. **Target markets?** — US, EU, China, Japan, Korea, etc.
3. **Commercial timeline?** — when will it be sold/used?

Break the product down into individual technical features (Feature A, B, C...).

## Phase 2: Patent Search (Blocking Patents)

For EACH feature, search for active patents:

1. **EPO OPS**: `build_patent_query` → `search_patents` for EP/WO
   - Focus on GRANTED patents (kind codes B1/B2)
   - Verify EP grant status: `ops_api_guide` action="endpoint" endpoint="register-biblio" → `patent_api_request`
   - Legal status: `ops_api_guide` endpoint="legal" → `patent_api_request`
2. **USPTO**: `build_uspto_query` → `patent_api_request` (POST) for US granted patents
3. **Target-market coverage**: patent families via `ops_api_guide` endpoint="family" → `patent_api_request`

### Key Filters
- Only ACTIVE patents matter (not expired, lapsed, or abandoned)
- Only patents in TARGET MARKETS matter
- Only patents with claims covering YOUR features matter

### Pending applications — future risk, not a skip
Granted claims decide today's risk, but PENDING applications (kind codes A1/A2) and open continuations in the same families are tomorrow's: claims can still be amended to cover the product before launch, and US published applications carry provisional rights (35 U.S.C. 154(d)) back to publication if substantially identical claims grant. Flag high-relevance pending applications and open continuity chains in a separate "monitor" list with their projected grant timelines — do not silently drop them.

## Phase 3: Claim Mapping

Retrieve claims with `get_patent_details` (EP/WO). For each potentially blocking patent:

| Patent | Status | Claim 1 Element A | Element B | Element C | Risk |
|--------|--------|-------------------|-----------|-----------|------|
| EP123 | Active (expires 2035) | ✅ Product matches | ✅ Matches | ❌ Differs | MEDIUM |
| US11,xxx | Active (expires 2040) | ✅ Matches | ✅ Matches | ✅ Matches | HIGH |

### Risk Levels
- **HIGH**: all elements of an independent claim are present in the product
- **MEDIUM**: most elements match, one may be arguable
- **LOW**: significant differences in key elements
- **NONE**: clear non-infringement

**Doctrine of equivalents caveat**: escaping LITERAL infringement is not the end — an element performing substantially the same function, in substantially the same way, for substantially the same result can still infringe under the doctrine of equivalents. When a rating rests on ONE differing element, say whether the difference is substantive or merely verbal, and keep the patent at MEDIUM rather than LOW/NONE if it is arguably equivalent.

## Phase 4: Legal Status Verification

For each HIGH/MEDIUM risk patent:
1. **Multi-market status in one call**: `ops_api_guide` endpoint="family-legal" → `patent_api_request` — legal events for ALL family members, shows which jurisdictions are active/lapsed
2. Check the expiration date (20 years from filing + any extensions)
3. Check if the patent was narrowed during prosecution
4. Check for ongoing oppositions or IPR proceedings
5. **EU Unitary Patent**: `ops_api_guide` endpoint="register-upp" → `patent_api_request` — if the patent has Unitary Patent Protection it covers all participating EU member states

## Phase 5: Design-Around Options

For HIGH risk patents, suggest:
- Which claim elements could be designed around
- Alternative technical approaches
- Whether dependent claims narrow the risk

## Output: FTO Report

Save via `write_patent_results`:
1. **Product Description**: feature decomposition
2. **Target Markets**: jurisdictions analyzed
3. **Blocking Patent Analysis**: table with risk ratings
4. **High-Risk Patents**: detailed claim mapping for each
5. **Legal Status**: active/expired/opposed for key patents
6. **Design-Around Suggestions**: alternatives for high-risk areas
7. **Disclaimer**: not legal advice
8. **Audit Trail**: all searches performed (see the audit-report skill)
