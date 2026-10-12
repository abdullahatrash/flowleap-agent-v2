# PRD 0022 — Planned Specification Drafting

**Status:** READY 2026-10-12 — executes the accepted part of #627; tickets E1 #629, E2 #630, E3 #631, E4 #632, E5 #633; parent #627
**Date:** 2026-10-12
**Base:** main after PR #626 (`876c8403797`); PRD 0020 complete (D5 live run passed 2026-10-12)
**Decides:** two small things, recorded under *Decisions* below; no new ADR. Everything else
executes ADR 0012.
**Glossary:** `CONTEXT.md` → Application Drafting, Feature List, Approved Claims, Draft
Application, Model-Proposed, Inventor Question, Finding, Drafting Checklist. Adds **Draft
Outline** and **Outline Item** (E1 writes them).
**Evidence:** AutoSpec, Shea and Yu, Findings of EMNLP 2025 (arXiv 2509.19640); issue #627;
assessment of 2026-10-12 against the shipped pipeline.

## Why

Application Drafting ships as a traced pipeline: gates in files, a source on every paragraph,
validators in code. One stage is implicit: the plan. Step 3 of the skill goes from the start
tool straight to the full specification. The attorney sees the plan only through the draft.

AutoSpec shows the one idea worth taking: a persisted outline between the claims and the text,
with template items (the standard sections) and technical items (the concepts of the claims),
and a deliberate merge. The rest of the paper does not transfer. Its technical items are
enriched with web search results, which ADR 0012 decision 2 forbids as a source. Its rubric
rewards *elaboration* and *diversity*, and in the paper the baseline that elaborated most
(GPT-4o) won that dimension. Under our doctrine an elaboration without a source is a defect.
Its fine-tuning is out of scope. Its practitioner study is the right end state, not the next
step.

So: make the plan a file, let code check that the plan covers the claims and that the text
covers the plan, give the skill an integration pass, and measure with the validators we have
plus one judge for unsupported additions. The practitioner study follows after real matters
exist.

## Decisions

1. **The Draft Outline is a code precondition, not a fourth human gate.** The draft save
   refuses while no outline exists for the current Approved Claims hash. The attorney may edit
   the outline, and the skill asks them to read it, but no flag is needed. Reason: ADR 0012 has
   three gates by design; a fourth gate slows every matter for a document the attorney can
   inspect at any time. Rejected: `planned: true` on the outline.
2. **The drafting rubric is style, factual accuracy and claim coverage. Elaboration and
   diversity are dropped.** Factual accuracy is measured as *unsupported technical additions*
   against the Feature List, disclosure and answers. Reason: the two dropped dimensions score
   added content as quality and pull against ADR 0012 decision 2. PRD 0020 keeps its non-goal
   on academic-dataset benchmarks: the regression set is synthetic matters, not HUPD.

## The pipeline, with the new stage

```
drafting/<matter>/
  feature-list.md                 ← unchanged
  figures.md                      ← unchanged
  claims.md                       ← unchanged; its approved hash binds the outline
  draft-outline.md                ← NEW: the plan; frontmatter: office, claims (SHA-256)
  draft-application.md            ← paragraph markers may name the Outline Item they realise
  draft-application.working-record.md  ← header gains "Outline SHA-256"
  findings.md                     ← gains the outline and item-coverage rules
  checklist.md                    ← step 3 shows two lines: outline, draft
```

### Draft Outline format

Frontmatter: `office` (`US` or `EPO`), `claims` (the SHA-256 of the Approved Claims the plan
was made from). Body: one table, one row per Outline Item.

| Column | Content |
|--------|---------|
| `Item` | `O1`, `O2`, … in draft order |
| `Section` | A section name of the office order (`references/us-section-order.md` or the EPO file) |
| `Kind` | `Template` (standard section text) or `Technical` (a concept of the claims) |
| `Claims` | The claim numbers the item realises; a dependent claim is listed with the independent claim it depends on (`1, 3`) |
| `Claim terms` | The claim terms the item explains, as the claims introduce them (`a sealing ring`) |
| `Sources` | `F3`, `§2.1`, `FIG. 2`, `IQ-4`; empty only when `Question` is filled |
| `Explain` | `yes` when the item needs a mechanism, parameter or example, `no` for a statement |
| `Question` | The open question when a Technical item has no source; becomes an Inventor Question in the draft |

Rules the validators read: a Template item has no claim terms; a Technical item has at least
one source or a question, never neither; a source names a row, span, figure or answered
question that exists.

### Marker extension

A paragraph marker may name the item it realises: `<!-- src: feature:F3, disclosure:§2.1,
item:O7 -->`. `item` is a plan reference, not a source; a paragraph with only `item` and
`model-proposed` is still a Model-Proposed paragraph. Headings carry no marker.

## Slices

### E1 — Outline contract and validators (extensions/copilot, common layer)
Pure code, no VS Code API, no model call. Parse and write `draft-outline.md` (frontmatter and
table). Add `item` to the marker parser as a plan reference. Validators, each returning
Findings with a line and a severity:
- `outline-claims`: Error when the outline's `claims` hash is not the Approved Claims hash.
- `outline-coverage`: Error for every claim term (the phrases `checkLiteralBasis` already
  extracts) that no Technical item lists (Technical items only); Error for every dependent claim
  that no item lists (Technical items only) together with the independent claim it depends on
  (the combination has no plan).
- `outline-sources`: Error for a Technical item with neither source nor question; Error for a
  source that names a Feature row, figure or `IQ-n` that does not exist or is unanswered.
