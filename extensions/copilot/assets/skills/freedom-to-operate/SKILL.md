---
name: freedom-to-operate
description: Freedom-to-operate (FTO) analysis — find active blocking patents for a product or technology in target markets, map claims against product features, and verify legal status. Use when the user asks about FTO, infringement risk, blocking patents, or "can I sell/launch/build X without infringing". Always includes the not-legal-advice disclaimer. For the reverse — asserting YOUR patent against a product — use infringement-charting; for general novelty searching use prior-art; to attack a specific blocking patent's validity use invalidity-analysis.
user-invocable: true
---

# Freedom-to-Operate Analysis

Determine whether a product or technology infringes active patents in target markets.

## IMPORTANT DISCLAIMER
Close every deliverable with: "AI-assisted analysis for review by a registered patent attorney — not legal advice."

## Phase 1: Product/Technology Decomposition

Ask the user (via the `vscode_askQuestions` tool):
1. **What is the product/technology?** — detailed technical description
2. **Target markets?** — US, EU, China, Japan, Korea, etc.
3. **Commercial timeline?** — when will it be sold/used?

Break the product down into individual technical features (Feature A, B, C...).

## Phase 2: Patent Search (Blocking Patents)

For EACH feature, search for active patents:

1. **EPO OPS**: write the CQL (see `patent-search`) → `search_patents` for EP/WO
   - Focus on GRANTED patents (kind codes B1/B2)
   - Legal status (grant, lapse, expiry, opposition — is it still in force?): `get_legal_status` (publicationNumber)
   - EP register events (oppositions, transfers of rights, amendments): `get_register_events` (publicationNumber)
2. **USPTO**: write the ODP Lucene query (see `patent-search`) → `patent_api_request` (POST) for US granted patents
3. **Target-market coverage**: patent family across jurisdictions via `get_patent_family` (publicationNumber) — the INPADOC members show where the patent is (or is not) filed

### Key Filters
- Only ACTIVE patents matter (not expired, lapsed, or abandoned)
- Only patents in TARGET MARKETS matter
- Only patents with claims covering YOUR features matter

### Pending applications — future risk, not a skip
Granted claims decide today's risk, but PENDING applications (kind codes A1/A2) and open continuations in the same families are tomorrow's: claims can still be amended to cover the product before launch, and US published applications carry provisional rights (35 U.S.C. 154(d)) back to publication if substantially identical claims grant. Flag high-relevance pending applications and open continuity chains in a separate "monitor" list with their projected grant timelines — do not silently drop them.

### When a search fails

Before concluding a feature is clear or reporting a coverage gap, work the ladder in order:
1. **Clean zero result** (call succeeded, no hits): reformulate before concluding no blocking patent exists — swap synonyms, broaden or narrow the CPC/IPC, drop a filter, try a different number format — then try the alternate office/route (`search_patents` ↔ `patent_api_request`, `get_patent_summary` when `get_patent_details` is empty). A clean zero is NOT a freedom-to-operate finding until the feature has been searched both ways.
2. **Search error** (5xx, gateway timeout, connection reset, truncated response): transient outage, not a coverage limit — back off and retry the same call, then switch office. NEVER report "no blocking patents" from an errored call.
3. **Route exhausted** (both offices genuinely dry): fall back to the web — `fetch_webpage` is always available (even when `web_search` is not) against `patents.google.com/patent/NUMBER` or `freepatentsonline.com`; quote only text the page returned and spot-check the number and title.

Disclose a gap only after all three, and name what you tried.

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
1. **Which jurisdictions are active/lapsed**: `get_patent_family` (publicationNumber) to enumerate the INPADOC members, then `get_legal_status` on each member for its grant/lapse/expiry status. For whole-family legal status in one call, raw `ops_api_guide` endpoint="family-legal" → `patent_api_request` remains the advanced path
2. Check the expiration date with `get_patent_term` (publicationNumber) — the base 20-years-from-filing estimate plus the adjustment caveats (PTA/PTE, terminal disclaimers); treat it as an estimate, not the enforceable date
3. Check if the patent was narrowed during prosecution
4. Check for ongoing oppositions or IPR proceedings — `get_register_events` (publicationNumber) surfaces EP opposition and transfer events
5. **EU Unitary Patent**: if the patent has Unitary Patent Protection it covers all participating EU member states; the raw `ops_api_guide` endpoint="register-upp" → `patent_api_request` reports UPP status (no typed tool for this niche endpoint yet)

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
