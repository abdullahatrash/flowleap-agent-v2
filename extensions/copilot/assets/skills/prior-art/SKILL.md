---
name: prior-art
description: Multi-jurisdiction prior-art search on the USPTO broad-to-narrow method, with concept-synonym tables, classification mapping and a full audit trail. Use when the user wants prior art for an invention, a patentability or novelty search, or asks whether an idea is new. For a quick lookup use patent-search; to assess retrieved passages against claim text use patent-examination.
user-invocable: true
---

# Prior Art Search

Systematic prior art search within the user-confirmed jurisdictions, sources, and date basis. Separate a focused candidate review from a patentability opinion; provide the requested depth and record unsearched coverage.

For CPC/IPC section tables, common codes, and classification search syntax, see [references/cpc-classification.md](references/cpc-classification.md).

## Phase 1: Invention Analysis (USPTO 3-Sentence Technique)

### 1a. Three-Sentence Description
Describe the invention three different ways (ask the user, or derive from their description): 1. structure/components, 2. function/use case, 3. novelty/differentiation. Review all three for **repeated words and phrases** — these are the core concepts. If the user is describing THEIR OWN invention, decompose it yourself with the `claim-analysis` skill (Step 3b) — it turns the claim into keywords, synonyms and classification codes. Preserve the disclosure’s essential features, optional embodiments, and relationships between components; distinguish inventor assertions from verified source evidence.

### 1b. Feature Coverage
Build a coverage record before searching. For each essential or optional feature and each important interaction/combination, record: `feature`, its required `elements` (each constituent the feature needs), `importance`, `status`, `sourceAnchors`, and `gap`. Start at `unresolved`; update only after inspecting source evidence. Separate findings about individual components do not establish disclosure of their combination.

Assign search tracks to unresolved essentials, interactions, alternative mechanisms, terminology, and relevant adjacent fields. Adapt these tracks to the invention: software data flow, mechanical component relationships, electronic timing, and chemical composition/process conditions need different evidence. Completion means each important track has supporting passages or an explicit remaining gap, not that every feature has a matching patent.

### 1c. Concept-Synonym Table (MANDATORY)
Build a table of every concept with synonyms, technical equivalents, and related terms:

| Concept | Synonyms & Variations |
|---------|----------------------|
| [Primary concept] | [synonym1], [synonym2], [technical term] |

Use dictionaries, technical manuals, and `web_search` (when available) to discover terms. Aim for **at least 3 variations per concept**.

Build one row **per claim element**, not per invention. Each row holds the claim's own word, the structural equivalents another drafter would use, and the functional words for what the element does. Older art and other offices describe the same part differently, and a document that uses none of your words is invisible to every keyword query. Example (hydraulic actuator, EP4758353A1): pump: bidirectional, reversible, tiltable, over-centre, four-quadrant; chamber: cap side, rod side, piston side, annulus; line: flow path, passage, conduit, channel; pressure reservoir: accumulator, tank, pressure compensator; bypass: discharge, makeup, regeneration, anti-cavitation. Within one element, OR the row (`ta any "..."` or `ta=a OR ta=b`); never let one element's word stand in for the whole invention. OPS `ta=` matches the English title and abstract, so English synonyms come first; add German (or French) terms when the scope includes DE (or FR) documents that may carry only original-language text.

### 1d. Classification Mapping
Identify **2-3 CPC/IPC codes** covering the invention (see [references/cpc-classification.md](references/cpc-classification.md)). Note both broad parent codes and specific subgroups.

When the subject is a published document, read its full CPC list from `get_patent_details`, including the **indexing codes** (the 2000-series subgroups, e.g. `F15B2211/7053`, `F15B2211/785`). Indexing codes describe the features themselves (pump type, circuit layout, accumulator, bypass) independent of wording, and OPS `cpc=` searches them. Record which indexing codes map to which claim element; they feed the classification-only track in 2a.

Show the 1c table and these codes to the user as a **Search Statement** block: add a CPC column to the table, then the Boolean statement, the Espacenet link and the Discriminating Term, in the shape of [search-statement.md](../patent-search/references/search-statement.md). Show one block per statement that ran; when the user changes a concept, show the next version.

### 1e. Critical Date & Prior Art Scope
- **Date basis**: preserve the user-confirmed publication cutoff, including whether it is strict or inclusive. Keep a demonstration cutoff separate from an actual priority/filing date; resolve legal eligibility separately when requested.
- **Prior art includes** (per 35 USC 102): patents and published applications (US and foreign); printed publications (journals, manuals, websites); public use or on sale (trade shows, demos, launches); otherwise available to the public (talks, social media, videos)
- Ask the user: was the invention publicly demonstrated, sold, or shown anywhere before filing?
- **Scope confirmation**: when the disclosure or the user asks you to confirm the search scope before searching, ask once with `vscode_askQuestions` before the first query and record the confirmed scope in the report objective. Otherwise do not re-confirm a scope that was stated explicitly.

