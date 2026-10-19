# Fallback Coverage: row fields, dependency wording, worked example

A proprietor under attack retreats to a fallback: a dependent claim, or an amendment drawn from
the description. An invalidity chart that covers the independent claims but not the fallbacks
stops where the litigator's work starts. This file is the field detail for Phase 4 and Phase 4b
of the `invalidity-analysis` skill.

## The Fallback Ladder comes from the writer

The writer computes the ladder in code from the per-claim text that `get_patent_details` recorded
for `challengedPublication`. You do not type the ladder. You chart each rung, or you name it in
`fallbacksNotCharted`. A rung is every dependent claim under an independent claim, directly or
through other dependent claims, in claim order.

If the writer refuses with "fetch the challenged patent's claims with get_patent_details first",
call `get_patent_details` on the challenged publication and save again. If the claims came back
without claim numbers, the writer builds no ladder, refuses nothing, and the report says "claim
numbers could not be established; no Fallback Ladder".

## Dependency wording the writer reads

Read the ladder the same way the writer does, so your rows land on the rungs it expects.

| Language | Single parent | Several parents (a rung under each) |
|----------|---------------|-------------------------------------|
| EN | "according to claim 1", "as claimed in claim 1", "of claim 2" | "according to any one of claims 1 to 3", "as claimed in claim 1 or 2" |
| DE | "nach Anspruch 1", "gemäß Anspruch 1" | "nach einem der Ansprüche 1 bis 3", "nach Anspruch 1 oder 2" |
| FR | "selon la revendication 1" | "selon l'une des revendications 1 à 3", "selon la revendication 1 ou 2" |

A claim with no such reference is independent. A claim that refers to an independent claim of
another category ("Use of the holder according to claim 1") is still a rung of that claim.
Chart it or name it in `fallbacksNotCharted` with the reason.

## Row fields

All rows go in `coverage` of the `write_patent_results` save, `template: 'invalidity-claim-chart'`.

**Dependent-claim fallback row**

| Field | Value |
|-------|-------|
| `kind` | `'fallback'` |
| `claimNumber` | the dependent claim, e.g. `"3"` |
| `fallbackOf` | the independent claim it falls back from, e.g. `"1"` |
| `feature` | the rung and ONLY its added limitation: `"Claim 3 (depends on 1) — added limitation: …"` |
| `status`, `sourceAnchors`, `evidence`, `elements`, `gap`, `importance` | as on a `feature` row. `elements` are literal fragments of the PRIOR ART; the anchors cite the prior art. |

The report prints the claim's own text from the ledger beside the row, so `feature` names the
limitation; it does not restate the claim.

**Description fallback row** (optional; never required for a save)

| Field | Value |
|-------|-------|
| `kind` | `'fallback'` |
| `claimNumber` | omitted |
| `fallbackOf` | the independent claim the amendment would narrow |
| `basis` | `{ anchor, quote }`: an anchor of the CHALLENGED patent's description and a verbatim quote of it. The writer validates the quote like an evidence quote. |
| other fields | as on a dependent-claim fallback row |

Propose a description fallback only when the description gives a concrete feature a proprietor
could add to the claim. The basis quote is what keeps the proposal honest.

**`fallbacksNotCharted`**: `{ claimNumber, reason }` for each rung you leave out. Give a reason a
practitioner accepts, e.g. "claim 9 is a use claim outside the attack".

**`rounds`**: one entry per Search Round:
`{ round, targets, answers, queries: [{ tool, query, count }], outcome }`. `answers` are the ids of
the open points of the previous receipt that the expert chose (e.g. `["rung-3", "search-1"]`); the
writer refuses a new round whose `answers` name none of them. `targets` are claim numbers or
the `feature` of a description fallback. Copy each `query` exactly as you ran it: the writer
matches it to a tool execution in the ledger (tool name and query text, whitespace normalised)
and refuses the save on a mismatch. The ledger records `search_patents`, `search_register`, `patstat_*`, `patent_api_request`, `fetch_webpage` and `run_in_terminal` calls; the writer confirms those queries against it. NPL and academic queries (`search_npl`, `search_academic`) are listed in the round too and the chart marks them 'not recorded by the ledger'. Every round must contain at least one query through a recorded tool, exactly as run, or the writer refuses the save.
`outcome` says what the round changed, in chart wording:
"disclosed in the cited art", "partially disclosed", "not found in the cited art".

**Wording**: `feature`, `gap`, `reason` and `outcome` use the chart's words only. They carry no
X or Y tag and no anticipation or obviousness statement; that judgment stays in your prose.

**`criticalDate`**: the critical date as `YYYY-MM-DD`. Keep the basis in `objective`. Without it,
the receipt says the publication dates of the cited documents were not checked.

