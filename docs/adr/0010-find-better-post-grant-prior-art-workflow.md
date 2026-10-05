# Find Better: post-grant prior-art discovery is a named workflow with a code-computed Examiner Baseline

**Status:** accepted (2026-10-05)

An experienced EPO patent professional sent a private proposal (2026-10-05) for a tool that
starts from a **granted patent**, collects the prior art every office cited across the whole
**Patent Family**, and then digs for earlier or closer disclosures the examiners never saw. The
bundled `invalidity-analysis` skill already de-prioritises art of record and hints at inventor
self-collision, but it has no per-office record of what was cited, no systematic expansion, and
no honest way to say "nothing better exists". We decide to build **Find Better** as a named
workflow and deliverable of its own, with its factual core computed in code.

## The decisions

1. **Find Better is its own deliverable, between Prior-Art Search and Invalidity Analysis.**
   Input is a granted patent; output is, per independent claim, the examiner's best art beside
   the best art Find Better found, with an element-count comparison. It asks "is there better art
   than the offices found?" and nothing about venue, grounds or claim construction. An Invalidity
   Analysis may start from a Find Better report; a Find Better report never contains invalidity
   conclusions. Rejected: folding it into `invalidity-analysis` as a phase (the discovery result
   is useful to patentees, licensees and examiners who are not attacking anything) and a separate
   service outside the app (it needs the same tools, skills and working record).
2. **The Examiner Baseline is computed in code, never typed by the model.** A CLI verb
   (`flowleap patent examiner-baseline <publication>`) walks the family, reads each member's
   `references-cited` from EPO OPS (examiner versus applicant, X/Y/A category, cited claims,
   passages) and the USPTO enriched citations, and prints one matrix: cited document × office,
   with "cited by none" as the visible remainder. The skill reads that matrix; it does not
   reconstruct it from prose. This is the **Verified-Data Contract** applied to citations.
   Rejected: letting the model gather citations tool call by tool call (it drops members, merges
   offices and cannot say what was absent).
3. **The score is an element count from the structured chart, and "nothing better" is a valid
   result.** The per-claim comparison comes from coverage rows the writer validates (quotes
   checked, second read), rendered as "disclosed n of m elements", with the examiner's best art
   scored on the same rows. There is no model-rated similarity or significance score. A run that
   finds no uncited art still produces the full Baseline and the search log; it is not a failure.
   Rejected: a "Find Better Score" as a model judgement (the fabrication mode fixed in #174/#175
   would return under a new name).
4. **Three expansion tracks are mandatory and logged.** Backward citations of the cited documents
   (two hops from every X or Y reference); other patents and papers by the target's inventors and
   by the inventors and NPL authors of the cited documents; documents in the classifications
   shared by the target and its key citations, combined with the claim's **Discriminating Terms**.
   Each track records its queries and counts in the working record, including empty ones, so a
   reviewer sees what was not searched.
5. **It runs on both chat surfaces from the same core.** The Baseline verb and the skill serve the
   Agents Window (CLI and MCP) and the editor Patent Agent chat (typed tools, validated chart
   writer). Rejected: building it only in the Agents Window (it would lose the quote-validated
   chart) or only in the editor (it would be invisible to hosted and CLI users).

## Consequences

- A new report template beside `invalidity-claim-chart`, with an "examiner's best art" column
  and the Baseline matrix as a section. The invalidity skill's Phase 1.4 ("art of record") is
  replaced by reading a Find Better Baseline.
- CN, JP and KR members contribute citations and English abstracts only; element mapping against
  them is not possible until full text exists for those offices. The Baseline must show that gap
  as a gap, never as "nothing cited".
- The same proposal's second idea, an editable Boolean **Search Statement** with an "Open in
  Espacenet" hand-off, is a presentation change to the existing concept tables and needs no ADR.
- The idea came as a private proposal. No public credit, case study or release note names its
  author without their written consent.
