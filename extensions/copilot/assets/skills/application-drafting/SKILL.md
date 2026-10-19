---
name: application-drafting
description: Draft a full patent application for the US or the EPO (specification, abstract, brief description of the drawings) from a confirmed Feature List and Approved Claims through a Draft Outline that plans every claim term, with a source marker on every paragraph, code validators and an advisory review. Use when the user asks to draft, write or prepare a patent application or specification. For claims only use claim-drafting; to evaluate a new invention use invention-disclosure. The output is always a draft for attorney review.
user-invocable: true
---

# Application Drafting

Turn a disclosure into a **Draft Application** for one office, US or EPO. The
deliverable is a traced draft: every paragraph names its source, and every
technical gap is an **Inventor Question**. The attorney signs the application,
so the draft shows what the model added.

All files of one matter live in `drafting/<matter>/`: `feature-list.md`,
`figures.md`, `claims.md`, `draft-outline.md`, `draft-application.md`,
`findings.md`, `inventor-answers.md`. The tools write the snapshot, the Working Record, the
export and `checklist.md` beside them.

In a matter that has `checklist.md`, read it first. Code writes it after
every drafting tool call, also after a refusal: it shows the steps that are
done, the open steps with the file and the line to change, and the next step
for the attorney. Its step numbers are the step numbers of this skill. When a
tool refuses, report the items and the open steps it names.

## Gates

Three gates stop the work. The attorney opens each gate in its file, and the
tools read it from the file:

| Gate | File | The attorney writes | Opens |
|------|------|---------------------|-------|
| Intake | `feature-list.md` | `confirmed: true` | Step 2 |
| Claims | `claims.md` | `approved: true` | Step 3 |
| Export | `findings.md` | no unwaived Error, no open Inventor Question | the export in Step 6 |

At a gate, stop. Tell the attorney the file, the action at the top of the
file and the one word to change, in the sentence the tool or the checklist
gives, for example: "Review `drafting/hinge/claims.md:3`, then click
**Approve Claims** at the top of the file, or change `false` to `true` on
line 3."
Keep the path and its line in backticks: the chat opens the file at that line.
Use only the words of that sentence, no technical terms for the file format.
Then wait. Only the attorney writes `true`: an "I approve" or "looks good" in
chat opens no gate. When a tool refuses at a gate, give its sentence and ask
again.

## Step 1: Intake

Build the Feature List and the figures list from the disclosure, or from the
invention record of the **invention-disclosure** skill.

1. Write `feature-list.md` with `office` (`US` or `EPO`; ask the
   attorney when it is not stated) and `confirmed: false` in the top block of
   the file. Put this comment line directly above `confirmed: false`:
   `# Review, then change false to true below, or click the action at the top.`
   One row per
   element, embodiment and alternative the disclosure states, each with an ID
   (`F1`, `F2`, ...) and the disclosure span it comes from. Mark each example
   as working (the inventor ran it) or prophetic.
2. Write `figures.md`: a heading per figure the user supplied, then one list
   item per part, `- 12: housing [F3]`, one numeral per part across all
   figures. Put the Feature List rows the part shows in brackets. A part that
   shows no row has no brackets. The claimed-feature coverage check
   (37 CFR 1.83(a)) in Step 4 reads these links. Without them it is skipped.
   Leave `pageSize` out of the top block of the file: the drawings then use
   the page of the office's export (letter for US, A4 for EPO), one page size
   per application.
3. A feature the disclosure only implies goes to the attorney as a question,
   not into a row.

Done when both files exist and every row cites a disclosure span. Stop at the
Intake gate.

## Step 2: Claims

Hand the confirmed Feature List and the prior-art results to the
**claim-drafting** skill. Save its claim set as `claims.md` with
`approved: false` in the top block of the file, and put the same comment line
directly above it:
`# Review, then change false to true below, or click the action at the top.`
Stop at the Claims gate. When the claims change after
approval, the attorney sets `approved: true` again.

## Step 3: Plan, draft and integrate the specification

1. Before the first drafting call, state in chat the model and the provider
   the disclosure goes to. Use the same values in the save in Step 4.
2. Call `start_application_draft` with the matter folder. It returns the
   Feature List, the figures, the Approved Claims, the Draft Outline when it
   exists, and up to five style exemplars, or it refuses and names the
   gate to open.

