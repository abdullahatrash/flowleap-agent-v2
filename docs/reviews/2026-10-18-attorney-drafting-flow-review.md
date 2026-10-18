# Attorney drafting flow review, 2026-10-18

Written by a read-only review agent on 2026-10-18. It looked at the live matter `drafting/pipe-clamp/` (US application from `disclosure/pipe-clamp-disclosure.md`) after a full run of the application-drafting and patent-drawings skills in the editor Patent Agent chat, on branch `integration/drawings-d1-d4`. It changed nothing. PRD 0025 executes its ranked fixes.


## Verdict

The design is sound: a flag the attorney writes in a file is a better record than a word in chat, and `checklist.md` already names the file, the line and the text for each open step. The execution hides that help: nobody opens the checklist, chat shows one line about it, and the gate files do not explain themselves. The attorney needs no course, only the instruction where they look and one click to act on it.

## Where the attorney gets lost

| Stop | Text they see | Must do | Lost because |
|---|---|---|---|
| Intake gate | "feature-list.md has no `confirmed` flag in its frontmatter. The attorney sets `confirmed: true` after review; a statement in chat does not open this gate." | Open file, line 3, `false` to `true` | "frontmatter" and "flag" are engineering words. The file shows `confirmed: false` with no sentence on what it is. |
| Claims gate | Same with `approved`. Chat adds only "Wrote checklist.md: the next step for the attorney is step 2 (Approve the claims)." | Same edit | The useful line "→ Review claims.md, then on line 3 write:   approved: true" sits in a file nothing opens. |
| Claims changed | "claims.md changed after it was approved, so `approved` was set to `false`." | Re-approve, re-plan, re-draft | Reads as a punishment. Live now: `claims.md` says `approved: false` (17:37), `checklist.md` (10:34) still ticks step 2. |
| Errors | Ten `antecedent-basis` Errors, all false positives (#747). "To waive one, add a line `  - Waived: <reason>` under it." | Type ten indented lines | Two spaces and a hyphen are a syntax. |
| Inventor Questions | "Write the inventor's answer under each **Answer:**... Then tell the agent: 'Apply the answers'." | Fill eight answers | The file explains itself. The inventor is not in the IDE and gets no document. |
| Claims 4 and 7 | Advisory: "37 CFR 1.83(a) requires every claimed feature to be shown. The attorney decides: add a figure of the leaf spring, or cancel claim 4." | Edit claims.md, then redo the gate chain | The cost is not stated. No tool offers the edit. |
| Figures | "figures.md links no part to a Feature List row (`- 12: housing [F3]`), so the claimed-feature coverage was not checked." | Add `[F#]` to 28 lines | The model built both lists and could propose the links. |
| New review cycle | Confirmation dialog after round three | Click | Right: a click with a stated cost. |

## Design vs execution

Design, keep: file flags read by code; waivers with a kept reason; Inventor Questions answered in a file; the confirm click for a new drawing cycle.

Execution gaps:
- The checklist is the right instruction in the wrong place. No tool opens it (`checklistLine` in `draftingWorkspace.ts`).
- Refusal wording is for engineers: "frontmatter", "flag", "literal YAML boolean" (`gateRefusal`, `package.json`).
- The gate files carry a bare `confirmed: false`. `findings.md` and `inventor-answers.md` explain themselves; these do not.
- The checklist goes stale in the drawings step: `renderFigureTool.ts` and `buildDrawingSetTool.ts` never rewrite it.
- No skill or tool text contains "cancel claim".
- `[F#]` links are asked of the attorney, though the model holds both tables.

## Smallest fixes ranked

1. **Chat names file, line and word at each gate, with a `file:line` link.** Text exists in `checklist.ts` (`gateStep`); link and chat placement do not.
2. **"Confirm Feature List" / "Approve Claims" CodeLens at line 1.** Does not exist (no CodeLens or command touches drafting files in `extensions/copilot/src` or `package.json`).
3. **Open `checklist.md` after each tool call; rewrite it from the drawing tools too.** Does not exist (no `showTextDocument` in any drafting tool).
4. **Waive as a CodeLens on an Error, plus "Waive all of this rule".** Does not exist.
5. **Claim decision in chat with two actions.** "Claim 4 covers a leaf spring no figure shows. Add a figure, or remove the claim. Removing it closes the claims gate." Exists only as advisory prose.
6. **Model proposes `[F#]` links at intake; attorney confirms.** Exists as a validator message only (`figureValidators.ts`).
7. **Inventor Questions exported as .docx, answers imported back.** Does not exist (`export.md`).
8. **One comment line in each gate file**: "Review, then change `false` to `true` below."

## Ideal transcript

1. Attorney: "Draft my US application from disclosure/pipe-clamp-disclosure.md."
2. Chat: "Feature List written, 24 rows. Review it, then click **Confirm Feature List** at the top of feature-list.md." The file opens.
3. Attorney reads, clicks. Chat: "Confirmed. Drafting the claims."
4. Chat: "14 claims. Click **Approve Claims** at the top of claims.md." Attorney reads, clicks.
5. Chat: "Draft saved. Steps 1 to 3 done. 8 Inventor Questions: **Send to inventor** writes inventor-questions.docx."
6. The answered file comes back. Attorney: "Apply the answers."
7. Chat: "10 antecedent Errors, one rule. **Waive all** or review each." Attorney clicks, types one reason.
8. Chat: "Claims 4 and 7 cover parts no figure shows. **Add figures** or **Remove claims 4 and 7**." Attorney clicks Remove, then **Approve Claims** again.
9. Attorney: "Export to Word", then "Make the drawings." Three rounds per figure, one confirm click.
10. Chat: "Three .docx files, filing-manifest.md, drawings.pdf. A draft for attorney review, not a filing."

## Gaps

- Lines 2, 4, 8: no editor action; today hand-edited YAML after an engineer-worded refusal.
- Line 5: checklist not shown. Line 6: no inventor document. Line 7: no bulk waiver.
- Line 8: no claim action, no stated cost. Line 9: checklist stale during drawings.
- Line 10 is already true.
