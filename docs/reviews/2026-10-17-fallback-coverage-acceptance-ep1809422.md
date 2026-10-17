# Fallback Coverage acceptance: EP1809422B1 (Mineral breaker), 2026-10-17

Second live run for #711 (slice E2 of PRD 0024), after the Cuozzo pilot
(`2026-10-17-fallback-coverage-pilot-cuozzo.md`). Graded on the two-tier acceptance baseline of
PRD 0024 (decided 2026-10-17): Tier A is the code-guaranteed baseline read from the saved
artifacts and decides the verdict; Tier B is content, recorded per run and tallied across runs,
and never changes the verdict.

Real FlowLeap IDE, editor Patent Agent chat, Claude Sonnet 5 (Anthropic BYOK), fresh empty
workspace, `--unattended` launch, one prose prompt:

> Prepare an invalidity chart for EP1809422B1. Chart claim 1 and all its fallbacks, and save the chart in analysis/EP1809422B1_invalidity_chart.md.

Answer key (public record, T 0693/17 and the EP Register file): one independent claim; ladder
2, 3, 4 (3→4), 5 (4→5), 6 (1 or 2); critical date 2004-09-27 (GB 0421384). D3 = JP 2004-174393
took the novelty of the proprietor's claim 1 at the Opposition Division; the patent survived on
granted claim 3 (four side-by-side drums, each rotating opposite to its neighbour), held new over
D3 (six rolls) and inventive over D3 + CGK, D3 + D1 (JP 9-155215), D4 (WO 00/35585) + D1, D1 + D4.

## Verdict: PASS (Tier A, 8 of 8)

Every Tier A point holds in the saved artifacts. The chart was saved through the writer with the
ledger `save` record, every quote and fragment is in the recorded text, the ladder equals the
recorded claim tree with every rung charted, the coverage counts match the rows, the loop rule
applied as written (`fallbacksNotCovered=0`, no round, rationale given), no assertive legal
phrase, the generated honesty sections are present, and no row is disclosed on a bibliography
anchor. Tier B records three content misses (B3 critical date, B4 one misread figure, B5 one
failed search not retried) and one open design question (B2: a partly covered rung never
triggers a Search Round). Two harness defects outside both tiers cost the run about an hour.

## Tier A — baseline

