# Patent drawings D7 run: pipe clamp (PRD 0023, #651)

**Date:** 2026-10-18 to 2026-10-19. **Build:** `integration/drawings-d1-d4` at 3403f7f7e48 (PR #774).
**Model:** Claude Opus 5.5 (Anthropic BYOK). **Workspace:** `~/FlowLeap Projects/IDF-D7`, matter `drafting/pipe-clamp`, office US.

## Verdict

Pipeline check PASSED. The D7 acceptance is not closed: two of its criteria were not exercised (see the table).

The disclosure was written by the agent to fit the engine (plates, blocks, pins, a spring, a pipe). A pass shows that the pipeline works end to end on a v1-sized input. It does not show that an attorney's own disclosure works. A run on a real disclosure stays open, with the professional comparison (#651).

## Input

- `disclosure/pipe-clamp-disclosure.md`: quick-close pipe clamp with a spring-opened hinged cap; numbered method steps in section 5.
- Two labelled sketches: `sketch-1-assembly.png` (perspective), `sketch-2-section.png` (end section). A washer is on sketch 2 only, never in the prose.
- Intake, Feature List (24 rows), 14 claims (method claim 8 after renumbering), draft, 8 Inventor Questions answered by the founder as the inventor.

## What the run produced

| Step | Result |
|---|---|
| Feature List, claims, draft | Done in the app on 2026-10-18. The drafting agent found three real slips in the synthetic disclosure (cap 14 mm against a 13 mm groove; 9 mm pocket in a 7 mm land; hole access). |
| Claims 4 and 7 removed | Done by one plain prompt on 2026-10-19. The claims were re-approved and the hash recorded. 10 claims remain. |
| figures.md | FIG. 1 perspective, FIG. 2 end section, FIG. 3 flowchart. Every part links to a Feature List row (`[F3]`). Numerals even, 10 to 52. |
| FIG. 1 | Cycle 2, three rounds. Round 2 tried dashed hidden edges to show hinge lug 20; the agent judged that cluttered and asked the attorney. Decision: leave 20 out of FIG. 1, it is in FIG. 2. |
| FIG. 2 | Cycle 2, one round, no Errors. One Note: base plate and saddle block share one hatch. Correct, they are one machined part (claim 6). |
| FIG. 3 | Flowchart from the method claim, one box per step, numerals 44 to 52 as listed in figures.md, START and END terminals. |
| Drawing Set | `drawings.pdf`, 3 sheets, Letter. Receipt `drawings-compliance.md`: 29 pass, 0 fail, 1 not checked. |

The receipt's two Notes: FIG. 1 lists 10 and 20 but does not draw them; FIG. 2 lists 14, 28 and 30 but does not draw them. Numeral 10 (the whole clamp) was never drawn in any figure.

## D7 criteria

| Criterion | Met | Evidence |
|---|---|---|
| One real disclosure, two labelled sketches, one method claim, whole pipeline | Yes, on a synthetic disclosure | Input above; `drawings/` of the matter |
| Numeral set equals the description | Yes, with the two Notes above | Receipt rows `numeral-*`, `figure-parts-not-drawn` |
| Every claimed feature drawn, coverage check green | Green by waiver | The six `figure-coverage` Errors were validator mistakes (#783). Every structural claim element is drawn. |
| All code checks green with the receipt | Yes | 29 pass, 0 fail |
| No part the disclosure does not support | Yes | The washer was never proposed as a part; the inventor answer made it a test shim |
| At least one part through the proposal gate | **No** | The agent did not propose a part from the sketch on its own. The gate exists (`propose_figure_part`) and was not exercised. |
| Flowchart has one node per claimed step | Yes | FIG. 3: 5 steps, 5 boxes |
| Patent professional compares with an illustrator's set | **No** | Stays open under #651 |

## Faults found by this run

Engine and validators, in the order found. All fixed on the branch of PR #774 unless marked open.

| Issue | What | State |
|---|---|---|
| #747 / #748 | Antecedent-basis check swallowed the next word; 10 false Errors on real claims | Fixed |
| #752 / #755 | Section view: whole-loop edge attribution gave the cap 0 edges; false `lead-line-off-part` | Fixed |
| #753 / #754 | Skill did not ask for `[Fn]` links, so the coverage check never ran | Fixed |
| #782 | `reference-numeral` rejects "step 44" against flowchart step names; 5 false Errors | Open |
| #783 | `figure-coverage` demands a drawing for every cited Feature List row, including alternatives, a material and test results; 6 false Errors. The Error text offers the removal of an independent claim. | Open |
| #786 / #788 | Flowchart numbered its steps 2, 4, 6… and ignored the numerals listed in figures.md; FIG. 3 could not render in a matter with part figures | Fixed |

Attorney-flow gaps found in the same run are in PRD 0025 and its outcome: #784 (actions invisible in the markdown preview), #785 (waive click does not rewrite the checklist).

## What the agent did well

- Stopped with one round left and asked the attorney a three-option question when FIG. 1 could not show the hinge lug from its view.
- Read the waivers back from `findings.md` when told to, and said the build order was wrong when it ran the build before FIG. 3.
- Refused to work around #786 by itself; it named the tool limit and offered options.

## What to watch

- The agent trusted a stale `checklist.md` and reported 11 blocking Errors after they were waived (#785).
- Two of the agent's four options for #786 renumbered the matter to fit the tool. The attorney should not take such options; the tool is fixed instead.
- Numeral 10 for the whole assembly is listed and never drawn. A convention for assembly numerals in a perspective view is still to decide.

## Not published

No time-saved or cost-saved figure.

## Follow-up wave, same day

A two-axis review (standards and spec) of PR #774 found 16 items, #791 to #806. Five draft PRs fixed them, merged by the founder in order #807, #808, #809, #811, #810. Three were founder decisions: the per-part code escape hatch dropped (#799), the hard cap of three review cycles dropped (#803), and drawings depends on drafting in one direction only (#798).

Re-run on the same D7 matter after the merges, in the app:

| Step | Result |
|---|---|
| Build the drawing set | Refused: `numeral-not-drawn`, numeral 10 ("pipe clamp") cited from line 42 of the draft and drawn in no Figure. The agent offered three options and asked. |
| Option 1, new cycle on FIG. 1, lead for 10 | Cycle 3 opened after confirmation. FIG. 1 round 1 carries 10 on the base plate. |
| Build the drawing set | 3 sheets, Letter. Receipt 38 pass, 0 fail, 1 not checked. New rows: six diagram rules cited, `figure-coverage`, `numeral-not-drawn`, `centre-line-crosses-part`. |

The receipt no longer carries the word the brief bans. Open after the wave: #782, #783 (validator mistakes, waivable by one click), #784 (buttons in the preview), #785 (checklist refresh after a click), #770 (eval tool list), #651 (professional comparison).
