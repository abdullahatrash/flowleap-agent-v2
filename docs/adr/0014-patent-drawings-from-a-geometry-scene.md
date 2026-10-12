# Patent drawings from a geometry scene on an OpenCascade kernel, the parts list as authority

**Status:** accepted (2026-10-12)

ADR 0012 made figure generation a non-goal: the attorney supplies the figures, drafting manages
the numerals. Every AI drawing product on the market (DeepIP, PatentFig, PatentDrawingAI, Solve
Intelligence, Patlytics) fills that gap the same way: a generative image model turns a sketch
into pixels, the pixels are traced, numerals are placed on the raster, and the numeral sync lives
in the vendor's store. None of them can give a second view of the same figure, a section with a
cut face, hidden lines, or a file the attorney owns and edits. Users complain about exactly
those things: numerals and lead lines, compliance claimed but not shown, double outlines,
invented parts, drawings drifting from the specification. Research record:
`docs/research/patent-drawings/01` to `05`.

We decide to build **Patent Drawings Generation** as geometry, not pixels, and we reverse the
ADR 0012 non-goal by this ADR rather than by editing it.

## The decisions

1. **A Figure is a geometry scene, rendered.** The model writes a JSON scene per Figure: parts
   as primitives (box, cylinder, extruded polygon, revolve, tube) or library parts (fastener,
   spring, gear, bearing, shaft, pipe, motor), placements, cameras, and reference numerals as
   named ports on part faces. The engine builds solids, projects them, removes hidden lines,
   places numerals and lead lines, and writes SVG. The scene is the source of truth; SVG, sheets
   and PDF are derived and regenerate. A per-part code escape hatch exists for shapes the
   primitives cannot express. Rejected: image-to-image line art (no part identity, no second
   view, no hidden lines, not editable); the model writing kernel code directly (no check can run
   before a render, and BYOK models of mixed quality write JSON more reliably than code).
2. **The kernel is OpenCascade compiled to WebAssembly, through replicad.** It is the only
   exact vector hidden-line removal reachable from Node without a native addon, and it brings
   revolve, sweep, fillet, booleans, orthographic presets and a plane cut for sections. Cost: a
   23 MB LGPL-2.1 module and a one-maintainer wrapper. The module ships as its own file, loaded
   only when a drawing tool runs, with its license notice beside it; a user can replace the
   file, which is what LGPL asks of an unmodified module. Rejected: manifold-3d with our own
   hidden-line code (0.5 MB, Apache, but weeks of geometry work, faceted curves, no fillets);
   the Anatomy isometric painter with white fills (zero dependencies, but painter's order is
   not hidden-line removal and there are no sections); Python kernels (no runtime ships).
3. **The parts list is the authority for what exists; the sketch only says where.** Vision
   models count parts and judge depth near chance on the benchmarks and fail where shapes touch,
   while handwritten labels doubled their accuracy in the one controlled study. So every drawn
   part has a numeral in `figures.md`, each part names the Feature List row it depicts, and a
   part the sketch shows but the list lacks enters the list as a **proposal** the attorney
   confirms before export. Photos as the only input, organic shapes and unlabelled sketches with
   touching parts are refused with the reason. Rejected: "draw what you see" (the Anatomy rule
   "invent a believable machine" is the opposite of a disclosure; invented detail is added
   matter).
4. **Compliance is code with a citation, and the receipt ships with the set.** About 35 boolean
   checks from 37 CFR 1.84, MPEP 608.02, OJ EPO 2025 A49 and PCT Rule 11 run on every set:
   margins, glyph height, numeral set equal to the description, lead lines end on their part and
   never cross, no text beyond keywords, single-figure label rule, sheet numbering, orientation
   per office. Each result is written with its rule to `drawings-compliance.md`. The attorney's
   own check, 37 CFR 1.83(a), runs as code through the Feature List links: every row an approved
   claim cites has a drawn numeral. Rejected: "USPTO and EPO compliant" as a claim in a FAQ.
5. **The model looks at its own render, with a budget.** The render loop returns the PNG and
   the mechanical check report; the model fixes against a fixed fault list; three rounds per
   Figure, latest render only. Rejected: unbounded loops (the evidence shows faulty examples
   accumulate in context and the critic misreads its own renders).
6. **Black line art on white is the default because it files everywhere.** The EPO accepts
   colour and greyscale for electronic filings since 1 October 2025; the USPTO needs a petition
   and the PCT converts to black and white. Colour is a later option, not a rule.
7. **One engine, two callers.** The engine lives in the Patent Agent extension in TypeScript. A
   typed tool calls it in editor chat; a bundled Agents Window skill calls the same build through
   a CLI entry copied at build time. App-only: no plugin or CLI sync, so no second copy drifts.

## Consequences

- The Drawing Set replaces the outsourced illustrator step. It does not replace the attorney's
  review. No time-saved or cost-saved figure is published.
- The extension host payload grows by about 30 MB of WebAssembly (kernel and rasterizer), listed
  in the postinstall copy list, loaded lazily.
- `figures.md` gains a proposal marker, Feature List links and a numeral scheme field; the
  Filing Manifest's drawing-sheet count becomes a measured value when a Drawing Set exists.
- Flowcharts and block diagrams ship first: nodes come one-to-one from claim steps by code, the
  model proposes only branches, and a node count that differs from the step count is rejected.
- Exploded views, a presentation render in the Anatomy look, colour, design patents, chemistry,
  CAD import and GUI editing are outside this decision. Exploded views and the presentation
  render are the first slices of the next PRD.
- Three terms enter `CONTEXT.md`: Figure, Drawing Sheet, Drawing Set.