## Phase 2: Broad-to-Narrow Search (USPTO Core Methodology)

### 2a. Build Search Sets
Start broad, narrow progressively. Use the session execution evidence recorded by tools for exact queries, filters, ranges, totals and returned IDs. Keep a separate record of passages actually inspected; retrieval alone does not establish review. Failed or cancelled calls are not zero-hit results.

Use this planning table, then replace planned sets with the actual execution log:

| Set | Query | Purpose |
|-----|-------|---------|
| X1 | [Primary concept] OR synonyms | Broadest — primary concept |
| X2, X3 | [Other concepts] OR synonyms | Each remaining concept |
| X4 | X1 AND X2 | First narrowing |
| X5 | X4 AND X3 | Second narrowing → reviewable set |

**Primary concept** = the single concept ALL relevant results must contain.

Run at least two independent tracks, so a document missed by one can be caught by another:
- **Keyword track**: the sets above, built from the 1c synonym rows.
- **Classification-only track**: the main group AND combinations of 2-3 indexing codes that map to essential elements, with the date limit and no keywords, e.g. `cpc=F15B7/006 AND cpc=F15B2211/7053 AND cpc=F15B2211/785 AND pd<20230810` (45 hits, probed live 2026-10-11; with `cpc=F15B2211/20561` in place of `/785`, 120). A single code is a neighbourhood; a conjunction of specific indexing codes is a set small enough to read in full, and it finds the documents whose wording the keyword track never matched. Try several combinations; log each with its count.
- **Citation track** (2f): one hop from the closest hits.

**Review the whole set, never page 1.** `search_patents` returns 25 by default and at most 100 per call, ordered by publication date, newest first, not by relevance: older art sits at the end of the list. A set is reviewed when every hit's title (and abstract where the title is unclear) has been read: page through it with `range` `1-100`, `101-200`, ... When the total is too large to read in full (over about 300), narrow the query (next synonym row, another indexing code, a date window) until it is, and log each step. Never judge a set, or record a document as absent, from the first page.

OPS returns **one publication per family**: a hit may be a CA, WO or JP member while the document you know is its US publication (US2013333894A1 comes back as CA2828987A1). Compare documents by family, not by number.

### 2b. EPO OPS (worldwide bibliographic index)
For EP/WO scope, pass `countries="EP,WO"` to `search_patents` or explicitly constrain publication authority in CQL. Record the effective query the backend echoes; the database name alone does not establish an authority filter.
1. Write the CQL from the concept-synonym table — see `patent-search` for the field reference
2. `search_patents` with the CQL → record result count
3. Test different synonym combinations and classification refinements. For each next query, name the unresolved feature or coverage gap it tests, and pass it as `purpose` so the record and the report can name it. When variants repeat reviewed documents without useful new evidence, update coverage and synthesize; continue only for a distinct unresolved essential feature or combination. Record `stopReason` and outstanding tracks. Use neither a universal query cap nor a required number of searches. Update the todo phase when switching to document analysis or writing.
4. For top 3-5 results: `get_patent_details` → full claims and description

### 2c. USPTO (US)
1. Write the ODP Lucene query from the concept-synonym table — see `patent-search`; `uspto_api_guide` gives the body shape
2. `patent_api_request` (POST) with the generated body → record hit counts
3. Run keyword + CPC + assignee variations; filter to before the critical date
4. For endpoint details beyond search: `uspto_api_guide` action="list"

### 2d. Google Patents / WIPO / Asian Offices
Use `web_search` for coverage the APIs miss (if `web_search` is not available on this model, skip this sweep, cover CN/JP/KR via patent-family expansion in 2f, and record the coverage gap in the audit trail):
- Full text: `site:patents.google.com "[phrase]" "[kw2]"` (add CPC code to narrow)
- PCT applications: `site:patentscope.wipo.int "[kw1]" "[kw2]"`
- CN/JP/KR: `site:patents.google.com/patent/CN "[kw1]"` (likewise /JP, /KR) — see the patent-translation skill for the full multi-language strategy

