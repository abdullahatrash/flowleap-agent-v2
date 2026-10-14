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
sh "<skill base directory>/drawings.sh" render <matter> <N> --flowchart drafting/<matter>/drawings/FIG-<N>.flowchart.json
sh "<skill base directory>/drawings.sh" render <matter> <N> --block drafting/<matter>/drawings/FIG-<N>.block.json
sh "<skill base directory>/drawings.sh" propose <matter> <numeral> "<part>" --sketch sketches/<file> --figure <N>
sh "<skill base directory>/drawings.sh" build <matter>
```

Each command prints one JSON object. `"ok": false` is a refusal: report its
`reason` and `findings`. The launcher runs `drawings-cli.js` of this app on
the app's own runtime; no Node.js install is needed. When it cannot find the
app, it says so: ask the user to set `FLOWLEAP_DRAWINGS_CLI` to
`<app>/resources/app/extensions/copilot/dist/drawings-cli.js` (macOS:
`<App>.app/Contents/Resources/app/extensions/copilot/dist/drawings-cli.js`).
Pass `--office US`, `EPO` or `PCT` when `feature-list.md` sets no office.

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
2. Flowchart: write `drawings/FIG-<N>.flowchart.json` as
   `{ "claim": "<approved method claim>" }` or
   `{ "steps": [{ "id": "s1", "text": "..." }] }`. Code makes one box per
   step. You may add `"proposal": { "nodes": [decisions], "edges": [loops] }`
   only, and `"terminals": true` for START and END.
3. Block diagram: write `drawings/FIG-<N>.block.json` as
   `{ "blocks": [{ "id", "label" }], "connections": [{ "from", "to", "label"?, "direction"? }] }`,
   blocks in numeral order.

Done when every in-scope Figure has an input file whose numerals are all
confirmed parts of `figures.md`.

## Step 3: Render and fix, at most three rounds

1. Run `render` for the Figure. It writes `FIG-<N>.svg` and the review render
   named in `review`, and prints the Findings.
2. Read the review PNG. Fix each Error per
   [references/fault-list.md](references/fault-list.md), in the input file,
   then render again. Look at the render for what code cannot check: a part
   in the wrong place, a wrong view.
3. Stop after the third round (`roundsLeft` is 0, or the CLI refuses). Report
   the Errors that stay open.

Done when each Figure has no Error Finding, or has used three rounds and its
open Errors are reported.

## Step 4: Propose missing parts and stop

When a sketch or the disclosure needs a part that `figures.md` does not list,
run `propose` with the numeral, the part name and the sketch it comes from.
It adds a `(proposed from <sketch>)` line. Do not draw the part. Ask the
attorney to confirm it (remove the marker) or delete the line, and wait.

Done when every needed part is either confirmed in `figures.md` or proposed
and the attorney is asked.

## Step 5: Build the set and report the receipt

1. Run `build`. It refuses on a `(proposed)` line, an unwaived Error or a
   claimed feature with no drawn part; report each item it lists.
2. On success it writes `sheet-N.svg`, `drawings.pdf`, `drawings-compliance.md`
   and, when the draft and the claims exist, `filing-manifest.md`.
3. Report: the sheet count, the checks by result (pass, fail, not checked)
   with each failing check and its rule, the review rounds per Figure, and the
   rules only the attorney can judge ([references/office-page-rules.md](references/office-page-rules.md)).

Done when the receipt is reported. Say "no failing check", never
"compliant", "passed" or "ready to file". Close with: "AI-assisted drawings
for review by a registered patent attorney — not legal advice."
