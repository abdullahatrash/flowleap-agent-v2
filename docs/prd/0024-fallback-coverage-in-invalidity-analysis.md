# PRD 0024 — Fallback Coverage in Invalidity Analysis

**Status:** ACTIVE 2026-10-17 — ADR 0016 accepted; issues filed per slice below (numbers in the Status line of each slice once filed)
**Date:** 2026-10-17
**Base:** main at `62638e93f24` (after #700)
**Decides:** nothing new — executes ADR 0016.
**Glossary:** `CONTEXT.md` → Fallback Ladder, Fallback Coverage, Search Round, Verified-Data Contract, Examiner Baseline.
**Evidence:** a UPC litigator's answer to the founder's outreach (2026-10-17, private message):
"You make a search and evaluate if your guns are big enough. If they're not, you go back to
search. It's about assessing whether the documents you have found take care of the existing
claims and all of the fallbacks you can imagine." The invalidity answer key for EP2110298B1
(memory `invalidity-chart-grounding`); the Find Better acceptance findings (memory
`find-better-acceptance-2026-10-05`).

## Why

The `invalidity-claim-chart` deliverable charts independent claims against validated quotes and
names the gaps. It charts no dependent claim and never goes back to search. A UPC litigator
judges an invalidity search by whether the art covers the claims **and every fallback**, and
loops until it does or the search is exhausted. If he asks for a demo, the chart must show that
judgment and that loop, and both must be true: the ladder computed from the patent's own claims,
each rung quoted and validated, each Search Round visible in the chart and matched to real tool
executions, and a verdict that an opposition decision on the public record confirms.

Three tracks. **C** (code, the writer) and **S** (skill text) run in parallel from the row
contract below. **E** (eval and acceptance) follows C.

## The row contract (shared by every slice)

Additions to the `write_patent_results` input for `template: 'invalidity-claim-chart'`:

- Coverage row `kind` gains `'fallback'`. A fallback row charts only the limitation a fallback
  adds, with the same `status`, `sourceAnchors`, `evidence`, `elements`, `gap`, `importance`
  fields as a `feature` row.
  - Dependent-claim fallback: `claimNumber: '<dependent>'`, `fallbackOf: '<independent>'`.
    `feature` names the rung, e.g. `"Claim 3 (depends on 1) — added limitation: …"`.
  - Description-supported fallback: no `claimNumber`, `fallbackOf: '<independent>'`,
    `basis: { anchor: '<challenged patent description anchor>', quote: '<verbatim>' }`.
- `fallbacksNotCharted?: { claimNumber: string; reason: string }[]` — rungs of the ladder the
  model did not chart, each with a reason (e.g. "claim 9 is a use claim outside the attack").
- `rounds?: { round: number; targets: string[]; queries: { tool: string; query: string; count?: number }[]; outcome: string }[]`
  — `targets` are claim numbers or the `feature` of a description fallback; every `query` must
  match a tool execution in the ledger (tool name and query text, whitespace-normalised).
- Writer receipt line gains `fallbacksNotCovered=<n> rounds=<k>`.

Statuses and their chart wording stay as today: supported → "disclosed in the cited art",
partial → "partially disclosed", unresolved → "not found in the cited art". The coverage line
maps them to covered / partly covered / not covered.

## Track C — the writer (extensions/copilot)

### C1 — Fallback Ladder derivation and fallback row checks
`extensions/copilot/src/extension/tools/vscode-node/patentFallbackLadder.ts` (new, beside
`patentFindBetter.ts`), called from `patentCandidateReview` for the invalidity variant.
- Derive the ladder from the ledger: the per-claim sources `get_patent_details` recorded for
  `challengedPublication` (`reference.section === 'claims'`, `reference.claimNumber`, `text`).
  Parse the dependency reference in EN/DE/FR ("according to claim 1", "as claimed in any one of
  claims 1 to 3", "of claim 2", "nach Anspruch 1", "nach einem der Ansprüche 1 bis 3", "selon la
  revendication 1", "selon l'une des revendications 1 à 3"). Multiple dependency = a rung under
  each parent. A claim with no reference is independent.
- Checks, in the invalidity variant only: ledger holds per-claim sources for the challenged
  publication (else refuse: "fetch the challenged patent's claims with get_patent_details
  first"); every rung under a charted independent claim has exactly one fallback row or one
  `fallbacksNotCharted` entry; a fallback row's `claimNumber` is a rung of `fallbackOf`; a
  description fallback's `basis.quote` validates against the ledger text at `basis.anchor`
  (reuse the evidence quote validator), and `basis.anchor` belongs to the challenged
  publication; `fallbackOf` names a claim that has `feature` rows.
- Unsegmented claims (no claim numbers in the ledger): no ladder, no refusal; the report says
  "claim numbers could not be established; no Fallback Ladder".
- Guardrail: no model call; no `any`; the parser is a pure function with its own spec.
- Acceptance: vitest spec with synthetic claim sets (EN, DE, FR, multiple dependency, chain of
  three, unsegmented) — one snapshot-style assertion per fixture for the derived ladder; one
  spec per refusal message.

### C2 — Fallback coverage and Search rounds in the rendered chart
`patentCandidateReview.ts` render path (`renderCandidateReview`, `renderWorkingRecord`) and
`patentReportTemplates.ts` for the structured invalidity chart.
- Per independent claim, after its element rows: `## Fallback coverage (generated)` — one row
  per rung in claim order: claim number and chain, the claim text from the ledger (not the
  model's `feature`), status wording, references cited; description fallbacks follow with their
  validated basis quote; `fallbacksNotCharted` entries render as "not charted: <reason>".
- The coverage line per independent claim: "Claim 1: n of m elements disclosed; fallbacks: k of
  j covered (p partly); not covered: claims 3, 5". Counts computed from statuses.
- `## Search rounds` section: one block per round — targets, each query with its tool and count,
  outcome; "no Search Round ran" when `rounds` is empty and fallbacks are not covered.
- The reference-roles table includes fallback rows.
- Guardrail: the legal-conclusion phrase list applies to every new model-written field
  (`outcome`, `reason`, `feature`); nothing in the generated text says X, Y, anticipat-, obvious-.
- Acceptance: snapshot spec of a rendered chart with two independent claims, a chain of three,
  one description fallback, one not-charted rung and two rounds; the existing invalidity specs
  stay green.

### C3 — Receipt counts and the completion-guard loop
`writePatentResultsTool.ts` receipt line and `priorArtReportCompletion.ts`.
- Receipt gains `fallbacksNotCovered=<n> rounds=<k>` (invalidity variant only; other templates
  unchanged).
- Completion guard, invalidity deliverable only: when the latest receipt has
  `fallbacksNotCovered > 0` and `rounds === 0`, return one nudge: "The saved chart leaves
  <n> fallbacks not covered (claims …). Run one Search Round aimed at those limitations
  (new Discriminating Terms, other office, NPL, web), record it in `rounds`, and re-save. If
  the round finds nothing, re-save with the round recorded; 'not covered' is then final." A
  receipt with `rounds >= 1` is accepted whatever the count. The nudge fires at most once per
  report path.
- `rounds[].queries` validation against the ledger lives in C1's checker; C3 only reads counts.
- Guardrail: never nudge a second round; never nudge when the request is not an invalidity
  chart; the text keeps the guard's existing sentence "do not repeat searches merely to pass
  validation".
- Acceptance: `priorArtReportCompletion.spec.ts` cases: not covered + no round → nudge; not
  covered + round 1 → accepted; covered → accepted; prior-art template with the same receipt →
  no nudge.

## Track S — the skill

### S1 — `invalidity-analysis` skill: ladder, loop, stop rule
`extensions/copilot/assets/skills/invalidity-analysis/SKILL.md` + new
`references/fallback-coverage.md`.
- Phase 1 adds: fetch the challenged patent with `get_patent_details` (claims segmented) before
  anything else — the writer builds the Fallback Ladder from that call.
- Phase 4 adds the ladder: one `fallback` row per dependent claim of each charted independent
  claim, charting the added limitation only; optional description fallbacks with a `basis`
  quote; `fallbacksNotCharted` with a reason for any rung left out.
- Phase 4b, the stop rule: save; read the receipt; if `fallbacksNotCovered > 0` and no round
  ran, run ONE Search Round aimed at those limitations (new Discriminating Terms for the added
  limitation, the skill's search ladder in order, NPL, web), record it in `rounds`, re-save.
  After one round, "not covered" is a complete result and the report says so.
- "Gaps" in Phase 5 becomes the list the round consumed, with what each round changed.
- Guardrail: SKILL.md stays about five phases; the row-field detail, the EN/DE/FR dependency
  wording and a worked example go to `references/fallback-coverage.md`. The worked example must
  not use an acceptance patent (grep the skill trees first). Keep every existing rule of the
  skill (critical date, Phillips standard, art of record, figure reading).
- Acceptance: skill hygiene tests green; a dry read of the skill by a second agent lists the
  five phases and the stop rule without reading the reference file.

### S2 — CLI and Agents Window copies (follow-up, not blocking the demo)
`flowleap-cli/skills/recipe-invalidity-analysis` gets the same phase text adapted to the CLI
(no typed writer: the ladder and the round log are written by hand into the report, marked as
unvalidated); re-pin the vendored copy in `src/vs/sessions/skills` and the plugins pack per the
release checklist. Filed in flowleap-cli; linked here.

## Track E — eval and acceptance

### E1 — Trajectory case for the loop + k-of-n gate
`extensions/copilot/evals/datasets/trajectory/trajectory-cases.yaml` + fixture
`fixtures/trajectory/t11-fallback-round.json` + predicates in `trajectory-assertions.mjs`.
- Scripted mocks: `get_patent_details` returns a challenged patent with claim 1 + dependents 2–4;
  the first `write_patent_results` returns a receipt with `fallbacksNotCovered=2 rounds=0`; the
  second returns `fallbacksNotCovered=1 rounds=1`.
- Predicates: `t11_fetched_claims_before_chart`, `t11_ran_one_round_after_not_covered` (a
  retrieval call whose query names a term from the uncovered limitation, between the two
  saves), `t11_second_save_records_round` (`rounds.length === 1` in the second save's args),
  `t11_stopped_after_one_round` (no third save, no further retrieval after the second save).
- Run the repeat gate (`npm run eval:trajectory:repeat`) and record the k-of-n result for T11
  beside the existing baseline; the existing cases must not move.
- Guardrail: follow the fixture and predicate conventions in the file header; one case, not a
  family.

### E2 — Live acceptance with public answer keys
Three runs each from a FRESH EMPTY workspace, editor Patent Agent chat on Sonnet 5, prose
prompt ("Prepare an invalidity chart for <patent> …", no typed command):
- (a) EP case A and (b) EP case B from `fallback-cases.md` (opposition: maintained in amended
  form; the maintained claim 1 = original claim 1 + a dependent claim). Pass: the ladder in the
  chart equals the B1 claim tree; the rung the proprietor retreated to is charted; the
  documents the Opposition Division applied against original claim 1 appear in the chart; a
  Search Round ran when fallbacks were not covered; the "not covered" verdict is consistent with
  the decision (the surviving rung is not covered, or it is covered by art the division did not
  have — say which).
- (c) US6778074B1 (Cuozzo, IPR2012-00001): claims 10, 14, 17 charted; the applied references
  appear on the right rungs; no X/Y wording.
- Grade on: 0 unvalidated quotes, ladder complete, every round matched to real executions, no
  legal-conclusion phrase, stop after one round. Record in
  `docs/reviews/2026-10-XX-fallback-coverage-acceptance.md`; defects become issues.
- Guardrail: acceptance patents must not appear in any skill example; never let an acceptance
  agent wait in a shell loop.

## Out of scope

Find Better on dependent claims (ADR 0010 keeps it to independent claims); a model-rated fallback
score; auxiliary-request drafting for the proprietor's side; the UPC filing skills.

## Risks

- Dependency parsing on translated or OCR'd claims: unsegmented claims give no ladder by design;
  a wrong parse is visible because the report prints the claim text beside the rung.
- The loop costs one more search pass per chart; the guard caps it at one.
- Skill chain #676–#688 (ADR 0015) is on hold; S1 edits the same SKILL.md the later eval
  baseline will measure. The T11 case and the repeat-gate result give that baseline the loop
  already in place.
