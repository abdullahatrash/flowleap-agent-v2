---
name: patent-translation
description: Multi-language patent search strategy for Chinese, Japanese, Korean, and other non-English jurisdictions via Google Patents/PATENTSCOPE search patterns and patent-family expansion. Use when prior art or FTO coverage must include CN/JP/KR filings, the user asks about Chinese/Japanese/Korean patents, or a key reference exists only in a non-English language and translated claims are needed.
user-invocable: true
---

# Patent Translation & Multi-Language Search

Strategy for finding patents in Chinese, Japanese, Korean, and other non-English jurisdictions.

## Why This Matters
- China (CNIPA) files more patents than any other country
- Japan (JPO) has deep prior art in electronics, automotive, materials
- Korea (KIPO) dominates semiconductor, display, battery patents
- Missing these jurisdictions = incomplete prior art search

## Search Strategy by Jurisdiction

All via `web_search` — Google Patents indexes machine-translated versions, so search in English:

- **Chinese (CN)**: `site:patents.google.com/patent/CN "keyword1" "keyword2"`
  - Companies to watch: Huawei, CATL, BYD, BOE, Xiaomi, SMIC, DJI
  - CN utility models (实用新型) are common — shorter protection but still relevant prior art
- **Japanese (JP)**: `site:patents.google.com/patent/JP "keyword1" "keyword2"`; also `site:j-platpat.inpit.go.jp "keyword"` for more detail
  - Companies: Toyota, Sony, Panasonic, Canon, Fujitsu, NEC, Hitachi
  - JP Kokai (公開) = published applications; JP patents = granted
- **Korean (KR)**: `site:patents.google.com/patent/KR "keyword1" "keyword2"`
  - Companies: Samsung, LG, SK Hynix, Hyundai, POSCO; strong in semiconductors, displays, batteries, 5G/6G
- **WIPO/PCT**: `site:patentscope.wipo.int "keyword1" "keyword2"` — PCT applications indicate global filing intent

## Cross-Language Discovery Workflow

### Step 1: English Search First
Run EPO OPS (`build_patent_query` → `search_patents`) and USPTO (`build_uspto_query` → `patent_api_request`) to establish the baseline.

### Step 2: Identify Key Players
Note applicants from Step 1, then search their CN/JP/KR filings:
`site:patents.google.com/patent/CN "Samsung" "keyword"`

### Step 3: Patent Family Expansion
For any important patent found in any jurisdiction:
1. `ops_api_guide` action="endpoint" endpoint="family" → `patent_api_request`
2. Family members have translated claims in their respective offices — often the fastest route to an English version of a CN/JP/KR disclosure

### Step 4: IPC-Based Cross-Language Search
IPC codes are universal across all patent offices:
`site:patents.google.com inurl:CPC=G06N3` finds patents in ANY language under that code.

## Translation Quality Notes
- Google Patents machine translation: good for screening, not for legal analysis
- EPO Patent Translate: higher quality but only via the EPO website
- Always flag: "Machine-translated from [language] — verify with a human translator for legal reliance"

## Output
Include in reports (and the audit-report skill's source table):
- Language and jurisdiction for each reference
- Whether claims were machine-translated or original
- Translation quality caveat for non-English references
