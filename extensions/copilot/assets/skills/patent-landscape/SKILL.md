---
name: patent-landscape
description: Technology landscape and trend analysis across patent portfolios — filing volumes, top assignees, geographic distribution, year-over-year trends, white spaces. Use when the user asks who files in a technology domain, about patent trends, competitive or market IP intelligence, or white-space opportunities. For a single company's holdings use portfolio-analysis; for finding individual patents use patent-search; for prior art against an invention use prior-art.
user-invocable: true
---

# Patent Landscape Analysis

Map the patent landscape for a technology domain — who files, where, when, and what trends emerge.

## Phase 1: Define Scope

Ask (via the `vscode_askQuestions` tool):
1. **Technology domain** (e.g., "solid-state batteries", "federated learning")
2. **Time period** (e.g., "last 5 years", "2020-2025")
3. **Focus**: top filers, technology trends, geographic distribution, or all

Map the technology to 2-3 IPC/CPC codes for coverage (see the prior-art skill's `references/cpc-classification.md`).

## Phase 2: Data Collection

### 2a. Analytics in One Call (PREFERRED)
`patent_analytics_viz` is the priority tool for topic-centric landscape questions: one call over the full backend corpus returns the filing trend by publication year, top assignees, country breakdown, and top CPC sections as ready-made tables. Run it once per sub-topic to compare clusters.

### 2b. Per-Company Slices (PATSTAT)
Once the top filers emerge, `patstat_portfolio` per named company → worldwide application counts by filing year and office under harmonized applicant names. Quote each `summary` and name the PATSTAT edition (the response's data_edition field) in the report. **Counting semantics**: `patstat_portfolio` counts APPLICATIONS by FILING year; `patent_analytics_viz` counts PUBLICATIONS by publication year — the numbers legitimately differ, so never mix the two bases in one table and label each figure's basis.

### 2c. Targeted Counts (EPO OPS)
Where you need precise per-slice counts beyond the analytics sample:
- `build_patent_query` → `search_patents`, note the total count per query
- Top applicants: `pa=Samsung and ic=H01M and pd>=2020` → count; repeat for 8-10 expected filers
- Year-over-year: `ic=G06N and pd>=2020 and pd<=2020` → 2020 count; repeat per year

### 2d. US Data (USPTO)
- `build_uspto_query` (ODP Lucene) → `patent_api_request` (POST)
- Vary by CPC code + date range for volume, by assignee for top-filer analysis
- Bulk detail retrieval: `ops_api_guide` action="endpoint" endpoint="biblio-bulk" → `patent_api_request` (OPS carries US publications too)

## When a search fails

Landscape counts lean on live search — before reporting a count as zero or a coverage limit, work the ladder in order:
1. **Clean zero result** (call succeeded, no hits): reformulate before concluding — broaden or narrow the CPC/IPC, drop a filter, widen the date slice, try a different assignee spelling — then try the alternate office/route (`patent_analytics_viz` ↔ `patstat_portfolio` ↔ `search_patents` ↔ `patent_api_request`). A `patstat_portfolio` not-found/ambiguous error carries its own next step (spelling suggestion or candidate entities) — follow it before switching routes.
2. **Search error** (5xx, gateway timeout, connection reset, truncated response): transient outage, not a real count — back off and retry the same call, then switch office. NEVER report a "0" or a coverage limit from an errored call; a failed slice is a hole in the data, not a finding, so mark it as retry-pending rather than reporting it as trend.
3. **Route exhausted** (both offices genuinely dry): fall back to the web — `fetch_webpage` is always available (even when `web_search` is not) against `patents.google.com/patent/NUMBER` or `freepatentsonline.com`; quote only text the page returned and spot-check the number and title.

Report a slice as low-activity or white space only after all three, and note in the methodology what failed.

## Phase 3: Analysis

### Filing Trends
- Growing, stable, or declining? Any inflection points? (sudden increase = breakthrough or regulation change)

### Top Filers Ranking
| Rank | Company | EP/WO Count | US Count | Total | Trend |
|------|---------|-------------|----------|-------|-------|
| 1 | Samsung | 245 | 312 | 557 | ↑ Growing |
| 2 | Toyota | 198 | 267 | 465 | → Stable |

### Technology Sub-Clusters
Group patents by sub-IPC codes to identify hot areas within the domain.

### Geographic Distribution
Which filing offices are most active? (EP, US, CN, JP, KR)

## Phase 4: Report

Save via `write_patent_results` (`template: 'landscape-report'`):
1. **Executive Summary**: key findings in 3-5 bullets
2. **Methodology**: IPC codes used, date range, databases searched, each figure's counting basis (PATSTAT applications-by-filing-year vs publication-level counts vs live-search hits), and the PATSTAT edition for any patstat figures
3. **Filing Volume & Trends**: year-over-year data
4. **Top Filers**: ranked table with counts
5. **Technology Sub-Clusters**: breakdown by sub-topics
6. **Key Patents**: the 5-10 most cited/important patents found (`search_forward_citations` on the publication number for who-cites-this-forward counts; for the references cited AGAINST a patent that's `search_citations` on its US **application** number, resolved via `get_patent_family` → `get_continuity`)
7. **White Spaces**: areas with low filing activity (potential opportunities)
8. **Data Tables**: raw data for all searches performed

## Visual deliverable

If the user wants a shareable dashboard rather than (or in addition to) the
markdown report, save one with `write_patent_results` — omit `template` and
give a `filePath` ending in `.html` so the content is written verbatim instead
of wrapped in the markdown report structure. This surface has no CLI or
Node-script execution, so the model authors the HTML directly; the contract is
the same as any other deliverable on this skill:

1. **Numbers only from tool results.** Every figure in the page — chart,
   table, or narrative sentence — must trace back to a `patent_analytics_viz`,
   `patstat_portfolio`, `search_patents`, or `patent_api_request` call already
   made in this conversation. Never invent or round a number while writing the
   HTML.
2. **Self-contained, no external requests.** Inline all CSS and chart markup
   directly in the file. No `<script src=...>` or `<link>` to a CDN, no
   external fonts or images — inline SVG (bars/lines built from the `<svg>`
   element with `<rect>`/`<path>`) for the filing-trend and top-filer charts.
3. **Provenance footer.** End the page with the queries/tool calls run, the
   date, and the same counting-basis caveats used in Phase 4's Methodology
   section (applications-by-filing-year vs publication-level counts, plus the
   PATSTAT edition), so the dashboard is auditable on its own without the chat
   transcript.
