# CPC/IPC Classification Reference

## Find the codes with `patstat_query` first — this file is the fallback

The tables in this file are hand-typed and **CPC is revised quarterly**, so they
go stale. When `patstat_query` is available, derive the codes from the corpus and
the official scheme instead. `patstat_api_guide` with `action='section'`,
`section='examples'` serves both queries below with their live status.

**1. Which codes the corpus actually uses for the concept** — backend verified
query **`concept_to_cpc_codes`**, the primary lookup. Discovery returns
identifiers and codes, never document text as the answer. The match idiom is
exact (the indexes are English-only partial indexes; any other language
seq-scans and the gate rejects it):

```sql
WITH hits AS (
  SELECT tx.application_id
  FROM flowleap.application_texts tx
  WHERE to_tsvector('english', tx.title) @@ plainto_tsquery('english', 'solid state battery electrolyte')
    AND tx.title_lang = 'en'
), scoped AS (
  SELECT h.application_id, a.family_id
  FROM hits h
  JOIN flowleap.applications a ON a.application_id = h.application_id
  WHERE a.ipr_type = 'PI' AND a.earliest_filing_year >= 2015
), codes AS (
  SELECT LEFT(c.cpc_code, 4) AS cpc_subclass,
         c.cpc_code,
         COUNT(DISTINCT s.family_id)      AS families,
         COUNT(DISTINCT s.application_id) AS applications
  FROM scoped s
  JOIN flowleap.classifications c ON c.application_id = s.application_id
  GROUP BY 1, 2
)
SELECT k.cpc_subclass, k.cpc_code, k.families, k.applications,
       ROUND(100.0 * k.families / (SELECT COUNT(DISTINCT family_id) FROM scoped), 1) AS share_of_hits_pct,
       sub.title AS subclass_title, grp.title AS code_title
FROM codes k
LEFT JOIN flowleap.cpc_scheme sub ON sub.symbol = k.cpc_subclass
LEFT JOIN flowleap.cpc_scheme grp ON grp.symbol = k.cpc_code
ORDER BY k.families DESC, k.cpc_code
LIMIT 30
```

EXPLAIN does not bound a GIN seed, so bound it yourself with `ipr_type = 'PI'`,
a year floor and/or an office, as above.

**2. Which codes are *named* for the concept** — backend verified query
**`cpc_candidate_codes`** over the version-stamped scheme text:

```sql
SELECT symbol, title FROM flowleap.cpc_scheme
WHERE title ILIKE '%photovoltaic%' ORDER BY symbol LIMIT 15;
```

Run both and compare: a code named for the concept but barely used, or used but
never named, means the seed phrasing is off.

**Three traps, all measured on real answers.** *Circularity* — the seed decides
the corpus, so cross-check a second phrasing before believing a ranking.
*Generic co-occurring codes* — never take the mode: on the `solid state battery
electrolyte` seed rank 1 is `Y02E60/10` "Energy storage using batteries", a
Y-scheme tag on 86.7% of hits, and the real answer is rank 2; a code whose own
corpus dwarfs the hit set is a tag, not the area. *Reclassification mix* —
legacy and current codes coexist (`H01L` and `H10F` for photovoltaics on this
edition), so verify every derived code against `flowleap.cpc_scheme` before
landscaping with it.

## CPC Structure (Cooperative Patent Classification)

Joint USPTO + EPO system. Hierarchy:
```
B        → Section
B62      → Class
B62K     → Subclass
B62K3/00 → Main Group
B62K3/12 → Subgroup
```

## 9 CPC Sections

| Section | Domain |
|---------|--------|
| **A** | Human Necessities (agriculture, food, health, sports, entertainment) |
| **B** | Performing Operations; Transporting (vehicles, printing, nano, 3D) |
| **C** | Chemistry; Metallurgy (organic, inorganic, polymers, fuels, glass) |
| **D** | Textiles; Paper |
| **E** | Fixed Constructions (buildings, roads, bridges, locks, tunnels) |
| **F** | Mechanical Engineering; Lighting; Heating; Weapons; Blasting (engines/pumps live in F01–F04) |
| **G** | Physics (instruments, optics, computing, control, nuclear) |
| **H** | Electricity (generation, conversion, distribution, circuits, communication) |
| **Y** | CPC-ONLY tagging section (emerging tech, climate mitigation — Y02, Y04, Y10); has NO IPC equivalent |

## Last-resort fallback (may be stale — CPC is revised quarterly)

The table below is orientation for when `patstat_query` is unavailable
(`patstat_unavailable`) or the question cannot be phrased as a concept. These
hand-typed codes drift every quarter, so if you use them, say in the answer that
the codes came from a static table rather than the current edition.

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
| G10L | Speech/audio processing (text NLP is G06F 40/00) |
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

## How to Find the Right CPC Code

1. Start with the section (A-H) matching the technology domain
2. Run `concept_to_cpc_codes` and `cpc_candidate_codes` through `patstat_query` (above); only if
   PATSTAT is unavailable, `web_search` with `"cpc scheme [technology term]"`
3. Check both the **parent class** (e.g., G06N) and **specific subgroups** (e.g., G06N3/084 for backpropagation; G06N3/08 is the broader "learning methods" group)
4. Use EPO's CPC browser: `web_search "espacenet cpc [term]"`
5. Look at CPC codes assigned to similar known patents — they reveal the right codes
6. The `claim-analysis` skill (Step 3b) derives classification codes when the user describes their own invention

## Boolean Classification Search (CQL)

Combine classification codes with text for precision:
- `ic=B62K3 AND (backpack OR rucksack)` — bicycles + carrying
- `ic=G06N3 AND (transformer OR attention)` — neural networks + transformer architecture
- Use `$` wildcard for subgroups: `B62K15/$` matches all foldable bicycle subgroups

**Field choice — `ic=` vs `cpc=`**: `ic=` searches the IPC field. CPC-ONLY codes — the entire Y section (Y02E, Y02T, …) and codes like B33Y, G06V, G16B, G16H, F24S — do NOT exist in the IPC, so `ic=Y02E` returns zero results silently. Query CPC-only codes with the CPC field (`cpc=Y02E…`); codes that exist in both systems can use either.
