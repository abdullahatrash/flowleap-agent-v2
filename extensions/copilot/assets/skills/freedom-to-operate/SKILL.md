---
name: freedom-to-operate
description: Freedom-to-operate (FTO) analysis - identify blocking patents for a product/technology
user-invocable: true
---

# Freedom-to-Operate Analysis

Determine whether a product or technology infringes active patents in target markets.

## IMPORTANT DISCLAIMER
Always include: "This FTO analysis is for informational purposes only and does not constitute legal advice. Consult a registered patent attorney for formal FTO opinions."

## Phase 1: Product/Technology Decomposition

Ask the user (via `askQuestions`):
1. **What is the product/technology?** — detailed technical description
2. **Target markets?** — US, EU, China, Japan, Korea, etc.
3. **Commercial timeline?** — when will it be sold/used?

Break down the product into individual technical features:
- Feature A: [description]
- Feature B: [description]
- Feature C: [description]

## Phase 2: Patent Search (Blocking Patents)

For EACH feature, search for active patents:

### Active Patent Search
1. **EPO OPS**: `build_patent_query` → `search_patents` for EP/WO
   - Focus on GRANTED patents (filter by kind code B1/B2)
   - Verify EP grant status: `ops_api_guide` action="endpoint" endpoint="register-biblio" → curl to check prosecution status directly
   - Check legal status via `ops_api_guide` → curl `/v1/ops/legal?doc=EP...`
2. **USPTO**: `uspto_api_guide` → curl for US granted patents
3. **Target market patents**: Check patent families via `ops_api_guide` → curl `/v1/ops/family?doc=...`

### Key Filters
- Only ACTIVE patents matter (not expired, lapsed, or abandoned)
- Only patents in TARGET MARKETS matter
- Only patents with claims covering YOUR features matter

## Phase 3: Claim Mapping

For each potentially blocking patent:

| Patent | Status | Claim 1 Element A | Claim 1 Element B | Claim 1 Element C | Infringement Risk |
|--------|--------|-------------------|-------------------|-------------------|-------------------|
| EP123 | Active (expires 2035) | ✅ Product matches | ✅ Product matches | ❌ Product differs | MEDIUM |
| US11,xxx | Active (expires 2040) | ✅ Product matches | ✅ Product matches | ✅ Product matches | HIGH |

### Risk Levels
- **HIGH**: All elements of an independent claim are present in the product
- **MEDIUM**: Most elements match, one may be arguable
- **LOW**: Significant differences in key elements
- **NONE**: Clear non-infringement

## Phase 4: Legal Status Verification

For each HIGH/MEDIUM risk patent:
1. **Multi-market status in one call**: `ops_api_guide` action="endpoint" endpoint="family-legal" → curl `/v1/ops/family/legal?doc=EP...`
   - Returns legal events for ALL family members — shows which jurisdictions are active/lapsed
2. Check expiration date (20 years from filing + any extensions)
3. Check if patent was narrowed during prosecution
4. Check for ongoing oppositions or IPR proceedings
5. **EU Unitary Patent**: `ops_api_guide` action="endpoint" endpoint="register-upp" → curl `/v1/ops/register/upp?doc=EP...`
   - If patent has Unitary Patent Protection, it covers all EU member states (post-June 2023 grants)

## Phase 5: Design-Around Options

For HIGH risk patents, suggest:
- Which claim elements could be designed around
- Alternative technical approaches
- Whether dependent claims narrow the risk

## Output: FTO Report

CREATE markdown file with:
1. **Product Description**: features decomposition
2. **Target Markets**: jurisdictions analyzed
3. **Blocking Patent Analysis**: table with risk ratings
4. **High-Risk Patents**: detailed claim mapping for each
5. **Legal Status**: active/expired/opposed for key patents
6. **Design-Around Suggestions**: alternatives for high-risk areas
7. **Disclaimer**: not legal advice
8. **Audit Trail**: all searches performed
