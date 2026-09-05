# Demo drive findings

Observed through computer use on 2026-09-05 in the running development app. These are UI observations, not diagnosed root causes.

Classification follows the owner's direction: **Bug — blocker** prevents the intended recording flow without a reasonable workaround; **Nice to have — non-blocker** allows the recording to proceed with a workaround. A non-blocker can still be an actual software defect. Reclassify if the planned shot makes it essential.

Rehearsal: create a Claim Analysis project named `EP1234567 — Claim Analysis Rehearsal`, request a breakdown of granted claim 1 of public patent EP1234567B1, save `outputs/claim-1-analysis.md`, and open the report. The agent completed the request; the report and its update to `notes.md` were kept. Report accuracy has not been validated for publication.

## Bug — blocker

### D01 — Citation click handling works; source correctness remains blocked

- Status: click handling verified after the owner's fix; end-to-end source correctness blocked by D06 and D07 below.
- Observed: the generated Markdown report names the publication but provides no clickable source link. The source was opened manually through the Browser sidebar.
- Impact: cannot yet demonstrate the intended finding → click citation → source passage flow from this report.
- Evidence limit: absence of a link in this output does not establish the cause of the citation-click handling issue the owner is fixing.
- Retest on 2026-09-05 afternoon: a fresh answer generated `EP1234567, claim 1`. Clicking it opened the FlowLeap Patent Reader beside the document and visibly scrolled to and highlighted Claim 1. The Markdown report also contained actionable `flowleap://` links; its B1 bibliography link opened a reader. A one-time URI-open confirmation was required for each tested open (the persistent trust checkbox was left unchecked).

### D06 — B1 citation reader displays earlier publication content

- Classification: Bug — blocker.
- Status: root cause verified; fix implemented and locally tested. Production backend deployment and desktop integration/rebuild are pending.
- Reproduction: request claim 1 of EP1234567B1 with a clickable citation. Click the generated chat citation (`EP1234567, claim 1`), then open `outputs/citation-rehearsal.md` and click its explicit B1 overview link: `flowleap://flowleap.patent-ai/patent?publication=EP1234567B1&section=bibliography`.
- Actual: both readers show publication date `20020828` and Claim 1 beginning `Partikuläres Kompositmaterial`. Even the reader titled `EP1234567B1` shows that content. Its claim lacks the granted composition's sub-100 nm limitation discussed in the answer.
- Cross-check: the public Google Patents B1 page already open inside the app displays the 2007-04-11 grant and Claim 1 beginning `Composition that comprises at least one polymerisable monomer and/or prepolymer`, with the composition essentially exempt of filler below 100 nm. The earlier rehearsal's German B1 wording begins `Zusammensetzung`.
- Additional observation: the generated chat and table citations omit the B1 kind code, although the report's overview link preserves it. Preserving the kind in generated links alone did not resolve the observed reader mismatch.
- Expected: preserve publication kind through generation, resolution, retrieval, and display; show the requested B1 text or clearly report that it is unavailable.
- Impact: a viewer clicking a citation is shown text that does not support the answer's B1-only finding. Do not record this as a successful source-verification demonstration.
- Retest: explicit B1 claim link must land on the actual granted claim, with matching kind/date/content; separately verify A2 resolves to its own text.

### D07 — Patent reader treats claim continuation paragraphs as separate claims

- Classification: Bug — blocker for claim-specific citation demonstrations.
- Status: backend parser and facade numbering fixed and locally tested. Production deployment is pending.
- Actual: reader heading `Claim 3` contains the beginning of numbered claim `3.`; heading `Claim 4` contains its `(a)`, `(b)`, `(c)` continuation; heading `Claim 5` contains text beginning `4.`. Further headings continue to drift, reaching `Claim 29` above text numbered `27.`.
- Expected: continuation paragraphs remain inside their parent claim; headings and citation targets match the document's actual claim numbers.
- Impact: numbered claim targets after a split can point to the wrong claim or a fragment. Claim 1 highlighting itself worked in this test.
- Retest: a multiline claim stays intact, and clicking claim 4 lands on actual numbered claim 4.

## Nice to have — non-blocker

### D02 — Set Project Status says no project is open

- Status: open; reproduced again in the afternoon citation retest with the same warning.
- Reproduction: create the rehearsal project; open FlowLeap Projects; right-click that project's row; select Set Project Status.
- Actual: notification says `No project open`, despite the project name appearing in the window and the agent reading its notes.
- Expected: show the selected project's status choices.
- Recording workaround: omit status changes. This becomes a blocker if the recording requires that action.

