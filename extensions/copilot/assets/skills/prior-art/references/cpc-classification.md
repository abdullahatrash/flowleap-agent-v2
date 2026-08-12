# CPC/IPC Classification Reference

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

## Common CPC Codes by Domain

**Starting hints only — confirm against the corpus (see "How to Find the Right CPC Code").**
Last reviewed 2026-08. CPC moves: the `H10` range (`H10F`, `H10H`, `H10K`, `H10N`) was carved
out of `H01L`, so anything below may already be superseded.

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
| H01L | Semiconductor devices *not* covered by H10 |
| H10F | Photovoltaic cells, photodiodes, light-sensitive semiconductors |
| H01M | Batteries, fuel cells, electrochemical cells |
| H02J | Power supply, charging, energy storage |
| H04B | Signal transmission |
| H04L | Data transmission, networking, security |
| H04N | Image/video communication |
| H04W | Wireless communication |
| Y02E | Clean energy (solar, wind, hydro, nuclear) |
| Y02T | Climate change — transportation |

## How to Find the Right CPC Code

**Derive it from the corpus. Do not look it up in a list.**

CPC is revised quarterly. Any table of codes — including the one above — is a snapshot that
drifts, and prose cannot tell you it has gone stale. The patents themselves cannot: they carry
whatever classification is current.

The method, and it costs one search you were about to run anyway:

1. Run a **text-only** search on the invention's discriminating terms — no classification filter:
   `ta="perovskite solar cell"`
2. Read the classification codes off the top 5-10 hits. The codes that recur ARE the right
   codes, by definition — they are where this art actually lives today.
3. Re-run with the most frequent code added as a filter, and compare counts.

This is self-updating: when CPC reclassifies, the corpus reclassifies with it, and step 2
returns the new code without anyone maintaining anything.

Fallbacks when a corpus search is not available or returns nothing:

- `web_search "cpc scheme [technology term]"`, or EPO's browser via `web_search "espacenet cpc [term]"`
- Check both the **parent class** (e.g. G06N) and **specific subgroups** (e.g. G06N3/084 for
  backpropagation; G06N3/08 is the broader "learning methods" group)
- The `claim-analysis` skill (Step 3b) derives classification codes from the user's own claim

## Boolean Classification Search (CQL)

Combine classification codes with text for precision:
- `ic=B62K3 AND (backpack OR rucksack)` — bicycles + carrying
- `ic=G06N3 AND (transformer OR attention)` — neural networks + transformer architecture
- Use `$` wildcard for subgroups: `B62K15/$` matches all foldable bicycle subgroups

**Field choice — `ic=` vs `cpc=`**: `ic=` searches the IPC field. CPC-ONLY codes — the entire Y section (Y02E, Y02T, …) and codes like B33Y, G06V, G16B, G16H, F24S — do NOT exist in the IPC, so `ic=Y02E` returns zero results silently. Query CPC-only codes with the CPC field (`cpc=Y02E…`); codes that exist in both systems can use either.