- `item-coverage`: Error for a Technical item no draft paragraph names with `item:`, except an
  item that carries a `Question` and no source, which yields an Inventor Question and no text:
  Note; Note for a Template item nobody names; Error for an `item:` that names no row of the outline.
- `duplicate-sentence`: Note when one sentence (the Working Record's sentence split, normalised)
  appears in two paragraphs.
Parse errors of the outline are `outline-format` Errors with a line.
Add **Draft Outline** and **Outline Item** to `CONTEXT.md` under Application Drafting.
Guardrail: the outline carries no technical text, only references; a validator never reads a
source's content. Acceptance: unit tests over synthetic outlines, claims and drafts, one
snapshot-style assertion per rule, both offices.

### E2 — Tools, checklist and record (extensions/copilot, vscode-node)
- `write_patent_results` gains the template `draft-outline`: writes `drafting/<matter>/
  draft-outline.md` with the Approved Claims hash in its frontmatter; refuses when the claims
  are not approved. Add the kind to the reported template set.
- The `draft-application` save refuses while `draft-outline.md` is missing or its hash is not
  the Approved Claims hash (decision 1). Editing the claims clears the outline binding as it
  clears `approved`.
- `validate_draft` runs the E1 rules and writes them to `findings.md` with the others.
- The Working Record header gains `Outline SHA-256`; the checklist's step 3 shows two lines,
  `outline written for the approved claims` and `draft written`, each read from the files.
- `start_application_draft` returns the outline when it exists, after the claims.
Guardrail: the gate is read from the file; a save is never blocked by findings, only by the
missing or stale outline. Acceptance: tool tests with the in-memory filesystem pattern,
including each refusal and the stale-outline case.

### E3 — Skill: plan, draft by item, integrate (extensions/copilot/assets/skills)
Step 3 of `application-drafting` becomes three sub-steps, kept short, detail in reference files:
1. **Plan.** From the Approved Claims, the Feature List and the figures, write the Draft
   Outline per `references/outline-format.md`: the Template items of the office order, then one
   Technical item per claim concept, each with its claims, terms, sources and `Explain`. A
   concept with no source gets a `Question`, never a source found outside the matter. Save with
   the `draft-outline` template. Tell the attorney the outline is in the folder and may be
   edited before drafting.
2. **Draft by item.** Write the specification in outline order. Template items first, then
   Technical items in place, each paragraph with its source marker and its `item:`. An item
   with a `Question` yields an Inventor Question and no technical text.
3. **Integrate.** One pass per `references/integration-review.md`: shared terminology, figure
   references, contradictory embodiments, duplicated passages, and support of every claimed
   combination the outline planned. Items go to `validate_draft` as advisory items, each
   quoting the passage.
Reference files: `outline-format.md`, `integration-review.md`; `marker-syntax.md` gains the
`item` entry. Guardrails: the skill stays at six steps; no time saving; exemplars still never a
source. Acceptance: snapshot of the rendered skill; the live run in E5.

### E4 — Drafting regression eval (extensions/copilot/evals)
`promptfooconfig.drafting.yaml` with `datasets/drafting/`. Three synthetic matters across
domains (mechanical, software, chemistry), each with `feature-list.md`, `figures.md`,
`claims.md` and a short disclosure, run on both offices. Two single-turn case kinds, graded by
the common-layer validators imported into the assertions (no model in a grader except one):
- **Outline case:** inputs → outline text; pass when `outline-coverage` and `outline-sources`
  report no Error.
- **Draft case:** inputs plus a fixed outline → draft text; pass when the E1 and D1 validators
  report no Error, and the one judge (gemini-2.5-flash, as the other evals) finds no technical
  sentence whose fact is absent from the Feature List, disclosure and answers.
Regression cases the issue asks for: changed claims (stale hash → refusal; tool test in E2),
missing support (an element with no row → an Inventor Question, no invented text), hallucinated
figures and results (a numeral not in `figures.md`, a past-tense result for a prophetic
example), cross-section consistency (a defined term used two ways), end-to-end completion.
Style is not measured in v1: it would need a second judge call per case; revisit when a single judge call can return both. Baseline is the same set run on main
before E3 merges; the PR reports both columns. Repeat-gate per the flake rule (3 runs).
Guardrail: fixtures are invented matters, no HUPD or Google Patents text. Acceptance: the config
runs green on the candidate and the report is in the PR.

### E5 — Acceptance (founder)
One real matter through the pipeline with the outline, one office. Pass: the outline exists
before the draft, every Technical item traces to a row, span, figure or answered question or
carries a question; every claimed combination is planned by an item and the advisory review
quotes its support; `item-coverage` reports no planned item left unwritten; the export refuses
at least once for a real reason. Fail on any technical sentence without a source. Record under
`docs/reviews/`.

## Follow-up, not a slice

**Practitioner study** (the second half of #627's evaluation): blinded drafts, scoring anchors
for the three rubric dimensions, reviewer agreement, serious errors, cost. Filed as a follow-up
issue, opened only after five real matters have run with the outline. Judge calibration
against practitioner ratings belongs to that issue.

## Explicit non-goals

- Fine-tuning or a specialised model (AutoSpec's LoRA).
- External retrieval into Outline Items; web research never becomes a source.
- Scoring elaboration or diversity.
- A fourth human gate on the outline.
- Benchmarks on academic datasets (PRD 0020 non-goal, kept).
- The Agents window (the vendored skill follows through the normal skill sync).

## Execution

E1 first, E2 after E1, E3 in parallel with E2, E4 after E3 (baseline run before E3 merges),
E5 after all. One worktree per agent, stage only your own files, base every PR on main.

## Outcome

(filled at completion)
