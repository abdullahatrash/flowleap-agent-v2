---
name: patent-search
description: Run patent searches across EPO OPS (EP/WO) and USPTO Open Data Portal (US) — query building, execution, and refinement. Use when the user wants to find patents by topic, applicant, or classification ("search patents for X", "what has company Y filed", "find EP patents about Z"). For a documented prior-art hunt against an invention use prior-art; for filing statistics and trends use patent-landscape.
user-invocable: true
---

# Patent Search

Comprehensive patent search across EPO OPS (EP/WO) and USPTO Open Data Portal (US).

## Jurisdiction Gate (MANDATORY)

Before ANY search, determine jurisdiction. If not specified by the user, ask (via the `vscode_askQuestions` tool):
- "US patents only" → USPTO path
- "European/International (EP/WO)" → EPO OPS path
- "Both (comprehensive)" → run both

## EPO OPS Search (EP/WO Patents)

### Tool Chain
1. Write the CQL yourself (see below) → `search_patents` with it → returns EP/WO results
2. `get_patent_details` for full claims/description of interesting hits
3. Other detail endpoints (family, legal, register): `ops_api_guide` → execute with `patent_api_request`

### Writing the query

**Step 1 — extract the terms. Mandatory, before any CQL.** List every specific noun
phrase in the description: materials, mechanisms, subject matter ("sulfide glass
ceramic", "foreign object detection", "prior art"). These are your candidate
discriminating terms. For each one you leave out of the query, state why. Uncertainty
about phrasing ("glass ceramic" vs "glass-ceramic") is a reason to OR both forms, never
to drop the term. The most common failure is dropping the phrase that *is* the
invention.

**Step 2 — write the query.** Every query needs at least one **discriminating** term —
one that separates this invention from the millions of generic patents in its technology
area. A CPC code is never discriminating: it names a neighbourhood, not a house.

For "AI for patent analysis", the discriminating term is `ta="patent analysis"` or
`ta="prior art search"`. `ta="artificial intelligence"` is the neighbourhood, and
`ic=G06N` alone returns every machine-learning patent ever filed.

```
pa=GOOGLE* AND ta="machine learning" AND ic=G06N
```

**Before writing any CQL beyond a single `pa=` or `ti=` term, read
`references/cql-reference.md`. Do not guess field names.** Every field in your query must
appear in that reference — if you cannot name the field's entry, you have guessed, so go
read it. Wildcards on `ic`/`cpc`/`cl`/`pn` and queries over ~10 terms are API errors, not
weak results.

**Step 3 — probe the count. Mandatory, before trusting any results.** Run the query with
a small limit and read the total. **Over ~1,000 hits: the query is too broad — add the
next discriminating term from your Step 1 list and probe again.** Under 10: broaden (see
Refinement). A query you never probed is a guess, and in a prior-art search a query
returning thousands of hits instead of tens means the closest art is never seen.

**Query budget — probing is not sweeping.** A standard search finishes in **4-6 queries
total**, probe included. A Prior-Art Search may go deeper, but stop when new variants
return the same documents. Never spend a call on what you already know:
- A single neighbourhood term alone (`ta=pipeline`, `ta=sensor`) is always huge — never
  execute it; probe only queries you would actually accept.
- `AND` order does not matter: `X AND Y AND Z` equals `Z AND X AND Y` — never re-run a
  reordered version of a query you already ran.
- After a transient backend error, retry the SAME query at most once, then move on to a
  different query or report the gap — grinding retries is not persistence.

## USPTO Search (US Patents)

The USPTO API is the **Open Data Portal (ODP)** with Lucene query syntax.

### Tool Chain
1. `uspto_api_guide` action="endpoint" for the search endpoint → gives the current request body shape
2. Write the Lucene query into that body → `patent_api_request` (POST) → results
3. For other ODP endpoints (patent by ID, applications, continuity chains): `uspto_api_guide` action="list", then `patent_api_request`

`uspto_api_guide` is the single source of truth for current ODP request shapes — always
read the shape from it rather than recalling one. You supply the query; it supplies the
envelope.

### Writing the Lucene query
Steps 1 and 3 above apply unchanged: extract the candidate terms first, and probe the
count before trusting results. The **discriminating** rule applies unchanged too: the
query needs the specific subject matter, not the technology area. ODP differs from CQL in
syntax, not in strategy:
- Fielded terms: `inventionTitle:(solar cell)`, `abstractText:(photovoltaic)`
- Assignee: `assigneeEntityName:(Tesla)`
- Boolean: `AND`, `OR`, `NOT`; group with parentheses; phrases in `"double quotes"`
- Classification and date filters travel as separate body parameters, not inside the query
  string — `uspto_api_guide` gives their current names

## Search Refinement
- Too many results (>1,000): add the next discriminating term from your Step 1 list; then a date filter or a narrower classification
- Too few results (<10): try synonyms, remove filters, use the parent CPC class
- Off-topic results: the discriminating term is too broad — replace the category word with the specific subject matter
- Try subsidiary companies: Google → also Alphabet, DeepMind, Waymo
- Try keyword variations: "machine learning" → "neural network", "deep learning"

A **Prior-Art Search** starts broad and narrows. You cannot notice what a too-narrow query
never returned.

## Output
- Save results via `write_patent_results`
- Include: patent number, title, applicant, date, relevance summary
- Use tables for >5 results
- Reference the saved file in your response
