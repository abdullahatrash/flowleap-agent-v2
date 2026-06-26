---
name: prior-art
description: Comprehensive multi-jurisdiction prior art search using USPTO broad-to-narrow methodology with audit trail
user-invocable: true
---

# Prior Art Search

Systematic prior art search across all available databases using USPTO-recommended broad-to-narrow methodology with full documentation.

## Phase 1: Invention Analysis (USPTO 3-Sentence Technique)

### 1a. Three-Sentence Description
Ask the user to describe the invention three different ways (or do it yourself from their description):
1. First description — focus on structure/components
2. Second description — focus on function/use case
3. Third description — focus on novelty/differentiation

Review all three for **repeated words and phrases** — these are the core concepts.

### 1b. Concept-Synonym Table (MANDATORY)
Build a structured table of every concept with synonyms, technical equivalents, and related terms:

| Concept | Synonyms & Variations |
|---------|----------------------|
| [Primary concept] | [synonym1], [synonym2], [technical term] |
| [Second concept] | [synonym1], [synonym2], [related term] |
| [Third concept] | [synonym1], [synonym2], [alternative] |

Use dictionaries, technical manuals, and web search to discover additional terms.
Aim for **at least 3 variations per concept**.

### 1c. Classification Mapping (CPC/IPC)

#### CPC Structure (Cooperative Patent Classification)
Joint USPTO + EPO system. Hierarchy:
```
B        → Section
B62      → Class
B62K     → Subclass
B62K3/00 → Main Group
B62K3/12 → Subgroup
```

#### 8 CPC Sections
| Section | Domain |
|---------|--------|
| **A** | Human Necessities (agriculture, food, health, sports, entertainment) |
| **B** | Performing Operations; Transporting (vehicles, printing, nano, 3D) |
| **C** | Chemistry; Metallurgy (organic, inorganic, polymers, fuels, glass) |
| **D** | Textiles; Paper |
| **E** | Fixed Constructions (buildings, roads, bridges, locks, tunnels) |
| **F** | Mechanical Engineering; Lighting; Heating; Weapons; Engines/Pumps |
| **G** | Physics (instruments, optics, computing, control, nuclear) |
| **H** | Electricity (generation, conversion, distribution, circuits, communication) |

#### Common CPC Codes by Domain
| Code | Domain |
|------|--------|
| A01 | Agriculture, forestry, animal husbandry |
| A23 | Foods, foodstuffs |
| A45 | Travelling articles, personal items, backpacks |
| A61B | Medical diagnosis/surgery |
| A61K | Pharmaceutical compositions |
| A61P | Therapeutic activity of chemical compounds |
| B01 | Chemical/physical processes (separation, mixing) |
| B25J | Robotics, manipulators |
| B29 | Plastics, 3D printing |
| B33Y | Additive manufacturing (3D printing) |
| B60L | Electric vehicles, propulsion |
| B62 | Land vehicles (bicycles, motorcycles) |
| B64 | Aircraft, aviation, cosmonautics |
| C07 | Organic chemistry |
| C08 | Organic macromolecular compounds (polymers) |
| C12N | Biotechnology, genetic engineering |
| C12Q | Biological testing, diagnostics |
| F03D | Wind motors |
| F24S | Solar heating |
| G01N | Material analysis, testing |
| G02B | Optical elements, lenses |
| G05B | Control systems |
| G06F | Computing, data processing |
| G06N | AI, machine learning, neural networks |
| G06Q | Business methods, fintech |
| G06T | Image processing, computer vision |
| G06V | Image/video recognition |
| G10L | Speech processing, NLP |
| G16B | Bioinformatics |
| G16H | Healthcare informatics |
| H01L | Semiconductor devices |
| H01M | Batteries, fuel cells, electrochemical cells |
| H02J | Power supply, charging, energy storage |
| H04B | Signal transmission |
| H04L | Data transmission, networking, security |
| H04N | Image/video communication |
| H04W | Wireless communication |
| Y02E | Clean energy (solar, wind, hydro, nuclear) |
| Y02T | Climate change — transportation |

#### How to Find the Right CPC Code
1. Start with the section (A-H) matching your technology domain
2. Use `web_search` with `"cpc scheme [technology term]"` to find specific codes
3. Check both the **parent class** (e.g., G06N) and **specific subgroups** (e.g., G06N3/08 for backpropagation)
4. Use EPO's CPC browser: `web_search "espacenet cpc [term]"`
5. Look at CPC codes assigned to similar known patents — they reveal the right codes

#### Boolean Classification Search
Combine classification codes with text for precision:
- `ic=B62K3 AND (backpack OR rucksack)` — bicycles + carrying
- `ic=G06N3 AND (transformer OR attention)` — neural networks + transformer architecture
- Use `$` wildcard for subgroups: `B62K15/$` matches all foldable bicycle subgroups

Identify **2-3 CPC/IPC codes** that cover the invention.
Note both broad parent codes and specific subgroup codes.

### 1d. Critical Date & Prior Art Scope
- **Critical date**: priority date or filing date — all prior art must predate this
- **Prior art includes** (per 35 USC 102):
  - Patents and published patent applications (US and foreign)
  - Printed publications (journals, papers, manuals, websites)
  - Public use or on sale (trade shows, demos, product launches)
  - Otherwise available to the public (conference talks, social media, videos)
- Ask the user: was this invention publicly demonstrated, sold, or shown anywhere before filing?

## Phase 2: Broad-to-Narrow Search (USPTO Core Methodology)

