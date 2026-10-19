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
| `part-without-numeral` | Refusal: a drawn part has no numeral port. Every part drawn has one. Nothing is written. | Add a port for the part with its numeral from `figures.md`, or remove the part. |
| `numeral-without-port` | A port names a part or face that does not exist (the message lists the faces). | Use a face from the list, or add a `point` on the face. |
| `numeral-not-allowed` | Refusal: the numeral is not in `figures.md`. Nothing is written. | Use the numeral `figures.md` gives the part. A new part goes through `propose_figure_part` first. |
| `numeral-two-parts` | One numeral points at two different parts. | Give each part its own numeral; for one part shown twice, use the same `name` on both. |
| `lead-lines-cross` | Two lead lines cross. | Move one port: another face or `point` that the camera sees on the other side, or change the camera. |
| `lead-line-off-part` | A lead line ends off its part. | Pick a face that is visible in this camera, or give a `point` on the visible side. |
| `lead-ends-on-nothing` | A lead line ends more than 0.3 mm from every visible edge and every centre mark (for example on the empty middle of a face). | Point the port at a visible edge, or use the `axis` port or `mark: "centre"` for an axis or a centre point. |
| `lead-along-edge` | A lead line runs along a visible edge: within 5° of it and within 0.3 mm for more than 1 mm. It reads as part of the edge. | Move the port to a face the camera does not see edge-on, or give a `point` away from the edge's end. |
| `lead-crosses-outline` | Note: a lead line crosses a visible edge of its own part, but the numeral fits inside the outline next to its feature (37 CFR 1.84(q), lead lines as short as possible; OJ EPO 2025 A49 Art. 2). The engine puts the numeral of a centre mark or of a feature more than 8 mm inside the outline inside first, so a hand edit or an old render causes it. | Render again. If the numeral must stay outside, accept the Note. |
| `lead-line-far-from-numeral` | A lead line does not start beside its numeral. | Move the port so the numeral has free space near it; render again. |
| `lead-line-missing` | A numeral has no lead line and is not an underlined surface numeral. | Remove `surface: true` only if a lead line is wanted, or set it for a surface numeral. |
| `glyph-too-small` | A character is under 3.2 mm high at sheet scale. | Remove `scale` (fit to the default size), or lower the part count of the Figure. |
| `text-beyond-keywords` | A text is more than two words, or names a scale. | Remove the text. A 3D Figure carries numerals only. |
| `numeral-overlap` | Two numerals overlap. | Move one port to another face or point. |
| `numeral-on-line` | A numeral sits on a drawn line. | Move the port; a surface numeral needs a free area of the face. |
| `hatch-same-as-neighbour` | Note: two touching sectioned parts have the same hatch angle and pitch, so they read as one body (37 CFR 1.84(h)(3); OJ EPO 2025 A49 Art. 1(2)(b)). Only a `hatch` override causes it. | Remove the `hatch` of one part, or give it another angle or pitch. Keep it when the two parts are one item. |

## Diagram faults

From the flowchart and block-diagram writers and `diagramFaults.ts`. A
refusal returns no SVG.

