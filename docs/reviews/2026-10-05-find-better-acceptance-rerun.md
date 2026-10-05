# Find Better acceptance rerun: PRD 0019 F5 (#505), runs (a) and (b)

Date: 2026-10-05
Build: `main` at `43d179a2394` (#534 typed `examiner_baseline` tool, Baseline integrity check, "Search incomplete" rule, hop-1/hop-2 convention, examiner art without X/Y; #530 new worked example EP2743895B1). Dev build from a worktree (`out/` transpiled, `extensions/copilot` compiled, built-in extensions compiled).
Method: `verify-flowleap-ide` (`up --seed-profile ~/Library/Application Support/code-oss-dev`), **one window and one user-data-dir for both runs**. Only the workspace folder changed: `/tmp/fb-rerun/run-a`, then `/tmp/fb-rerun/run-b` (both fresh and empty, opened with File > Open in the same window, then trusted). The founder signed in to FlowLeap once, by hand. The Accounts menu then showed the FlowLeap account and the Settings view showed "Active". Editor Patent Agent chat, model **Anthropic: Claude Sonnet 5.5** (BYOK, reasoning effort Medium), permission picker **Allow all**.
Backend: production. CLI on the PATH for the reviewer's hand checks: `flowleap 0.9.0`.
Previous review: `docs/reviews/2026-10-05-find-better-acceptance.md` (1 of 3 PASS).

## Verdict

**2 of 2 runs PASS, with notes.** All four fixes from #534 work in the live app: the typed tool wrote the full Baseline, the writer checked completeness, Track 1 logged hop 1 and hop 2, and a US Baseline without X/Y saved with examiner-cited art as the examiner's best art.

| Run | Target | Verdict | Notes |
|---|---|---|---|
| (a) | EP2110298B1 | PASS (with notes) | The first save had no second read: the judge request failed on a network error, and the writer did not try again (#538). After one user message the model saved again, and the second read ran. It answered the objections over five saves and then stopped, because the objections changed on each pass (#538). |
| (b) | US6778074B1 (Cuozzo) | PASS on the fallback branch | No IPR reference surfaced. All three tracks ran with real queries and counts, hop 2 included, and every result line is honest. The tools can find Evans and Wendt. The model's Track 3 terms excluded them (#539). |

Read the (b) PASS carefully before you show it to the evaluator. The pass line accepts "an honest complete tracks log". A user who asks "did the examiner miss the IPR art?" still does not get Evans or Wendt. #539 is the fix.

## Issues filed

- #537 — Find Better report: the tracks log marks recorded queries as unverified when the query text has a note; the best-art header repeats one document (`EP1162102A2, EP1162102`).
- #538 — Second read: one network error skips it with no retry, and the objections change on every re-save.
- #539 — Find Better Track 3: no relaxation pass, so the Cuozzo IPR art (Evans, Wendt) is missed although the tools can find it.

## Run (a): EP2110298B1

**Prompt (exact):** `Run Find Better on EP2110298B1.`
Follow-up (exact, sent by the reviewer after the first save reported the skipped second read): `The second read was skipped because the judge request failed. Save the report again so the second read runs.`
Session: 33 steps in 11 min 33 s (17:14 → 17:25), then the follow-up (17:35 → about 17:47, five saves).

**What the model did.** It read the `find-better` skill and called the typed `examiner_baseline` tool once (log: `[ExaminerBaselineTool] Saved the Examiner Baseline of EP2110298B1 to references/EP2110298B1.examiner-baseline.json (57 documents)`). It read the claims and the X documents, then ran Track 1 hop 1 (the cited lists of US4964287, US5135330, US4763957, US2007052285) and hop 2 (the cited lists of US4028915, US4621873, US4770011, which are hop-1 documents outside the Baseline). Track 2 covered Cusack and the inventors of three X documents, plus one academic query. Track 3 used five B62K25/02 queries with skewer/cam/lobe/detent terms. It viewed figures of US4964287, US4763957 and US2004046353. It saved on the second write.

**Against the pass line**

| Check | Result |
|---|---|
| Baseline via the typed `examiner_baseline` tool, file in `references/`, 57 documents, no truncation | PASS: 57 documents, no `_truncation`. The file equals `flowleap tools run examiner_baseline` byte for byte, except the volatile provenance fields. |
| The writer's receipt states that the completeness check passed | PASS: working record, Provenance: "The writer checked its shape, its X/Y categories and that documents[] holds every citation membersWalked counts". |
| Baseline equals the answer key | PASS: EP2110298A3 X documents US4964287, US2007052285, US5135330, US4763957; `EP1602570 A1 | X cl. 13, A cl. 1,5,9 [applicant]`; gap row "no USPTO enriched-citation record for US8056987B2 (application 12756531)". Member table: A2 1, A3 5 (4/1), US7722129B2 49 (5/44), US8056987B2 50 (6/44). "Cited documents: 57." |
| All three tracks logged with queries; Track 1 has hop 1 AND hop 2 | PASS: 4 hop-1 rows, 3 hop-2 rows, 5 Track 2 rows, 5 Track 3 rows. Note: 3 Track 2 rows say "not in the execution record" although the search log has them (#537). |
| Result line "No better art found" only if the tracks are complete | PASS: "No better art found for claim 1; the examiner's best art remains US4964287, US5135330 (disclosed 0 of 4)." Claims 6 and 10 are the same shape. The writer did not mark the search incomplete. |
| Found art predates 2009-01-19 | PASS: the model used the stricter critical date 2008-04-16 (US priority). Every best-art-found document (US2004046353A1 2004, US2007052286A1 2007) predates it. |
| The ≥3-lobe element is not anticipated | PASS: "Claim 1 — element (d): cam profile includes at least three lobes | not found | not found". The three lobe/detent Track 3 queries returned 0. |
| Report, working record, evidence, second read saved | PASS after the follow-up. First save: "Second read: skipped (judge request failed)" (`net::ERR_CONNECTION_CLOSED` on the judge call). Final save: "Second read by anthropic/claude-sonnet-5: 21 elements judged, 3 not confirmed". `.second-read.json` is present (#538). |
| Chat summary repeats the saved n-of-m | PASS: both final chat and report say claim 1 0 of 4 / 0 of 4, claim 6 0 of 2 / 0 of 2, claim 10 0 of 2 / 0 of 2. The chat also explains why claim 1 went from 2 of 4 (first save) to 0 of 4. |
| Zero fabricated references | PASS: 81 distinct numbers in the report and working record. 64 are in the Baseline, and 16 resolve with `flowleap ops biblio`. The remaining one, `US20080103744`, is the epodoc form of the US priority application 12/103,744 (filed 2008-04-16), which `get_patent_summary` returned. It is not a publication, and the report labels it as the priority. |

**Second-read passes.** The judge's objections were correct in substance. For example, eccentric portions and detent indentations are not the claimed lobed cam, and a separate cam-lever head is not the claimed head portion. The model downgraded the rows (claim 1 examiner's art 2 of 4 → 0 of 4). But each pass judged reworded rows and raised new objections: 6, then 4, …, then 3 not confirmed. The model stopped after five saves and listed the three open points in chat. #538 asks for a stop rule.

**Espacenet per member (Chrome, by hand)**

| Member | Espacenet "Cited documents" | Baseline `membersWalked` |
|---|---|---|
| EP2110298A3 | 4 SEA (US4964287A, US2007052285A1, US5135330A, US4763957A) | 5 (4 examiner + EP1602570 applicant-marked X,A cl. 13), as in the first review |
| US7722129B2 | 49 (5 SEA, 44 APP) | 49 (5 / 44) |
| US8056987B2 | 50 (6 SEA, 44 APP) | 50 (6 / 44) |

Screenshots: [signed in](../media/find-better-acceptance-rerun/a-signed-in.jpg), [first save](../media/find-better-acceptance-rerun/a-editor-first-save.jpg), [second-read passes](../media/find-better-acceptance-rerun/a-second-read-passes.jpg), [Espacenet EP2110298A3](../media/find-better-acceptance-rerun/a-espacenet-EP2110298A3-cited.jpg), [Espacenet US7722129B2](../media/find-better-acceptance-rerun/a-espacenet-US7722129B2-cited.jpg).

## Run (b): US6778074B1 (Cuozzo)

**Prompt (exact):** `Run Find Better on US6778074B1.`
Session: 17:52 → about 18:02, no follow-up.

**What the model did.** It called the typed Baseline tool (12 documents, all examiner, no category; gap: no USPTO office-action citation record for application 10100378). It took the examiner's best art from the examiner-cited documents and ranked them itself: claim 1 US4935850, US5485161 (US6265989 named but not scored); claim 10 US5485161, US4935850; claim 20 US6265989, US5485161. The writer accepted this and showed "(examiner-cited, no category)" beside each. Critical date 2002-03-18 (filing date, the only priority). Track 1 hop 1 used the cited lists of six examiner documents, and hop 2 used four hop-1 documents. Track 2: `in="CUOZZO"` (38), `in="CUOZZO GIUSEPPE"` (0), the inventors of three examiner documents, and one academic query (5). Track 3: six classification + term queries (G01D7/00, G01P1/08, G01P1/10 with speedometer/limit/colour terms; 0 to 34 hits). Several calls got HTTP 503 and were retried once. Best art found: EP1162102A2 (2001-12-12, "Speed indication using navigation unit"). It also retrieved, as abstracts only, DE2520195A1 (1976, "Automatic speed limit warning speedometer"), GB2301924A, SE8803015L, JP2001281001A and GB2363200A, and said they were not scored.

**Against the pass line**

| Check | Result |
|---|---|
| The save succeeds with examiner-cited art accepted as the examiner's best art | PASS: "Examiner's best art (US4935850 (examiner-cited, no category), US5485161 (examiner-cited, no category))". |
| All three tracks ran with real queries and counts, hop 2 included | PASS: 6 hop-1 rows, 4 hop-2 rows, 6 Track 2 rows, 6 Track 3 rows. Four rows say "not in the execution record" because the model added "(first call HTTP 503, retried)" to the query text (#537). |
| At least one IPR reference surfaces | **No.** None of Evans, Wendt, Tegethoff or Aumayer is in the report, the working record or the evidence file. |
| … OR the log shows the query that should have found it, with "Search incomplete" or an honest "No better art found" over a complete log | **Met.** The G01P1/10 query (the class of Evans and Wendt) is logged with its count, `ic=G01P1/10 and ta=speedometer and ta=limit and pd<20020318`, 34 hits. Its `ta=limit` term excluded Evans and its `ta=speedometer` term excluded Wendt (see the hand check). Result lines: claim 1 "the best art found (EP1162102A2, EP1162102) discloses 1 of 3 elements; the examiner's best art US4935850, US5485161 discloses 0 of 3"; claim 10 "No better art found … (disclosed 1 of 3)"; claim 20 "No better art found … (disclosed 2 of 4)". The writer saw no incomplete track. The chat states the limits: 25 of 34 rows previewed, partial hop 2, and the abstract-only documents. |
| Second read | 30 elements judged, 0 not confirmed, 1 not judged (figure). |
| Chat summary repeats the saved n-of-m | PASS: claim 1 0/3 vs 1/3, claim 10 1/3 vs 1/3, claim 20 2/4 vs 1/4, the same as the report. |
| Zero fabricated references | PASS: 45 distinct numbers. 20 are in the Baseline, 25 resolve with `flowleap ops biblio`, and 0 do not resolve. |
| Baseline per member matches Espacenet | PASS: US6778074B1 12 = 12 (all SEA). |

Screenshots: [tracks running](../media/find-better-acceptance-rerun/b-tracks-running.jpg), [editor at the end](../media/find-better-acceptance-rerun/b-editor-final.jpg), [Espacenet US6778074B1 cited documents](../media/find-better-acceptance-rerun/b-espacenet-US6778074B1-cited.jpg).

### Hand check: were the four IPR references findable with the tools?

The critical date was read with the tool: `flowleap --json ops biblio US6778074` gives filing 2002-03-18 and one priority, US 2002-03-18. **The critical date is 2002-03-18, not 2000-01-25.**

| Reference | `ops biblio` (pn) | Published | A classification + Discriminating Term query that finds it, before 2002-03-18 (total hits) | Verdict |
|---|---|---|---|---|
| Evans US3980041 | resolves; CPC B60K35/60, G01P1/08, G01P1/10 | 1976-09-14 | `cpc=G01P1/10 AND ta=speedometer` (54); `ta="speed warning"` (158); `ic=G01P1/10 and ta=speedometer` (123) | **Findable.** The run's query added `ta=limit` (34) and lost it. |
| Wendt US2711153 | resolves; CPC G01P1/10; **no abstract in OPS** | 1955-06-21 | `cpc=G01P1/10 AND ta="speed limit"` (36); `ti="speed limit indicator"` (10) | **Findable.** Title-only document. Each run query required `speedometer`. |
| Tegethoff DE19755470A1 | resolves; 38 CPC incl. G01P1/10, B60K35/213 | 1998-09-24 | `cpc=G01P1/10` alone (843); `cpc=B60K35/213` (78). Each "speed limit" phrase query missed it. | **Weakly findable.** Only a wide classification-only query finds it. |
| Aumayer US6633811B1 | resolves | 2003-10-14 | none (published after the critical date; DE priority DE19950156C1 2001-05-10 also not found by any phrase query tried) | **Not findable by design** with a `pd<` filter (it is 35 USC 102(e) art). |

Track 1 cannot reach any of them: the 12 examiner documents cite 107 distinct documents within two hops, and none cites an IPR reference (`/tmp/fb-rerun/hops.sh`, output 0 hits). So the gap is in Track 3 term choice, and #539 proposes a relaxation pass plus a title-phrase query for old US art.

## Deviations and environment notes

- The founder signed in by hand once, after the reviewer's one message to the lead. The sign-in held across the workspace switch.
- `doctor` reports `window-title-marker` false when a folder is open (known, as in the first review).
- The reviewer sent one follow-up in run (a) to get a second read. Without it, the run fails the "second read saved" item.
- The Agents Window copy of the skill (`src/vs/sessions/skills/recipe-find-better/references/`) still uses EP2110298B1 as its worked example. The editor chat skill does not, and this rerun used the editor chat only. `assets/skills/investigation-record/references/row-format.md` mentions EP2110298B1 dates, but not its citations.
- `control-flowleap-ide down` removed the run's profile directory, so the extension-host log lines quoted in #538 are recorded in the issue, not on disk.

## Reproduce

```bash
# Baseline answer key (released CLI, facade tool):
flowleap --json tools run examiner_baseline --input '{"publication":"EP2110298B1"}' | jq '.documents | length'   # 57
# Cuozzo hand checks:
flowleap --json ops biblio US6778074 | jq '.dates'                                                     # filing/priority 2002-03-18
flowleap --json ops search --cql 'cpc=G01P1/10 AND ta=speedometer AND pd<20020318' --end 100 | grep -c US3980041
flowleap --json ops search --cql 'cpc=G01P1/10 AND ta="speed limit" AND pd<20020318' --end 100 | grep -c US2711153
# App: .claude/skills/verify-flowleap-ide/scripts/control-flowleap-ide up --seed-profile "$HOME/Library/Application Support/code-oss-dev" -- /tmp/fb-rerun/run-a
```
