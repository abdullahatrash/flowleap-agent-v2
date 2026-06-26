---
name: patent-landscape
description: Technology landscape and trend analysis across patent portfolios
user-invocable: true
---

# Patent Landscape Analysis

Map the patent landscape for a technology domain — who files, where, when, and what trends emerge.

## Phase 1: Define Scope

Ask via `askQuestions`:
1. **Technology domain** (e.g., "solid-state batteries", "federated learning")
2. **Time period** (e.g., "last 5 years", "2020-2025")
3. **Focus**: top filers, technology trends, geographic distribution, or all

Map technology to IPC/CPC codes (use 2-3 codes for coverage).

## Phase 2: Data Collection

### 2a. Volume Analysis (EPO OPS)
Run multiple searches to gauge landscape size:
1. `build_patent_query` → broad query (just IPC code + year range)
2. `search_patents` → note total count
3. Refine with sub-topics to see distribution

### 2b. Top Applicants (EPO OPS)
Search by major expected filers:
- `pa=Samsung and ic=H01M and pd>=2020` → count
- `pa=Toyota and ic=H01M and pd>=2020` → count
- `pa=CATL and ic=H01M and pd>=2020` → count
Repeat for 8-10 top companies in the domain.

### 2c. US Data (USPTO)
Run parallel searches via `/v1/patent-search-uspto`:
- By CPC code + date range for volume
- By assignee for top filer analysis
- For bulk details: `uspto_api_guide` action="endpoint" endpoint="bulk" → POST with up to 100 patent IDs for efficient data retrieval

### 2d. Year-over-Year Trends
Search by year to build trend data:
- `ic=G06N and pd>=2020 and pd<=2020` → 2020 count
- `ic=G06N and pd>=2021 and pd<=2021` → 2021 count
- ... repeat per year

## Phase 3: Analysis

### Filing Trends
- Is the technology growing, stable, or declining?
- Any inflection points? (sudden increase = technology breakthrough or regulation change)

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

CREATE markdown file with:
1. **Executive Summary**: key findings in 3-5 bullets
2. **Methodology**: IPC codes used, date range, databases searched
3. **Filing Volume & Trends**: year-over-year data
4. **Top Filers**: ranked table with counts
5. **Technology Sub-Clusters**: breakdown by sub-topics
6. **Key Patents**: the 5-10 most cited/important patents found
7. **White Spaces**: areas with low filing activity (potential opportunities)
8. **Data Tables**: raw data for all searches performed