| # | Point | Result | Read from |
|---|-------|--------|-----------|
| A1 | Saved through the writer from a fresh empty workspace, no confirmation stall; ledger holds the `save` record | PASS | Ledger `0833db58…json`: `{"kind":"save","status":"succeeded","tool":"write_patent_results","request":"analysis/EP1809422B1_invalidity_chart.md","rounds":0,"recordedAt":"2026-10-17T16:49:51.941Z"}`. Workspace created empty at 15:02Z, trusted, prompt sent 15:06:37Z. No tool, URL, opt-in or request-limit prompt appeared (UI polled every 30 s 15:07–15:37; every executed tool started within 12 s of its request for the whole run). The one stall was a model-API error, not a confirmation (see Harness). |
| A2 | 0 unvalidated quotes | PASS | Chart: 9 `<blockquote>` passages on 4 text anchors (EP0167178A2:description:en ×3, WO2005072877A1:description:en ×3, WO2005072877A1:claims:1:en ×3) and 10 `disclosedBy` fragments. Each one re-checked by the reviewer against the recorded tool outputs in the chat session store: 9 of 9 and 10 of 10 found verbatim. Writer refusal 7 (16:48:12) had rejected six non-verbatim description quotes before the save. The evidence file holds the 44 recorded executions (20 details, 14 search, 4 analytics, 4 status, 2 figures) the audit covered. |
| A3 | Ladder equals the recorded dependent-claim tree; every rung has a row with status and reference, or a `fallbacksNotCharted` reason | PASS | Recorded claims (`get_patent_details` EP1809422B1, 15:06:40Z, anchors `EP1809422B1:claims:1..6:en`): 2→1, 3→1, 4→3, 5→4, 6→"Claim 1 or Claim 2". Chart "Fallback coverage (generated) — claim 1": Claim 2 (1 → 2) disclosed, WO2005072877A1; Claim 3 (1 → 3) partially disclosed, JP2004174393; Claim 4 (1 → 3 → 4) partially disclosed, WO2005072877A1; Claim 5 (1 → 3 → 4 → 5) partially disclosed, WO2005072877A1; Claim 6 (1 → 6) partially disclosed, WO2005072877A1. Each row prints the recorded claim text. No `fallbacksNotCharted`. Refusal 1 (15:39:24) had caught claims 4 and 5 charted under 3 and 4 instead of 1. |
| A4 | Coverage line per independent claim whose counts equal the row statuses | PASS | Chart line 192: "Claim 1: 2 of 7 elements disclosed; fallbacks: 1 of 5 covered (4 partly); not covered: none." Rows: (a) disclosed, (b) disclosed, (c) not found, (d) not found, (e) partial, (f) partial, (g) partial = 2 of 7; rungs: 1 disclosed, 4 partial, 0 unresolved = 1 of 5, 4 partly, none not covered. |
| A5 | Loop rule | PASS (pre-C4 rule) | Receipt: `fallbacksNotCovered=0 rounds=0 notCovered=`. Ledger save record `rounds:0`. No `rounds` in the chart. Stopping rationale (chart "Search stopping rationale" and Limitations): "no additional Search Round was run because every charted fallback row already carries at least partial support from the first-pass search." Rule applied: `fallbacksNotCovered = 0` → no round, rationale given. The #725 order check had nothing to act on (one save, no re-save). |
| A6 | 0 assertive legal-conclusion phrases; noun forms only in disclaimers or listed by the wording review | PASS | Grep of chart and working record for is/are obvious, obvious over, would have been obvious, anticipates, anticipated by, is/are not novel: 0 hits. Noun forms: one hit, the generated disclaimer in "Reference roles" ("asserts nothing about anticipation, obviousness or inventive step"). Working record "Wording review: No phrases flagged." The #733 refusal never fired. |
| A7 | Generated honesty sections present and drawn from the record | PASS | Chart "Limitations", generated block: 14 out-of-scope documents (JP, DE, US, GB) listed; "19 of 22 retrieved documents are not cited in any coverage row"; "1 search(es) could not be run and were not retried: … ((ti=breaker or ti=crusher) and ab=drum and ab=teeth and ab="four" and not pa="MMD")"; no classification query; drawing-reading caveat. Working record: "Second read" (18 elements judged, 18 agree, 0 disagree, 4 not judged), "Retrieved but not read", "Provenance". |
| A8 | No row disclosed on a bibliography anchor; every figure-based row carries "rests on a drawing reading" | PASS | Row anchors in the chart: EP0167178A2:description:en, WO2005072877A1:description:en, WO2005072877A1:claims:1:en, JP2004174393:figure:6 only; "bibliography" appears only in the "Retrieved documents" table. The three figure-based rows (claim 1 elements (a), (b); claim 3) each carry "rests on a drawing reading". Refusal 1 had rejected two JP2004174393A:bibliography anchors used as feature support. |

## Tier B — content

