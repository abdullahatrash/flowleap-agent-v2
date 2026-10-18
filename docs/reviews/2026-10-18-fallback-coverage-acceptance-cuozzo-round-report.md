# Fallback Coverage acceptance with the Round Report: US6778074B1 (Cuozzo), 2026-10-18

Case (c) of slice E2 of PRD 0024 (#711), run again after the Round Report shipped (slice C4, PR #742;
#745 merged in PR #751). The pilot on the same patent (`2026-10-17-fallback-coverage-pilot-cuozzo.md`)
ran before the Round Report existed. Graded on the two-tier acceptance baseline of PRD 0024: Tier A is
the code-guaranteed baseline read from the saved artifacts and decides the verdict; Tier B is content,
recorded per run and compared with the pilot, and never changes the verdict.

Real FlowLeap IDE built from main at 79e0444a64e (HEAD includes PR #751), editor Patent Agent chat,
Claude Sonnet 5 (Anthropic BYOK), fresh empty workspace, `--unattended` launch, one prose prompt:

> Prepare an invalidity chart for US6778074B1. Attack claims 10, 14 and 17; chart the fallbacks too and save the chart in analysis/US6778074B1_invalidity_chart.md.

The operator answered the Round Reports with ids only: `rung-17, drawing-10.4` after the first,
`rung-17` after the second, and stopped the run after the third. The three Round Reports are verbatim
in [the appendix](2026-10-18-fallback-coverage-acceptance-cuozzo-round-report.round-reports.md).

Answer key (public record): IPR2012-00001, final written decision 2013-11-13. Claims 10, 14 and 17
held unpatentable over Aumayer (US6633811) + Evans (US3980041) + Wendt (US2711153), and over
Tegethoff (DE19755470) + Awada + Evans + Wendt. No attacked claim survived; the motion to amend was
denied. The critical date the tools record is 2002-03-18 (the pilot's note on an earlier date stays
unconfirmed by any tool output).

## Verdict: PASS (Tier A, 8 of 8). The loop ran three times as designed; the content misses the answer key on every reference.

Every Tier A point holds in the saved artifacts. Five saves went through the writer with ledger
records, every quote and fragment is in the recorded text, the ladder equals the recorded dependent
claim tree with every rung charted or deferred with a reason, the coverage counts match the rows, each
turn ended at a Round Report that named every open point of its receipt with a recommendation, both
Search Rounds ran only after an answer and recorded exactly the ids the operator chose, no legal
phrase reached the chart, the honesty sections are present, and no row is disclosed on a bibliography
anchor. The one A5 fact that needs a reading is stated under A5: twice the model re-saved once more
before its Round Report, on the receipt's own invitation, with no search in between.

Tier B is weak. None of the four answer-key references is on a row, although Aumayer and Evans were
retrieved with text and Wendt without text. Claim 17 stays "not found" after two Search Rounds,
against the decision. The two failed USPTO full-text lookups were not retried on another route. The
pilot had charted Aumayer; this run charts examiner-cited art only.

The run also surfaced a new defect in the prompt, not in the loop: a prompt block that listed two
zero-match evidence lookups as "returned text". The model treated it as injected content, said so in
every Round Report, and wrote it into the chart's Limitations (#772, fix PR #773).

## Tier A

| # | Point | Result | Read from |
|---|-------|--------|-----------|
| A1 | Saved through the writer from a fresh empty workspace, no confirmation stall; ledger holds the `save` record | PASS | Workspace created empty at 14:52Z, opened with the launch, trusted through the Restricted Mode banner, prompt sent 14:56:11Z. Ledger: five `save` records (15:18:19Z, 15:20:01Z, 15:48:44Z, 16:07:07Z, 16:09:03Z), each with `rounds` and `openPoints`. No tool, URL, opt-in or request-limit prompt appeared: the longest wait between a tool request and its execution start was 10 s (search_npl at 16:05:46Z). No pre-execution input rejection (#740 did not recur). No usage-limit error. |
| A2 | 0 unvalidated quotes | PASS | Final chart: 12 `<blockquote>` passages and 9 `disclosedBy` fragments, each re-checked by the reviewer against the recorded sources in the evidence companion: 12 of 12 and 9 of 9 found verbatim. Writer refusals at 15:15:01Z, 15:16:22Z and 15:17:04Z had rejected bibliography anchors as feature support, a drawing page quoted as text and a figure cited outside the row's anchors. |
| A3 | Ladder equals the recorded dependent-claim tree; every rung has a row with status and reference, or a `fallbacksNotCharted` reason | PASS | Recorded claims (`get_patent_details` US6778074B1, 14:56:24Z, anchors `US6778074B1:claims:10..20:en`): 11→10, 12→10, 13→12, 14→10, 15→14, 16→15, 17→14, 18→10, 19→10; claim 20 independent. Chart "Fallback coverage (generated) — claim 10": rows for 11 (disclosed, US5485161A), 14 (partially disclosed, US4935850A), 17 (not found), 19 (partially disclosed, US6265989B1); `not charted` with a reason for 12, 13, 15, 16, 18 (LCD and mechanical-construction rungs deferred to a Search Round). Each row prints the recorded claim text. |
| A4 | Coverage line per independent claim whose counts equal the row statuses | PASS | Final: "Claim 10: 2 of 4 elements disclosed; fallbacks: 1 of 9 covered (2 partly); not covered: claim 17; not charted: claims 12, 13, 15, 16, 18." Elements: (a) disclosed, (b) partial, (c) partial, (d) disclosed. Rungs: 11 disclosed, 14 and 19 partial, 17 not found, five not charted. Saves 1 to 4 said "2 of 9 covered (1 partly)" while claim 14 was still disclosed. |
| A5 | Loop rule (C4) | PASS, with one reading stated | Three Round Reports, each after a save, each naming every open point of its receipt with a recommendation (6, 6 and 7 points), each ending the turn (chat store `modelState` completed at 15:20:22Z, 15:49:11Z, 16:09:17Z; no "Cancel" in the snapshots). Search Round 1 ran after the answer at 15:45:34Z, echoed "Running: [rung-17] … [drawing-10.4] …", and recorded `Answers open points: rung-17, drawing-10.4`; its two queries ran at 15:45:54Z and 15:45:59Z, after the 15:20:01Z save. Search Round 2 ran after the answer at 16:05:17Z, echoed "Running: [rung-17] … no other open point is being run this round", recorded `Answers open points: rung-17`; its queries ran at 16:05:41Z and 16:05:46Z, after the 15:48:44Z save. The fact to read: twice the model saved, read the receipt's second-read objection, and saved once more before writing the Round Report (15:18:19Z then 15:20:01Z; 16:07:07Z then 16:09:03Z). The receipt invites this ("Re-save at most 2 more times for second-read objections"), the ledger holds no search between the two saves of a pair, and the Round Report that followed named every open point of both receipts. Reading applied: a receipt-invited correction re-save is part of the same pass, not a new Search Round, so the rule holds. If the PRD means the stricter reading (a Round Report after literally every save), the text of A5 should say so and the writer's invitation should change. |
| A6 | 0 assertive legal-conclusion phrases; noun forms only in disclaimers or listed by the wording review | PASS | Grep of chart and working record for is/are obvious, obvious over, would have been obvious, anticipates, anticipated by, is/are not novel: 0 hits. Noun forms: one hit, the generated disclaimer in "Reference roles". Working record "Wording review: No phrases flagged." Pilot: 9 phrases. |
| A7 | Generated honesty sections present and drawn from the record | PASS | Chart "Limitations": seven model bullets (scope, deferred rungs, the two USPTO 404s, the two rounds, the US6515596B2 date, the second-read downgrades, the #772 block) and the generated block ("16 of 21 retrieved documents are not cited", "No description passage is cited", two partial result pages, drawing caveat). Working record: search log (35 searches, 19 details, 2 figures), "Open points (generated)", "Retrieved but not read", "Second read" (14 judged, 0 not confirmed, 2 not judged as figure), "Wording review", "Provenance". The generated block lists no failed search because the two failures were `patent_api_request` lookups (analytics kind), not searches; the model's own bullet reports them. |
| A8 | No row disclosed on a bibliography anchor; every figure-based row carries "rests on a drawing reading" | PASS | Row anchors: claims anchors of US6265989B1, US6515596B2, US4935850A, US5485161A and the figure anchor `US4935850:figure:2`; "bibliography" appears only in document tables and in the figure anchor's link target (see defect 2). Element (d) carries "rests on a drawing reading"; "Claim 10 as a whole" carries "rests in part on a drawing reading". Refusal 1 had rejected three `US4935850A:bibliography` uses as feature support. |

## Tier B, compared with the pilot on the same patent

| # | Observation | This run | Pilot (2026-10-17) |
|---|-------------|----------|--------------------|
| B1 | Answer-key references on the right rungs | 0 of 4. Aumayer US6633811B1 retrieved with claims text (15:01:12Z) and figures (15:11:07Z), cited on no row. Evans US3980041A retrieved with claims text (14:58:24Z), cited on no row. Wendt US2711153A retrieved with no text sections (15:03:08Z); the `get_us_grant` lookup returned 404; not cited. Tegethoff DE19755470 found by a number search (15:03:14Z), never retrieved. Awada never searched. Every row rests on examiner-cited art: US6265989B1, US6515596B2, US4935850A, US5485161A. The model named Aumayer, Wendt, Evans, Garmin and IPR2012-00001 in 16 query purposes from memory before any search, as in the pilot, and still put none of them on a row. | 1 of 4: Aumayer on claim 10 (b), (c), the whole, and rungs 11, 12, 13, 18. |
| B2 | The rung the proprietor retreated to is charted; verdict consistent with the decision | No rung survived in the decision, so the check is on the narrowest attacked rung. Claim 17 is charted "not found in the cited art" after two Search Rounds (four patent queries, one NPL query, all zero or irrelevant). Inconsistent with the decision, which held claim 17 unpatentable over Aumayer + Evans + Wendt: two of those three were on disk with text and were not read against the rung; the third has no text in the tools. | Claim 17 "not found", same inconsistency; the Evans and Wendt searches had hit backend 503s. |
| B3 | Prior-art eligibility: critical date right, every cited reference before it or flagged | Critical date 2002-03-18 from the record. Cited: US4935850A 1990-06-19, US5485161A 1996-01-16, US6265989B1 2001-07-24, all before; US6515596B2 2003-02-04, after, flagged by code as `[date-US6515596B2]` in all three reports and in a Limitations bullet, and the critical-date row says "flagged per reference below" instead of asserting that everything predates the date (the EP1809422 free-text defect did not recur). Noise point `[date-US4935850]` in all three reports: the figure anchor carries no kind code (#729). Not cited but worth a note: Aumayer US6633811B1 published 2003-10-14, after the critical date; its eligibility would have needed the same flag. | Critical date 2002-03-18; no date flags existed yet. |
| B4 | Figure readings correct on a spot check | PASS. Element (d) reads `US4935850:figure:2` as "the needle (2), the color-filter segment plate (8), the interrupter plate (14) and the illuminated display face (20) all mounted along the single servo shaft axis (6) driven by one motor (4)". `references/figures/US4935850-page-2.png`, FIG. 1 and FIG. 2: one motor 4, shaft 6, plates 10/12 and 14/16, display 20 with marks 22 and needle 2 on one axis. The reading stands; it also supports the model's claim 17 gap text (filter driven by the same shaft as the needle). | Not spot-checked. |
| B5 | Failed searches retried | Fail. `patent_api_request` `/tools/get_us_grant` returned 404 for 2711153 (15:03:20Z) and 4935850 (15:45:48Z); neither was retried on another route. Every Round Report recommended a Google Patents fetch for US4935850 and the model never ran one (no `fetch_webpage` call this run). | Fail: nine searches "could not be run and were not retried". |
| B6 | Legal noun forms outside disclaimers | 0 | 0 outside the disclaimer, but 9 assertive phrases. |

## Timeline (UTC)

| Time | Event |
|------|-------|
| 14:52:29 | First launch opened the seed profile's last workspace; stopped and relaunched at 14:53:16 with the empty folder as the code.sh argument. |
| 14:56:11 | Prompt sent. |
| 14:56:18–15:11:07 | 35 searches, 19 detail reads, 3 NPL searches, 2 figure reads; Aumayer, Evans, Wendt and Tegethoff looked up by name and number. |
| 15:15:01, 15:16:22, 15:17:04 | Three writer refusals (bibliography anchors as support, every-element-disclosed partial rows, anchors without evidence, missing limitations and stopReason; drawing page quoted as text; figure cited outside the row's anchors). |
| 15:17:45 | Save 1 (33.7 s with the second read): receipt `fallbacksNotCovered=1 rounds=0 notCovered=17`, 5 open points, second read 3 not confirmed. |
| 15:19:29 | Save 2 (32.3 s): rows (b), (c), whole and 19 downgraded; 6 open points. |
| 15:20:22 | Round Report 1; turn ended. Prompt to report 24 min 11 s. |
| 15:45:34 | Answer `rung-17, drawing-10.4` (operator latency 25 min: the operator's file watcher had the ledger layout wrong). The first paste attempt at 15:44Z failed (defect 3). |
| 15:45:48–15:45:59 | Echo "Running: [rung-17] …; [drawing-10.4] …"; `get_us_grant` 4935850 → 404; two `search_patents` (0, 0). |
| 15:47:18 | Writer refusal: the round listed the 404 lookup as a query and the ledger check did not match it (defect 4). |
| 15:48:16 | Save 3 (28.7 s): `rounds=1`, Search Round 1 with `answers: rung-17, drawing-10.4`, 6 open points, second read 0 not confirmed. |
| 15:49:11 | Round Report 2; turn ended. Round 3 min 37 s. |
| 16:05:17 | Answer `rung-17` (operator latency 16 min). |
| 16:05:41–16:05:46 | Echo "Running: [rung-17] …"; two `search_patents` (0, 0), one `search_npl` (2 irrelevant reports). |
| 16:06:44 | Save 4 (23.5 s): `rounds=2`, `answers: rung-17`; second read objects to claim 14 ("means for filtering" is not an express colored filter). |
| 16:08:36 | Save 5 (27.4 s): claim 14 downgraded to partial; 7 open points (`rung-14` added); second read 0 not confirmed. |
| 16:09:17 | Round Report 3; turn ended. Round 3 min 59 s. Run stopped by the operator at 16:19:18. |

Wall clock from prompt to the third report 1 h 13 min; model work about 33 min; operator latency
about 41 min. No idle time came from the product.

## Defects and observations

1. **#772, evidence-lookup history lists a zero-match lookup as returned text** (new class, filed by
   the lead during the run; fix PR #773). The `<patentEvidenceReading>` block listed the
   `evidenceLookup.query` of 15:15:09Z on US4935850A ("interrupter plate is rotationally attached to
   the speedometer needle shaft"), which returned "Local returned-text literal matches: 0 results",
   as a request that returned text with `count: 1`. The model refused it as "untrusted injected
   content" seven times across the two rounds, opened Round Reports 2 and 3 with the complaint, and
   wrote a Limitations bullet about "messages attached to this session" into the client chart. The
   loop was not harmed, but the deliverable carries prompt plumbing. Cause: the history keeps any
   result that starts with "Local returned-text", and the zero-result line starts the same way.
2. **#729, kind-code duplicate.** The figure anchor `US4935850:figure:2` has no kind code, so the
   chart lists US4935850 and US4935850A as two references in "Reference roles" and in "Retrieved
   documents" (US4935850 with "Unknown" date and title), the receipt raised `[date-US4935850]` in all
   three Round Reports, and the figure anchor's link target reads `section=bibliography`. Same noise
   as the EP1809422 runs.
3. **#744, paste helper.** With the chart's figure tab closed and focus in the empty editor area,
   `drive paste` pressed Control+Meta+i, which toggled the visible chat closed; the paste then failed
   with "no native-edit-context found on page" and nothing was typed anywhere. The retry, with the
   chat hidden, opened it and pasted correctly. Both attempts are in the evidence
   (`12-answer-1-pasted.png`, `13-answer-1-pasted.aria.yml`).
4. **A failed round query is refused as unmatched** (new, small). Search Round 1 listed the
   `patent_api_request` lookup that returned 404; the ledger holds it as `analytics / failed`, but
   the round check said it "matches no tool execution recorded this session", so the model dropped
   it, and the chart's round table shows only the two zero-hit searches. The honest record of a
   failed attempt should match the ledger. Filed as #775.
5. **Partial elements are not open points** (design observation). `rowOpenPoints` lists fallback
   rows that are partial or unresolved, but feature rows only when unresolved. Claim 10 elements (b)
   and (c) stayed partial in all five saves and were never offered for a round, while the partial
   rung 19 was. A litigator may want "partly disclosed" element rows on the list too.
6. **Round Report 1 format drift** (model). The first report put the closing line as a heading
   above the numbered points and shortened it ("Reply with the ids to run, 'all', or your own
   steer"); the receipt text and the point order were right. Reports 2 and 3 followed Phase 4b
   exactly, with the receipt, the numbered points and the full closing line last.
7. **Round `targets` rendering.** The model put the open-point id into `targets`, so the chart says
   `Targets: claim 17, description fallback "10.4"`. Harmless; `answers` carries the ids.
8. **USPTO full text not held for older grants** (environment, related to #750). `get_us_grant`
   answered "No US patent found with patentNumber=4935850 … not yet ingested by USPTO ODP" (1990
   grant) and the same for 2711153 (1955 grant). The description-less rows and the drawing-only
   support for element (d) follow from it. The model never tried the web route it recommended.
9. **Transcript stops before the last save**, as in the EP1809422 run: the copilot-agent jsonl ends
   at the 16:08:36Z turn start; the final save and Round Report are in the debug log and the chat
   store only.
10. **Answer-key leak from model memory** persists (pilot defect 5): 16 query purposes name the IPR
    references; recall from memory still produced no charted row, so the leak did not inflate B1.

## Setup

- Code: main at 79e0444a64e (`integration/drawings-d1-d4` with origin/main merged; HEAD includes
  PR #751), run from the main checkout `/Users/abdullahatrash/flowleap/flowleap-agent-v2`, not
  rebuilt: `out/` 17:03 local, `extensions/copilot/dist/extension.js` 17:48 local.
- Launch: `control-flowleap-ide up --unattended --seed-profile "~/Library/Application Support/code-oss-dev" -- <workspace>`.
  Run `vfl-20261018T175316-46656`. The first launch without the folder argument opened the seed
  profile's last workspace and was stopped.
- Doctor: five of six checks ok. `window-title-marker` red because the title carries the workspace
  name ("Welcome — e2-cuozzo2-ws"); `no-extension-load-failures` was green this time.
- Model: the profile already had Claude Sonnet 5 (Anthropic 2 group) selected; confirmed from the
  picker ("Claude Sonnet 5, Anthropic 2, Current model"; the Other Models list shows the Anthropic
  group without it because it is in the top list). Chat store `selectedModel`:
  `anthropic/Anthropic 2/claude-sonnet-5`. Mode Agent, reasoning High.
- Workspace: fresh empty folder `…/scratchpad/e2-cuozzo2-ws`, trusted through the Restricted Mode
  banner's Manage action. Prompt pasted once with `drive paste` and sent at 14:56:11Z.
- Waiting: a background `until` loop on the ledger `save` records and the chat store's request
  result, then one snapshot and screenshot per change; no UI polling loop.

## Evidence

- Tool-calls appendix (every tool call with UTC time, the user messages, every writer execution with
  its full result text):
  `docs/reviews/2026-10-18-fallback-coverage-acceptance-cuozzo-round-report.tool-calls.txt`
- Round Reports verbatim:
  `docs/reviews/2026-10-18-fallback-coverage-acceptance-cuozzo-round-report.round-reports.md`
- Kept outside the repository in the session scratchpad under `e2-cuozzo2-evidence/`: the chart,
  working record, evidence companion and second-read JSON after saves 2, 3 and 5 (`save1/`, `save2/`,
  `save3/`, each with its SHA-256: bd3723c5…, 23218fb4…, f1e177d9…, equal to the receipts'
  `reportDigest`), the figure pages, the execution ledger, the copilot-agent transcript, the debug log,
  the chat session store, `code.log`, and the screenshots and ARIA snapshots of the launch, trust,
  model picker, prompt, each Round Report, each answer and the end state.