### D03 — Project notes shortcut fails

- Status: open; reproduced again in the afternoon citation retest with the same undefined-path error.
- Reproduction: in the rehearsal project's row actions, click Open Project Notes.
- Actual: `Error running command flowleap.openNotes: The "path" argument must be of type string. Received undefined.`
- Expected: open that project's notes.
- Verified workaround: double-click `notes.md` in Explorer; the rendered document opens successfully.

### D04 — Wide bilingual tables are difficult to read on camera

- Status: presentation improvement.
- Observed: the five-column claim table wraps heavily in the chat panel and also needs substantial vertical scrolling in the document preview.
- Recording workaround: request a concise table with fewer columns and show it in the wider document pane. Hiding the sessions rail was tested successfully.

### D05 — Slash-command discovery mixes patent and developer skills

- Status: presentation improvement; may depend on this user's installed skills.
- Observed: typing `/` lists unrelated entries such as Clerk and UptimeRobot skills alongside patent tools.
- Verified workaround: typing `/flowleap` filters to the FlowLeap skill family. Plain-language prompts also work.

### D08 — Successive citation opens crowd the editor layout

- Status: observed; presentation improvement.
- Reproduction: click the chat citation, open its report in that reader's editor group, then click the report's B1 overview citation.
- Actual: the first reader opened in editor group 2 and the second in group 3. Together with chat and Projects, the resulting columns were too narrow to read comfortably on camera.
- Recording workaround: prepare the editor arrangement before the take and avoid sequential opens from multiple groups. Consider reusing a reader group or offering an open-in-place option.

## Operating notes (not defects)

- Project creation reloads the workspace and creates matter folders plus template notes; it does not automatically submit an analysis prompt. Controls can change during initialization.
- Under Default Approvals, each tested Google Patents fetch paused before fetching and again before passing the result to the agent. The owner plans to use bypass approvals for recordings; that mode has not been tested in this rehearsal.
- The agent fetched bibliography, register events, legal status, summary, family, and English/German sources for the one-claim request. Allow for retrieval time even with a narrowly scoped prompt.
- Markdown defaults to rendered preview; Reopen as source file and Open as Preview switch views.
- Generated edits have Keep/Undo controls; review and keep before the final outcome shot.
- The embedded Google Patents page displays the signed-in Google account. Prepare recording framing/profile accordingly.
- Existing project names include test/demo names. Prepare the visible project rail before recording.
- The owner authorized a fresh retest after completing the citation fix. The afternoon trial finished, generated `outputs/citation-rehearsal.md`, and updated `notes.md`; both edits were kept. The UI reported `Completed 3 steps in 51s` despite showing a longer expanded tool trace earlier; treat that as the app's displayed metric, not a measured end-to-end recording runtime.
- The afternoon trial remained in Default Approvals and did not require web-fetch approvals during generation. Internal citation opens still prompted for permission. Bypass mode remains untested.

## D06/D07 verified fix — 2026-09-05

### Root causes and source verification

