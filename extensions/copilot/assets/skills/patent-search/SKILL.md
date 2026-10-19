---
name: patent-search
description: Search EPO OPS for EP and WO and USPTO Open Data for US: query building, execution and refinement. Use when the user wants to find patents by topic, applicant or classification, or asks to turn a claim or an invention into a search statement or a query to run in Espacenet. For a documented prior-art hunt use prior-art; for filing statistics use patent-landscape.
user-invocable: true
---

# Patent Search

Find patents by topic, applicant or classification, and turn a claim or an invention into a
query. This file holds the method only. The query grammar lives with the backend that runs the
search: `get_search_syntax` serves it, and `search_patents` ends each result with the next step
its count calls for.

## Steps

1. **Fix the scope.** Apply the jurisdiction gate from the system prompt: EP/WO through
   `search_patents`; US through `uspto_api_guide`, then `patent_api_request`; both when the task
   needs comprehensive coverage. Done when the offices, the date bound and every user constraint
   are written down before the first query.

2. **Extract the terms.** List every specific noun phrase in the description: materials,
   mechanisms, subject matter. For each one you leave out of the query, state why. Done when the
   list holds at least one discriminating term: a term that separates this invention from the
   generic patents of its area. A classification code or a category word ("sensor", "artificial
   intelligence") is never discriminating. For "thing A applied to domain B", the pair is the
   discriminating term: keep both.

3. **Write the query.** A query of one applicant or title term needs no preparation. Before a
   query with other fields, grouping or wildcards, read the grammar once per session with
   `get_search_syntax` (provider epo_ops, or uspto); do not guess a field name. Spend terms on discrimination, not
   coverage: two precise title-or-abstract terms beat five vague ones. Uncertain phrasing
   ("glass ceramic" or "glass-ceramic") is a reason to OR both forms, never to drop the term.
   When the invention spans classes, OR the classes together. To find the codes in use for a
   concept, run `patstat_api_guide` with action section and section examples, and reuse the
   verified queries concept_to_cpc_codes and cpc_candidate_codes; do not type codes from
   memory, CPC is revised every quarter. Done when every field in the query is in the grammar and the query
   holds a discriminating term.

4. **Probe the count.** Run the query with a small range and read the total and the
   `Next step` line of the result. Over about 1,000 hits: add the next discriminating term from
   your list. Under 10: read the hits before you widen. Use the same `countries` value for the
   probe and for the search it serves. Done when the count is one you would read in full.

5. **Read the set, then stop.** Page `range` through the whole set, or narrow until one page
   holds it; never judge a set from its first page. The same terms in another order are the
   same query: do not run it twice. After a transient backend error, retry the same query at
   most once. Stop when new variants repeat reviewed documents without new evidence; an
   unresolved feature justifies another track, a query count does not. Done when each
   unresolved feature has a track or a stated gap.

6. **Deliver.** When the user asked for a search statement, or will run the query themselves,
   show the Search Statement block from `references/search-statement.md`. Otherwise save the
   results with `write_patent_results` (a prior-art candidate review follows the `prior-art`
   skill), keep the execution records the tools emit, and name the saved file in the answer.
   Done when every number in the answer traces to a tool result.
