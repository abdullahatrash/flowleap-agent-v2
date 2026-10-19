# PRD 0025 — Attorney Gate Actions

**Status:** READY 2026-10-18 — slice tickets S1 #756, S2 #757, S3 #758, S3b #759, S4 #760, S5 #761, S6 #762
**Date:** 2026-10-18
**Base:** main after #754 (`31642767c23`); S3b and S5 on `integration/drawings-d1-d4`
**Decides:** four small things under *Decisions*. No new ADR. ADR 0012 stays as it is.
**Glossary:** `CONTEXT.md` → Application Drafting, Feature List, Approved Claims, Finding,
Inventor Question, Drafting Checklist, Figure, Drawing Set.
**Evidence:** `docs/reviews/2026-10-18-attorney-drafting-flow-review.md` (live matter
pipe-clamp); the founder, same day: "How the hell will the patent attorney know these terms,
'cancel claims 4 and 7', 'set approved true'? This now needs a course."

## Why

The design is sound: flags in files, waivers with a reason, Inventor Questions in a file, and a
Drafting Checklist that names the file, the line and the text for each open step. The execution
hides that help. No tool opens the checklist. The gate files carry a bare `confirmed: false`
with no sentence on what it is. The refusals say "frontmatter", "flag" and "literal YAML
boolean". Ten Errors of one rule need ten indented lines. A claim with no figure support gets
advice, not an action. The inventor gets no document.

**Success test.** A patent attorney who never saw the product runs the flow from "draft my
application" to the Word export and the drawings. They see no course, no YAML and no indented
syntax. Still, every approval is a deliberate act that a file records.

**Why a click keeps the doctrine.** A click in the editor that writes the flag keeps ADR 0012
decision 3 and the skill's gate rule: the attorney acts on the file, the record shows the flag,
and the model cannot write it, because the click is an editor command and not a tool.

## Decisions

1. **Gate actions are editor commands, never tools.** "Confirm Feature List", "Approve Claims"
   and "Waive" are CodeLens actions in the gate file, registered as commands with no tool entry.
   Rejected: a chat button, which would be the model's act (a tool result carries no button).
2. **The record format does not change.** A click writes the same `confirmed: true`,
   `approved: true` and `  - Waived: <reason>` lines a hand edit writes.
3. **The checklist is revealed, not pushed.** A drafting tool opens `checklist.md` beside the
   active editor, without focus, when it is not visible; the chat result ends with the
   next-step line.
4. **Claim removal is a typed tool with a confirmation in code** (the `render_figure`
   `newCycle` pattern): VS Code shows the cost before the tool runs. The approval still closes
   by code, so a skipped confirmation opens no gate.

The review's "Ideal transcript" is the target; its line 10 is already true.

## Slices

Each slice is independent. Paths are under `extensions/copilot/src/extension/`. Prior art for
every test: `tools/common/test/drafting*.spec.ts` and
`tools/vscode-node/test/applicationDraftingTools.spec.ts` (`MockFileSystemService`).

### S1 — Gate words (base main) #756

At each gate the chat names the file, the line and the one word to change, with a link that
opens the file at that line. The words frontmatter, flag, YAML and boolean leave every
attorney-facing text.

Seams: `gateRefusal` and `checklistLine` in `tools/vscode-node/draftingWorkspace.ts`;
`gateStep` and `fieldLine` in `tools/common/drafting/checklist.ts`; the "Gates" section of
`assets/skills/application-drafting/SKILL.md`; the model descriptions of the three drafting
tools in `package.json`. The link: `linkify/common/filePathLinkifier.ts` emits a
`LinkifyLocationAnchor`, which already accepts a `Location`; it learns an optional `:<line>`
suffix, so `` `drafting/x/claims.md:3` `` opens at line 3.

Done when: a refused start, validate or export says "Review drafting/x/claims.md, then change
`false` to `true` on line 3", the path opens line 3, and a grep for the four words over the
refusals, the checklist renderer and the skill finds nothing. Tests: the checklist snapshot,
one linkifier test, one refusal assertion per tool.

Merge Danger: low. S2 and S3 touch the same files; rebase, do not re-split.

### S2 — Gate buttons (base main) #757

A CodeLens at line 1 of `drafting/*/feature-list.md` reads "Confirm Feature List"; on
`claims.md` it reads "Approve Claims". A click writes the flag line through a `WorkspaceEdit`,
or adds it to the top block when it is missing. On a file already `true` the lens is inert. The
skill's Step 1 and 2 write one comment line above the flag:
`# Review, then change false to true below, or click the action at the top.`

