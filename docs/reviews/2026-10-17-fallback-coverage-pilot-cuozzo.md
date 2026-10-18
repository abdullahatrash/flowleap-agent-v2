# Fallback Coverage pilot: US6778074B1 (Cuozzo), 2026-10-17

Pilot for #711 (slice E2 of PRD 0024). One live run in the real FlowLeap IDE, editor Patent Agent
chat, Claude Sonnet 5, fresh empty workspace, prose prompt:

> Prepare an invalidity chart for US6778074B1. Attack claims 10, 14 and 17; chart the fallbacks too and save the chart in analysis/US6778074B1_invalidity_chart.md.

Answer key: IPR2012-00001, final written decision 2013-11-13. Claims 10, 14 and 17 held unpatentable
over Aumayer (US6633811) + Evans (US3980041) + Wendt (US2711153), and over Tegethoff (DE19755470)
+ Awada + Evans + Wendt.

## Verdict: PARTIAL PASS. The feature works end to end; the chart misses the E2 bar on wording and on the answer-key art.

The Fallback Coverage machinery is true in the live app. The writer computed the ladder, refused
two bad saves with correct reasons, and printed the receipt with the coverage counts. The Search
Round is ledger-matched and the agent stopped after one. The chart content fails two E2 checks:
nine legal-conclusion phrases reached the saved chart, and only one of the four answer-key
references was charted.

| # | Point | Grade |
|---|-------|-------|
| 1 | Saved through the validated writer, receipt with `fallbacksNotCovered=… rounds=… notCovered=…` | PASS |
| 2 | Fallback coverage section lists 14 and 17 under 10 with recorded claim text | PASS |
| 3 | Answer-key references on the right rows | PARTIAL: Aumayer only |
| 4 | Search Round ran for not-covered fallbacks, queries ledger-matched, stopped after one | PASS, with a skill-order observation |
| 5 | Writer refusals and the agent's response | PASS: 2 refusals, both fixed |
| 6 | 0 unvalidated quotes; no X/Y/anticipat-/obvious- wording | Quotes PASS; wording FAIL (9 phrases) |

## Facts asked for by the lead

### 1. write_patent_results calls (UTC) and what each returned

| Call | Start | Result |
|------|-------|--------|
| 1 | 10:56:03Z | Refused (119 ms). "Candidate draft was not saved." Bibliography anchors used as feature support, anchors without evidence entries, "every element … is disclosed" rows left partial, `disclosedBy` fragments not in the recorded text, figure pages quoted as text. |
| 2 | 11:04:14Z | Refused (111 ms). Quoted below. |
| 3 | 11:05:35Z | Saved (58 s, includes the second read). Receipt below. |

Call 2 refusal, verbatim:

```
Candidate draft was not saved. Correct these issues and retry with the revised content:
- Search Round 1 lists search_patents query "ab="liquid crystal" and ab=speedometer and ab=color and ab=zone and pd<20020318", which matches no tool execution recorded this session. Run the query, or copy it exactly as it ran (same tool, same text), or remove it from the round.
```

The agent fixed it correctly. The executed query had no `pd<20020318` suffix, and call 3 lists it
without the suffix, marked ledger-matched.

Call 3 receipt line, verbatim (digests shortened):

```
Prior-art artifact receipt: {"reportUri":"file:///…/e2-cuozzo-ws/analysis/US6778074B1_invalidity_chart.md","reportDigest":"a2a4b78f…","evidenceUri":"…/US6778074B1_invalidity_chart.md.8f468052-9a9e-4f96-b53e-bddb68968c2d.evidence.json","evidenceDigest":"6cb8d939…"} fallbacksNotCovered=1 rounds=1 notCovered=17
```

The same result also said: "Wording review: 9 phrase(s) flagged in the working record" and
"Second read (anthropic/claude-sonnet-5): 21 elements judged, 11 not confirmed". It invited up to
2 re-saves. The agent did not re-save. Its turn ended at 11:06:45Z.

Full writer result texts are in the evidence appendix.

### 2. Search Round order

The round's queries ran BEFORE the only save. The 14 queries in "Search Round 1" ran at 06:47Z,
09:07Z and 10:41–10:50Z. The first save attempt was at 10:56:03Z and the first successful save at
11:05:35Z. So the first receipt already shows `rounds=1`, because the agent recorded a round it
ran before any chart existed.

This is a skill-order observation, not a failure. The skill says a round targets fallbacks a
SAVED chart left not covered. Here the agent judged "not covered" from its own draft. The round
itself is honest: every query is ledger-matched, the targets (claims 12, 13, 15, 16, 17, 18) are
the rows its draft left partial or not found, and it stopped after one round.

### 3. The six points

1. **Receipt: PASS.** See above. `fallbacksNotCovered=1 rounds=1 notCovered=17` agrees with the
   chart: "fallbacks: 2 of 9 covered (6 partly); not covered: claim 17".
2. **Ladder: PASS.** "Fallback coverage (generated) — claim 10" lists every dependent claim 11–19.
   It shows "Claim 14 (10 → 14)" with recorded text "…wherein said colored display is a colored
   filter." and "Claim 17 (10 → 14 → 17)" with recorded text "…wherein said display controller
   rotates said colored filter independently of said speedometer…". The ladder equals the B1
   claim tree.
