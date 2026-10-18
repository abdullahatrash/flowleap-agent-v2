# Round Report demo: EP1809422B1 (Mineral breaker), 2026-10-18

First live run of the Round Report (PRD 0024 slice C4, PR #742, ADR 0016 amendment of 2026-10-17).
Real FlowLeap IDE built from main at 228b7d37bc0, editor Patent Agent chat, Claude Sonnet 5 (Anthropic
BYOK), fresh empty workspace, `--unattended` launch, one prose prompt:

> Prepare an invalidity chart for EP1809422B1. Chart claim 1 and all its fallbacks, and save the chart in analysis/EP1809422B1_invalidity_chart.md.

The founder answered the Round Reports: `2, 6` after the first, `rung-3` after the second, then stopped
the run after the third. The three Round Reports are verbatim in
[the appendix](2026-10-18-round-report-demo-ep1809422.round-reports.md).

Answer key as in the previous run (`2026-10-17-fallback-coverage-acceptance-ep1809422.md`): the patent
survived opposition on granted claim 3 (four side-by-side drums, each rotating opposite to its
neighbour).

## Verdict: FAIL on Tier A, 7 of 8. Point A5 failed once: Search Round 1 answered points the expert did not choose. The loop itself ran three times as designed.

The demo showed the litigator's method on screen: a saved chart, twelve open points computed by the
writer with a recommendation each, the expert's answer, one Search Round on that answer, a re-save, a
new Round Report, a wait. No completion-guard nudge was needed. No usage-limit error. The one failure
is a protocol defect, not a loop defect: the expert typed question numbers (`2, 6` = [rung-3] and
[element-1.3]), the model read claim numbers and ran the round on rung-2, rung-4, rung-5 and rung-6.
The writer accepted it because every id named was an open point of the previous receipt; it cannot see
the expert's message. Filed as #745 (ask for ids, echo the mapping, ask on bare numbers). The second
answer, given as the id `rung-3`, was followed exactly.

## Tier A

| # | Point | Grade | Read from |
|---|-------|-------|-----------|
| A1 | Saved through the writer from a fresh empty workspace, no confirmation stall | PASS | ledger `save` records at 06:26:46Z, 06:54:00Z, 07:20:36Z; no prompt in 1 h 40 min |
| A2 | 0 unvalidated quotes | PASS | five refusals before the saves caught non-verbatim and unrecorded quotes; the saved chart's quotes validate |
| A3 | Ladder equals the recorded dependent-claim tree | PASS | rungs 2, 3, 4 (3→4), 5 (4→5), 6 (1 or 2) with recorded text |
| A4 | Coverage line equals the row statuses | PASS | "Claim 1: 5 of 7 elements disclosed; fallbacks: 0 of 5 covered (0 partly); not covered: claims 2, 3, 4, 5, 6." in all three saves |
| A5 | Every save followed by a Round Report naming every open point with a recommendation; a Search Round runs only after an expert answer and answers points the expert chose | FAIL (round 1) | three Round Reports, each with all points and the closing line; no round before an answer; round 1 `answers: rung-2, rung-4, rung-5, rung-6` against the expert's `2, 6` (= rung-3, element-1.3); round 2 `answers: rung-3` as chosen |
| A6 | 0 assertive legal-conclusion phrases | PASS | the writer refused "anticipates" at 06:21:24Z; the saved chart has none |
| A7 | Generated Limitations and second read from the record | PASS | Limitations list the failed search, unread documents, partial result pages; second read 14 judged, 0 not confirmed, each save |
| A8 | No "disclosed" on a bibliography anchor; drawing rows tagged | PASS | the writer refused a bibliography anchor as support at 06:21:24Z; two rows carry "rests on a drawing reading" |

## Tier B

| # | Observation | Result |
|---|-------------|--------|
| B1 | Answer-key references on the right rungs | Partial: D3 (JP2004174393) on claim 1 elements (a), (b), (e); DE20208107U1 retrieved, no text; D1 and D4 not cited |
| B2 | Surviving rung charted, verdict consistent | Consistent: claim 3 not found after a targeted round (EP0864365A1 located and ruled out as two stacked pairs), which matches the opposition outcome |
| B3 | Prior-art eligibility | Caught by code this time: `[date-WO2005072877A1]` published 2005-08-11, after the critical date 2004-09-27, listed as an open point from the structured `criticalDate`; the model recommended an Art. 54(3) assessment by counsel. The free-text critical-date row still says "All art cited below publishes before this date", which is wrong for that document |
| B4 | Figure readings | Not spot-checked this run |
| B5 | Failed searches retried | Fail: the PAJ NPL lookup failed once and was not retried; it stayed `[search-1]` in all three reports |
| B6 | Legal noun forms outside disclaimers | 0 |

## Timeline (UTC)

| Time | Event |
|------|-------|
| 05:42:09 | Prompt |
| 06:11:12, 06:21:24, 06:25:32 | Three writer refusals (quotes not verbatim, figure quoted as text, bibliography anchor as support, "anticipates", partial rows with every element disclosed, fragments not in recorded text) |
| 06:26:46 | Save 1: rounds=0, 12 open points |
| 06:28:09 | Round Report 1; prompt to end of turn 45 min 56 s |
| 06:48:49 | Answer `2, 6` |
| 06:49:00 | Round 1: fetch_webpage GB2155808A on Google Patents; search_patents feed drum "same direction" (48) |
| 06:51:42, 06:52:49 | Two refusals: the round listed a fetch_webpage query text that matched no execution; the save then listed the URL |
| 06:54:00 | Save 2: rounds=1, 12 open points, coverage unchanged |
| 06:54:56 | Round Report 2; round 6 min 7 s |
| 07:17:49 | Answer `rung-3` |
| 07:18:22 | Round 2: two search_patents (4 hits each), EP0864365A1 details, evidence lookups, figures |
| 07:20:36 | Save 3: rounds=2, 13 open points |
| 07:21:32 | Round Report 3; round 3 min 43 s. Run stopped by the founder |

## Defects and observations

1. **#745 Round Report numbering collides with claim numbers** (A5 failure above).
2. **Full text the tools do not hold cannot become evidence.** GB2155808A was read on the web in round 1 and, by the model's account, discloses claim 2 word for word; the writer cannot anchor it because the ledger records only the bibliography, so claim 2 stays "not found" after the round, and the model says so honestly in Round Report 2. The same gap holds JP2004174393A (figures only) and DE20208107U1 (no text). This blocked both EP1809422 runs. Decision needed: a backend route for GB and JP full text, or a recorded evidence kind for web sources marked unverified.
3. **#729 kind-code duplicate as noise points.** The bare anchor `JP2004174393` beside `JP2004174393A` produced `[date-JP2004174393]` in every report and `[scope-JP2004174393]` from the third; the model had to call both reporting artifacts.
4. **#744 paste helper.** The operator's first attempt to type the answer went into the open chart editor; undone, the on-disk file untouched (digest equal to the receipt). Recorded in the evidence.
5. **Critical-date free text** still asserts every cited document predates the date while the computed point says otherwise. The structured check wins; the free text should defer to it.
6. **Round 1 refusal pair** shows the ledger check working on `fetch_webpage`: the model first wrote a query sentence, the writer demanded the executed text, the model recorded the URL.

## Unverified

- Why the model read `2, 6` as claim numbers: its reasoning is not logged.
- Round Report 3 is from the chat store and may lack its first lines; Round Reports 1 and 2 are from the transcript.
- The two early refusal texts are truncated in the debug log.
- The GB2155808A "verbatim" reading is the model's claim; the writer did not validate it.

Evidence (screenshots, aria snapshots, debug log, chat store, ledger, final chart and companions) is in the
session scratchpad under `e2-demo-evidence/`, not committed.