Seams: no CodeLens exists in `extensions/copilot/src/extension` (only test fixtures). Copy
`PatentAIContribution` in `patentai/vscode-node/patentContribution.ts` (registered in
`extension/vscode-node/contributions.ts`) and add `vscode.languages.registerCodeLensProvider`
on `**/drafting/*/{feature-list,claims}.md`. Readers: `readGateFlag` in
`common/drafting/frontmatter.ts`, `fieldLine` in `checklist.ts` (export it).
`writeDraftingFrontmatter` drops comments (`yaml.stringify`) and `checkClaimsApproval` calls it
to add `approvedHash`: it must keep `#` lines, or the help line vanishes on the first tool call.

Done when: a click sets `approved: true` and the comment survives the next
`start_application_draft`; `ToolName` gains nothing.
Tests: `draftingFrontmatter.spec.ts` (comments kept) and a provider test.

Merge Danger: medium. `writeDraftingFrontmatter` is shared by every drafting write; the change
is additive and its round-trip test must stay green.

### S3 — Checklist surfaced (base main) #758

Every drafting tool that writes `checklist.md` reveals it beside the active editor, `preserveFocus: true`, only when no visible editor shows it. The
chat result ends with the first open step in the S1 form: "Next: review drafting/x/claims.md:3
and click Approve Claims".

Seams: `checklistLine` and `refusal` in `draftingWorkspace.ts`, the one place every tool
passes; `nextChecklistStep` in `checklist.ts`; `writePatentResultsTool.ts` runs `vscode.open`
after a save (prior art). The tests have no window: the reveal goes behind an injectable
callback that defaults to the VS Code call, as the PDF reader does.

Done when: after a refused export the checklist is visible beside the chat, the chat text ends
with the file, line and action, and a second refusal opens no second editor. Tests: one
callback call per tool call, and the result text.

Merge Danger: low. Same `checklistLine` as S1; whoever merges second rebases.

### S3b — Checklist current during the drawings (base `integration/drawings-d1-d4`) #759

`render_figure`, `build_drawing_set` and `propose_figure_part` rewrite `checklist.md` after they
run, also after a refusal. The Figures note gains the drawn count: "Figures: 10 in figures.md,
3 drawn in drawings/".

Seams: the three tools call `DraftingWorkspace.locate` and never `checklistLine`;
`checklistNotes` in `checklist.ts`; `DraftingChecklistFiles` gains `drawnFigures`, read through
`matterFiles().listFiles('drawings')`. The tools do not exist on main.

Done when: after a `render_figure` call the checklist is newer than the render and counts the
drawn Figures; a refused `build_drawing_set` ends with the open steps. Tests:
`drawingTools.spec.ts` on the branch; the checklist snapshot.

Merge Danger: medium. The branch moves daily; rebase before the PR.

### S4 — Waive by click (base main) #760

A CodeLens on each unwaived Error line of `drafting/*/findings.md` reads "Waive…". A click asks
the reason in an input box and writes `  - Waived: <reason>` under the item; an empty reason
writes nothing. When one rule has more than two unwaived Errors, the first also shows "Waive all
N Errors of this rule": one reason, written under each item.

Seams: `parseFindingsFileItems` in `common/drafting/findingsFile.ts` gives each item with
`fileLine`, rule and waived state; `waiverPattern` there is the format; the provider lives in
the S2 file with a second selector.

Done when: ten antecedent-basis Errors show ten "Waive…" lenses and one "Waive all 10"; after
the bulk click `validate_draft` keeps all ten waivers and `export_draft_docx` stops listing
them; a cancelled input box changes nothing. Tests: a provider test over a findings fixture;
`draftingFindingsFile.spec.ts` round-trips the written file.

Merge Danger: low. Existing format; merge S2 first or rebase.

### S5 — Claim decisions (base `integration/drawings-d1-d4`) #761

When the `figure-coverage` Error or the advisory review says a claim has no figure support
(37 CFR 1.83(a)), the chat offers two actions with the cost: "Add a figure of the leaf spring"
or "Remove claim 4 (this re-opens the claims approval)". "Remove" is a new tool `remove_claim`:
it deletes the claim, renumbers the claims after it, rewrites dependency references, and
refuses with the list when another claim depends on it. The approval closes as today by the
body hash; the attorney re-approves with S2.

