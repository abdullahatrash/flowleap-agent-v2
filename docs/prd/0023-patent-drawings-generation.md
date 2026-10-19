# PRD 0023 — Patent Drawings Generation

**Status:** READY 2026-10-12 — ADR 0014 accepted; spec issue #637 `ready-for-agent`; slice tickets D1 #645, D2 #646, D3 #647, D4 #648, D5 #649, D6 #650, D7 #651 (number 0022 was taken by Planned Specification Drafting, merged first in #628)
**Date:** 2026-10-12
**Base:** main after #625 (`2b83c88853b`)
**Decides:** nothing new — executes ADR 0014 (drawings from a geometry scene).
**Glossary:** `CONTEXT.md` → Figure, Drawing Sheet, Drawing Set, Feature List, Filing Manifest,
Application Drafting.
**Evidence:** `docs/research/patent-drawings/01-formal-drawing-rules.md`,
`02-illustrator-practice.md`, `03-ai-drawing-products.md`, `04-geometry-engines.md`,
`05-sketch-to-geometry-feasibility.md` (all 2026-10-12); `competitor-profiles/deepip.md`;
grilling session 2026-10-12 (27 questions, all recommendations accepted).

## Why

Drafting ends at the figures list. Today the attorney sends sketches and a numeral key to an
illustrator, waits three to five days, pays per sheet, and checks the numerals by hand when the
sheets come back. Every AI competitor replaces the illustrator with a raster generator and keeps
the numeral sync in its own store. Nobody ships geometry, sections from a cut face, a
claims-driven check that every claimed feature is drawn, a compliance receipt citing the rule, or
a file the attorney owns. Those are the things attorneys complain about, and they are the things
our doctrine already produces for text: a source for every element, checks as code, a record.

First user: the small-firm attorney already drafting in the editor Patent Agent on BYOK, with a
`drafting/<matter>/` folder. Second user: the same attorney in the Agents Window for a long
drawing session.

## The pipeline

```
drafting/<matter>/
  figures.md                 ← parts with numerals; gains (proposed) marker, [F#] links, numerals: scheme
  sketches/                  ← inventor sketches and photos, copied here when attached in chat
  drawings/
    FIG-1.scene.json         ← source of truth per Figure (parts, placements, cameras, numeral ports)
    FIG-1.svg                ← derived line art
    sheet-1.svg              ← office page geometry with FIG labels and n/N numbering
    drawings.pdf             ← vector, fonts embedded, 300 dpi images if any
    drawings-compliance.md   ← every code check with rule citation and result; rounds the model saw
    review/FIG-1.round-2.png ← the model's own review renders, never a deliverable
```

Gates, read by code: no `(proposed)` line in `figures.md` at export; numeral set in the Drawing
Set equals the set in the description (and the claims for EPO); every Feature List row an
approved claim cites has a drawn numeral; a flowchart has exactly one node per claimed step.

Inputs the skill accepts: `figures.md`, the disclosure, labelled sketches of housings, brackets,
plates, revolves with stated diameters, and labelled assemblies of 15 parts or fewer; numbered
method steps or approved method claims for the 2D mode. Refused with the reason: photos as the
only input, organic shapes, complex mechanisms beyond the part library, unlabelled sketches with
touching parts.

## Slices

### D1 — Scene schema and geometry engine (extensions/copilot, node layer, no VS Code API)
The scene schema with a validator: primitives (box, cylinder, extruded polygon, revolve, tube
with straight segments and bends), seven library parts with named ports (fastener, spring, gear,
bearing, shaft, pipe, motor), placements, camera presets (isometric, front, top, side), section
planes, numeral ports (part, face, point). The per-part code escape hatch was dropped 2026-10-19,
see #799. The build on replicad:
solids, booleans, projection with visible and hidden edges, section cut with the cut face.
Line art writer: visible edges at 0.4 mm, lead lines at 0.2 mm, 45° hatching clipped to the cut
face, numerals at 3.2 mm sheet scale, lead lines that start beside the numeral, end on the part
and never cross; underlined numerals for surfaces. The mechanical fault list, run on the scene
and the SVG before any model sees a render. Guardrail: no model call in this layer; the kernel
loads lazily and its license notice ships beside the file. Acceptance: fixture scenes render to
snapshot SVG, one snapshot assertion per fixture; a fault fixture per check.