**Web page text**: when the tools hold no text for a cited document, the Google Patents page
fetched with `fetch_webpage` is recorded as web text under the anchors the tool note lists
(`<PUB>:description`, `<PUB>:claims` where the page has those sections). Cite those anchors like any other; the writer checks the fragment against the page text
and refuses a fragment the page does not hold. The row carries the label "Source: web page
(<host>), not official full text" and the receipt lists `source-<PUB>`. Official text wins: a web
anchor cited while the tools hold that section's text is refused with the official anchor.

## Open points and the Round Report

The receipt lists the open points of the saved chart, one line each, in a fixed order. The writer
computes them from the record. The ids stay the same across saves of one chart.

| Id | Open point |
|----|------------|
| `rung-3`, `rung-d1` | a rung partly disclosed or not found (`d1` = the first description fallback) |
| `element-1.2` | the second element row of claim 1 is not found in the cited art |
| `scope-XX0000004A` | a cited document outside the searched jurisdictions |
| `date-XX0000005A` | a cited document published after `criticalDate`, or with no recorded date |
| `drawing-1.1` | a row that rests on a drawing reading, not on quoted text |
| `source-XX0000004A` | a row that rests on web page text of that document (a fetched patent page), not official full text; recommend that the expert confirms it against the official full text or a certified copy |
| `search-1` | a search that failed and did not run again |

The Round Report numbers them in receipt order. Each question names the id and gives your
recommended next step: the terms, office or source you would search, or "accept as not covered".
It ends with the line "Reply with the ids to run (for example rung-3, element-1.3), 'all', or your own steer." Then the turn ends.
The question number is a reading aid. The expert answers with the ids.
If the expert gives a steer of their own, name in `answers` the open points the steer is about.

If the expert answers with bare numbers (for example "2, 6"), do not run a round. Question
numbers and claim numbers share the same small integers, and a rung is named by a claim number
(`rung-3` is claim 3, which can be question 2). Ask one short question: "Do you mean the question
numbers or the claim numbers?" Run the round only when the expert confirms.

## Running a Search Round on the expert's answer

1. **Echo the mapping** in one line before any search: "Running: [rung-3] four-drum alternating
   rotation; [element-1.3] deposit region of the inner pair." Each id with the limitation it
   stands for. A wrong reading is then visible before the round costs anything.
2. New **Discriminating Terms** for the limitation of each chosen point (not the terms of the
   independent claim). Run them after the receipt: the writer refuses a new round whose queries
   all ran before the previous save, so do not list Phase 3 queries as the round.
3. The search-failure ladder of the skill, in order: reformulate, other office, NPL
   (`search_npl`, then `search_academic`), web. Search only for the points the expert chose.
4. Chart what the round found on those rows, and add the round to `rounds` with `answers` (the
   chosen ids), `targets`, every query exactly as run, and an `outcome`.
5. Save again. If the writer refuses a round query as matching no execution, correct the query
   text to the exact text you ran, or drop that query, and save again. Never re-run a search only
   to make a query match. Then write the next Round Report.

## Status and coverage

| Row `status` | Chart wording | Fallback Coverage |
|--------------|---------------|-------------------|
| supported | disclosed in the cited art | covered |
| partial | partially disclosed | partly covered |
| unresolved | not found in the cited art | not covered |

The writer counts the coverage line per independent claim from the statuses:
"Claim 1: 4 of 4 elements disclosed; fallbacks: 2 of 4 covered (1 partly); not covered: claim 4".

## Worked example (SYNTHETIC)

The patent, the claims and the prior art below are invented to show the shape. `XX` is not an
office code. Never cite these numbers as real documents.

**Challenged patent** `XX0000001B1`, a bicycle bottle holder. Claims as `get_patent_details`
returned them:

1. A bottle holder for a bicycle frame, comprising a base plate with two mounting holes and a
   cage formed of a single bent wire attached to the base plate.
2. The holder according to claim 1, wherein the wire is of titanium.
3. The holder according to claim 1 or 2, wherein the cage has a side opening for lateral
   insertion of the bottle.
4. The holder according to claim 3, wherein a resilient tab at the side opening retains the
   bottle.
5. Use of the holder according to claim 1 on a frame tube of carbon fibre.

The writer's ladder for claim 1: claim 2; claim 3 (refers to 1 or 2, one rung under claim 1); claim 4 (via 3); claim 5.
The description states at `XX0000001B1:description:en`: "the base plate is bonded to the wire by
a polymer overmould".

**First save** (elided to the fallback part):