3. **References: PARTIAL.**
   - Aumayer (US6633811B1) is charted on claim 10 elements (b) and (c), "Claim 10 as a whole",
     and rungs 11, 12, 13 and 18. That matches the PTAB's use of Aumayer for claim 10.
   - Evans, Wendt, Tegethoff and Awada do not appear. The agent tried to find Evans and Wendt,
     but those searches hit backend 503 errors. The chart says they "could not be run and were
     not retried". It looked for Evans as US6480783, not US3980041.
   - Claim 14 is covered by US4935850A, which is not PTAB art. The second read disagreed with
     that row ("filtering an illumination source … not that the display element itself is
     constituted as a colored filter").
   - Claim 17 is "not found in the cited art". The PTAB held claim 17 unpatentable with Wendt.
     The "not covered" verdict is wrong against the decision, because the art the board used
     was never retrieved.
4. **Search Round: PASS.** One "### Search Round 1" block, 14 `search_patents` queries, all
   "ledger-matched", outcome "still not found in the cited art" for claim 17. No second round.
   See the order observation above.
5. **Refusals: PASS.** Two refusals, quoted above. The agent fixed both on the next save.
6. **Quotes and wording.**
   - Quotes: PASS. The writer checks quotation identity mechanically and accepted the save, so
     there are 0 unvalidated quotes.
   - Wording: FAIL. The generated sections ("Fallback coverage (generated)", "Reference roles
     (generated)") hold only disclaimers. But nine model-written phrases reached the saved
     chart, for example "claim 10 is obvious (not anticipated)" in the "Claim 10 as a whole" gap.

### 4. Timeline gaps

| Window (UTC) | What happened |
|------|---------------|
| 06:49:55–09:06:54 | One `search_npl` call waited for its tool confirmation. The pilot approved it ("Allow in this Session") at 09:06:56Z. |
| 09:07:35–10:36:48 | One `fetch_webpage` call was open for 89 minutes. It fetched Wikipedia and CAFC pages on Cuozzo v. Garmin. The model made no request in this window. The pattern fits a URL-fetch confirmation waiting for a click, but the debug log does not record the confirmation itself. |
| 11:01:58–11:04:14 | The "Continue to iterate?" request-limit prompt. Someone clicked Continue at 11:04:14Z. |
| 11:06:45–13:55:54 | Run ended. At 13:55:54Z the founder asked "did you finish the stpes?". The agent then wrote a Phase 2 venue note in chat (expired patent, §315(e)) and did not save again. |

The model itself did no work in the two long gaps. Tool confirmations and the request limit caused
about 3 h 50 min of idle time in a run that needed about 25 minutes of model work.

## Defects

1. **Reference roles counts one patent twice.** US4935850 and US4935850A are listed as two
   references in "Reference roles (generated)". One says "discloses element(s) on its own", the
   other "contributes in combination". The writer should normalise the kind code.
2. **Legal conclusions reach the saved chart.** The wording review flagged nine phrases
   ("anticipation", "obviousness", "is obvious", §103) in gap text, `limitations[2]` and
   `stopReason`. The save succeeded anyway, and the agent did not reword them. The flag is
   advisory. E2 needs it to block, or the skill needs to make the reword mandatory before the
   final answer.
3. **Second-read objections ignored.** 11 of 21 elements were not confirmed. The receipt invited
   re-saves. The agent ended its turn without one.
4. **Critical date.** The tools report 2002-03-18. `get_patent_details` for US6778074B1 shows
   "Filing Date: 20020318" and "Priority Date(s): 2002-03-18 (US20020100378)". The chart states
   "no foreign priority claimed". The answer key's 2000-03-10 date is unconfirmed by any tool
   output; the case file should be corrected or sourced.
5. **Cuozzo leaks the answer key through model memory.** The agent named IPR2012-00001, Aumayer,
   Evans and Wendt in its query purposes before searching. It fetched court pages for the
   decision. Reference landing on this case measures recall from training data. Replace or
   supplement it with a case the model does not know.
6. **Harness: confirmations stall unattended acceptance runs.** `search_npl`, `fetch_webpage` and
   the request limit each stopped the run. E2 runs need these approved up front, or the operator
   must watch for them.
7. **Skill order: Search Round before the first save** (observation, see above).
8. **Backend 503s left the answer-key art unretrieved.** Nine searches "could not be run and
   were not retried", including every Evans and Wendt lookup.

## Setup

- Code: `origin/integration/fallback-coverage` at 037667b6bb6 (C1+C2+C3+S1).
- Build: core `out/` copied from the main checkout plus the one core diff patched by hand
  (`searchRegister` in `patentChatToolReferenceNames.js`). The copilot extension was built in the
  worktree with `node .esbuild.mts --dev`. Other extension builds were copied.
- Profile: seeded from the founder's dev profile (BYOK). Model picked in the picker: Claude Sonnet 5.
- Workspace: fresh empty folder, trusted through the Restricted Mode banner. Prompt sent once at
  06:41:52Z.

## Evidence

- Evidence appendix (every tool call with UTC time, and the three writer results):
  `docs/reviews/2026-10-17-fallback-coverage-pilot-cuozzo.tool-calls.txt`
- The saved chart, working record, transcript, debug log, ledger and screenshots were kept
  outside the repository with the pilot's evidence.
