---
name: patent-translation
description: Multi-language patent search strategy for CN/JP/KR patents and cross-language discovery
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

### Chinese Patents (CN)
Use `web_search`:
```
site:patents.google.com/patent/CN "keyword1" "keyword2"
```
Google Patents provides machine-translated abstracts and claims for CN patents.

**Tips:**
- Search in English — Google Patents indexes translated versions
- Chinese companies to watch: Huawei, CATL, BYD, BOE, Xiaomi, SMIC, DJI
- CN utility models (实用新型) are common — shorter protection but still relevant prior art

### Japanese Patents (JP)
Use `web_search`:
```
site:patents.google.com/patent/JP "keyword1" "keyword2"
```
Also try J-PlatPat for more detailed results:
```
site:j-platpat.inpit.go.jp "keyword"
```

**Tips:**
- Japanese companies: Toyota, Sony, Panasonic, Canon, Fujitsu, NEC, Hitachi
- JP Kokai (公開) = published applications, JP patents = granted

### Korean Patents (KR)
Use `web_search`:
```
site:patents.google.com/patent/KR "keyword1" "keyword2"
```

**Tips:**
- Korean companies: Samsung, LG, SK Hynix, Hyundai, POSCO
- Strong in: semiconductors, displays, batteries, 5G/6G

### WIPO/PCT Applications
Use `web_search`:
```
site:patentscope.wipo.int "keyword1" "keyword2"
```
PCT applications indicate global filing intent.

## Cross-Language Discovery Workflow

### Step 1: English Search First
Run EPO OPS + USPTO searches (dedicated tools) to establish baseline.

### Step 2: Identify Key Players
Note applicants from Step 1 results — then search for their CN/JP/KR filings:
```
site:patents.google.com/patent/CN "Samsung" "keyword"
```

### Step 3: Patent Family Expansion
For any important patent found in any jurisdiction:
1. `ops_api_guide` action="endpoint" endpoint="family" → get curl
2. Run curl → find family members in other countries
3. Family members have translated claims in their respective offices

### Step 4: IPC-Based Cross-Language Search
IPC codes are universal across all patent offices:
- Search Google Patents by IPC: `site:patents.google.com inurl:CPC=G06N3`
- This finds patents in ANY language classified under that code

## Translation Quality Notes
- Google Patents machine translation: good for screening, not for legal analysis
- EPO Patent Translate: higher quality but only via EPO website
- For critical references: note that machine translation is approximate
- Always flag: "Machine-translated from [language] — verify with human translator for legal reliance"

## Output
Include in reports:
- Language and jurisdiction for each reference
- Whether claims were machine-translated or original
- Translation quality caveat for non-English references
