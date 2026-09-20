---
name: figure-analysis
description: Retrieve patent drawings as inline images and read them: reference numerals, claim mapping, visual comparison. Use when the user asks to see or analyze a patent's figures, for inventions whose drawings carry the disclosure, or to check a reference visually across languages. Also the step a search skill sends you to before marking a structural feature unresolved on text alone.
user-invocable: true
---

# Figure & Drawing Analysis

Drawings are part of the legal disclosure and can be prior art for what they clearly show.

- Use `get_patent_figures` (pub number) to fetch drawings as inline images — it returns the actual drawing pages by default; pass `pages` for specific ones.
- Pull figures when the user asks to see them, for structural/mechanical/design inventions, flowcharts, or to verify a reference visually.
- Map reference numerals (e.g. "housing 12") to the claims/description via `get_patent_details`.
- For prior art, compare element-by-element against what the figure actually shows for §102/§103, using the ✅/⚠️/❌ disclosure notation defined in the patent-examination skill.
- Figures are language-independent — analyze CN/JP/KR/DE drawings without translation.
- Never describe a figure you haven't retrieved; don't over-read ambiguous depictions.
- A figure discloses what it clearly shows — that an element exists, how parts connect or are arranged; it does not disclose dimensions, proportions or ratios unless the drawing is stated to be to scale (MPEP 2125; *Hockerson-Halberstadt v. Avia*; *In re Wright*), so a ratio read off an unscaled figure is invented evidence.
- Save non-trivial analyses via `write_patent_results` — the reference-numeral map, figure citations, and comparison table.
- The analysis is complete only when every figure referenced in the answer has been retrieved via `get_patent_figures` and every claim-mapping statement cites a specific figure and reference numeral.
