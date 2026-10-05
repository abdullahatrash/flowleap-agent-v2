# Find Better acceptance — PRD 0019 F5 (#505)

Date: 2026-10-05
Build: `main` at `b33ae051d4f` (#510 find-better-report + #513 find-better skill merged; #512 not merged), dev build from a worktree (`out/` transpiled, `extensions/copilot` compiled).
Method: `verify-flowleap-ide` (`up --seed-profile ~/Library/Application Support/code-oss-dev`), one fresh empty workspace folder per run under `/tmp/fb-acceptance/`, editor Patent Agent chat, model **Anthropic: Claude Sonnet 5.5** (BYOK via OpenRouter, reasoning effort Medium), permission picker set to **Allow all**.
Backend: production `api.flowleap.co`, `examiner_baseline` facade tool live.
CLI on the PATH: `flowleap 0.9.0` (`~/.local/bin`). The released CLI (0.9.0 and 0.9.1) has **no** `patent examiner-baseline` verb; it is merged on flowleap-cli main (#127) but not released. A CLI built from flowleap-cli main was used only by the reviewer, to cross-check the Baseline.

## Verdict

**1 of 3 runs PASS.** Run (c) meets its pass line; runs (a) and (b) do not. The bar "Baseline per member matches Espacenet" fails in run (a).

| Run | Target | Verdict | Blocking reason |
|---|---|---|---|
| (a) | EP2110298B1 | FAIL | The Baseline was truncated (53 of 57 documents) and rendered as complete (#526). Track 1 was not run (#529). The skill carries the answer key for this patent (#527), so this run cannot show that the model derived it. |
| (b) | US6778074B1 (Cuozzo) | FAIL | None of the IPR references surfaced, and no report or tracks log was saved: the writer needs X/Y-categorised examiner art and this US Baseline has none (#531). The model found other uncited earlier art (EP1162102A2) and said so honestly. |
| (c) | EP3925734B1 | PASS (with notes) | The report renders complete with "No better art found for claim 1; the examiner's best art remains …", the full Baseline (22 = 22), and no fabricated reference. Notes in #529. |

Agent Session (Agents Window) for run (a): **not run.** The Agents Window opened in the dev build with Claude signed in (model "Sonnet"), and a fresh folder `run-a-agents` was trusted and chosen ([screenshot](../media/find-better-acceptance/a-agents-window-ready.jpg)). The reviewer's own harness (Claude Code auto-mode permission classifier) then refused to drive a Claude agent session ("Create Unsafe Agents"), first for the Bypass Permissions mode and then for sending the prompt at all. Not a product finding; it needs a human to send the prompt.

## Issues filed

- #526 — Find Better: the Examiner Baseline is silently truncated in the editor chat (`patent_api_request` 50k budget drops 4 of 57 documents; the writer accepts it).
- #527 — find-better skill: the worked example is the F5 acceptance target EP2110298B1 (the answer key leaks into run a); a blocked run reached for it. Comment: run (c) shows the same pressure to save while blocked.
- #529 — Find Better report: "No better art found" is rendered over a skipped mandatory track, and names examiner documents that were never scored.
- #531 — Find Better cannot save a report for a US patent whose citations carry no X/Y category (`examinerBestArt` requires X/Y; Track 1 never starts).
- Known, not refiled: #523 (priority date prints as `[object Object]`). Both runs hit it; run (a) inferred the critical date from the US filing date, run (c) read it from a Google Patents page.

## Environment notes (not product defects)

- **Sign-in in the cloned profile.** Every run started with 401 from the patent tools: the seeded profile clone does not carry a working FlowLeap session (memory `l4-acceptance-verify-and-local-dev-recipe`). Run (a) recovered in the same turn without a visible user action. In run (c) a human signed in by hand and typed "signin works" into the chat (that message is not the reviewer's). Run (b) ran in a relaunched window (`run-b2`) after the founder signed in by hand; the first run-(b) window stayed signed out and only answered with the 401 (see run b).
- `doctor` reports `window-title-marker` false when a folder is open (the title is the folder name, not "FlowLeap"). All other checks passed.
- Enter in the chat input did not send in two of the instances; the Send button did.

## Run (a) — EP2110298B1

**Prompt (exact):** `Run Find Better on EP2110298B1.`
Session: 38 tool calls, 15:54 → 16:01 (about 7 minutes). Workspace `/tmp/fb-acceptance/run-a`.

**What the model did**

1. Read the `find-better` skill and its `tracks.md` and `baseline-json.md` references (calls 1–3).
2. Ran `flowleap --json patent examiner-baseline EP2110298B1 > references/…json` in the terminal. The installed CLI answered "unrecognized subcommand". The model removed the error file.
3. Called the facade tool through `patent_api_request` (`POST /tools/examiner_baseline`). First answer: 401. The model stopped correctly ("Neither source of the Examiner Baseline is available, and I'm not rebuilding it from other calls"), then continued in the same turn and tried a structured save that named US5135330 as the examiner's best art. That document came from the skill's worked example, not from a tool result; the writer refused the save (#527).
4. Retried the facade: it answered. The result was truncated by the tool's 50,000-character budget (`_truncation: omittedItems 4, retainedItems 53`). The model copied `data` from the stored tool result into `references/EP2110298B1.examiner-baseline.json` with a Python one-liner (an unedited copy of what it received, not an assembly) and passed it as `baselinePath`.
5. Read the claims and the X documents' claims (US5135330, US4964287, US4763957), ran 2 Track 3 queries (0 and 0 hits) and the Track 2 inventor queries (Cusack: 1 hit; Gaul: 503 twice). Track 1 was not run.
6. Saved `outputs/EP2110298B1.find-better-report.md` on the fourth write attempt (the writer asked for drawings first, then a malformed call dropped `baselinePath`).

**Against the pass line**

| Check | Result |
|---|---|
| Baseline from the CLI verb or the examiner_baseline tool, never assembled from get_family / get_bibliography / search_citations | PASS — from the facade tool via `patent_api_request`; the tool log has no `search_citations`, and `get_patent_family` was called only after the Baseline, for the priority date. The working record states "Examiner Baseline source: file references/EP2110298B1.examiner-baseline.json". |
| Baseline equals the answer key: five A3 citations incl. EP1602570 X claim 13, and the US8056987B2 enriched gap row | PASS on the key rows (US5135330, US4964287, US2007052285, US4763957 X; EP1602570 X,A cl. 13 marked `[applicant]`; gap row present). But see the next row. |
| Baseline per member matches Espacenet | **FAIL** — the matrix has 53 documents; the full Baseline has 57. Missing: US6386643, US6454363, US6742849, US7000995 (US applicant citations). Espacenet: US7722129B2 cites 49 and US8056987B2 cites 50, the same as `membersWalked`, so the rendered member table and the matrix contradict each other (#526). |
| Found art predates 2009-01-19 | PASS (vacuous) — no candidate was found. The one Track 2 hit, US2005012299A1 (2005, a carbon fork), predates; it was not read. |
| The ≥3-lobe element stays un-anticipated | PASS — "Claim 1 — element (d): the cam profile includes at least three lobes": not found in both columns. |
| Report saved with `find-better-report`, structured, with working record, evidence companion and second read | PASS — four files; second read 8 elements judged, 0 not confirmed; wording review clean. |
| Chat summary repeats the saved n-of-m | PASS — "disclosed 0 of 4" (claim 1), 0 of 3 (claims 6, 10) in both. |
| Zero fabricated references | PASS on disk — every number in the report resolves (US2005012299A1, US2007052286A1, EP1602570A1 checked with `flowleap ops biblio`). The one invented entry (US5135330 before the Baseline existed) was refused by the writer. |
| Zero quotes not found | PASS — the writer accepted every quote; all quotes are claim text. |

**Other observations.** The examiner's X art scores 0 of 4 on claim 1 because the model read claims only (no US descriptions) and did not read two of three drawing sets. `examinerBestArt` equals the skill's worked example row for row, and the model says the claim 6 and 10 mapping is "provisional", so the concordance was taken, not derived (#527). Critical date 2008-04-16 (inferred, #523).

Screenshots: [editor at the end](../media/find-better-acceptance/a-editor-final.jpg), [Espacenet EP2110298A3 cited documents](../media/find-better-acceptance/a-espacenet-EP2110298A3-cited-1.jpg), [Espacenet US8056987B2 cited documents](../media/find-better-acceptance/a-espacenet-US8056987B2-cited.jpg).

**Espacenet per member (Chrome, by hand):**

| Member | Espacenet "Cited documents" | Baseline `membersWalked` | Rendered matrix |
|---|---|---|---|
| EP2110298A2 | 1 (APP US4964287A) | 1 (0 / 1) | 1 |
| EP2110298A3 | 4 (SEA: US4964287A, US2007052285A1, US5135330A, US4763957A) | 5 (4 / 1) | 5 |
| US7722129B2 | 49 | 49 | fewer (4 dropped) |
| US8056987B2 | 50 | 50 | fewer (4 dropped) |

The EP2110298A3 difference is EP1602570: OPS lists it on the A3 as an applicant-marked citation with category X,A on claim 13, and Espacenet's Citations tab shows only the four search-report (SEA) rows. The examiner counts agree (4 = 4).

## Run (b) — US6778074B1 (art not of record used in an IPR)

**Choice and source.** US6778074B1 (Cuozzo Speed Technologies, "Speed limit indicator and method for displaying speed and the relevant speed limit"), filed 2002-03-18. In IPR2012-00001 (*Garmin v. Cuozzo*, the first PTAB final written decision, Paper 59, 2013-11-13) the Board held claims 10, 14 and 17 unpatentable as obvious over Aumayer (US 6,633,811), Evans (US 3,980,041) and Wendt (US 2,711,153), and alternatively over Tegethoff (DE 197 55 470), Awada (US 6,515,596), Evans and Wendt. Source: *In re Cuozzo Speed Technologies*, 793 F.3d 1268 (Fed. Cir. 2015), slip op. p. 3–4 (the grounds and the reference numbers). Of these, only Awada (US6515596) is in the examiner's citations; **Evans, Wendt, Tegethoff and Aumayer are art not of record**. Note: Aumayer was published 2003-10-14, after the filing date (it is 35 USC 102(e) art), so a `pd<` filter by design never finds it; Evans (1976), Wendt (1955) and Tegethoff (1999) predate.

**Prompt (exact):** `Did the examiner miss better prior art for US6778074B1? I want to know whether there is earlier or closer art than what was cited during prosecution.`
First window (`run-b`): the patent tools answered 401 and the window could not be signed in from the cloned profile; the model stopped correctly and asked for sign-in (no save attempt). A follow-up "I'm signed in to FlowLeap. Please continue." got another 401. The window was closed and relaunched as `run-b2`; the founder signed in by hand; the same prompt was sent again at 16:40.
Session (`run-b2`): 24 tool calls, 16:40 → about 16:46.

**What the model did.** The `find-better` skill triggered without being named. CLI verb missing; Baseline from the facade (`patent_api_request`), 12 documents, all `examiner`, no category; USPTO enriched record empty (gap). Read the claims (independent claims 1, 10, 20), ran `search_citations` on application 10100378 (empty), four Track 3 style queries (one of them a broad `ta="speed limit" AND ta=speedometer AND pd<20020318`: 68 hits, 17 looked at), the inventor query (`in="CUOZZO GIUSEPPE"`, 503 twice), a CPC G01P1/103 query (503), forward citations (0) and legal status (it noticed three IPRs and the 2018 IPR certificate but did not open them). It read EP1162102A2 (Howard, 2001-12-12, "Speed indication using navigation unit") and mapped it in chat: GPS, speed-limit database and coloured indication disclosed; "integrally attached to the speedometer" not found. It did **not** save a report: "I did not save a formal Find Better report, because that report requires X/Y-categorised art" (#531). Track 1 not run for the same reason.

**Against the pass line**

| Check | Result |
|---|---|
| Find Better surfaces at least one of the IPR references | **FAIL** — none of Evans, Wendt, Tegethoff (or Aumayer) appears. |
| … or the tracks log shows the query that should have found it, and its count | **FAIL** — no report, so no tracks log. The chat lists the queries. The reviewer re-ran the broad query: 68 hits, none of the four references among them (Evans, "Speedometer with speed warning indicator…", 1976, has no "speed limit" phrase in its title; Wendt, "Automobile speed limit indicator", 1955, has no "speedometer" in its title and old US documents carry no abstract in OPS, so an AND of both terms misses each; Tegethoff, "Anzeigesystem für Fahrzeuge", is German). Track 1 (two hops from the cited art) never started. |
| Baseline per member matches Espacenet | PASS — US6778074B1: 12 = 12 (all SEA). |
| Zero fabricated references | PASS — EP1162102A2, GB2363200A resolve (`flowleap ops biblio`). |
| Zero quotes not found | n/a — no writer save; the chat quotes EP1162102A2 text the model read (not validated by a writer). |

Screenshots: [editor at the end](../media/find-better-acceptance/b-editor-final.jpg), [Espacenet US6778074B1 cited documents](../media/find-better-acceptance/b-espacenet-US6778074B1-cited.jpg).

## Run (c) — EP3925734B1 (no better art expected)

**Choice.** EP3925734B1 (Simian Ltd, "Gripping tool"), priority JP 2019-07-17, one independent claim, search report EP3925734A4 with three citations (EP0010693 X, US4330936 X, WO2019163506 X,P). Picked by the reviewer for a small, recent EP family with a clean search report; five offices (EP, CN, JP, US, WO) so the gap rendering is exercised.

**Prompt (exact):** `Run Find Better on EP3925734B1.` A human then typed `signin works` after signing in by hand (not the reviewer).
Session: 42 tool calls, 16:11 → 16:21. Workspace `/tmp/fb-acceptance/run-c`.

**What the model did.** Same opening as run (a): CLI verb missing, facade 401, two refused write attempts while blocked (#527 comment), stop and ask for sign-in. After sign-in: facade Baseline (22 documents, no truncation, saved as `references/EP3925734B1.examiner-baseline.json` with `jq '.data'` from the stored tool result), claims, the three X documents, figures of WO2019163506 and EP0010693, Track 1 hop 1 (cited-reference lists of the three X documents), Track 2 (Hantani, Swarth, Baierl), Track 3 (three CPC queries: 0, 0, 42 hits), one candidate WO2017183442A1 (2017, same inventor) read and scored. Priority date read from a Google Patents page (#523).

**Against the pass line**

| Check | Result |
|---|---|
| Report renders complete with "No better art found for claim N; the examiner's best art remains …" | PASS — "No better art found for claim 1; the examiner's best art remains EP0010693, US4330936, WO2019163506 (disclosed 6 of 6)." Best art found WO2017183442A1: disclosed 1 of 6. |
| Full Baseline | PASS — 22 documents, 5 offices, 11 publication reads, 1 gap ("no USPTO enriched-citation record for US11498188B2 (application 17439552)"). |
| Baseline per member matches Espacenet | PASS — EP3925734A4: 3 = 3 (SEA WO2019163506A1, EP0010693A1, US4330936A); US11498188B2: 16 = 16 (5 SEA + 11 APP). |
| No fabricated reference | PASS — WO2017183442A1, JP2019146954A, WO2019163506A1 resolve. |
| Zero quotes not found | PASS — writer accepted; second read 23 elements judged, 0 not confirmed, 2 not judged (figure). Note: three quoted sources are Japanese or German text; the report says those readings are the model's own translation. |
| Chat summary repeats the saved n-of-m | PASS — "examiner's best art disclosed 6 of 6. Best art found disclosed 1 of 6." |

**Notes (#529).** The result line names three examiner documents, but every examiner-side row cites WO2019163506 only (EP0010693 and US4330936 "were not scored element by element"), and WO2019163506 is an X,P document published after the priority date. The model flagged this in Limitations; the result sentence does not. Track 1 hop 2 was not run.

Screenshots: [editor at the end](../media/find-better-acceptance/c-editor-final.jpg), [Espacenet EP3925734A4](../media/find-better-acceptance/c-espacenet-EP3925734A4-cited.jpg), [Espacenet US11498188B2](../media/find-better-acceptance/c-espacenet-US11498188B2-cited.jpg).

## Reproduce

```bash
# Baseline cross-check (released CLI, facade tool; unwrapped and untruncated):
flowleap --json tools run examiner_baseline --input '{"publication":"EP2110298B1"}' | jq '.documents | length'   # 57
# CLI verb (flowleap-cli main, unreleased):
flowleap --json patent examiner-baseline EP2110298B1 | jq '.documents | length'                                 # 57
# App: .claude/skills/verify-flowleap-ide/scripts/control-flowleap-ide up --seed-profile "$HOME/Library/Application Support/code-oss-dev" -- /tmp/fb-acceptance/run-x
```
