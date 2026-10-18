# Round Reports, EP1809422B1 demo, 2026-10-18

Verbatim model text. Times are UTC.

## Round Report 1 (after the first save at 06:26:46Z; request ended 06:28:09Z)

Source: copilot transcript (assistant.message 06:28:09Z).

Saved: [analysis/EP1809422B1_invalidity_chart.md](analysis/EP1809422B1_invalidity_chart.md). The chart covers claim 1 of EP1809422B1 (element-by-element) plus all five of its fallbacks (claims 2–6), using the family's own art of record as the closest prior art found so far: WO2005072877A1 (MMD's own earlier filing, elements a/e/g of claim 1 supported), EP0167178A2 (MMD's own 1986 mineral sizer, elements d/g supported), and JP2004174393A's drawings (element b, resting on a figure reading). Elements c and f of claim 1 are unresolved — no cited reference discloses a deposit region specific to the inner pair, or the inner pair discharging oversized mineral outward to the outer drums, which is this patent's apparent point of novelty. Fallback claims 2–6 are all unresolved: the one potentially relevant reference, GB2155808A (adjustable drum spacing), has only bibliographic/abstract text recorded by the retrieval tool, not quotable claims/description text.

**Receipt:** fallbacks not covered: 5 of 5 (claims 2–6). Claim 1: 5 of 7 elements disclosed (elements c and f not found in the cited art); combination row partial. Critical date: 2004-09-27.

1. **[rung-2]** Claim 2 (adjustable inner-pair spacing) not found in cited art with quotable text. *Recommended:* pull GB2155808A's full claims/description from a non-OPS source (UK IPO, Espacenet classic, or Google Patents) since OPS has only its abstract.
2. **[rung-3]** Claim 3 (exactly four drums, full alternating rotation) not found. *Recommended:* targeted search for 4-drum fully-alternating breaker/crusher rows in B02C4, plus DE20208107U1 full text (OPS 404s on this utility model).
3. **[rung-4]** Claim 4 (two separately-cased breaker units side-by-side) not found. *Recommended:* check MMD's own GB2208614A (FEEDER-BREAKER APPARATUS, 1989) and GB2153702A/GB2153703A, neither yet pulled for full text.
4. **[rung-5]** Claim 5 (common frame, slidable casings between units) not found. *Recommended:* same GB2155808A full-text pull as rung-2, which may cover this limitation too.
5. **[rung-6]** Claim 6 (feed drum same direction as inner drum) not found — WO2005072877A1's feeders actually rotate *opposite* to the final breaking pair. *Recommended:* search specifically for "feed roll" + "same direction" in crusher/breaker CPC classes.
6. **[element-1.3]** Deposit region specific to the inner pair not found (only a general end-of-row deposit point in WO2005072877A1). *Recommended:* obtain JP2004174393A's full claims/description (currently figure-only).
7. **[element-1.6]** Inner-pair-to-outer-drum outward transfer not found — the apparent novelty point. *Recommended:* obtain DE20208107U1 full text (it is Y/A-rated against claims 2,5,6 but only A against claim 1 itself) and resolve the unidentified NPL (point 12).
8. **[date-JP2004174393]** The dedupe anchor "JP2004174393" (no suffix) carries no recorded date; the dated publication JP2004174393A is recorded at 2004-06-24, before the critical date. *Recommended:* no search needed — treat as a reporting artifact, not a gap.
9. **[date-WO2005072877A1]** Published 2005-08-11, **after** the 2004-09-27 critical date, even though its own priority (2004-01-30/2004-03-26) predates it. As used, it is not straightforward Art. 54(2) state-of-the-art against this priority date. *Recommended:* have counsel assess Art. 54(3) EPC "whole contents" eligibility, or re-source the same disclosure from its own priority documents GB20040001993/GB20040006802 if accessible.
10. **[drawing-1.2]** Element (b) rests only on a JP2004174393A drawing reading, not quoted text. *Recommended:* same JP2004174393A full-text pull as point 6.
11. **[drawing-1.whole]** The claim-1 combination row partly rests on that same drawing reading. *Recommended:* resolves together with point 10.
12. **[search-1]** The examiner's X-rated NPL "Patent Abstracts of Japan vol. 2003, no. 12 (2003-12-05)" against claim 1 could not be identified (OpenAlex: not found; classification/applicant searches did not surface a matching JP publication). *Recommended:* search J-PlatPat or a JP-specific database directly for crusher/screening publications from December 2003, or try Espacenet's PAJ abstract index by volume/number.

Reply with the numbers to run, 'all', or your own steer.

## Expert answer: "2, 6" sent 06:48:49Z (debug-log time; operator recorded 06:48:53Z)

## Round Report 2 (after the Search Round 1 save at 06:54:00Z; message 2026-10-18T06:54:56.768Z)

Saved: [analysis/EP1809422B1_invalidity_chart.md](analysis/EP1809422B1_invalidity_chart.md) (Search Round 1 complete).

**Receipt:** Claim 1: 5 of 7 elements **supported** (a, b, d, e, g); 2 **unresolved** (c, f). Combination row: **partial**. Fallbacks: 0 of 5 covered — claims 2–6 all **unresolved** in the structured chart (claim 2 has confirmed-but-uncharted support in GB2155808A, explained below). Critical date: 2004-09-27.

1. **[rung-2]** Claim 2 (adjustable inner-pair spacing) — not found *in chartable form*. GB2155808A's full text (read via web fallback this round) **does** disclose this limitation verbatim, but OPS records only its bibliography for the retrieval tool, so it can't be entered as quoted evidence. *Recommended:* if available, source GB2155808A's claims/description from UK IPO or Espacenet classic so it can be properly anchored and charted as supported.
2. **[rung-3]** Claim 3 (exactly four drums, full alternating rotation) — not found. *Recommended:* obtain DE20208107U1 full text (still 404s on OPS) or search specifically for 4-drum fully-alternating crusher rows.
3. **[rung-4]** Claim 4 (two separately-cased units) — not found; this round confirmed GB2155808A does NOT disclose this (one drum per housing, not a casing per pair). *Recommended:* check MMD's own GB2208614A and GB2153702A/GB2153703A, not yet pulled.
4. **[rung-5]** Claim 5 (common frame, slidable casings) — not found; GB2155808A ruled out this round for the same reason as rung-4. *Recommended:* same GB2208614A/GB215370x check as rung-4.
5. **[rung-6]** Claim 6 (feed drum same direction as inner drum) — searched this round (48 hits), none probative; WO2005072877A1's feeders actually rotate opposite the final pair. *Recommended:* accept as not covered, or narrow further to B02C4 classification specifically.
6. **[element-1.3]** Deposit region specific to the inner pair — not found. *Recommended:* obtain JP2004174393A's full claims/description (currently figure-only).
7. **[element-1.6]** Inner-pair-to-outer-drum outward transfer — not found; the apparent novelty point. *Recommended:* obtain DE20208107U1 full text and resolve the unidentified NPL (point 12).
8. **[date-JP2004174393]** Reporting artifact — the dedupe anchor carries no date, but the dated publication JP2004174393A (2004-06-24) predates the critical date. *Recommended:* no action needed.
9. **[date-WO2005072877A1]** Published 2005-08-11, after the 2004-09-27 critical date, though its own priority predates it. *Recommended:* counsel to assess Art. 54(3) EPC eligibility, or re-source from its own priority documents.
10. **[drawing-1.2]** Element (b) rests only on a JP2004174393A drawing. *Recommended:* resolves with point 6 (full JP text).
11. **[drawing-1.whole]** Combination row partly rests on that same drawing. *Recommended:* resolves with points 6 and 10.
12. **[search-1]** The 2003 Japanese NPL citation remains unidentified. *Recommended:* try J-PlatPat directly or Espacenet's PAJ abstract index by volume/number.

Reply with the numbers to run, 'all', or your own steer.

## Expert answer: "rung-3" sent 07:17:49Z

## Round Report 3 (after the Search Round 2 save at 07:20:36Z; request ended 07:21:32Z; source: chat session store, the message starts at "Receipt:")


**Receipt:** Claim 1: 5 of 7 elements **supported** (a, b, d, e, g); 2 **unresolved** (c, f). Combination row: **partial**. Fallbacks: 0 of 5 covered — claims 2–6 all **unresolved** in the structured chart (claim 2 has confirmed-but-uncharted support in GB2155808A). Rounds run: 2. Critical date: 2004-09-27.

1. **[rung-2]** Claim 2 (adjustable inner-pair spacing) — not found *in chartable form*. Confirmed disclosed in GB2155808A's full text (Round 1), but OPS carries no claim/description anchor for it. *Recommended:* source GB2155808A from UK IPO or Espacenet classic for a properly anchored quote.
2. **[rung-3]** Claim 3 (exactly four drums, full alternating rotation, single row) — not found this round either. EP0864365A1 ("Multi-roll crusher") has four alternating rolls but arranged as two **stacked** pairs, not a row. *Recommended:* obtain DE20208107U1 full text (still 404s on OPS) — it's the examiner's own Y-rated reference against claims 2/5/6 and may cover this row structure.
3. **[rung-4]** Claim 4 (two separately-cased units side-by-side) — not found; GB2155808A ruled out in Round 1. *Recommended:* check MMD's own GB2208614A and GB2153702A/GB2153703A, not yet pulled for full text.
4. **[rung-5]** Claim 5 (common frame, slidable casings) — not found; GB2155808A ruled out in Round 1. *Recommended:* same GB2208614A/GB215370x check as rung-4.
5. **[rung-6]** Claim 6 (feed drum same direction as inner drum) — searched in Round 1 (48 hits), none probative. *Recommended:* accept as not covered, or narrow further to B02C4 classification specifically.
6. **[element-1.3]** Deposit region specific to the inner pair — not found. *Recommended:* obtain JP2004174393A's full claims/description (currently figure-only via OPS).
7. **[element-1.6]** Inner-pair-to-outer-drum outward transfer — not found; the apparent novelty point. *Recommended:* obtain DE20208107U1 full text and resolve the unidentified NPL (point 13).
8. **[scope-JP2004174393]** The dedupe anchor "JP2004174393" (no suffix) is flagged as outside the EP/WO search scope — the dated publication JP2004174393A was in fact searched and charted (element b). *Recommended:* no action; reporting artifact of the dedupe key.
9. **[date-JP2004174393]** Same anchor carries no recorded date; JP2004174393A itself is dated 2004-06-24, before the critical date. *Recommended:* no action needed.
10. **[date-WO2005072877A1]** Published 2005-08-11, after the 2004-09-27 critical date, though its own priority (2004-01-30/2004-03-26) predates it. *Recommended:* counsel to assess Art. 54(3) EPC "whole contents" eligibility, or re-source from its own priority documents GB20040001993/GB20040006802.
11. **[drawing-1.2]** Element (b) rests only on a JP2004174393A drawing. *Recommended:* resolves with point 6 (full JP text).
12. **[drawing-1.whole]** Combination row partly rests on that same drawing. *Recommended:* resolves with points 6 and 11.
13. **[search-1]** The 2003 Japanese Patent Abstracts of Japan NPL citation remains unidentified. *Recommended:* try J-PlatPat directly or Espacenet's PAJ abstract index by volume/number.

Reply with the numbers to run, 'all', or your own steer.
