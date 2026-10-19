---
name: invalidity-analysis
description: Prior art against a granted patent's claims, assembled into an invalidity chart for EPO opposition, US IPR or PGR, or a defence. Use when the user wants to challenge or invalidate a patent, or received a demand letter or infringement assertion. To clear your own product use freedom-to-operate; for art on your own invention use prior-art; to assert a patent use infringement-charting.
user-invocable: true
---

# Invalidity Analysis

The adversarial mirror of a prior art search: the target is a granted patent's claims, and the goal is destruction. Search relative to the TARGET's priority date, and prioritize art the examiner never saw.

**Critical date on every search.** Every search in this skill, the Search Round included, keeps only art published before the critical date (Phase 1.3).

## Phase 1: Know the Target

1. **Fetch the challenged patent first, before any other call**: `get_patent_details` with the publication number → granted claims, segmented by claim number (independent claims are the targets), description, and classification. The writer builds the **Fallback Ladder** (every dependent claim under each independent claim, with the limitation it adds) from this call, and refuses a chart when the ledger holds no per-claim text for the challenged patent. If the claims come back unsegmented, the chart saves with no ladder and the report says so.
2. Confirm it IS granted (kind code B1/B2) and in force: `ops_api_guide` endpoint="family-legal" → `patent_api_request`
3. **Critical date**: the earliest priority date, not the filing date — check the family (`ops_api_guide` endpoint="family-biblio" → `patent_api_request`). ALL invalidating art must predate it.
   - **Attack the priority claim itself**: priority entitlement is challengeable per claim. If the priority document doesn't fully support a claim, that claim's critical date shifts to the actual filing date — opening intervening art, often including the patentee's own publications. Compare the claim against the priority document's disclosure.
