# Fault list

Code runs these checks on the scene and on the written SVG before you see a
render. Each Finding names its `rule`. Fix the rule, not the picture: change
the scene (or the step list), then render again. Every fault is an Error
unless the table says Note.

## Scene and 3D Figure faults

From the scene validator, the renderer and `drawingFaults.ts`.

| Rule | Meaning | Fix |
|---|---|---|
| `scene-schema` | A field of the scene has a wrong type, value or range (the message gives the path, e.g. `parts[1].shape.radius`). | Correct that field per [scene-schema.md](scene-schema.md). |
| `code-not-allowed` | A part uses the `code` kind; the tools do not opt in. | Build the part from primitives or a library part. If neither can, the part is out of scope. |
| `scene-build` | The geometry kernel could not build the solids (bad boolean, zero-size cut, self-crossing profile). | Simplify the part: check that `subtract` shapes overlap the part, that a polygon or profile does not cross itself, that a tube bend radius fits its segments. |
| `part-without-numeral` | A drawn part has no numeral port. Every part drawn has one. | Add a port for the part with its numeral from `figures.md`, or remove the part. |
| `numeral-without-port` | A port names a part or face that does not exist (the message lists the faces). | Use a face from the list, or add a `point` on the face. |
| `numeral-not-allowed` | The numeral is not in `figures.md`. | Use the numeral `figures.md` gives the part. A new part goes through the `propose` command first. |
| `numeral-two-parts` | One numeral points at two different parts. | Give each part its own numeral; for one part shown twice, use the same `name` on both. |
| `lead-lines-cross` | Two lead lines cross. | Move one port: another face or `point` that the camera sees on the other side, or change the camera. |
| `lead-line-off-part` | A lead line ends off its part. | Pick a face that is visible in this camera, or give a `point` on the visible side. |
| `lead-line-far-from-numeral` | A lead line does not start beside its numeral. | Move the port so the numeral has free space near it; render again. |
| `lead-line-missing` | A numeral has no lead line and is not an underlined surface numeral. | Remove `surface: true` only if a lead line is wanted, or set it for a surface numeral. |
| `glyph-too-small` | A character is under 3.2 mm high at sheet scale. | Remove `scale` (fit to the default size), or lower the part count of the Figure. |
| `text-beyond-keywords` | A text is more than two words, or names a scale. | Remove the text. A 3D Figure carries numerals only. |
| `numeral-overlap` | Two numerals overlap. | Move one port to another face or point. |
| `numeral-on-line` | A numeral sits on a drawn line. | Move the port; a surface numeral needs a free area of the face. |

## Diagram faults

From the flowchart and block-diagram writers and `diagramFaults.ts`. A
refusal returns no SVG.

| Rule | Meaning | Fix |
|---|---|---|
| `no-steps` | Refusal: the step list is empty. | Give the numbered steps or the approved method claim. |
| `no-blocks` | Refusal: the block list is empty. | Give the blocks. |
| `node-count` | Refusal: a proposal adds a process box. One box per step, never more. | Remove the `process` node; a proposal adds decisions and edges only. |
| `numeral-range` | Refusal: too many steps or blocks for the `hundreds` series of this Figure (more than 49). | Split the method into two Figures. |
| `duplicate-node` | Refusal: an id is used twice or is `start` / `end`. | Rename the node. |
| `unknown-node` | Refusal: a decision, edge or connection names a node that is not in the Figure, or a decision is not reachable. | Use the step ids (`s1`, `s2`, ...), the decision ids and `start` / `end` only. |
| `terminal-edge` | Refusal: a proposed edge enters START or leaves END. | Reverse or remove the edge. |
| `mpep-608.02-unlabeled-box` | A US box or block has no label (MPEP 608.02, form paragraph 6.22). | Give the step or block a text. |
| `epo-empty-step`, `epo-empty-block` | An EPO step or block has no text (GL A-IX 8; PCT Rule 11.11). | Give the step or block a text. |
| `us-keywords-only` | A US label has more than 4 words (37 CFR 1.84(o)). As a Note, the label was cut to keywords for you. | Shorten the step or block label; the full step stays in the description. |
| `epo-short-sentence` | An EPO label has more than 12 words (GL A-IX 8). As a Note, the label was cut. | Shorten the label to a short sentence. |
| `label-overlap` | Two texts overlap. | Shorten the labels, or remove an edge label. |
| `numeral-set` | The drawn numerals differ from the step or block numerals. | Render again from the same step list; do not edit the SVG. |
| `lead-line` | A numeral has no lead line. | Render again; if it stays, report it. |
| `lead-crosses-edge` | A numeral or its lead line touches a connector. | Remove or move a proposed edge, or shorten the labels so the layout changes. |
| `decision-branch` | Note: a decision has fewer than two outgoing edges. | Add the second branch edge, or remove the decision. |

## Drawing Set gates

The `build` command refuses on these. They are not fixed by a render.

| Rule | Meaning | Fix |
|---|---|---|
| `figure-proposal` | A `(proposed)` line is in `figures.md`. | The attorney removes the marker (confirms) or the line. |
| `figure-coverage` | A Feature List row an Approved Claim cites has no drawn part (37 CFR 1.83(a)), or a part links a row that does not exist. | Draw a confirmed part that links the row, `- 20: part [F3]`, or ask the attorney. |
| `figures-settings` | `pageSize: letter` for the EPO (Error), or an unknown setting value (Note). | The attorney sets `pageSize: A4`. |
| any Figure Error | A Figure still has an unwaived Error Finding. | Fix the Figure, or the attorney waives the Finding with a reason. |

## Sheet checks in the receipt

`drawings-compliance.md` lists these per Drawing Set, each with its rule and
`pass`, `fail` or `not-checked`: `page-size`, `margins`, `no-frame`,
`glyph-height`, `label-larger-than-numerals`, `figure-labels`,
`single-figure-no-label`, `sheet-numbering`, `orientation`, `text-keywords`,
`no-scale-text`, `pdf-format`. The citations are in
[office-page-rules.md](office-page-rules.md).
