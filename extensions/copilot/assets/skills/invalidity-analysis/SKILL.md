---
name: invalidity-analysis
description: Prior art against a granted patent's claims, assembled into an invalidity chart for EPO opposition, US IPR or PGR, or a defence. Use when the user wants to challenge or invalidate a patent, or received a demand letter or infringement assertion. To clear your own product use freedom-to-operate; for art on your own invention use prior-art; to assert a patent use infringement-charting.
user-invocable: true
---

# Invalidity Analysis

The adversarial mirror of a prior art search: the target is a granted patent's claims, and the goal is destruction. Search relative to the TARGET's priority date, and prioritize art the examiner never saw.

## Phase 1: Know the Target

1. `get_patent_details` with the publication number → granted claims (independent claims are the targets), description, and classification
2. Confirm it IS granted (kind code B1/B2) and in force: `ops_api_guide` endpoint="family-legal" → `patent_api_request`
3. **Critical date**: the earliest priority date, not the filing date — check the family (`ops_api_guide` endpoint="family-biblio" → `patent_api_request`). ALL invalidating art must predate it.
   - **Attack the priority claim itself**: priority entitlement is challengeable per claim. If the priority document doesn't fully support a claim, that claim's critical date shifts to the actual filing date — opening intervening art, often including the patentee's own publications. Compare the claim against the priority document's disclosure.
4. **Prosecution history** (`ops_api_guide` endpoint="register-events" → `patent_api_request`, plus `search_citations` keyed on the target's US **application** number — the references cited AGAINST it; resolve the application number via `get_patent_family` → `get_continuity` if you only have the publication number. For who-cites-the-target-forward that's `search_forward_citations` instead):
   - Art already of record — a challenge built on already-considered art is much weaker; you want NEW art
   - What was amended or argued to get allowance — the distinguishing feature the applicant relied on is exactly where to aim, and their arguments constrain how broadly they can now construe the claims

## Phase 2: Venue & Window (verify with `search_legal` — never from memory)

- **EPO opposition**: 9 months from grant mention; any ground (novelty, inventive step, added matter, insufficiency)
- **US IPR**: after 9 months post-grant; grounds limited to patents and printed publications under 102/103. **35 U.S.C. 315(b) time bar**: an IPR petition is BARRED more than one year after the petitioner (or a privy) was served with an infringement complaint — for a user holding a demand letter or complaint, check this clock FIRST.
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

## When a search fails

Prior art rarely sits in one office — before concluding the art isn't there, work the ladder in order:
1. **Clean zero result** (call succeeded, no hits): reformulate before concluding — rebuild the concept table from other claim elements, broaden or narrow the CPC/IPC, drop a filter, try a different number format — then try the alternate office/route (`search_patents` ↔ `patent_api_request`, `get_patent_summary` when `get_patent_details` is empty) and the NPL sweep (`search_academic`). A clean zero on the killer element is not "no invalidating art" until searched every way.
2. **Search error** (5xx, gateway timeout, connection reset, truncated response): transient outage, not a coverage limit — back off and retry the same call, then switch office. NEVER report a gap in the art from an errored call.
3. **Route exhausted** (both offices genuinely dry): fall back to the web — `fetch_webpage` is always available (even when `web_search` is not) against `patents.google.com/patent/NUMBER` or `freepatentsonline.com`; quote only text the page returned and spot-check the number and title.

Record an element as un-anticipated (the patent's real strength) only after all three — and, on a structural target, only after reading the figures of the closest reference (`get_patent_figures` with `saveDir: "references/figures"`, so the cited page is on disk beside the chart, per the `figure-analysis` skill), recording any figure reading on the element it discloses with the `PUB:figure:N` anchor, `basis: "figure"` and a `reading` — the writer refuses an essential element left un-anticipated until a drawing was read this session, or until the row's `gap` carries the phrase `figures not consulted:` followed by the reason a drawing cannot settle it — and name what you tried.

## Phase 4: Invalidity Chart

Per target claim, using the **patent-examination** X/Y discipline. Construction standard: this is a GRANTED patent — use the *Phillips* ordinary-meaning standard (PTAB and district courts; NOT examination-style broadest reasonable interpretation, which overstates invalidity), and let the prosecution-history arguments from Phase 1.4 narrow it further:

| Target Claim | Ground | Reference(s) | Element Mapping | Strength |
|--------------|--------|--------------|-----------------|----------|
| 1 | §102 / Art. 54 | [new ref] | All elements ✅ (table) | Strong |
| 1 | §103 / Art. 56 | [ref A + ref B] | A: F1-F3, B: F4-F5; motivation: [same field, explicit suggestion] | Moderate |

- §102/Art. 54: ONE reference, every element, arranged as claimed
- §103/Art. 56: name the combination, which reference contributes which element, and a concrete motivation — anticipate the patentee's secondary-considerations rebuttal (commercial success, long-felt need)
- EPO extra grounds worth checking: added matter (Art. 123(2)) — compare granted claims against the application as filed

## Phase 5: Report

Save via `write_patent_results` (`template: 'invalidity-claim-chart'`). Save it **structured**: leave `content` empty and supply `coverage`, so the writer validates the quotes, renders the chart and writes the evidence companion.
- One row per element of each independent claim — `feature: "Claim 1 — element (b): …"`, `claimNumber: "1"`, `kind: 'feature'` — plus one `kind: 'combination'` row per independent claim (`"Claim 1 as a whole"`).
- `elements` carry literal fragments copied from the **prior art's** claims or description, and `sourceAnchors`/`evidence` cite those prior-art passages, never the challenged patent.
- Set `challengedPublication` to the target patent, and put the critical-date basis in `objective`.
- `status` stays supported / partial / unresolved; the chart renders them as disclosed / partially disclosed / not found in the cited art, and derives a reference-roles table from them. Your X/Y/A tagging stays your own judgment in the prose above.

The saved chart covers:
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
- Close every deliverable with: "AI-assisted analysis for review by a registered patent attorney — not legal advice."
