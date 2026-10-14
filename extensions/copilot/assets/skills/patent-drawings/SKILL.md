---
name: patent-drawings
description: Make the patent drawings of a drafting matter (Figures, Drawing Sheets, the drawings PDF) from figures.md, the disclosure and the inventor's sketches, as filing line art with reference numerals for the US, EPO or PCT. Use when the user asks for drawings, figures, drawing sheets, or a flowchart or block diagram from a method claim; it refuses photos-only input, organic shapes and complex mechanisms with the reason.
user-invocable: true
---

# Patent Drawings

Make the **Drawing Set** of one matter in `drafting/<matter>/`. Each **Figure**
has a scene file that code turns into line art, checks and lays out on
**Drawing Sheets**. You write scenes and fix Findings. You never draw pixels
and never place a numeral by coordinates.

Inputs: `figures.md` (the parts and their numerals per Figure), the
disclosure, `feature-list.md`, the Approved Claims, and sketches in
`drafting/<matter>/sketches/`. Outputs go to `drafting/<matter>/drawings/`.

## Step 1: Read and scope

1. Read `figures.md`, `feature-list.md` (its `office`) and each sketch, per
   [references/sketch-reading.md](references/sketch-reading.md): the list says
   what exists, the sketch says where.
2. For each Figure, decide the mode (3D scene, flowchart, block diagram) or a
   refusal per [references/scope-and-refusals.md](references/scope-and-refusals.md).
3. State in chat, per Figure: the mode, or the refusal and its reason.

Done when every `FIG. N` heading of `figures.md` has a stated mode or refusal.

## Step 2: Write the input per Figure

1. 3D Figure: write the `scene` per [references/scene-schema.md](references/scene-schema.md).
   Write the numeral ports first, one per listed part, then the geometry.
   Use a library part for each standard part ([references/part-library.md](references/part-library.md)).
2. Flowchart or block diagram: first make sure `figures.md` lists the step or
   block numerals under the Figure heading, in the `numerals:` scheme (`2, 4,
   6` for `even`; `502, 504` in FIG. 5 for `hundreds`). Then give
   `flowchart` with `fromClaim` (an approved method claim number) or `steps`
   (the texts in order), never both, or `block` with `blocks` in numeral order
   and `connections`. A flowchart `proposal` adds decisions and edges only.

Done when every in-scope Figure has an input whose numerals are all in
`figures.md`.

## Step 3: Render and fix, at most three rounds

1. Call `render_figure` with `matter`, `figure` (the number), `partial` for a
   partial view, and one input. It writes `FIG-N.scene.json`, `FIG-N.svg`
   and a review render, and returns the render and the Findings. A refusal
   writes nothing and uses no round: fix what it names.
2. Fix each Error per [references/fault-list.md](references/fault-list.md),
   in the input, then render again. Look at the render for what code cannot
   check: a part in the wrong place, a wrong view.
3. Stop after the third round. Report the Errors that stay open.

Done when each Figure has no Error Finding, or has used three rounds and its
open Errors are reported.

## Step 4: Propose missing parts and stop

When a sketch or the disclosure needs a part that `figures.md` does not list,
call `propose_figure_part` with `matter`, `figure`, `part`, the `sketch` it
comes from (the attached image name or a workspace path) and `features` when
it shows a Feature List row. Leave out `numeral` to get the next free one.
Ask the attorney to confirm the part (remove "(proposed)") or delete the
line, and wait.

Done when every needed part is either confirmed in `figures.md` or proposed
and the attorney is asked.

## Step 5: Build the set and report the receipt

1. Call `build_drawing_set` with `matter`. It refuses on a `(proposed)` line,
   an open Figure Error, an open figure-list Error (claimed-feature
   coverage, page size) or a failing sheet check; report each item it lists.
   Only the attorney waives an Error, in `findings.md`.
2. On success it writes `sheet-N.svg`, `drawings.pdf` and
   `drawings-compliance.md`, and updates `filing-manifest.md` when the export
   has written one.
3. Report: the sheet count, the checks by result (pass, fail, not checked)
   with each failing check and its rule, and the rules only the attorney can
   judge ([references/office-page-rules.md](references/office-page-rules.md)).

Done when the receipt is reported. Say "no failing check", never
"compliant", "passed" or "ready to file". Close with: "AI-assisted drawings
for review by a registered patent attorney — not legal advice."
