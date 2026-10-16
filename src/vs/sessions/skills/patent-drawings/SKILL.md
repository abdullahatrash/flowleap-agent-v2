---
name: patent-drawings
description: Make the patent drawings of a drafting matter (Figures, Drawing Sheets, the drawings PDF) from figures.md, the disclosure and the inventor's sketches, as filing line art with reference numerals for the US, EPO or PCT. Use when the user asks for drawings, figures, drawing sheets, or a flowchart or block diagram from a method claim; it refuses photos-only input, organic shapes and complex mechanisms with the reason.
---

# Patent Drawings

Make the **Drawing Set** of one matter in `drafting/<matter>/`. Each **Figure**
has a scene file that code turns into line art, checks and lays out on
**Drawing Sheets**. You write scenes and fix Findings. You never draw pixels
and never place a numeral by coordinates.

Inputs: `figures.md` (the parts and their numerals per Figure), the
disclosure, `feature-list.md`, the Approved Claims, and sketches in
`drafting/<matter>/sketches/`. Outputs go to `drafting/<matter>/drawings/`.

## The drawings CLI

Run every command from the workspace folder that holds `drafting/`, with the
launcher in this skill's base directory:

```sh
sh "<skill base directory>/drawings.sh" render <matter> <N> --scene drafting/<matter>/drawings/FIG-<N>.scene.json
sh "<skill base directory>/drawings.sh" render <matter> <N> --flowchart drafting/<matter>/drawings/input/FIG-<N>.json
sh "<skill base directory>/drawings.sh" render <matter> <N> --block drafting/<matter>/drawings/input/FIG-<N>.json
sh "<skill base directory>/drawings.sh" propose <matter> <N> "<part>" --sketch <workspace path> [--features F3] [--numeral <n>]
sh "<skill base directory>/drawings.sh" build <matter>
```

Add `--new-cycle` to `render` to start the next review cycle of a Figure
(three more rounds). Unlike the editor tool, it has no chat confirmation. The
guard is the host's approval of the command and a hard cap of three cycles per
Figure: after that, `render` refuses until a person clears the rounds.

`<N>` is the Figure number, or `1A` for a partial view. Each command prints
one JSON object. `"ok": false` is a refusal: it wrote nothing; report its
`reason`. The launcher runs `drawings-cli.js` of this app on the app's own
runtime; no Node.js install is needed. When it cannot find the app, it says
so: ask the user to set `FLOWLEAP_DRAWINGS_CLI` to
`<app>/resources/app/extensions/copilot/dist/drawings-cli.js` (macOS:
`<App>.app/Contents/Resources/app/extensions/copilot/dist/drawings-cli.js`).

## Step 1: Read and scope

1. Read `figures.md`, `feature-list.md` (its `office`) and each sketch, per
   [references/sketch-reading.md](references/sketch-reading.md): the list says
   what exists, the sketch says where.
2. For each Figure, decide the mode (3D scene, flowchart, block diagram) or a
   refusal per [references/scope-and-refusals.md](references/scope-and-refusals.md).
3. State in chat, per Figure: the mode, or the refusal and its reason.

Done when every `FIG. N` heading of `figures.md` has a stated mode or refusal.

## Step 2: Write the input file per Figure

1. 3D Figure: write `drawings/FIG-<N>.scene.json` per
   [references/scene-schema.md](references/scene-schema.md). Write the numeral
   ports first, one per listed part, then the geometry. Use a library part
   for each standard part ([references/part-library.md](references/part-library.md)).
2. Flowchart or block diagram: first make sure `figures.md` lists the step or
   block numerals under the Figure heading, in the `numerals:` scheme (`2, 4,
   6` for `even`; `502, 504` in FIG. 5 for `hundreds`). Then write
   `drawings/input/FIG-<N>.json`: a flowchart is `{ "fromClaim": <approved
   method claim number> }` or `{ "steps": ["...", "..."] }`, never both, with
   optional `"terminals": true` and a `"proposal"` of decisions and edges
   only; a block diagram is `{ "blocks": [{ "id", "label" }], "connections":
   [{ "from", "to", "label"?, "direction"? }] }`, blocks in numeral order.

Done when every in-scope Figure has an input file whose numerals are all in
`figures.md`.

## Step 3: Render and fix, at most three rounds

1. Run `render` for the Figure. It writes `FIG-<N>.scene.json`,
   `FIG-<N>.svg`, the review render named in `review` and `rounds.json`, and
   prints the Findings.
2. Read the review PNG. Fix each Error per
   [references/fault-list.md](references/fault-list.md), in the input file,
   then render again. Look at the render for what code cannot check: a part
   in the wrong place, a wrong view. When you cannot read images, add
   `--no-render-seen`, so the receipt records that no render was seen.
3. Stop after the third round of the review cycle (`roundsLeft` is 0, or the
   CLI refuses). Report the Errors that stay open.
4. Never add `--new-cycle` on your own. Add it only when the attorney asked to
   continue work on this Figure or the engine changed, and ask the attorney
   in chat first: this flag has no chat confirmation.

Done when each Figure has no Error Finding, or has used the three rounds of
its review cycle and its open Errors are reported. A new review cycle starts
only when the attorney asked for it.

## Step 4: Propose missing parts and stop

When a sketch or the disclosure needs a part that `figures.md` does not list,
run `propose` with the Figure, the part name, the sketch it comes from and
`--features` when it shows a Feature List row. Leave out `--numeral` to get
the next free one. It adds a `(proposed from sketches/<file>)` line and copies
the sketch. Ask the attorney to confirm the part (remove "(proposed)") or
delete the line, and wait.

Done when every needed part is either confirmed in `figures.md` or proposed
and the attorney is asked.

## Step 5: Build the set and report the receipt

1. Run `build`. It refuses when a Figure that `figures.md` names is not drawn
   (`figures-missing`), on a `(proposed)` line, an open Figure Error, an open
   figure-list Error (claimed-feature coverage, page size) or a failing sheet
   check; report each item it lists. Only the attorney waives an Error, in
   `findings.md`.
2. On success it writes `sheet-N.svg`, `drawings.pdf` and
   `drawings-compliance.md`, and updates `filing-manifest.md` when the export
   has written one.
3. Only when the attorney asks to review the Figures drawn so far, run
   `build --partial`. The receipt then starts with `INCOMPLETE SET` and
   `filing-manifest.md` is not changed. Report it as a review build, never as
   the Drawing Set.
4. Report: the sheet count, the checks by result (pass, fail, not checked)
   with each failing check and its rule, and the rules only the attorney can
   judge ([references/office-page-rules.md](references/office-page-rules.md)).

Done when the receipt is reported. Say "no failing check", never
"compliant", "passed" or "ready to file". Close with: "AI-assisted drawings
for review by a registered patent attorney — not legal advice."