4. **Prosecution history** (`ops_api_guide` endpoint="register-events" → `patent_api_request`, plus the **Examiner Baseline** — the art of record for every family member and office. For who-cites-the-target-forward that's `search_forward_citations` instead):
   - Get the Baseline with the `examiner_baseline` tool: it writes `references/<publication>.examiner-baseline.json` and returns that path. Read the file with `read_file`. Without the tool, use `flowleap --json patent examiner-baseline <publication>` in the terminal and save the output to the same path.
   - Any document with an X or Y category is the examiner's art. Each entry in `gaps[]` is a gap in the record, never "nothing cited". See also the `find-better` skill, Step 1.
   - Art already of record — a challenge built on already-considered art is much weaker; you want NEW art
   - What was amended or argued to get allowance — the distinguishing feature the applicant relied on is exactly where to aim, and their arguments constrain how broadly they can now construe the claims

Done when the claims are recorded per claim number, and the critical date, legal status and art of record are known.

## Phase 2: Venue & Window (verify with `search_legal` — never from memory)

- **EPO opposition**: 9 months from grant mention; any ground (novelty, inventive step, added matter, insufficiency)
- **US IPR**: after 9 months post-grant; grounds limited to patents and printed publications under 102/103. **35 U.S.C. 315(b) time bar**: an IPR petition is BARRED more than one year after the petitioner (or a privy) was served with an infringement complaint — for a user holding a demand letter or complaint, check this clock FIRST.
- **US PGR**: within 9 months of grant; any ground
- **District court**: any time as a defense; clear-and-convincing standard
Note which of the user's goals fit which venue, and whether the clock has run.

Done when each of the user's goals has a venue, and each venue has an open or closed clock.

## Phase 3: The Search

Run the **prior-art** skill's broad-to-narrow engine with these overrides:
- Concept table built from the TARGET's independent claim elements (not an invention description), with the added limitation of every Fallback Ladder rung as a secondary concept: the first search aims at the claims and every fallback, and the Search Round is only the retry
- Hard date filter: publication before the priority date
- **De-prioritize art of record** (from Phase 1.4) — log it, but the prize is art the examiner never considered
- NPL hits hard here (`search_npl` first, then `search_academic`): printed publications are fully usable in IPR, and examiners rarely searched them
- Papers already of record: resolve the target's cited [NPL] entries (`get_patent_details` with `resolveNpl: true`, or `get_npl_work` for one string) before searching, so the NPL sweep logs them as art of record and aims past them
- Check the applicant's own earlier filings and the inventors' own papers — self-collision is common
- Aim at the allowance-winning feature identified in Phase 1.4

Done when every element of every independent claim and the added limitation of every rung were searched with the date filter, each query is logged with its count, and each zero result went down the search-failure ladder below. Retries on that ladder are part of Phase 3; a Search Round is only the pass Phase 4b runs after the expert answers a Round Report.

## When a search fails

Prior art rarely sits in one office — before concluding the art isn't there, work the search-failure ladder in order:
1. **Clean zero result** (call succeeded, no hits): reformulate before concluding — rebuild the concept table from other claim elements, broaden or narrow the CPC/IPC, drop a filter, try a different number format — then try the alternate office/route (`search_patents` ↔ `patent_api_request`, `get_patent_summary` when `get_patent_details` is empty) and the NPL sweep (`search_npl`, then `search_academic`). A clean zero on the killer element is not "no invalidating art" until searched every way.
2. **Search error** (5xx, gateway timeout, connection reset, truncated response): transient outage, not a coverage limit — back off and retry the same call, then switch office. NEVER report a gap in the art from an errored call.
3. **Route exhausted** (both offices genuinely dry): fall back to the web — `fetch_webpage` is always available (even when `web_search` is not) against `patents.google.com/patent/NUMBER` or `freepatentsonline.com`; quote only text the page returned and spot-check the number and title. A fetched patent page is recorded as evidence under its publication anchor (Phase 4, "a cited document with no text in the tools").

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

The structured chart for `write_patent_results` (`template: 'invalidity-claim-chart'`) carries these rows:
- **Element rows**: one row per element of each independent claim — `feature: "Claim 1 — element (b): …"`, `claimNumber: "1"`, `kind: 'feature'` — plus one `kind: 'combination'` row per independent claim (`"Claim 1 as a whole"`).
- **Fallback rows**: one `kind: 'fallback'` row per rung of the Fallback Ladder of each charted independent claim, with `claimNumber` (the dependent claim) and `fallbackOf` (its independent claim). It charts ONLY the limitation the dependent claim adds, with the same evidence fields as an element row. A claim that depends on several claims is a rung under each parent it names.
- **Description fallbacks** (optional): an amendment the proprietor can draw from the description, as a fallback row with no `claimNumber` and a `basis` that quotes the challenged patent's own description verbatim.
- **Rungs left out**: each one goes in `fallbacksNotCharted` with a reason. The writer refuses a chart in which a rung has neither a row nor an entry.
- `elements` carry literal fragments copied from the **prior art's** claims or description, and `sourceAnchors`/`evidence` cite those prior-art passages, never the challenged patent. Only a description fallback's `basis` quotes the challenged patent.
- **A cited document with no text in the tools** (an older US grant, a GB or JP document, a DE utility model): `get_patent_details` records its bibliography and names the sections it could not get. Fetch its Google Patents page once with `fetch_webpage` (`https://patents.google.com/patent/<PUB>/en`). The ledger records the page text under the publication anchors (`<PUB>:description`, `<PUB>:claims`) as web text. Read it with `evidenceLookup` and cite it like any recorded text; never type a quote from memory. The writer checks the quote against the page text, labels the row "Source: web page (<host>), not official full text", counts it as covered, and lists the open point `source-<PUB>`. Official text wins: when the tools hold the text of that section, cite that anchor. In the Round Report, recommend that the expert confirms the page text against the official full text or a certified copy.
- Set `challengedPublication` to the target patent, set `criticalDate` to the critical date as `YYYY-MM-DD` when you know it, and put the critical-date basis in `objective`. With `criticalDate`, the receipt lists every cited document published after it.
- `status` stays supported / partial / unresolved; the chart renders them as disclosed / partially disclosed / not found in the cited art, counts fallbacks as covered / partly covered / not covered, and derives a reference-roles table from them. Your X/Y/A tagging and the §102/§103 grounds stay your own judgment in the prose above: the writer refuses a chart whose `gap`, `limitations`, `stopReason`, `outcome` or `reason` states a legal conclusion ("is obvious", "obvious over", "would have been obvious", "anticipates", "anticipated by", "is not novel"); a chart field says what the passage discloses and which element it meets or misses.

Field detail, the EN/DE/FR dependency wording and a worked example: [references/fallback-coverage.md](references/fallback-coverage.md).

Done when every element of every charted independent claim has a row, and every rung of its Fallback Ladder has a fallback row or a `fallbacksNotCharted` entry with a reason.

## Phase 4b: Save, Then the Round Report, Then Wait

The user is an expert. After every save, the expert decides what the next Search Round looks for.

1. **Save** via `write_patent_results` (`template: 'invalidity-claim-chart'`). Save it **structured**: leave `content` empty and supply the Phase 4 rows, so the writer validates the quotes, renders the chart and writes the evidence companion.
2. **Read the receipt**. The writer computes the open points from the record and prints one line each: `Open point [rung-3]: …`. You do not choose them, and you do not leave one out.
3. **Write the Round Report**: the receipt in one or two sentences; then each open point as a numbered question, in receipt order, with its id in brackets and your recommended next step; then the line "Reply with the ids to run (for example rung-3, element-1.3), 'all', or your own steer." Then **end the turn**. Do not search and do not save again before the expert answers. If the receipt says "Open points: none.", go to Phase 5. The question number is a reading aid. The id is the answer key.
4. **Read the expert's answer as ids.** If the expert answers with bare numbers (for example "2, 6"), do not run a round. Question numbers and claim numbers share the same small integers, and a rung is named by a claim number. Ask one short question: "Do you mean the question numbers or the claim numbers?" Wait for the confirmation.
5. **Echo the mapping** before any search, in one line: "Running: [rung-3] four-drum alternating rotation; [element-1.3] deposit region of the inner pair." A wrong reading is then visible before the round costs anything.
6. **Run one Search Round** aimed only at the points the expert chose, record it in `rounds` with `answers` (the ids of those points), and go back to step 1. The writer refuses a new round whose `answers` name no open point of the previous receipt, or whose queries all ran before the previous save.
7. **Stop when the expert says so.** A rung still not covered after a round is a complete result.

The jurisdiction rule does not change: search both offices first and ask about scope in the Round Report, never before the first search.

Open-point ids, a Round Report example, the round fields and a worked example: [references/fallback-coverage.md](references/fallback-coverage.md).

Done when the latest save is followed by a Round Report and the expert has answered, or the receipt lists no open points.

## Phase 5: Report

The saved chart covers:
1. **Target summary** — claims, priority date, legal status, prosecution-history findings
2. **Venue assessment** — which challenges are still open, on which grounds
3. **Invalidity charts** — per claim, best grounds first, then its fallback coverage ("fallbacks: k of j covered; not covered: claims 3, 5")
4. **Reference ranking** — the 3-5 strongest references, flagging which are NEW vs of record
5. **Open points after the last round** — each rung still not covered, the queries the rounds ran for it, the points the expert chose not to run, and what a deeper search would target. What stays not covered is the patent's real strength.
6. **Audit trail** (run the audit-report skill — invalidity work gets scrutinized)

Done when the chart is saved with every section above, and the chat summary states the fallback coverage per independent claim.

## Rules
- ALL art must predate the priority date — state each reference's publication date in the chart
- Always distinguish new art from art of record
- NEVER invent references or stretch a teaching — the other side WILL read the cited passage
- Close every deliverable with: "AI-assisted analysis for review by a registered patent attorney — not legal advice."
