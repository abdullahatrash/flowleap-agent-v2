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
X/Y document. Use the codes that the target shares with at least one X/Y
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

## Pull the candidates

For each candidate that maps to at least one claim element, read its claims
and description with `get_patent_details`. If a call fails, retry once, then
log the candidate as "not read" with the reason. Never score a document you
did not read.