The desktop worktree and original checkout both started at `3be103672e3` (the clickable-citation implementation, PR #308). The original checkout had no tracked edits; its untracked findings log and the kept rehearsal report/notes were preserved.

Direct, authenticated reads from EPO OPS reproduced the problem independently of the app. The existing `cleanDocumentId` removed A2/B1 before constructing **both** publication request URLs and cache keys. A kindless `epodoc/EP1234567` request returned A2. The bibliography extractor selected the first exchange document, while fulltext responses were labelled with the cleaned, kindless request. The facade then constructed kindless citations from that label. The reader retained the requested B1 title without checking the returned identity.

Exact DOCDB reads verified that EPO **does have** the requested B1 source. This was not a provider coverage gap:

| Requested publication | EPO publication date | Returned claim language | Complete claims | Claim 1 begins |
| --- | --- | --- | --- | --- |
| EP1234567A2 | 20020828 | German (English unavailable in this response) | 27 | `Partikuläres Kompositmaterial` |
| EP1234567B1 | 20070411 | English | 26 | `Composition that comprises` |

The B1 claim includes the sub-100 nm exclusion. The public [B1](https://patents.google.com/patent/EP1234567B1/en) and [A2](https://patents.google.com/patent/EP1234567A2/en) pages agree with this distinction. Unedited public EPO bibliography/claim XML fixtures are saved in the backend under `tests/fixtures/ops/ep1234567-{a2,b1}-{biblio,claims}.xml`, with retrieval provenance in `patent-reader-fixtures.md`.

For D07, EPO's text-only XML packs all claims into one unnumbered `<claim>` node with multiple `<claim-text>` paragraphs. Some paragraphs start a real numbered claim; others continue one. The parser treated every paragraph as a separate claim, and the facade assigned array-index numbers. Replaying the raw A2 response reproduced 29 headings over 27 claims, including a new heading 4 for claim 3's (a)/(b)/(c) continuation. The frontend was rendering these incorrect backend numbers faithfully.

### Implemented behavior

- Backend publication reads use exact DOCDB URLs when a kind is supplied, retain the kind in cache identity, and verify returned publication identity before accepting bibliography or fulltext. Other kinds are never used as a fallback for a requested B1. Fulltext availability requests also preserve the kind.
- Publication caches use the new `epo:publication-v2:*` namespace. Old kindless/misparsed entries in either cache layer cannot contaminate the corrected reads; no production cache flush was performed.
- A kindless OPS fulltext API request first resolves bibliography, then reads that returned publication explicitly. The resolved kind appears in `docId` and citations. This is **not** a latest-publication or grant-selection policy. For this patent, a bare request resolves A2.
- Claims retain provider numbers and complete continuation paragraphs. Structured numbered claim nodes and gaps are also preserved. The facade uses those numbers for `claimNumber`; it reports the actual returned language.
- The desktop reader verifies each section's `docId` against the requested publication and displays an unavailable/error notice if identity is missing or mismatched, including responses from an older backend. Kindless reader citations fail with a clear request for the publication kind before making backend calls.
- The desktop prompt now requires preservation of publication kinds and no longer recommends dropping the kind while retrying publication-specific text retrieval.

### Changed code and validation

Desktop changes are in the isolated worktree `/Users/abdullahatrash/.codex/worktrees/44b4/flowleap-agent-v2`: `patentDocumentViewer.ts`, new `patentDocumentData.ts` and its tests, and `patentAIPrompt.tsx`. The original desktop code checkout was not overwritten.

Backend changes were first tested in an isolated local clone, then copied into `/Users/abdullahatrash/flowleap/flowleap-backend` after checking every target file against its original contents: publication selection/request construction (`src/lib/ops/publication.ts`, `direct.ts`, `utils.ts`), XML claim extraction/types, facade numbering/docs, recorded fixtures and regression tests. Existing untracked backend research/review files were preserved.

Validation completed:

- Backend TypeScript build (`npm run build`) passed before tests.
- Final focused backend suite: **128 tests across 15 files passed**, including recorded A2/B1 isolation, old-cache exclusion, missing-kind resolution, missing requested-kind content, mismatched/unidentified provider responses, multiline claims, explicit numbers/gaps, language selection, real HTTP facade citation targets and registry documentation.
- Desktop extension `npm run typecheck` passed for all four configured TypeScript projects. One intermediate run transiently failed to resolve React in the simulation project; the isolated project recheck and full rerun passed.
- Desktop reader and prompt tests: **56 tests across 3 files passed**. These cover URI construction, complete-claim HTML anchors, missing-kind policy, old-backend bibliography mismatch per-section rejection of unverified text, and equivalent US serial formatting without conflating publication kinds.
- Direct extension bundle build (`node .esbuild.mts --dev`) passed. The required repository-wide `npm run gulp compile-extensions` was attempted but could not start because the existing root dependencies lack `gulp-merge-json`; this broad build remains an environment limitation.
- The **fixed backend code was run against live EPO OPS**, including bibliography, claims and description for A2, B1 and a bare number. All three sections agreed on publication identity. B1 returned 26 claims, A2 27; claim 3's continuation stayed attached, and number 4 held actual claim 4.

### Production/UI boundary

Computer use reconfirmed the currently running development app still displays the old B1-title/A2-content mismatch and drifting headings. The owner clarified that this app connects to the **production backend**, not localhost. Its connection, approval mode, trust settings and kept rehearsal files were not changed. No backend service was deployed/restarted and no release was published.

The corrected production citation flow is therefore **not yet end-to-end verified**. To observe the fix there, deploy the backend changes, integrate/rebuild the desktop changes, and reopen the reader (existing reader panels hold their loaded data). Then retest fresh explicit B1 claim-1 and claim-4 links and an A2 link. Existing report links that omitted the kind should be regenerated from the corrected retrieval; the earlier report is retained as test evidence, not silently rewritten.
