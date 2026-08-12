# EPO OPS CQL Reference

The query language for `search_patents`. Read this before writing any CQL beyond a single
`pa=` or `ti=` term.

## Coverage — what a hit actually gives you

| Office | Available |
|---|---|
| **EP** (European) | full text, claims, legal status |
| **WO** (WIPO/PCT) | full text, claims |
| US, CN, JP, KR | bibliographic data only — **no full text** |

A US hit from EPO OPS gives you title, abstract and dates, nothing more. For US full text
and prosecution data use the USPTO ODP path instead.

## Hard constraints — these produce API errors, not bad results

1. **Maximum ~10 terms per query.** More fails with `MaximumTotalTerms`.
2. **No wildcards on `ic`, `cpc`, `cl`, `pn`.** Produces `TruncationForbidden`.
3. Wildcards (`*`) are allowed **only** on text fields: `pa`, `in`, `ti`, `ab`, `ta`.

## Fields

### Text — wildcards allowed

| Field | Meaning | Note |
|---|---|---|
| `ta` | title + abstract combined | **Preferred.** Use instead of `ti` + `ab` — it costs one term instead of two |
| `ti` | title only | |
| `ab` | abstract only | |
| `pa` | applicant / assignee | `pa=GOOGLE*`, `pa="TESLA INC"` |
| `in` | inventor | `in=SMITH*`, `in="John Smith"` |

### Classification — no wildcards

| Field | Meaning |
|---|---|
| `ic` | IPC classification (`ic=G06N`, `ic=H01M10`) |
| `cpc` | CPC classification (`cpc=Y02E`, `cpc=G06N3/08`) |
| `cl` | all classifications combined (`cl=G06N`) |

### Identifiers — no wildcards

| Field | Meaning |
|---|---|
| `pn` | publication number, exact (`pn=EP1234567`) |
| `ap` | application number (`ap=EP20200001`) |
| `pr` | priority number or year (`pr=2020`) |

### Other

| Field | Meaning |
|---|---|
| `ct` | citation — finds documents **citing** this one (`ct=EP1234567`) |
| `pd` | publication date |

**Dates:** `pd=2023` (exact year) · `pd>=2020` · `pd<=2023` · `pd within "2020 2023"` (inclusive range)

**Operators:** `AND`, `OR`, `NOT` — uppercase. Phrases in `"double quotes"`.

## Choosing terms

Every query needs at least one **discriminating** term. See the skill for the rule; this is
how to apply it per field.

- **`ta` carries the discrimination.** It must hold the specific subject matter, not the
  technology area. For "AI for patent analysis": `ta="patent analysis"` or
  `ta="prior art search"` — never just `ta="artificial intelligence"`.
- **A classification code is never discriminating on its own.** `ic=G06N` is every machine
  learning patent ever filed. Always pair it with a `ta` term.
- **Applicants take wildcards for name variants**: `pa=GOOGLE*` catches "Google LLC",
  "Google Inc". Consider subsidiaries separately — Google also files as Alphabet, DeepMind,
  Waymo.
- **Spend the term budget on discrimination, not coverage.** With ~10 terms available, two
  precise `ta` terms beat five vague ones plus three classification codes.

## Recall vs precision

The old query builder exposed this as a `focus` parameter. It is a judgement, not a setting:

- **Broad** (maximise recall) — drop the classification filter, widen dates, use the parent
  CPC class, add synonyms with `OR`. Use when the cost of missing art is high: novelty
  searches, freedom-to-operate.
- **Precise** (maximise precision) — add a second `ta` term, narrow the classification to a
  subgroup, tighten dates. Use when you want the closest few documents to read in full.
- **Balanced** — one discriminating `ta` term, one classification, one date bound. The
  sensible default when nobody said otherwise.

A **Prior-Art Search** should start broad and narrow, never the reverse: you cannot notice
what a too-narrow query never returned.

## Refinement

| Symptom | Move |
|---|---|
| >10,000 results | add a date bound; narrow the classification; add a second `ta` term |
| <10 results | drop the classification; try synonyms; use the parent CPC class; widen dates |
| Off-topic results | your `ta` term is not discriminating — replace the category word with the specific subject matter |
| `MaximumTotalTerms` | too many terms; cut to the discriminating ones |
| `TruncationForbidden` | a wildcard on `ic`/`cpc`/`cl`/`pn`; remove it |

## Worked examples

**Good**

```
pa=GOOGLE* AND ta="machine learning" AND ic=G06N
pa=TESLA* AND ta=battery AND ic=H01M
in=HINTON* AND ic=G06N
ct=EP1234567
ta=CRISPR AND ic=C12N AND pd>=2020
pn=EP3456789
```

**Will error**

```
ic=G06N*                              ← wildcard on a classification field
pn=EP123*                             ← wildcard on a publication number
pa=GOOGLE* AND pa=APPLE* AND ta=phone AND ta=mobile AND ic=H04W AND ic=G06F
                                      ← over the term budget
```

**Weak but legal** — returns thousands of irrelevant hits:

```
ic=G06N AND pd>=2020                  ← no discriminating term at all
ta="artificial intelligence"          ← names the neighbourhood, not the house
```

## Classification codes

Do not guess codes. Common areas:

| Code | Area |
|---|---|
| A61K | pharmaceuticals, drug formulations |
| A61B | medical / surgical instruments |
| B60L | electric vehicle propulsion |
| B64C | aircraft, helicopters |
| C07D | organic chemistry compounds |
| C12N | biotechnology, genetic engineering |
| F03D | wind power turbines |
| G01N | testing, analysing materials |
| G06F | computing, data processing |
| G06N | AI, machine learning, neural networks |
| G06Q | business methods, fintech |
| G16H | healthcare informatics |
| H01L | semiconductors |
| H01M | batteries, fuel cells |
| H02J | power distribution, charging |
| H04L | network protocols, telecom |
| H04W | wireless communication |
| Y02E | clean energy technologies |

For anything not listed: the prior-art skill's `references/cpc-classification.md`, or
`web_search "cpc scheme [term]"` when `web_search` is available.
