---
name: portfolio-analysis
description: Company-centric patent portfolio analysis — size, technology mix, geographic coverage, legal status, expiration timeline, and crown-jewel identification via citation impact. Use when the user asks to analyze a company's patents, IP due diligence for M&A or investment, a competitor's IP position, or "what does company X hold". For technology-centric trends across all filers use patent-landscape; for challenging a specific patent found here use invalidity-analysis.
user-invocable: true
---

# Patent Portfolio Analysis

Map what a company actually holds, what it's worth strategically, and where the red flags are.

## Phase 1: Scope

Ask (via the `vscode_askQuestions` tool):
1. **Company** — and enumerate subsidiaries/acquisitions before searching (Google → also Alphabet, DeepMind, Waymo; check `web_search "[company] subsidiaries patents"`, or if `web_search` is not available on this model, ask the user for the subsidiary list and state which entities the counts cover). Missing subsidiaries is the #1 way portfolio counts come out wrong.
2. **Purpose** — M&A diligence, competitive intel, licensing scan? (drives depth)
3. **Technology focus** — whole portfolio or one domain?
4. **Time window** — default: last 20 years (the maximum enforceable term)

## Phase 2: Portfolio Map

- `patent_analytics_viz` per company name → total count, yearly trend, geographic distribution, top co-assignees in one call (note: aggregates over the 100 most relevant matches — report the sample basis)
- Per-subsidiary counts: `search_patents` with `pa="[name]"` queries; add `ic=` filters for the technology-mix breakdown by CPC class
- US sweep: `build_uspto_query` (assignee-focused) → `patent_api_request` (POST)
- Distinguish **granted vs pending** (kind codes A1/A2 vs B1/B2) — pending applications signal direction; granted patents are the enforceable estate

## Phase 3: Crown Jewels

Identify the patents that carry the portfolio's weight:
1. Rank candidates by forward-citation count: `search_forward_citations` on the most-cited/oldest core patents — high forward citations = foundational
2. For the top 5-10: `get_patent_details` → claim breadth (broad, clean independent claims = enforceable value)
3. Family breadth: `ops_api_guide` endpoint="family-biblio" → `patent_api_request` — wide international families show where the company spent money, which is a strong self-assessment of value
4. In-force check: `ops_api_guide` endpoint="family-legal" → `patent_api_request` — which family members are alive, where

## Phase 4: Risk & Signal Analysis

- **Expiration timeline**: filing date + 20 years per key patent — how much term is left on the crown jewels? A portfolio whose best assets expire in 3 years is worth far less than its count suggests
- **Lapses**: family members abandoned in major markets = deliberate cost-cutting; recent widespread lapses = distress signal
- **Filing velocity**: rising/falling applications per year = R&D investment direction (from the Phase 2 trend data)
- **Disputes**: opposition or litigation events in `register-events` on the crown jewels
- **Concentration risk**: does value sit in 2-3 patents (fragile) or spread across a thicket (robust)?

## Phase 5: Report

Save via `write_patent_results` (`template: 'portfolio-due-diligence-memo'`):
1. **Executive summary** — portfolio size, trajectory, and the 3 findings that matter
2. **Portfolio map** — counts by subsidiary, technology (CPC), jurisdiction, granted/pending; state which figures are exact counts vs the analytics sample
3. **Crown jewels table** — top 5-10: claim-breadth note, forward citations, family breadth, in-force status, expiry
4. **Timeline chart data** — filings per year, expirations per year
5. **Red flags** — lapses, expiring core assets, disputes, concentration
6. **Scope limits** — subsidiaries searched, jurisdictions covered, and that this reports objective signals, NOT a monetary valuation
7. **Audit trail** (audit-report skill — mandatory for diligence work)

## Rules
- Enumerate subsidiaries BEFORE searching, and list which were searched
- Never present the 100-match analytics sample as an exact portfolio count — run count queries for the headline numbers
- Objective signals only: citations, families, legal status, term. No monetary valuations
- For diligence purposes always include the audit trail