### D2 — Sheets, rasterizer, PDF and the receipt (extensions/copilot, node layer)
Sheet layout from the rules file: A4 default (Letter when the attorney sets it), margins
25/25/15/10 mm, no frame, landscape orientation flipped per office, FIG labels larger than
numerals, no label for a single-figure set, partial figures as number plus capital letter, sheet
numbering `n/N` for US and PCT and centred integers for EPO. PNG at 300 dpi through resvg-wasm
with one bundled sans font for the model's review loop. Vector PDF through pdfkit with the font
embedded, flattened, unencrypted. `drawings-compliance.md`: each check, its citation, its result,
and the rounds the model saw. The two WebAssembly files enter the postinstall copy list.
Acceptance: sheet snapshots for both offices and both orientations; a PDF test that opens the
file and reads page size, page count and embedded font.

### D3 — 2D mode: flowcharts and block diagrams (extensions/copilot, node layer)
Nodes built one-to-one from numbered steps or an approved method claim by code; the model
proposes branches and loops only; a node count that differs from the step count is rejected.
Layout through elkjs, deterministic. Box shapes per convention, step numerals (102, 104, ...)
as reference numerals, START and END optional, one short sentence per box for EPO, the
unlabeled-box objection as a check for US. Block diagrams share the writer with named
connections. Acceptance: snapshot per fixture; the invented-step fixture fails.

### D4 — `figures.md` contract and validators (extensions/copilot, common drafting layer)
Extend the parser and writer: `- 12: housing [F3]` links, `(proposed)` marker, frontmatter
`numerals: even | hundreds` (default even), `pageSize: A4 | letter` (default the office's text export page: letter for US, A4 for EPO and PCT, #665), `drawingSheets` becomes
measured when `drawings/` exists. New validators beside the existing numeral check: scheme
followed; no proposal at export; claimed-feature coverage (37 CFR 1.83(a)) through the Feature
List links; numeral set equality against description and, for EPO, claims. The Filing Manifest
reads the measured sheet count. Acceptance: unit tests over synthetic files, both offices.

### D5 — Typed tools (extensions/copilot, vscode-node)
`render_figure`: scene in, writes `FIG-N.scene.json` and `FIG-N.svg`, returns the review PNG
as a data part plus the fault report; refuses a part without a numeral or a numeral outside
`figures.md`; records the round. `build_drawing_set`: runs D2 over all Figures, refuses on a
proposal, an unwaived Error or a coverage gap, writes the PDF and the receipt, updates the
manifest. `propose_figure_part`: appends a `(proposed)` line with the sketch it came from.
Guardrail: three rounds per Figure, latest render only; a model without vision gets the fault
report and the receipt records that no render was seen. Acceptance: tool tests on the in-memory
filesystem pattern, including each refusal.

### D6 — `patent-drawings` skill (assets/skills) and the Agents Window entry
About five steps with reference files (founder rule): read `figures.md` and the sketches, state
the scope and refuse outside it; write the scene per Figure, numeral ports before geometry,
library parts for standard parts; render, fix against the fault list, at most three rounds;
propose missing parts and stop for the attorney; build the set and report the receipt, never
"compliant". Reference files: the scene schema, the part library with ports, the fault list,
the scope and refusal rules, the office page rules with citations, the sketch-reading rule
(list says what, sketch says where). Registered in `chatSkills`. A CLI entry
(`drawings-cli.js`) is copied into the skill folder at build time so the Agents Window skill
runs the same engine. App-only: not synced to the plugin pack or the CLI. Acceptance: the live
run in D7.

### D7 — Acceptance (founder + patent professional)
One real disclosure with at least two labelled inventor sketches and one method claim, US or
EPO, through the whole pipeline. A patent professional compares the Drawing Set to what an
illustrator would have returned for the same input. Pass: numeral set equals the description;
every claimed feature is drawn (the coverage check is green); all code checks green with the
receipt; the reviewer finds no part the disclosure does not support; at least one part went
through the proposal gate; the flowchart has one node per claimed step. Fail on any unsupported
part. Record the run under `docs/reviews/`. No time-saved or cost-saved figure is published.

## Explicit non-goals

- Presentation render in the Anatomy look, colour and greyscale drawings, design patents.
- Exploded views (next PRD, first slice; needs the offset-path audit).
- Chemical structures and reaction schemes; photos as the only input; CAD file import.
- GUI editing of a Figure; the attorney revises by chat or by editing the scene file, and
  the SVG is the editable handoff.
- Plugin pack or CLI distribution of the skill; a Pro gate; benchmarks on academic datasets.

## Execution

Two tracks. Track A (first live slice): D4, then D2 and D3 in parallel, then the 2D path of
D5 and D6, so flowcharts from approved method claims reach an attorney first. Track B: D1 in
parallel with Track A, then D5 and D6 extended to 3D Figures. D7 after both. One worktree per
agent, stage only your own files, base every PR on main.