### 2a. Build Search Sets
Create boolean search sets starting broad, narrowing progressively:

| Set | Query | Expected Hits | Purpose |
|-----|-------|---------------|---------|
| X1 | [Primary concept] OR [synonym1] OR [synonym2] | ~10,000+ | Broadest — primary concept |
| X2 | [Second concept] OR [synonym1] | ~large | Second concept |
| X3 | [Third concept] OR [synonym1] | ~large | Third concept |
| X4 | X1 AND X2 | ~smaller | First narrowing |
| X5 | X4 AND X3 | ~reviewable | Second narrowing |

**Primary concept** = the single concept that ALL relevant results must contain.
Document hit counts at every step.

### 2b. EPO OPS (EP/WO Patents)
1. `build_patent_query` with concept-synonym table → CQL queries
2. `search_patents` with CQL → record result count
3. Run at least **3 query variations** using different synonym combinations
4. Combine with CPC codes: `ic=[CPC] AND (keyword1 OR keyword2)`
5. For top 3-5 results: fetch claims via `ops_api_guide` → curl

### 2c. USPTO (US Patents)
1. `uspto_api_guide` → curl to `/v1/patent-search-uspto`
2. Translate IPC→CPC if needed (CPC is more granular for US patents)
3. Run parallel keyword + CPC + assignee searches
4. Filter by date range (before critical date)
5. Document hit counts for each query

### 2d. Google Patents (Full-Text Search)
Use `web_search` for Google Patents full-text coverage:
- `site:patents.google.com "[keyword phrase]" "[keyword2]"`
- Filter by CPC: add CPC code to query
- Useful for finding patents missed by structured API searches
- Good for browsing patent families and forward/backward citations

### 2e. WIPO PATENTSCOPE (PCT Applications)
Use `web_search` with:
- `site:patentscope.wipo.int "[keyword1]" "[keyword2]"`
- Covers 94M+ patent documents including 4M+ PCT applications
- Important for international applications not yet in national phase

### 2f. Asian Patents (CN/JP/KR)
Use `web_search` with these patterns:
- `site:patents.google.com/patent/CN "keyword1" "keyword2"`
- `site:patents.google.com/patent/JP "keyword1"`
- `site:patents.google.com/patent/KR "keyword1"`

### 2g. Non-Patent Literature (NPL)
Prior art is NOT limited to patents. Search:
1. `search_academic` for academic papers
2. `web_search` with:
   - `site:arxiv.org "keyword"` (CS/physics)
   - `site:pubmed.gov "keyword"` (medical)
   - `site:ieee.org "keyword"` (engineering)
   - `site:scholar.google.com "keyword"` (broad academic)
3. Consider: conference proceedings, technical standards, product manuals, YouTube demos, trade show presentations

### 2h. Patent Family with Biblio (Efficiency Shortcut)
For top results, get family members with full biblio in one call:
1. `ops_api_guide` action="endpoint" endpoint="family-biblio" → curl `/v1/ops/family/biblio?doc=...`
2. Returns all family members with titles, applicants, dates — replaces separate family + bulk biblio calls

### 2i. Citation Chain Analysis
For the most relevant results found:
1. `citation_api_guide` action="endpoint" endpoint="forward" → who cites this patent?
2. Follow forward citations to find more recent related art
3. Check backward citations to find foundational references
4. For key nodes: follow 2 hops to build citation network

## Phase 3: Relevance Assessment

### 3a. Element-by-Element Mapping
For each reference, rate against each claim element:

| Reference | Pub Date | Source | Element 1 | Element 2 | Element 3 | Overall |
|-----------|----------|--------|-----------|-----------|-----------|---------|
| EP1234567 | 2022-03 | EPO OPS | ✅ Teaches | ❌ Missing | ⚠️ Similar | High |
| US11,xxx | 2021-06 | USPTO | ⚠️ Similar | ✅ Teaches | ✅ Teaches | High |

- ✅ = Explicitly teaches this element
- ⚠️ = Related/similar but not identical
- ❌ = Does not teach this element

### 3b. 102/103 Analysis
- **102 (Novelty)**: Does ANY single reference disclose ALL claim elements? → X document
- **103 (Obviousness)**: Do 2+ references COMBINED cover all elements? → Y documents
  - Would a skilled person have motivation to combine them?
- **Background only**: Same field but different approach → A document

## Phase 4: Report Generation

CREATE a markdown file with:
1. **Search Summary**: invention description (3-sentence technique output), critical date, IPC/CPC codes used
2. **Concept-Synonym Table**: the full table built in Phase 1
3. **Search Strategy**: broad-to-narrow set documentation with hit counts at each step
4. **Search Queries**: every query executed across every database (full audit trail)
5. **Results Table**: all references with relevance ratings and source database
6. **Top References**: detailed element-by-element analysis of the 3-5 most relevant
7. **Non-Patent Prior Art**: any NPL, public use, or other non-patent references found
8. **Conclusion**: novelty assessment, potential 102/103 issues, suggested claim amendments
9. **Databases Searched**: EPO OPS, USPTO, Google Patents, WIPO PATENTSCOPE, Asian offices, NPL sources

## Rules
- NEVER invent patent numbers — only cite what search tools returned
- ALWAYS include publication dates (critical for 102/103)
- ALWAYS build the concept-synonym table before searching
- ALWAYS document hit counts for broad-to-narrow narrowing steps
- Document ALL queries run (this is the audit trail)
- Note which database each result came from
- Consider non-patent prior art (public use, on sale, demos) not just publications
