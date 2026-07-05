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

## 8 CPC Sections

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

## Common CPC Codes by Domain

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

## How to Find the Right CPC Code

1. Start with the section (A-H) matching the technology domain
2. Use `web_search` with `"cpc scheme [technology term]"` to find specific codes
3. Check both the **parent class** (e.g., G06N) and **specific subgroups** (e.g., G06N3/08 for backpropagation)
4. Use EPO's CPC browser: `web_search "espacenet cpc [term]"`
5. Look at CPC codes assigned to similar known patents — they reveal the right codes
6. `analyze_claim` also suggests IPC/CPC codes when the user describes their own invention

## Boolean Classification Search (CQL)

Combine classification codes with text for precision:
- `ic=B62K3 AND (backpack OR rucksack)` — bicycles + carrying
- `ic=G06N3 AND (transformer OR attention)` — neural networks + transformer architecture
- Use `$` wildcard for subgroups: `B62K15/$` matches all foldable bicycle subgroups