| # | Observation | Result | What was observed |
|---|-------------|--------|-------------------|
| B1 | Answer-key references on the right rungs | Partial | D3 (JP2004174393) is on claim 1 elements (a) and (b) ("disclosed in the cited art, rests on a drawing reading", figure page 6), on "Claim 1 as a whole", and on claim 3. Elements (c) and (d) (inner pair between outer pair; deposit region) are "not found in the cited art"; the OD found the proprietor's claim 1 not new over D3. D3's text is not served by the backend ("OPS serves no full text for these jurisdictions"), so the reading rests on drawings only. D1 (JP 9-155215) was never retrieved; D4 (WO0035585A1) was retrieved at 15:14:40Z and cited on no row. Source of D3: the `examiner_baseline` call (15:06:59Z) returned the B2's eleven applicant citations, which include JP2004174393 and WO0035585; the agent read D3 at 15:07:57Z before any search. Art of record, not model memory: the agent never named T 0693/17, a D-number, the opponent or the opposition. |
| B2 | The surviving rung is charted; verdict consistent with the decision | Consistent, with an open design question | Claim 3 is charted: "partially disclosed" by D3; element "a row containing at least four side-by-side breaker drum assemblies" met by "a sub-set of four" of D3's six rolls; element "each drum … rotating in a direction opposite to its immediately adjacent drum" "not disclosed in cited text". The OD held the rung new over D3 because D3 shows six rolls. So the chart does not cover the rung with D3 (consistent), and finds no art the division lacked. But the rung is "partly covered", not "not covered", so `notCovered` was empty and no Search Round ran for it. The litigator's question ("do the documents take care of all the fallbacks?") is answered "no" for claim 3 without a second search. Design question for the lead: should a partly covered rung count toward the nudge, or should the skill run the round for partial rungs too. |
| B3 | Prior-art eligibility right: critical date correct, every reference before it or flagged intermediate | Fail (lead's finding, confirmed) | Critical date 2004-09-27 is right. The row then says WO2005072877A1 "published 11 August 2005, before EP1809422's own filing date (26 September 2005), so it qualifies as ordinary Art. 54(2) EPC / pre-AIA 35 U.S.C. 102(b) state-of-the-art prior art". Recorded bibliography: WO2005072877A1 filed 2005-01-28, published 2005-08-11, priorities 2004-01-30 and 2004-03-26. Published after the critical date and before the filing date: an intermediate document, at most Art. 54(3) novelty-only art through its EP entry EP1725335; "102(b)" has no place in an EP chart. It is the main reference for claims 2, 4, 5, 6 and element (g). The chart flags nothing. Code can check this once the critical date is structured on the chart. |
| B4 | Figure readings correct on a spot check | One misread (lead's finding, confirmed on the saved page) | Claim 3 gap: "No rotation arrows or direction callouts are shown on the recorded drawing page". `references/figures/JP2004174393-page-6.png`, Fig. 5, draws a curved arrow on each of the six rolls (14), all turning the same way; Fig. 6 draws a rotation arrow on one roll. The status "partially disclosed" stands; the correct reason is that the arrows show same-direction rotation, which is evidence against the alternating-rotation limitation. The other two figure rows (claim 1 (a), (b): a row of toothed rolls, at least four) read correctly from Fig. 3 and Fig. 5. |
| B5 | Failed searches retried | Fail (lead's finding, confirmed) | Chart Limitations: "1 search(es) could not be run and were not retried: row of 4+ toothed breaker drums with inner pair feeding oversized material outward to outer pair ((ti=breaker or ti=crusher) and ab=drum and ab=teeth and ab="four" and not pa="MMD")" (15:09:41Z). A near variant without the `not pa` clause ran at 15:09:52Z and is logged as a separate search set; the failed query itself was not re-run. |
| B6 | Legal noun forms outside disclaimers | 0 | Chart and working record: the only noun-form hit is the generated disclaimer in "Reference roles". |

## Harness and run facts (outside both tiers)

### Receipt and coverage lines, verbatim

Receipt (16:49:06Z call, 45.9 s including the second read; digests shortened):

```
Prior-art artifact receipt: {"reportUri":"file:///…/e2-ep1809422-ws/analysis/EP1809422B1_invalidity_chart.md","reportDigest":"c8e1a6e5…","evidenceUri":"…/EP1809422B1_invalidity_chart.md.233a07f6-efb4-4535-a2eb-30f82995c024.evidence.json","evidenceDigest":"28464da5…"} fallbacksNotCovered=0 rounds=0 notCovered=
```

The on-disk chart's SHA-256 equals `reportDigest`. The same result said: "Second read
(anthropic/claude-sonnet-5): 18 elements judged, 0 not confirmed." No re-save was invited; the
agent's final message repeats each row's status word, states `fallbacksNotCovered=0, rounds=0`
and the figure-reading caveat, and adds no legal conclusion.

```
Claim 1: 2 of 7 elements disclosed; fallbacks: 1 of 5 covered (4 partly); not covered: none.
```

### write_patent_results: 19 attempts, 8 executions, 7 refusals, 1 save

| Call | Start (UTC) | Result |
|------|-------|--------|
| 1 | 15:39:24 | Refused (104 ms). Claims 4 and 5 charted with `fallbackOf` 3 and 4; claims 4 and 5 missing as rungs of claim 1; bibliography anchors used as feature support; anchors without evidence entries; a `disclosedBy` fragment not in the recorded text; a partial row with every element disclosed. |
| — | 15:51:27, 15:52:12, 15:53:04 | Rejected before execution by tool-input validation: "must NOT have fewer than 1 characters", then "must be array" twice. |
| — | 15:53:06 | Turn ended with a model-API error (quoted below). Idle until 16:40:16. |
| — | 16:41:56 | Rejected before execution: "must be array". |
| 2 | 16:42:17 | Refused (63 ms). Probe payload: claims 2–6 have no fallback row; limitations, stopReason and the combination row missing. |
| — | 16:42:59, 16:43:43, 16:44:21, 16:44:41 | Rejected before execution: "must be array" (4×). |
| 3 | 16:44:52 | Refused (53 ms). Same probe, same text as call 2. |
| — | 16:45:27, 16:45:59 | Rejected before execution: "must be array" (2×). |
| 4 | 16:46:08 | Refused (48 ms). Same text as call 2. |
| — | 16:46:20 | Rejected before execution: "must be array". |
| 5 | 16:46:28 | Refused (85 ms). Same text as call 2. |
| 6 | 16:47:20 | Refused (53 ms). Full draft: nine anchors without evidence entries; two partial rows with every element disclosed. |
| 7 | 16:48:12 | Refused (46 ms). Six description quotes not verbatim ("Copy it from evidenceLookup.anchor output"). |
| 8 | 16:49:06 | Saved (45.9 s). Receipt above. |

Calls 2–5 were the agent's own probes: at 16:44:41 it wrote "likely a size/length limit on the
`coverage` parameter", and at 16:47:20 "Found it — `limitations` must be an array of strings, not
a plain string." Every full result text is in the evidence appendix.

The turn-ending error, verbatim from the chat session store:

```
Sorry, your request failed. Please try again.
Client Request Id: 278debe4-95e2-49a7-850b-9d8c80f83001
Reason: 400 {"type":"error","error":{"type":"invalid_request_error","message":"You have reached your specified API usage limits. You will regain access on 2026-11-01 at 00:00 UTC."}}
```

### Prompts that appeared

None. The run profile held `chat.tools.global.autoApprove=true`, `chat.tools.urls.autoApprove`
for `https://*` and `http://*`, `chat.agent.maxRequests=1000` in `User/settings.json`, and
`chat.tools.global.autoApprove.optIn=true` in `state.vscdb` (checked after launch). The UI was
polled every 30 s from 15:07 to 15:37 and found no approval, opt-in, URL or request-limit prompt.
After 15:37 the poll was not re-armed; for that window the transcript shows every tool request
executing within 12 s of the model's request, so no tool waited on a click. `fetch_webpage` ran
twice and `search_npl` twice with no stop. The Cuozzo pilot's three stops did not recur.

### Time worked versus idle

| Window (UTC) | What happened |
|------|---------------|
| 15:06:37 | Prompt sent. |
| 15:06:40–15:39:24 | Search, reading, figures, first draft (33 min; thinking pauses of 2–4 min between calls at "High" reasoning). |
| 15:39:30–15:51:27 | Fixes after refusal 1: drawings of GB2088746A and JP2004174393A, evidence lookups (12 min). |
| 15:51:27–15:53:06 | Three drafts rejected by the input validator, then the turn died on the key's usage limit. |
| 15:53:06–16:40:16 | Idle 47 min 10 s. The chat showed "Try Again". Someone clicked it at 16:40:16; the acceptance operator did not. The model answered after the click, so the key or its limit had changed in between. |
| 16:40:16–16:49:06 | Eight more rejections, four probe refusals, two real refusals, then the save (9 min). |
| 16:49:06–16:50:01 | Second read and final message. Turn ended. |

Wall clock 1 h 43 min; model work about 56 min; idle 47 min; about 10 min of the work went to the
"must be array" loop.

## Defects and observations

1. **Tool-input validation names no field** (harness). Eleven writer requests were rejected with
   "Your input to the tool was invalid (must be array)" and the agent spent ten minutes and four
   probe saves finding that `limitations` was a string. The error should carry the JSON path. The
   rejected arguments are recorded nowhere (no ledger entry, no transcript event, no debug span).
   New issue.
2. **BYOK key usage limit ended the turn; a human "Try Again" resumed it** (environment). The
   click at 16:40:16Z is a second user message in a run meant to take one prompt. Acceptance
   protocol: check the key's remaining budget before an E2 run, and record who may click "Try
   Again". Not a product defect.
3. **B3, critical date row** (content, new issue): see Tier B. Candidate code guard: a
   structured critical date on the chart, then the writer compares each cited publication date
   and flags intermediate documents.
4. **B4, claim 3 gap text** (content, new issue): see Tier B.
5. **B2, partly covered rung never triggers a Search Round** (design): see Tier B. Decision for
   the lead.
6. **B5, failed search not retried** (content): see Tier B. The skill's search-failure ladder
   asks for a retry; the writer only reports it.
7. **Kind-code duplicates persist** (#729 family). "Retrieved documents" lists JP2004174393A and
   JP2004174393, GB2088746A and GB2088746 as separate rows; the figure anchors carry no kind code
   and the text anchors do.
8. **No "Search rounds" section when no round ran and nothing is not covered.** The stop is
   stated only in the model's Limitations prose. A generated one-liner would make A5 readable
   from generated text. Observation.
9. **Transcript stops before the save.** The copilot-agent jsonl ends at 16:49:05 with the
   model's last message; the save's execution events and the final message are only in the debug
   log and the chat session store. Observation (harness).
10. **The chart was open with unsaved edits at 16:54Z** in the IDE's editor (tab dirty, cursor
    at line 333). The on-disk file matches the receipt digest; the edits' origin is unknown and
    the operator did not save them. Observation.

## Setup

- Code: `origin/feat/725-round-after-save` at c592746c41b (main at #733 plus #725, merged to main
  as #737 during the run) with `origin/feat/731-unattended-launch` (034f793aaf4, #736) merged on
  top; worktree `/Users/abdullahatrash/flowleap/wt-e2-ep1809422`.
- Build: core `out/` copied from the main checkout (a613c13d060, `integration/drawings-d1-d4`),
  one core diff patched by hand (`searchRegister` in
  `out/vs/workbench/contrib/chat/common/tools/patentChatToolReferenceNames.js`; the other core
  diffs are remote-access and agent-host code the patent chat does not use). Copilot extension
  built in the worktree with `node .esbuild.mts --dev`. The main checkout's `build/node_modules`
  and every built-in extension's `node_modules` were empty (cleaned 2026-10-17 12:14), so the
  worktree ran `npm ci --ignore-scripts` for `build/` and nine built-in extensions and linked
  `.build/electron` from the main checkout.
- Launch: `control-flowleap-ide up --unattended --seed-profile "~/Library/Application Support/code-oss-dev"`
  (`~/.vscode-oss-dev` holds no `User/` directory; the Application Support profile is the
  founder's dev profile with the BYOK keys). Run `vfl-20261017T180034-57307`, run dir
  `/tmp/code-oss-dev/20261017-180034-57316`.
- Doctor: four of six checks ok. `no-extension-load-failures` stayed red because `code.log` is
  cumulative and holds the activation failures from before the `npm ci` fix (none after the
  reload at 18:05 local). `window-title-marker` stayed red because the title carries the
  workspace name ("Welcome — e2-ep1809422-ws"). Both benign for this run.
- Model: the profile defaulted to Claude Sonnet 5.5; Claude Sonnet 5 picked from "Other Models"
  (Anthropic BYOK group) before the prompt. Mode Agent, reasoning High.
- Workspace: fresh empty folder `…/scratchpad/e2-ep1809422-ws`, trusted through the Workspace
  Trust editor. Prompt pasted and sent at 15:06:37Z.

## Evidence

- Evidence appendix (every tool call with UTC time, the eleven pre-execution rejections, the
  turn-ending error and the eight writer results in full):
  `docs/reviews/2026-10-17-fallback-coverage-acceptance-ep1809422.tool-calls.txt`
- Kept outside the repository in the session scratchpad under `e2-ep1809422-evidence/`: the saved
  chart, working record, evidence companion, second-read JSON, the figure pages, the copilot-agent
  transcript, the debug log, the chat session store, the execution ledger (with the `save`
  record), `code.log`, and the screenshots and ARIA snapshots of the launch, trust, model picker,
  prompt and end state.
