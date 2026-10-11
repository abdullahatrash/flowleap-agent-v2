# The three Find Better tracks

All three tracks are mandatory. Log every query and its count in `tracks`,
empty results too, so a reviewer sees what was searched and what was not.
Keep only documents published before the critical date (CQL: `pd<YYYYMMDD`;
academic: check the exact publication date of each hit).

Before you search, mark every document already in the Baseline as "of record".
A candidate is new only when it is not of record.

## Track 1: backward citations, two hops

Start from every document with an X or Y category in the Baseline.

- Hop 1: the references cited by each X/Y document. Get the request shape from
  `ops_api_guide` (endpoint `biblio`), then call `patent_api_request` and read
  the cited references (patents and non-patent citations).
- Hop 2: the same call on every hop-1 document that is not of record and is
  published before the critical date.
- Optional, for a wider net: `patstat_graph` with `operation: "neighborhood"`
  on the X/Y document. A truncated result is capped; narrow it, never read it
  as complete.
- Log: per X/Y document, hop-1 count, hop-2 count, kept count.

## Track 2: inventor and author networks

Inventors come from `get_patent_details` of the target and of each X/Y
patent. Authors come from the X/Y non-patent documents.

- Patents by an inventor: `search_patents` with
  `in="<SURNAME GIVEN>" AND pd<<critical-date>`.
- The target's own inventors are the first names to run: their earlier
  publications are a frequent source of self-collision.
- PATSTAT inventor nodes do not expand: a person node gives "entity not
  found". Use the CQL `in=` query above for inventors. Only where an inventor
  is also an applicant, resolve the entity (`patstat_graph`,
  `operation: "resolve"`) and read its portfolio (`operation: "applicant_view"`
  with the `psnId` from resolve). A name that does not resolve is a log line
  ("did not resolve"), not an error.
- Papers: `search_academic` with `"<author name> <discriminating term>"`.
  Academic search has no author field: check the author list of each hit.
- Log: per name, each query and its count.

## Track 3: classification co-occurrence

Collect the CPC codes (from `get_patent_details`) of the target and of each
X/Y document, including the 2000-series **indexing codes** (e.g.
`F15B2211/7053`). Use the codes that the target shares with at least one X/Y
document.

- `search_patents` with
  `cpc=<code> AND (ta=<term> OR ta=<synonym>) AND pd<<critical-date>`.
- A classification code is never discriminating. Every query carries at least
  one Discriminating Term from Step 2 (method and count probe: the
  `patent-search` skill).
- Probe the count first. Over about 1,000: add the next Discriminating Term.
  Under 10: drop to the CPC main group or OR in synonyms.
- Example (EP2743895B1): `cpc=E05G1/026 AND ta=lock AND ta=door AND
  pd<20121217` gave 63.
- US-only documents: write a Lucene query (`uspto_api_guide`) and run it with
  `patent_api_request`, with the same date limit.
- Log: per code, each query and its count.

### Indexing-code combinations (mandatory when the target has indexing codes)

Indexing codes describe features independent of wording. Run the main group
AND each combination of 2-3 indexing codes that the target shares with the
examiner's documents, with the date limit and no terms, e.g.
`cpc=F15B7/006 AND cpc=F15B2211/7053 AND cpc=F15B2211/785 AND pd<20230810`
(45 hits, probed live 2026-10-11; it holds three of the four ISR documents of
WO2025031952A1, one as a CA family member). Log each combination with its
count and read every title.

### Reading a result set

Results come back newest first, not by relevance, 25 per call by default and
at most 100. Read every title of a set you rely on by paging `range`
(`1-100`, `101-200`, ...), or narrow the query until you can. Never judge a
set from its first page. OPS returns one publication per family: match a hit
to a Baseline document by family, not by number.

### Recall check

After Track 3, count how many Baseline documents (X, Y and A, by family) its
queries returned, and log "Track 3 retrieved n of m Baseline documents". When
the examiners' own art is missing from the classification sets, the queries
are too narrow for new art too: add the missing documents' indexing codes or
synonyms and run again before you trust a "no better art found".

### Term-drop pass (mandatory)

One query with two or more terms is over-specified: a reference that says
"speed warning" instead of "limit" is not in its hits. After the first
classification query, do these steps for each code:

1. Run the query again once for each term, with only that ONE term removed.
   Keep the code and the date limit.
2. If the first query gave 200 hits or fewer, also run the code with the date
   limit alone (`cpc=<code> AND pd<<critical-date>`).
3. Log every variant with its count, 0 included.
4. Read the titles of the top hits of every variant, published before the
   critical date. Pull each title that matches a claim element.

Example (US6778074B1, critical date 2002-03-18), counts probed live on
2026-10-06. The first query `cpc=G01P1/10 AND ta=speedometer AND ta=limit AND
pd<20020318` gave 15 and missed both IPR references. Without `ta=limit`,
`cpc=G01P1/10 AND ta=speedometer AND pd<20020318` (54) has Evans US3980041
("Speedometer with speed warning indicator and method of providing the
same"). Without `ta=speedometer`, `cpc=G01P1/10 AND ta=limit AND
pd<20020318` gave 56. The claim phrase `cpc=G01P1/10 AND ta="speed limit" AND
pd<20020318` (36) has Wendt US2711153 ("Automobile speed limit indicator").
The classification with the date limit alone, `cpc=G01P1/10 AND
pd<20020318`, gave 843.

### Title-phrase query (old art)

OPS has no abstract for many US documents published before 2000, so `ta=`
finds them only by their title words. For each Discriminating Term, run one
query on a two-word phrase from the claim:
`ti="<two-word phrase>" AND pd<<critical-date>`, with no classification.
Example: `ti="speed limit indicator" AND pd<20020318` (10) has Wendt
US2711153, which has no abstract in OPS. Log each query and its count.

## Pull the candidates

For each candidate that maps to at least one claim element, read its claims
and description with `get_patent_details`. If a call fails, retry once, then
log the candidate as "not read" with the reason. Never score a document you
did not read.