Seams: the Error text at the end of `common/drafting/figureValidators.ts` (only on the
integration branch); `parseClaims` in `common/drafting/claims.ts`; `prepareInvocation` with
`confirmationMessages` copied from `renderFigureTool.ts`; `checkClaimsApproval` already clears
`approved` on a hash change; the skill's Step 4 names the two options. "Cancel claim" appears
nowhere attorney-facing.

Done when: on the coverage Error the chat names both actions and the cost; "remove claim 4" on
14 claims yields 13 with "claim 5" references rewritten; the next start refuses with the S1
sentence; removing a claim that claim 9 depends on refuses and names claim 9. Tests: a
`draftingClaims.spec.ts` case per renumber rule; one tool test per refusal.

Merge Danger: medium. New entry in `package.json` and `toolNames.ts`; the Working Record and
the chat name old and new claim numbers.

### S6 — Inventor Questions document (base main; lowest priority) #762

"Send to inventor" writes `inventor-questions.docx` from `inventor-answers.md`: one table, a
row per open question with an empty answer cell. "Apply the answers" also accepts the answered
`.docx` or a `.md` beside it: code copies each answer cell into the matching `**Answer:**`
slot, never over a filled one; then the model applies the answers as today.

Seams: `parseInventorAnswers` and `currentAnswer` in `common/drafting/inventorAnswers.ts`; the
`docx` package as in `draftDocx.ts`; `mammoth` as in `draftingWorkspace.ts`. One new tool. The
skill's Step 5 gains two sentences.

Done when: eight open questions give a .docx with eight rows; three filled cells fill three
slots and leave five empty; a re-run overwrites no filled slot. Tests:
`draftingInventorAnswers.spec.ts`; a docx round trip beside `draftDocx.spec.ts`.

Merge Danger: low. New files and one tool; nothing shared.

## Rules for the agent (every slice)

- One worktree per agent from the slice's base; stage by pathspec; commit with `--no-verify`.
- Type-check with `tsgo`; never `npm run compile`.
- No `any`; tabs; `l10n.t` or `nls` for every user string; the Microsoft header on new files.
- No text says a draft or a Drawing Set passed or is ready to file.
- The model never writes a gate flag, a waiver or an answer; code writes what the attorney
  clicked or the inventor wrote. Keep the record formats.

## Out of scope

- Model-proposed `[F#]` links at intake (review item 6): a skill change, filed separately.
- A web form or e-mail for the inventor; any change to ADR 0012 or to the three gates.

## Risks

- **Auto-approved tool calls.** Blanket tool approval skips the S5 confirmation; the removal
  then happens on the model's call. No gate opens from it. Accepted.
- **Comment loss.** Without S2's writer change the first tool call erases the help line. The
  round-trip test guards it.

## Execution

S1 and S2 first; S3 and S4 after; S3b and S5 on the integration branch; S6 last. One live run
of the review's transcript, recorded under `docs/reviews/`, closes the PRD.

## Outcome

**Code complete 2026-10-18.** Seven PRs merged to main: S1 #766, S2 #765, S3 #771, S3b #764, S4 #768, S5 #767, S6 #769.

**Live run 2026-10-19** on the D7 matter (`docs/reviews/2026-10-19-drawings-d7-acceptance-pipe-clamp.md`), founder as the attorney, Claude Opus 5.5:

| Action | Exercised | What happened |
|---|---|---|
| Remove claims by a plain sentence (S5) | Yes | "Remove claims 4 and 7" removed both, renumbered the rest, and the claims were re-approved with the hash. |
| Approve Claims button (S2) | Yes | Claims re-approved after the removal. |
| Waive by click (S4) | Yes | Two clicks of "Waive all N Errors of this rule", one reason each, 11 waiver lines written. |
| Checklist surfaced (S3, S3b) | Yes | `checklist.md` showed the next step and the waive instruction. It stayed stale after the waive clicks until the next tool call (#785). |
| Gate words (S1) | Yes | No step asked for a flag, a frontmatter word or a command name. |
| Inventor Questions document (S6) | No | The questions were answered in the file before S6 shipped. |

**Gaps found, filed:**

- #784: CodeLens shows in the text editor only. An attorney who reads `findings.md` in the markdown preview sees no button. Fix: editor-title buttons on the three files.
- #785: the waive and gate clicks write the file but do not rewrite `checklist.md`; the agent then reported waived Errors as blocking.
- #783: the coverage Error text offers "Remove claim 1" for an independent claim. The remove tool asks for confirmation, so the agent cannot act alone, but the option should not be offered.

The PRD closes when #784 and #785 are merged and one more attorney run reads the files in the preview.