| Rule | Meaning | Fix |
|---|---|---|
| `no-steps` | Refusal: the step list is empty. | Give the numbered steps or the approved method claim. |
| `no-blocks` | Refusal: the block list is empty. | Give the blocks. |
| `node-count` | Refusal: a proposal adds a process box. One box per step, never more. | Remove the `process` node; a proposal adds decisions and edges only. |
| `numeral-count` | Refusal: the numeral list has another length than the steps or blocks. The render passes the numerals of the `figures.md` heading, one per step or block, in order. | List one numeral per step or block under the Figure heading. |
| `numeral-range` | Refusal: too many steps or blocks for the `hundreds` series of this Figure (more than 49) when the heading lists no numerals. | Split the method into two Figures. |
| `duplicate-node` | Refusal: an id is used twice or is `start` / `end`. | Rename the node. |
| `unknown-node` | Refusal: a decision, edge or connection names a node that is not in the Figure, or a decision is not reachable. | Use the step ids (`s1`, `s2`, ...), the decision ids and `start` / `end` only. |
| `terminal-edge` | Refusal: a proposed edge enters START or leaves END. | Reverse or remove the edge. |
| `mpep-608.02-unlabeled-box` | A US box or block has no label (MPEP 608.02, form paragraph 6.22). | Give the step or block a text. |
| `epo-empty-step`, `epo-empty-block` | An EPO step or block has no text (GL A-IX 8; PCT Rule 11.11). | Give the step or block a text. |
| `us-keywords-only` | A US label has more than 4 words (37 CFR 1.84(o)). As a Note, the label was cut to keywords for you. | Shorten the step or block label; the full step stays in the description. |
| `epo-short-sentence` | An EPO label has more than 12 words (GL A-IX 8). As a Note, the label was cut. | Shorten the label to a short sentence. |
| `label-overlap` | Two texts overlap (37 CFR 1.84(p)(1), (p)(3); OJ EPO 2025 A49 Art. 1(2)(g)). | Shorten the labels, or remove an edge label. |
| `numeral-set` | The drawn numerals differ from the step or block numerals (37 CFR 1.84(p)(4), (p)(5); OJ EPO 2025 A49 Art. 1(2)(i)). | Render again from the same step list; do not edit the SVG. |
| step numerals not listed | Refusal: the Figure's heading in `figures.md` lists no numerals (the refusal lists the lines to add, with the next free numerals of the `numerals:` scheme), lists another count than the steps or blocks, or lists a numeral that names another part of the figure list. The steps or blocks take the numerals under the heading, in order. | List one `- N: text` line per step or block under the heading, in order, each with its own numeral, then render again. |
| `lead-line` | A numeral has no lead line (37 CFR 1.84(q); OJ EPO 2025 A49 Art. 2). | Render again; if it stays, report it. |
| `lead-crosses-edge` | A numeral or its lead line touches a connector (37 CFR 1.84(q)). | Remove or move a proposed edge, or shorten the labels so the layout changes. |
| `decision-branch` | Note: a decision has fewer than two outgoing edges. | Add the second branch edge, or remove the decision. |

The receipt has one row per rule of `us-keywords-only`, `epo-short-sentence`,
`label-overlap`, `numeral-set`, `lead-line` and `lead-crosses-edge`, each with
its citation. A set with no diagram shows the rows as `pass` with no finding.

## Figure list Notes

From the `figures.md` validators. A Note never blocks a render, the build or
the export; the draft validation shows it.

| Rule | Meaning | Fix |
|---|---|---|
| `figures-settings` | Note: the `figures.md` frontmatter sets a `numerals` or `pageSize` value that is not known. The checks use the default: `numerals: even`, and the page of the office export (letter for US, A4 for EPO). | Set `numerals: even` or `numerals: hundreds`; set `pageSize: A4` or `pageSize: letter`, or remove the line. |
| `numeral-scheme` | Note: a numeral of `figures.md` does not follow the scheme its `numerals` setting names, once per numeral at its first line. `even`: every numeral is even (a letter suffix such as `12a` is not read). `hundreds`: the hundreds digit is the number of the Figure where the numeral first appears (`104` in FIG. 1, `202` in FIG. 2); a numeral under a range heading may take any Figure of the range; a part under no Figure heading is not checked. The scheme is drafting practice, not an office rule. | Give the part a numeral of the scheme, or change the `numerals` setting. |

## Drawing Set gates

`build_drawing_set` refuses on these. They are not fixed by a render.