### 2e. Non-Patent Literature (NPL)
Prior art is NOT limited to patents:
1. `search_npl` first: OpenAlex, 250M+ scholarly works (journal articles, proceedings, book chapters, preprints, theses, reports, standards). Reuse the discriminating terms from the concept-synonym table in paper wording, run a variant per essential feature, and set `toYear` to the critical-date year; check each `publicationDate` against the exact date. Narrow with `type` (e.g. `proceedings-article`, `dissertation`, `standard`) when a track calls for it. Record each query and its hit count in the audit trail
2. `search_academic` as a second pass (Semantic Scholar, arXiv) for preprints and CS/physics work; deduplicate against step 1 by DOI or title
3. `web_search` for what neither reaches: product manuals, web disclosures, standards bodies' sites, `site:ieee.org` (if unavailable, steps 1-2 are the NPL sources — note any remaining gap)
4. Read past the abstract via `fetch_webpage` on the open-access URL or DOI before relying on a paper; cite it by authors, title, venue, date and DOI
5. Papers an office already cited (the [NPL] entries of a source or family publication's cited references) are resolved, not searched: `get_patent_details` with `resolveNpl: true` resolves all of them to their OpenAlex record, `get_npl_work` one citation string or DOI. Only a `matched` record is the cited paper

### 2f. Family & Citation Expansion
- **Known source or family patent first**: when the disclosure names a source, parent or family publication (even a post-cutoff one), retrieve it with `get_patent_details` and work its listed cited references before widening the search. For an EP family the citations sit on the A3 search-report publication, not on the A1/A2 or the B1 grant, so retrieve `EPnnnnnnnA3` when the named publication shows none. Record the source publication itself as post-cutoff context, not as a candidate. Documents taken from its cited references are **of record**, not found by your search: keep them apart for the recall check (2g).
- **One hop from the closest hits**: for each of the closest candidates of the keyword and classification tracks, and for each Examiner Baseline document once 2g has it, read its cited references (`get_patent_details`) and its forward citations (`search_forward_citations`). Keep the documents published before the cutoff that share a CPC main group or indexing code with the subject. Citations reach documents that use other words, so this track catches what both query tracks missed.
- Family with biblio in one call: `ops_api_guide` action="endpoint" endpoint="family-biblio" → `patent_api_request`
- Forward citations — "who cites this?": `search_forward_citations` on the publication number → more recent related art
- Backward citations — the references cited AGAINST a patent: `search_citations` keyed on the US **application** number (resolve it via `get_patent_family` → `get_continuity`, not the publication number); follow 2 hops for key nodes

### 2g. Recall Check against the Examiner Baseline
When the subject is a published patent or application, or the disclosure names one, check the search against what the examiners cited **after** the keyword, classification and citation tracks have run:
1. Get the Examiner Baseline with `examiner_baseline` on the publication (it works on any family member, not only a grant). Take every document an examiner cited (X, Y and A categories, ISR and national searches); applicant-cited documents are listed separately.
2. For each Baseline document, check whether its family is in the search set: a document counts as **found** only when a search query returned it or a member of its family (`get_patent_family` gives the members). A `pn=` lookup, or reading the source's own cited references, does not count.
3. For each miss, find out why: compare its CPC codes and abstract wording with your queries (which synonym or indexing code it carries that the queries lacked, or whether it sat past the page you read). Run the query that fixes the cause (a synonym row, an indexing-code combination, a citation hop) and log it with its purpose. Repeat until each miss is found by a search or explained (e.g. "classified only in E21B, outside the agreed scope").
4. State the result as **"found n of m examiner-cited documents by search"**, list each miss with its reason, and put it in `searchStrategy`; unexplained misses go in `limitations`. A low recall means the queries are too narrow: say so rather than presenting new candidates as complete.

Then look for art beyond the Baseline, starting from the claim elements the examiner documents do not cover.

For very broad sweeps, `patent_search_subagent` can run the multi-database search autonomously — still document its queries and counts in the audit trail.

## When a search fails

Before handing back or recording a coverage gap in the audit trail, work the ladder in order:
1. **Clean zero result** (call succeeded, no hits): inspect the unresolved track before deciding whether another query is useful. Try a justified synonym, classification or number-format change within the agreed scope. Preserve confirmed dates and jurisdictions. A bounded lookup may finish with zero results and explicit limitations.
2. **Search error** (5xx, gateway timeout, connection reset, truncated response): transient outage, not a coverage limit — back off and retry the same call, then switch office. NEVER record "no results" or "doesn't exist" from an errored call.
3. **Route exhausted** (both offices genuinely dry): fall back to the web — `fetch_webpage` is always available (even when `web_search` is not) against `patents.google.com/patent/NUMBER` or `freepatentsonline.com`; quote only text the page returned and spot-check the number and title.

Apply this ladder within the confirmed scope. Record an intentionally excluded source as not searched, and a focused review as incomplete coverage; neither requires an out-of-scope search. Log operational failures separately, naming what you tried.

## Phase 3: Relevance Assessment

`supported` means every element of the feature is disclosed by a literal fragment of cited text, recorded per element as `anchor` + `disclosedBy`. A passage naming only a broader genus does not disclose a narrower element: cite the narrowing passage, or mark the row `partial` with the missing element named in the gap. Every document you retrieve is either cited in coverage or appears in the report's retrieved-but-not-cited list; read it or say you did not.

On a structural subject — a mechanical device, a mechanism, a layout, a design, not a composition or a process condition — fetch the figures of the closest candidates with `get_patent_figures` and read them per the `figure-analysis` skill before an essential feature is marked `unresolved` on text alone; a composition or formulation case gains nothing from drawings. A figure discloses that an element exists and how the parts are arranged, never a dimension or a ratio unless the drawing is stated to be to scale. Record the reading as evidence on the element it discloses: give that element the `PUB:figure:N` anchor printed by `get_patent_figures`, `basis: "figure"` and a `reading` of what the drawing clearly shows, and no `disclosedBy` — a drawing has no quotable text. The writer marks such a row as resting on a drawing reading, states it in limitations, and the second read does not judge it. A dimension, a proportion or a ratio is not a reading unless the drawing itself is stated to be to scale. The writer refuses to save an essential feature as `unresolved` until a drawing of a retrieved candidate was read this session — fetch it with `saveDir: "references/figures"` so the page cited in a row is on disk beside the report — or the row's `gap` carries the phrase `figures not consulted:` followed by the reason a drawing cannot settle it.

**Review depth.** For every document in the report, record how deeply it was read: `bibliography/abstract only` or `full text read` (claims and description through `get_patent_details`, or figures per the rule above). Map an element to a passage only after a full-text read; an abstract-only document can be named as a candidate, never as supporting a row. State the depth beside each document in the coverage evidence or the retrieved-but-not-cited list.

For each feature, identify its exact supporting passage and scope: independent claim, dependent claim with its dependencies, embodiment, example, or background discussion. Preserve the identity of the recited subject matter, units, denominators and qualifiers exactly as written. A numerical range overlap is partial support; an example or dependent-claim limitation does not become a requirement of the whole publication, and it never narrows the independent claim.

For worked rulings on composition and formulation evidence — narrower terms against a claim's genus, quantity denominators and conversions, exclusion language, and process-step absence — see [references/chemical-composition-evidence.md](references/chemical-composition-evidence.md).

Coverage status is exactly `supported`, `partial` or `unresolved`. A negative finding describes the passages actually reviewed, not the whole technical field. Mark translations as translations and use only claim-specific links supplied by the source tool; if claims are not individually addressable, use the returned claims-section link and name the printed claim number in prose.

For a requested novelty/patentability assessment, apply the **patent-examination** skill to the retrieved evidence. A candidate review does not itself establish a novelty conclusion, and missing results do not establish patentability.

## Phase 4: Report

Save via `write_patent_results` with `template="prior-art-report"` and empty `content`. Supply subject, the confirmed scope/cutoff in objective and searchStrategy (with the tracks run, the review depth used, and the 2g recall result "found n of m examiner-cited documents by search" with each miss and its reason), the `concepts` table from 1c and the `classifications` from 1d, structured `coverage`, `limitations` and `stopReason`, with `kind="feature"` rows and an explicit essential `kind="combination"` row that may honestly remain unresolved. Each supported/partial row lists its `elements` and attaches an `evidence` entry per anchor with the scope/dependency chain, qualifiers and original quantity basis; supply the anchor alone for a numbered claim (the writer copies it) and the exact quotation for a description passage. Where only bibliography or abstract text can be retrieved, record the row as unresolved with a "full text unavailable" gap. The writer renders the assessment; on refinement, update the same report with revised fields.

The save produces two documents: the client report at the path you gave, and a working record beside it at `<report>.working-record.md` holding the full search log including the queries that could not run, the retrieved-but-unread list, the wording review, the provenance and the second read. The report itself ends at its limitations and names the record in one line. A later session on the same matter reads the working record first: it states what was already searched and what was deliberately left. Do not repeat any of it in the workspace `notes.md` — under its headings point to the working record instead.

Review the later description passages for further relevant processing steps before making an absence statement; a missing literal match establishes only that the term was not found in returned text.

Keep gaps and source-review notes honest; weakening a status is not a repair for missing evidence. Open the saved report, audit companion and source links. Formal opinions remain a separate requested deliverable.

## Rules
- NEVER invent patent numbers — only cite what search tools returned
- ALWAYS build the concept-synonym table before searching
- NEVER judge a result set from its first page: read it in full or narrow it until you can
- ALWAYS run the 2g recall check when the subject has an Examiner Baseline, and report "found n of m"
- Consider non-patent prior art (public use, on sale, demos), not just publications
