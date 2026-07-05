---
name: figure-analysis
description: Retrieve patent figures/drawings as inline images and analyze them visually — reference numerals, claim mapping, visual prior art comparison. Use when the user asks to see, show, or analyze a patent's figures or drawings, for structural/mechanical/design inventions or flowcharts where the drawings carry the disclosure, or to verify a reference visually across languages.
user-invocable: true
---

# Figure & Drawing Analysis

Drawings are part of the legal disclosure and can be prior art for what they clearly show.

- Use `get_patent_figures` (pub number) to fetch drawings as inline images — it returns the actual drawing pages by default; pass `pages` for specific ones.
- Pull figures when the user asks to see them, for structural/mechanical/design inventions, flowcharts, or to verify a reference visually.
- Map reference numerals (e.g. "housing 12") to the claims/description via `get_patent_details`.
- For prior art, compare element-by-element against what the figure actually shows (✅ shown / ⚠️ similar / ❌ absent) for §102/§103.
- Figures are language-independent — analyze CN/JP/KR/DE drawings without translation.
- Never describe a figure you haven't retrieved; don't over-read ambiguous depictions.