| Rule | Meaning | Fix |
|---|---|---|
| `figures-missing` | A Figure that a heading of `figures.md` names (each member of a range heading such as `FIGS. 7 to 10`) has no `FIG-N.svg` (37 CFR 1.84(p)(5); OJ EPO 2025 A49 Art. 1(2)(i)). The refusal names the missing Figures. | Render each missing Figure. To review the Figures drawn so far, build with the partial option (`partial: true` in the editor, `--partial` in the CLI): the receipt starts with `INCOMPLETE SET: FIG. ... not drawn`, the FIG labels follow the `figures.md` count, and `filing-manifest.md` is not changed. A partial build is never the Drawing Set. |
| `figure-proposal` | A `(proposed)` line is in `figures.md`. A waiver does not open this gate. | The attorney removes the marker (confirms) or the line. |
| `figure-coverage` | A Feature List row an Approved Claim cites has no drawn part (37 CFR 1.83(a)), or a part links a row that does not exist. With no Draft Outline yet, or none of its Technical items lists claims, or `figures.md` links no part at all, the check does not run: a Note says so and the receipt row is `not-checked`. | Link a confirmed part to the row, `- 20: part [F3]`, or the attorney waives the Finding in `findings.md`. For a `not-checked` row, write the Draft Outline and link the parts, then build again. |
| `numeral-not-drawn` | A reference sign the description (`draft-application.md`) cites is drawn in no Figure of the set (37 CFR 1.84(p)(5); OJ EPO 2025 A49 Art. 1(2)(i)). The rule is one for the whole set: a sign is drawn when any Figure carries it. The Error names the first line of the draft and the Figures the citing paragraphs name. With no draft yet, or in a partial build, the check does not run and the receipt row is `not-checked`. | Draw the part with its numeral in a Figure that shows it (a port in the scene, then render again), or remove the numeral from the text; or the attorney waives the Finding in `findings.md`. |
| `page-size-mismatch` | `pageSize` in `figures.md` differs from the page of the office's text export (letter for US, A4 for EPO). One page size per application: 37 CFR 1.52(a)(1)(ii) and 1.84(f) for US; OJ EPO 2025 A49 Art. 1(1)(a) and PCT Rule 11.5 for A4. The draft validation shows it before the export and the build. | Remove the `pageSize` line (the office default applies), or set the office's page. |
| a Figure Error | An Error of the two tables above is open in a Figure (the build checks each `FIG-N.svg` again). | Fix the Figure and render again, or the attorney waives the Finding in `findings.md` with a `  - Waived: <reason>` line. |
| a failing sheet check | A sheet check of the receipt list below fails (for example `glyph-height` after a Figure was scaled down). | Fix the Figure that causes it and render again. |

A waived Figure Error shows in the receipt with its waiver reason.

## Sheet checks in the receipt

`drawings-compliance.md` lists these per Drawing Set, each with its rule and
`pass`, `fail` or `not-checked`: `page-size`, `margins`, `no-frame`,
`glyph-height`, `label-larger-than-numerals`, `figure-labels`,
`single-figure-no-label`, `sheet-numbering`, `orientation`, `text-keywords`,
`no-scale-text`, `pdf-format`, and `figures-missing` (the Figures of `figures.md` not drawn). The citations are in
[office-page-rules.md](office-page-rules.md).

The receipt also has the row `figure-parts-not-drawn` (37 CFR 1.84(p)(5);
OJ EPO 2025 A49 Art. 1(2)(i)). It is a Note and never blocks the build. Per
heading of `figures.md`, it lists the numerals under the heading that no drawn
Figure of the heading carries: `FIG. 2 lists but does not draw: 96, 98`. A range
heading (`FIGS. 7 to 10`) counts a numeral as drawn when one of its Figures
carries it. The render result shows the same line for the Figure. Draw each
listed part, or tell the attorney which parts the Figure leaves out.

Two more rows come from the Drawing Set gates above: `figure-coverage`
(37 CFR 1.83(a)) and `numeral-not-drawn` (37 CFR 1.84(p)(5); OJ EPO 2025 A49
Art. 1(2)(i)). Each is `pass` with no finding, `pass` with the waiver reason
when the attorney waived its Error, or `not-checked` with the reason the check
did not run.
