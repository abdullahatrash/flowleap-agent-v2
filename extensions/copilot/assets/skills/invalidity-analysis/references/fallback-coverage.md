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
`{ round, targets, queries: [{ tool, query, count }], outcome }`. `targets` are claim numbers or
the `feature` of a description fallback. Copy each `query` exactly as you ran it: the writer
matches it to a tool execution in the ledger (tool name and query text, whitespace normalised)
and refuses the save on a mismatch. The ledger records `search_patents`, `search_register`, `patstat_*`, `patent_api_request`, `fetch_webpage` and `run_in_terminal` calls; the writer confirms those queries against it. NPL and academic queries (`search_npl`, `search_academic`) are listed in the round too and the chart marks them 'not recorded by the ledger'. Every round must contain at least one query through a recorded tool, exactly as run, or the writer refuses the save.
`outcome` says what the round changed, in chart wording:
"disclosed in the cited art", "partially disclosed", "not found in the cited art".

**Wording**: `feature`, `gap`, `reason` and `outcome` use the chart's words only. They carry no
X or Y tag and no anticipation or obviousness statement; that judgment stays in your prose.

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

Receipt: `fallbacksNotCovered=2 rounds=0 notCovered=3,4`.

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
	"queries": [
		{ "tool": "search_patents", "query": "bottle cage side entry lateral insertion wire", "count": 14 },
		{ "tool": "patent_api_request", "query": "ti=\"side loading\" and ti=bottle", "count": 3 },
		{ "tool": "search_npl", "query": "side-loading bottle cage retaining tab", "count": 6 }
	],
	"outcome": "Claim 3 disclosed in the cited art (XX-NPL-1). Claim 4 not found in the cited art."
}]
```

Receipt: `fallbacksNotCovered=1 rounds=1 notCovered=4`. Stop searching. The report's "Not
covered after the Search Round" section says: "Claim 4 (resilient retaining tab): not covered
after one Search Round. Queries run: the three in round 1. A deeper search would target
side-loading cages in product catalogues before the critical date."
