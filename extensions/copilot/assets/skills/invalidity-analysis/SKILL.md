---
name: invalidity-analysis
description: Hunt for invalidating prior art against a granted patent's claims and build an invalidity claim chart — for EPO oppositions, US IPR/PGR, or defending against an assertion. Use when the user wants to challenge or invalidate a patent, received a demand letter or infringement assertion, or asks "can we kill patent X". For clearing your own product use freedom-to-operate; for prior art on your own invention use prior-art; for asserting a patent against a product use infringement-charting.
user-invocable: true
---

# Invalidity Analysis

The adversarial mirror of a prior art search: the target is a granted patent's claims, and the goal is destruction. Search relative to the TARGET's priority date, and prioritize art the examiner never saw.

## Phase 1: Know the Target

1. `get_patent_details` with the publication number → granted claims (independent claims are the targets), description, and classification
2. Confirm it IS granted (kind code B1/B2) and in force: `ops_api_guide` endpoint="family-legal" → `patent_api_request`
3. **Critical date**: the earliest priority date, not the filing date — check the family (`ops_api_guide` endpoint="family-biblio" → `patent_api_request`). ALL invalidating art must predate it.
4. **Prosecution history** (`ops_api_guide` endpoint="register-events" → `patent_api_request`, plus `search_citations` for US applications):
   - Art already of record — a challenge built on already-considered art is much weaker; you want NEW art
   - What was amended or argued to get allowance — the distinguishing feature the applicant relied on is exactly where to aim, and their arguments constrain how broadly they can now construe the claims

## Phase 2: Venue & Window (verify with `search_legal` — never from memory)

- **EPO opposition**: 9 months from grant mention; any ground (novelty, inventive step, added matter, insufficiency)
- **US IPR**: after 9 months post-grant; grounds limited to patents and printed publications under 102/103
- **US PGR**: within 9 months of grant; any ground
- **District court**: any time as a defense; clear-and-convincing standard
Note which of the user's goals fit which venue, and whether the clock has run.

## Phase 3: The Search

Run the **prior-art** skill's broad-to-narrow engine with these overrides:
- Concept table built from the TARGET's independent claim elements (not an invention description)
- Hard date filter: publication before the priority date
- **De-prioritize art of record** (from Phase 1.4) — log it, but the prize is art the examiner never considered
- NPL hits hard here (`search_academic`): printed publications are fully usable in IPR, and examiners rarely searched them
- Check the applicant's own earlier filings and the inventors' own papers — self-collision is common
- Aim at the allowance-winning feature identified in Phase 1.4

## Phase 4: Invalidity Chart

Per target claim, using the **patent-examination** X/Y discipline:

| Target Claim | Ground | Reference(s) | Element Mapping | Strength |
|--------------|--------|--------------|-----------------|----------|
| 1 | §102 / Art. 54 | [new ref] | All elements ✅ (table) | Strong |
| 1 | §103 / Art. 56 | [ref A + ref B] | A: F1-F3, B: F4-F5; motivation: [same field, explicit suggestion] | Moderate |

- §102/Art. 54: ONE reference, every element, arranged as claimed
- §103/Art. 56: name the combination, which reference contributes which element, and a concrete motivation — anticipate the patentee's secondary-considerations rebuttal (commercial success, long-felt need)
- EPO extra grounds worth checking: added matter (Art. 123(2)) — compare granted claims against the application as filed

## Phase 5: Report

Save via `write_patent_results`:
1. **Target summary** — claims, priority date, legal status, prosecution-history findings
2. **Venue assessment** — which challenges are still open, on which grounds
3. **Invalidity charts** — per claim, best grounds first
4. **Reference ranking** — the 3-5 strongest references, flagging which are NEW vs of record
5. **Gaps** — claim elements no found art teaches (the patent's real strength), and what a deeper search should target
6. **Audit trail** (run the audit-report skill — invalidity work gets scrutinized)

## Rules
- ALL art must predate the priority date — state each reference's publication date in the chart
- Always distinguish new art from art of record
- NEVER invent references or stretch a teaching — the other side WILL read the cited passage
- Always close with: "Invalidity assessment for review by patent counsel — not legal advice or a formal opinion."
