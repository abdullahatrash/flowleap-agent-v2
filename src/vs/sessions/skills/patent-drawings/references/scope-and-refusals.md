# Scope and refusals

Decide the scope per Figure before you write a scene. Say the decision in chat
with the reason. A refusal is a result, not a failure: the attorney sends the
Figure to an illustrator.

## In scope

| Input | Mode |
|---|---|
| Numbered method steps, or an approved method claim | Flowchart: one box per step, built by code |
| A list of blocks and their connections (a system, a circuit at block level) | Block diagram |
| Housings, brackets, plates, with holes and slots | 3D: `box`, `extrudedPolygon`, `cylinder`, `subtract` |
| Revolved parts (shafts, knobs, caps, bushings) with stated diameters | 3D: `revolve` or `shaft` |
| Tubes and hoses made of straight segments and bends | 3D: `tube` |
| Standard parts: fastener, spring, gear, bearing, shaft, pipe, motor | 3D: library part |
| A profile view of a cam seen along its axis: an extruded polygon with lobes and lands, one Figure per position | 3D: `extrudedPolygon` (its axis is the cam axis, Z), `top` camera |
| Labelled assemblies of 15 parts or fewer | 3D, one scene, parts placed from the list and the sketch |
| Sections through these parts, hidden edges as dashes | 3D: `section`, `hiddenEdges: dashed` |

## Refused, with the reason to give

| Input | Reason |
|---|---|
| A photo as the only input | A photo does not say what exists or where hidden parts are. Ask for a labelled sketch or the parts list with dimensions. |
| Organic or freeform shapes (ergonomic handles, blended shells, anatomy) | The primitives cannot build them and a guess changes the disclosure. |
| Complex mechanisms with many moving parts (linkages, gear trains with more than one gear pair, threads in detail) | Only one library call per standard part is reliable. |
| An unlabelled sketch with touching or overlapping parts | Counts and adjacency read from such a sketch are unreliable. Ask for numerals on the sketch. |
| Exploded views | Not in this version. |
| Colour, greyscale, shading, photographs as drawings, design patents | Filing line art only (black lines, hatching only). |
| Chemical structures and reaction schemes | Not in this version. |
| CAD file import | Not in this version. |
| A part that `figures.md` does not list | Never drawn silently. Propose it (the `propose` command) and stop for the attorney. |

## More than 15 listed parts under one heading

Split the Figure into partial views FIG. NA, FIG. NB, ... of 15 parts or fewer
each (37 CFR 1.84(u)(1)): `partial: "A"` in the editor, `<N>A` on the command
line. Before you render, say in chat which parts each view holds. Never leave a
listed part out of every view.

## How to refuse

State the Figure, the input, and the row of the table above, in one or two
sentences. Draw the other Figures that are in scope. Never draw a refused
Figure "as well as possible".
