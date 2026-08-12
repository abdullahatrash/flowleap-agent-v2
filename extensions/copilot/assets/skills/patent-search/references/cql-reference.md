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

**Grouping:** parentheses group complete `field=value` clauses:

```
(ic=H02J OR ic=B60L)                     ← valid; the way to cover two classes
(ta="glass ceramic" OR ta="glass-ceramic")   ← valid; the way to cover both word forms
ta=(turbine OR blade)                    ← NOT CQL — parentheses inside a field's value
                                           fail with a hard OPS 404
```

Repeat the field inside the parentheses; never put the parentheses inside the value.

**Not documented here, because it is not confirmed:** whether EPO OPS stems word forms
(`charging` → `charge`), how it treats hyphens (`glass-ceramic` vs `glass ceramic`),
whether a wildcard works *inside* a quoted phrase (`ta="patent claim*"` — a zero-hit
result from that shape may be a syntax artifact, not an empty field; prefer the wildcard
on an unquoted term), and exactly what counts as one "term" against the budget below (a
three-word phrase may cost one or three). Do not assume. Where hyphenation or word form changes your query, OR both forms
with the field repeated (the pattern above) — that is live-verified — rather than dropping
the term. If you learn a definitive answer, record it here.

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
- **When the invention spans classes, OR the classes together — do not drop them.**
  "Machine learning applied to patent analysis" lives across `G06N`, `G06F` and `G06Q`;
  pinning one silently discards the other two, but a class still does real work against a
  noisy `ta` term. Write `(ic=G06N OR ic=G06F OR ic=G06Q)`. Use no class only when you
  cannot name the candidate classes at all.
- **Aim for two or three discriminating terms, not the minimum one.** One extra
  discriminating term routinely cuts a count by two orders of magnitude — the difference
  between 3,549 hits (unusable) and 18 (readable). Take the next term from the extraction
  list the skill requires; do not invent one.
- **Spend the term budget on discrimination, not coverage.** With ~10 terms available, two
  precise `ta` terms beat five vague ones plus three classification codes.

### Combination inventions — when two broad terms are one narrow one

Many inventions are "thing A applied to domain B", where A and B are each a neighbourhood
but the *intersection* is narrow: a drone that inspects wind turbine blades; wireless
charging with foreign-object detection. Here **keeping both terms is the discrimination** —
dropping the category word loses the invention.

```
ta=drone AND ta="turbine blade"          ← the pair is narrow; keep both
ta="crack detection"                     ← drops the drone, pulls in ground-based inspection
```

Read the rule as *"replace a vague category with the specific subject matter"*, not as
*"delete every broad word"*.

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

The count probe is mandatory, not advisory. You cannot predict where a query will land, so
execute it with a small limit, read the total, and refine from there rather than reasoning
about it blind. A query is not done until its count is workable.

| Symptom | Move |
|---|---|
| >1,000 results | add the next discriminating term from your extraction list; then a date bound or a narrower classification |
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
ta="foreign object" AND ta=charging AND (ic=H02J OR ic=B60L)
pn=EP3456789
```

**Will error**

```
ic=G06N*                              ← wildcard on a classification field
pn=EP123*                             ← wildcard on a publication number
ta=(turbine OR blade)                 ← parentheses inside a field value; hard 404 —
                                        write (ta=turbine OR ta=blade)
pa=GOOGLE* AND pa=APPLE* AND ta=phone AND ta=mobile AND ic=H04W AND ic=G06F
                                      ← over the term budget
```

**Weak but legal** — returns thousands of irrelevant hits:

```
ic=G06N AND pd>=2020                  ← no discriminating term at all
ta="artificial intelligence"          ← names the neighbourhood, not the house
```

## Classification codes

Do not guess codes — and do not trust this table alone. **CPC reclassifies.** The `H10`
range (`H10F`, `H10H`, `H10K`, `H10N`) was carved out of `H01L` for radiation-sensitive,
light-emitting and other specialised semiconductor devices; `H01L` is now formally
"semiconductor devices **not covered by class H10**". Anything filed or classified recently
may sit in a code this table does not list. (The corpus agrees: `H10F` carries ~1.16M CPC
assignments in PATSTAT 2026 Spring; `H01L31`, the pre-2023 photovoltaics subclass, carries
zero — reclassification rewrote the backfile.)

**Verify the code — the official CPC scheme is queryable.** The version-stamped scheme
text lives in `flowleap.cpc_scheme` (columns: `symbol`, `level`, `title`), reachable via
`patstat_query`:

```sql
SELECT symbol, title FROM flowleap.cpc_scheme WHERE symbol = 'H10F';
-- does the code exist, and what is it

SELECT symbol, title FROM flowleap.cpc_scheme
WHERE title ILIKE '%photovoltaic%' ORDER BY symbol LIMIT 15;
-- candidate codes for a technology term
```

Read the results at the right level: a 4-char class carries only the headline
(`H10F` = "inorganic semiconductor devices sensitive to radiation"); the specific
technology titles live in its **groups** (`H10F10/00`, `H10F71/00` …). Match keywords
against group titles, then search with the 4-char class (`ic=H10F`) or the exact group
(`cpc=H10F10/00`). A wrong class silently returns the wrong corpus; it does not error.

Fall back to `web_search "cpc scheme [term]"` or the prior-art skill's
`references/cpc-classification.md` only when `patstat_query` is unavailable.

Common areas (as of 2026-08; treat as a starting point, not an authority):

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
| H01L | semiconductors *not* covered by H10 |
| H10F | photovoltaic cells, photodiodes, light-sensitive semiconductors |
| H01M | batteries, fuel cells |
| H02J | power distribution, charging |
| H04L | network protocols, telecom |
| H04W | wireless communication |
| Y02E | clean energy technologies |

For anything not listed: `patstat_query` on `flowleap.cpc_scheme` (the queries above) —
then the prior-art skill's `references/cpc-classification.md`, or
`web_search "cpc scheme [term]"`, when `patstat_query` is unavailable.