```json
{
	"template": "invalidity-claim-chart",
	"challengedPublication": "XX0000001B1",
	"criticalDate": "2009-05-04",
	"coverage": [
		{ "kind": "fallback", "claimNumber": "2", "fallbackOf": "1",
		  "feature": "Claim 2 (depends on 1) — added limitation: titanium wire",
		  "status": "supported", "sourceAnchors": ["XX0000002A1:claims:4:en"],
		  "elements": [{ "element": "titanium wire", "anchor": "XX0000002A1:claims:4:en", "disclosedBy": "the cage wire is made of titanium" }],
		  "gap": "", "importance": "optional" },
		{ "kind": "fallback", "claimNumber": "3", "fallbackOf": "1",
		  "feature": "Claim 3 (depends on 1 or 2) — added limitation: side opening for lateral insertion",
		  "status": "unresolved", "sourceAnchors": [], "elements": [],
		  "gap": "No cited document shows a side opening.", "importance": "optional" },
		{ "kind": "fallback", "claimNumber": "4", "fallbackOf": "1",
		  "feature": "Claim 4 (depends on 3) — added limitation: resilient retaining tab at the side opening",
		  "status": "unresolved", "sourceAnchors": [], "elements": [],
		  "gap": "No cited document shows a retaining tab.", "importance": "optional" },
		{ "kind": "fallback", "fallbackOf": "1",
		  "feature": "Description fallback — added limitation: polymer overmould bonding plate to wire",
		  "basis": { "anchor": "XX0000001B1:description:en", "quote": "the base plate is bonded to the wire by a polymer overmould" },
		  "status": "partial", "sourceAnchors": ["XX0000003A:description:en"],
		  "elements": [{ "element": "plate bonded to wire", "anchor": "XX0000003A:description:en", "disclosedBy": "the wire is fixed to the plate with adhesive" }],
		  "gap": "Bonding is disclosed; an overmould is not.", "importance": "optional" }
	],
	"fallbacksNotCharted": [{ "claimNumber": "5", "reason": "claim 5 is a use claim outside the attack" }]
}
```

Receipt (the open points, elided to the rungs):

```
… fallbacksNotCovered=2 rounds=0 notCovered=3,4
Open points: 3. Critical date: 2009-05-04. Write the Round Report now: …
Open point [rung-3]: Claim 3 (fallback of claim 1) is not found in the cited art: Claim 3 (depends on 1 or 2) — added limitation: side opening for lateral insertion
Open point [rung-4]: Claim 4 (fallback of claim 1) is not found in the cited art: Claim 4 (depends on 3) — added limitation: resilient retaining tab at the side opening
Open point [rung-d1]: Description fallback of claim 1 is partly disclosed in the cited art: Description fallback — added limitation: polymer overmould bonding plate to wire
```

**The Round Report**, then the turn ends:

> Saved. Fallbacks: 1 of 4 covered (1 partly); not covered: claims 3, 4.
> 1. [rung-3] No cited document shows a side opening. Recommended: search "side entry" and "lateral insertion" cages, then cycling NPL.
> 2. [rung-4] No cited document shows a retaining tab. Recommended: search "retaining tab" with the side-opening terms.
> 3. [rung-d1] Bonding is disclosed, an overmould is not. Recommended: search overmoulded wire-to-plate joints in B62J.
>
> Reply with the ids to run (for example rung-3, element-1.3), 'all', or your own steer.

The expert answers "rung-3, rung-4". The agent echoes the mapping before the first search:

> Running: [rung-3] side opening for lateral insertion; [rung-4] resilient retaining tab at the side opening.

**The Search Round**, aimed at claims 3 and 4 only. New Discriminating Terms for the added
limitations: "side entry", "lateral insertion", "retaining tab", "side-loading cage". The
search-failure ladder in order: reformulate in `search_patents`, the other office through
`patent_api_request`, then `search_npl`, then the web. Claim 3 is found in a dated product review
(`XX-NPL-1`); claim 4 is still not found.

**Second save**: the claim 3 row becomes `supported` with the NPL anchors, and the chart gains:

```json
"rounds": [{
	"round": 1,
	"targets": ["3", "4"],
	"answers": ["rung-3", "rung-4"],
	"queries": [
		{ "tool": "search_patents", "query": "bottle cage side entry lateral insertion wire", "count": 14 },
		{ "tool": "patent_api_request", "query": "ti=\"side loading\" and ti=bottle", "count": 3 },
		{ "tool": "search_npl", "query": "side-loading bottle cage retaining tab", "count": 6 }
	],
	"outcome": "Claim 3 disclosed in the cited art (XX-NPL-1). Claim 4 not found in the cited art."
}]
```

Receipt: `fallbacksNotCovered=1 rounds=1 notCovered=4`, with open points `rung-4` and `rung-d1`.
Write a new Round Report and wait. When the expert says stop, the report's "Open points after the
last round" section says: "Claim 4 (resilient retaining tab): not covered after one Search Round.
Queries run: the three in round 1. A deeper search would target side-loading cages in product
catalogues before the critical date. The description fallback was not run, on the expert's
choice."
