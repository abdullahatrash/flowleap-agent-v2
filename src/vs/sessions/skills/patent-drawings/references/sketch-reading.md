# Sketch reading

**The list says what exists. The sketch says where.**

`figures.md` is the authority for which parts a Figure has and for their
numerals. A sketch only gives the placement, the proportions and the view.

## Rules

1. Read `figures.md` first. List the parts of the Figure with their numerals.
2. Then read the sketch. For each listed part, find it on the sketch by its
   handwritten numeral or label. Write down where it is relative to the other
   parts (on top of, inside, beside, through) and any stated dimension.
3. Transcribe the handwritten numerals and labels as a separate step. Compare
   them with `figures.md`. A numeral on the sketch that is not in the list is
   a question for the attorney, not a part.
4. Do not count parts from the strokes. Do not infer a hidden part. A part you
   see on the sketch that `figures.md` does not list is a proposal: call
   the `propose` command with the sketch path and stop.
5. Hidden edges, sections and occlusion come from the 3D placement. Never draw
   them from the sketch.
6. Use stated dimensions. Where none is stated, keep the sketch's proportions
   between parts and say in chat which sizes you estimated.
7. A photo is support only, never the only input. An unlabelled sketch with
   touching parts is refused ([scope-and-refusals.md](scope-and-refusals.md)).

## Why

Vision models read labels well and spatial relations poorly: near chance on
counting and relative depth, and worst where shapes touch. With handwritten
labels, sketch matching doubled in accuracy. The source is
`docs/research/patent-drawings/05-sketch-to-geometry-feasibility.md`.