The draft save refuses while `draft-outline.md` is missing or was made from
other claims: after the attorney approves changed claims, plan again.

### 3a: Plan

1. From the Approved Claims, the Feature List and the figures, write the
   **Draft Outline** per [references/outline-format.md](references/outline-format.md):
   the Template items of the office order, and one Technical item per claim
   concept with its claims, claim terms (copy the claim terms from the
   `start_application_draft` list), sources and `Explain`. A concept
   with no source gets a `Question`, never a source found outside the matter.
2. Save with `write_patent_results`, template `draft-outline`, to
   `drafting/<matter>/draft-outline.md`. The save returns the Findings on the
   outline. Fix every Error the save reports before 3b.
3. Tell the attorney the outline is in the folder and they can edit it
   before drafting. It is not a gate.

### 3b: Draft by item

1. Write the specification in outline order, which follows the office's
   section order ([US](references/us-section-order.md) or
   [EPO](references/epo-section-order.md)). A claim element, example or
   embodiment with no source, such as an item with only a `Question`, yields an
   Inventor Question and no technical text.
2. Put a source marker before every paragraph, with the `item:O<n>` it
   realises, per [references/marker-syntax.md](references/marker-syntax.md).
3. Technical content comes only from a Feature List row, a disclosure span,
   an answered Inventor Question or an attorney instruction. Model-Proposed
   is for structure: transitions and boilerplate.
4. Write results only for experiments the disclosure says were run. A
   prophetic example is in present or future tense.
5. Exemplars shape voice and structure only, per
   [references/exemplar-rule.md](references/exemplar-rule.md). The tools
   create `style/` with a README; when it has no exemplar, tell the attorney
   once that they can put 1 to 5 of their own filed applications there.

### 3c: Integrate

1. Read the whole draft once per [references/integration-review.md](references/integration-review.md).
2. Write one advisory item per check that finds something and one per planned
   claimed combination, each quoting the passage with its line.
3. Hand the advisory items to `validate_draft` in Step 4.

Done when the outline is saved for the Approved Claims, every paragraph has
a marker, every Technical item is in a paragraph or an Inventor Question,
and the advisory items are written.

## Step 4: Save and validate

1. Save with `write_patent_results`, template `draft-application`, to
   `drafting/<matter>/draft-application.md`, with `office`, `model`,
   `provider` and `version`. Findings never block a save.
2. Call `validate_draft` on the matter folder with the advisory items of
   Step 3c. It runs the code validators, also the outline rules, and writes
   `findings.md`.
3. When a claim has no figure support (a `figure-coverage` Error, or an
   advisory item on 37 CFR 1.83(a)), give the attorney two options in one
   sentence: "Add a figure of the <part>" or "Remove claim <n> (this re-opens
   the claims approval)". Call `remove_claim` only after the attorney chooses
   the removal.

Done when `findings.md` holds the validator findings and the advisory items.

## Step 5: Resolve Inventor Questions

The save writes each Inventor Question to `inventor-answers.md`; the attorney
or the inventor fills the answers. When the attorney asks you to apply them,
follow [references/resolve-inventor-questions.md](references/resolve-inventor-questions.md).
When the attorney asks to send the questions to the inventor, call
`inventor_questions` with action `send`: it writes `inventor-questions.docx`,
a Word table with one row per open question and an empty answer cell. When
the inventor answered in that file (or in a `.md` file in the matter folder),
call `inventor_questions` with action `import` and that file before you apply
the answers: code copies each answer into its empty slot and never changes a
filled one.

Done when each filled answer is in the draft and `checklist.md` step 5 shows
no answered question that is not applied.

## Step 6: Report and export

Report the findings by severity: Error, Note, Advisory, then the open
Inventor Questions, each with its line reference. Report what the validators
found and what stays open. A run without Errors is "no Error findings", never
"passed" or "ready to file".

When the attorney asks for the Word file, call `export_draft_docx` and
report its result per [references/export.md](references/export.md).

## Rules

- Describe what the draft contains and what is open. State no time or effort
  saving anywhere.
- The inventor or the attorney answers an Inventor Question, in
  `inventor-answers.md`. The model only asks it and moves the written answer
  into the draft. An answer in chat is an attorney instruction, not an
  inventor answer.
- Close every deliverable with: "AI-assisted analysis for review by a
  registered patent attorney — not legal advice."
