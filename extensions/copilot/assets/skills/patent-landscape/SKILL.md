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
`patent_analytics_viz` is the priority tool for landscape questions: it builds the query, searches EPO OPS live, and returns the exact total match count plus yearly trend, geographic distribution, and top assignees (aggregated over the 100 most relevant matches — note the sample basis in the report). Run it once per sub-topic to compare clusters.

### 2b. Targeted Counts (EPO OPS)
Where you need precise per-slice counts beyond the analytics sample:
- `build_patent_query` → `search_patents`, note the total count per query
- Top applicants: `pa=Samsung and ic=H01M and pd>=2020` → count; repeat for 8-10 expected filers
- Year-over-year: `ic=G06N and pd>=2020 and pd<=2020` → 2020 count; repeat per year

### 2c. US Data (USPTO)
- `build_uspto_query` (ODP Lucene) → `patent_api_request` (POST)
- Vary by CPC code + date range for volume, by assignee for top-filer analysis
- Bulk detail retrieval: `ops_api_guide` action="endpoint" endpoint="biblio-bulk" → `patent_api_request` (OPS carries US publications too)

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
2. **Methodology**: IPC codes used, date range, databases searched, whether figures are exact counts or the 100-result analytics sample
3. **Filing Volume & Trends**: year-over-year data
4. **Top Filers**: ranked table with counts
5. **Technology Sub-Clusters**: breakdown by sub-topics
6. **Key Patents**: the 5-10 most cited/important patents found (`search_forward_citations` for citation counts)
7. **White Spaces**: areas with low filing activity (potential opportunities)
8. **Data Tables**: raw data for all searches performed
