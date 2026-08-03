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

- **Headline counts (PREFERRED)**: `patstat_portfolio` per entity (the company AND each subsidiary) → worldwide totals, filings per year, office coverage, and grant counts in one call each, under harmonized (PSN) applicant names. Quote the returned `summary` and name the PATSTAT edition (the response's data_edition field) next to every figure. If the name is ambiguous the error lists the candidate entities — relay them and retry with the specific entity; never merge distinct entities yourself
- Technology-mix breakdown: `search_patents` with `pa="[name]"` plus `ic=` filters per CPC class; `patent_analytics_viz` (assignee + keywords) for topic slices within the portfolio
- US sweep: `build_uspto_query` (assignee-focused) → `patent_api_request` (POST)
- Distinguish **granted vs pending** (kind codes A1/A2 vs B1/B2) — pending applications signal direction; granted patents are the enforceable estate
- **Counting semantics**: `patstat_portfolio` counts APPLICATIONS by FILING year (worldwide, deduplicated harmonized applicants); `patent_analytics_viz` counts PUBLICATIONS by publication year; live searches count result hits. The bases legitimately differ — never mix them in one table, and state which basis each figure uses
- **Aggregates the portfolio shape doesn't cover** (grant rate by office, citation-impact ranking of the portfolio, inventor concentration, family/jurisdiction depth): `patstat_query` — one SELECT against the flowleap.* views. Fetch `patstat_api_guide` section="examples" then section="semantic-model" first; apply its interpretation conventions and cite the data_edition. Fix a `patstat_sql_*` rejection once per its message (resubmit with retryOf), then stop

## Phase 3: Crown Jewels

Identify the patents that carry the portfolio's weight:
1. Rank candidates by forward-citation count: `search_forward_citations` on the most-cited/oldest core patents — high forward citations = foundational
2. For the top 5-10: `get_patent_details` → claim breadth (broad, clean independent claims = enforceable value)
3. Family breadth: `get_patent_family` per crown-jewel publication number → the INPADOC members across jurisdictions; wide international families show where the company spent money, a strong self-assessment of value (raw `ops_api_guide` endpoint="family-biblio" → `patent_api_request` remains the advanced path for full member biblio). For US crown jewels, also run `get_continuity` on the application to map the divisional/continuation chain (a deep US continuity family is itself a value signal)
4. In-force / legal history check: `get_prosecution_timeline` per crown-jewel publication number → its grant, opposition, renewal/maintenance and lapse chronology; for a member's per-jurisdiction status use `get_legal_status`. Use raw `ops_api_guide` endpoint="family-legal" → `patent_api_request` only for whole-family legal status across every member at once

## Phase 4: Risk & Signal Analysis

- **Expiration timeline**: filing date + 20 years per key patent — how much term is left on the crown jewels? A portfolio whose best assets expire in 3 years is worth far less than its count suggests
- **Lapses**: family members abandoned in major markets = deliberate cost-cutting; recent widespread lapses = distress signal
- **Filing velocity**: rising/falling applications per year = R&D investment direction (from the Phase 2 trend data)
- **Disputes**: opposition, transfer and lapse events via `get_register_events` on the crown jewels (EP Register; oppositions, assignments, procedural history)
- **Concentration risk**: does value sit in 2-3 patents (fragile) or spread across a thicket (robust)?

## Phase 5: Report

Save via `write_patent_results` (`template: 'portfolio-due-diligence-memo'`):
1. **Executive summary** — portfolio size, trajectory, and the 3 findings that matter
2. **Portfolio map** — counts by subsidiary, technology (CPC), jurisdiction, granted/pending; state each figure's counting basis (PATSTAT applications-by-filing-year vs publication-level vs live-search hits) and the PATSTAT edition
3. **Crown jewels table** — top 5-10: claim-breadth note, forward citations, family breadth, in-force status, expiry
4. **Timeline chart data** — filings per year, expirations per year
5. **Red flags** — lapses, expiring core assets, disputes, concentration
6. **Scope limits** — subsidiaries searched, jurisdictions covered, and that this reports objective signals, NOT a monetary valuation
7. **Audit trail** (audit-report skill — mandatory for diligence work)

## Rules
- Enumerate subsidiaries BEFORE searching, and list which were searched
- Headline portfolio counts come from `patstat_portfolio` — always name the PATSTAT edition with them, and never mix counting bases (applications-by-filing-year vs publications) in one table
- PATSTAT data is a twice-yearly snapshot: for any individual patent's CURRENT legal status use `get_legal_status`/`get_prosecution_timeline`, never snapshot grant counts
- Objective signals only: citations, families, legal status, term. No monetary valuations
- For diligence purposes always include the audit trail
