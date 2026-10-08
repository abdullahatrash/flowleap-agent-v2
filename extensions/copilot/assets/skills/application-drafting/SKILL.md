---
name: application-drafting
description: Draft a full patent application for the US or the EPO (specification, abstract, brief description of the drawings) from a confirmed Feature List and Approved Claims, with a source marker on every paragraph, code validators and an advisory review. Use when the user asks to draft, write or prepare a patent application or specification. For claims only use claim-drafting; to evaluate a new invention use invention-disclosure. The output is always a draft for attorney review.
user-invocable: true
---

# Application Drafting

Turn a disclosure into a **Draft Application** for one office, US or EPO. The
deliverable is a traced draft: every paragraph names its source, and every
technical gap is an **Inventor Question**. The attorney signs the application,
so the draft shows what the model added.

All files of one matter live in `drafting/<matter>/`: `feature-list.md`,
`figures.md`, `claims.md`, `draft-application.md`, `findings.md`,
`inventor-answers.md`. The tools write the snapshot, the Working Record, the
export and `checklist.md` beside them.

In a matter that has `checklist.md`, read it first. Code writes it after
every drafting tool call, also after a refusal: it shows the steps that are
done, the open steps with the file and the line to change, and the next step
for the attorney. When a tool refuses, report the open steps it names.

## Gates

Three gates stop the work. The attorney sets each flag in the file, and the
tools read it from the file:

| Gate | File | Flag | Opens |
|------|------|------|-------|
| Intake | `feature-list.md` | `confirmed: true` | Step 2 |
| Claims | `claims.md` | `approved: true` | Step 3 |
| Export | `findings.md` | no unwaived Error, no open Inventor Question | the export in Step 6 |

At a gate, stop, name the file and the flag, and ask the attorney to set it.
Then wait. Every flag is the attorney's to write: an "I approve" or "looks
good" in chat opens no gate. When a tool refuses because a flag is missing or
false, report the refusal and ask again.

## Step 1: Intake

Build the Feature List and the figures list from the disclosure, or from the
invention record of the **invention-disclosure** skill.

1. Write `feature-list.md` with frontmatter `office` (`US` or `EPO`; ask the
   attorney when it is not stated) and `confirmed: false`. One row per
   element, embodiment and alternative the disclosure states, each with an ID
   (`F1`, `F2`, ...) and the disclosure span it comes from. Mark each example
   as working (the inventor ran it) or prophetic.
2. Write `figures.md`: a heading per figure the user supplied, then one list
   item per part, `- 12: housing`, one numeral per part across all figures.
3. A feature the disclosure only implies goes to the attorney as a question,
   not into a row.

Done when both files exist and every row cites a disclosure span. Stop at the
Intake gate.

## Step 2: Claims

Hand the confirmed Feature List and the prior-art results to the
**claim-drafting** skill. Save its claim set as `claims.md` with frontmatter
`approved: false`. Stop at the Claims gate. When the claims change after
approval, the attorney sets the flag again.

## Step 3: Draft the specification

1. Before the first drafting call, state in chat the model and the provider
   the disclosure goes to. Use the same values in the save in Step 4.
2. Call `start_application_draft` with the matter folder. It returns the
   Feature List, the figures, the Approved Claims and up to five style
   exemplars, or it refuses and names the missing flag.
3. Write the specification in the office's section order:
   [US](references/us-section-order.md) or
   [EPO](references/epo-section-order.md).
4. Put a source marker before every paragraph, per
   [references/marker-syntax.md](references/marker-syntax.md).
5. Technical content comes only from a Feature List row, a disclosure span or
   an attorney instruction. Model-Proposed is for structure: transitions and
   boilerplate. When a claim element, example or embodiment has no source,
   leave the technical text out and write an Inventor Question.
6. Write results only for experiments the disclosure says were run. A
   prophetic example is in present or future tense.
7. Exemplars shape voice and structure only, per
   [references/exemplar-rule.md](references/exemplar-rule.md).

Done when every paragraph has a marker and every claim term appears in the
specification.

## Step 4: Save and validate

1. Save with `write_patent_results`, template `draft-application`, to
   `drafting/<matter>/draft-application.md`, with `office`, `model`,
   `provider` and `version`. Findings never block a save.
2. Call `validate_draft` on the matter folder. It runs the code validators
   and writes `findings.md`.
3. Run the advisory review: scope, clarity, and support of each claimed
   combination (a term that appears in the specification does not yet support
   the combination). Each item quotes the passage it concerns and gives its
   paragraph. Pass the items to `validate_draft` as advisory items.

Done when `findings.md` holds the validator findings and the advisory items.

## Step 5: Resolve Inventor Questions

The save writes each Inventor Question to `inventor-answers.md` with an empty
`**Answer:**` slot. The attorney or the inventor fills it. When the attorney
asks you to apply the answers:

1. Read `inventor-answers.md`. Use only the filled answers; an empty answer,
   "Not stated" or "unknown" is no answer.
2. Write each answer at the place its question names, in the inventor's
   words, with the marker `<!-- src: inventor:IQ-n -->`. Add no fact the
   answer does not state.
3. Delete the answered question. When the answer is partial, keep the
   question and narrow it to the part that is still open.
4. Save the draft and call `validate_draft` again.

Done when each filled answer is in the draft and `checklist.md` shows no
answered question that is not applied.

## Step 6: Report and export

Report the findings by severity: Error, Note, Advisory, then the open
Inventor Questions, each with its line reference. Report what the validators
found and what stays open. A run without Errors is "no Error findings", never
"passed" or "ready to file".

When the attorney asks for the Word file, call `export_draft_docx`. It
refuses on an unwaived Error or an open Inventor Question: report the open
steps of `checklist.md` and each item of `findings.md` they name. The
attorney resolves it, or writes a waiver with a reason in `findings.md`.
It writes the description, the claims and the abstract as three .docx files
with the office page setup (EPO Rule 49 EPC, US 37 CFR 1.52). It does not
draw figures: tell the attorney that the drawing sheets are prepared
separately. Beside the files it writes `filing-manifest.md` with the values
the attorney declares at filing: claims, drawing sheets, the proposed
abstract figure and the pages. Report the page counts as estimates, and the
abstract figure as a proposal.

## Rules

- Describe what the draft contains and what is open. State no time or effort
  saving anywhere.
- The inventor or the attorney answers an Inventor Question, in
  `inventor-answers.md`. The model only asks it and moves the written answer
  into the draft. An answer in chat is an attorney instruction, not an
  inventor answer.
- Close every deliverable with: "AI-assisted analysis for review by a
  registered patent attorney — not legal advice."
