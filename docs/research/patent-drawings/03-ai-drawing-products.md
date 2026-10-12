# AI patent-drawing products: what each one does

**Date:** 2026-10-12 · **Scope:** every AI drawing product we could reach, from its own pages, docs, changelogs and public criticism.
**Convention:** each claim has a URL and the page date in brackets, or `[f. 2026-10-12]` when the page shows no date (f. = fetched). Quotes are verbatim. Items marked **[competitor-written]** come from a rival vendor's page. DeepIP's full profile is in `competitor-profiles/deepip.md`; this file adds only drawing-specific facts.
**Not reachable this session:** Rowan/Clarivate product page (403), Qatent/Questel (402, empty), Specifio (connection refused), G2 and Capterra review pages (403), Reddit (blocked). Facts for those come from help centers, search snippets or third parties and are marked.

## 1. Summary table

| Product | Inputs | Method (as stated) | Output | Numerals ↔ spec | Views | Price |
|---|---|---|---|---|---|---|
| DeepIP Drawings | sketch, photo, text steps | "computer vision and generative models" | line art, flowchart, sequence diagram; PNG + Visio per rivals | click-to-rename propagates to spec, claims, figures | flowchart, sequence only named | not published |
| PatentFig AI | photo, sketch, CAD screenshot, text | "AI-powered", not named | PNG/SVG/PDF/TIFF 300 dpi; filing sheets for 6 offices | numerals are an editable layer; no spec sync | multi-view, section, flowchart, block, exploded (generator pages) | free; $20/$40/$80 per month |
| PatentDrawingAI | PNG/JPG/WebP photo or diagram; no native CAD | "the model" (unnamed) + clean/vectorize + auto-label | PDF/PNG/SVG/DXF; §1.84 sheets A4/Letter | auto-label, duplicate check; per-drawing only | isometric, section, block, flowchart; exploded not listed | $19/$79/$199/$399 per month |
| Solve Intelligence Figure Builder | PDF, image, Visio, Word/PPT embed, photo, sketch, 3D CAD, text | not named; AI chat + canvas | export "individually or in bulk"; formats not named | project-wide label registry propagates to all figures and documents | cross-section; "diagrams, flowcharts, schematics" | demo only |
| Patlytics | sketch, photo | "Sketch to Figure Conversion"; method not stated | "filing-ready starting point"; formats not named | shared numeral system across figures; spec text not auto-updated | not stated | not published |
| Rowan Patents (Clarivate) | Visio, PDF, patent publications, Mermaid markdown, images | stencil drawing tool; no AI generation found | .rp file; drawing sheets | adding a figure auto-creates spec sections; autonumbering updates text | flowchart from claims panel; stencils | not published |
| PatentPal | claims document | NLP, one click | Word + Visio or PowerPoint | not mentioned | flowchart, block diagram | trial only |
| Patently Create (Onardo) | text, claims, sketches, images | auto-generate or draw; "computer vision" is roadmap | in-browser figures | drag-and-drop part referencing | flow, sequence diagrams | from $125/user/month [competitor-written] |
| Edge (Ingenia) | not stated | "patent-focused figure editor and AI" | not stated | "track element names" | flow charts, block diagrams | custom |
| Pinch | STEP/IGES/Parasolid/STL CAD | geometric CAD conversion, no AI yet | PDF + 28 DXF vectors | none: "No reference numerals or call-out lines included" | ortho set; exploded + section "Coming Soon" | $50 per 21-drawing set |
| PatentDrawAI | sentence, sketch | 6 agents incl. CAD agent | 3D assembly view; no patent formats | not mentioned | exploded, assembly | tiers unpriced |
| Qatent, Specifio, PowerPatent | n/a | drawings are text inputs only | n/a | n/a | n/a | n/a |

## 2. Product notes

### DeepIP Patent Drawings Generation (adds to competitor-profiles/deepip.md)
- Method: FAQ says the tool "uses computer vision and generative models" and will "auto-detect edges and reference points" after upload. Inputs: "Upload any sketch or photo as your starting point"; "Paste your method steps as your input" for flowcharts. https://www.deepip.ai/products/patent-drawings-generation [f. 2026-10-12]
- Numerals: "Simply click a call-out to rename or renumber it; the change propagates across every instance of that label in your spec, claims, and figures." Editing is via "an in-app label editor and a Word add-in". Same URL.
- Compliance claim: figures "that meet USPTO and EPO formal-drawing rules". No file format, no vector/raster statement, no sheet layout on the page. Same URL.
- Only flowcharts and sequence diagrams are named as view types. No isometric, orthographic, section or exploded view is mentioned. Same URL.
- Retention: "never retains your drawings or specifications after processing". Same URL.
- **[competitor-written]** Pinch: DeepIP outputs "PNGs, and Visio export"; "lacks fine line-weight control and multi-view rendering"; "no native STEP or IGES import". https://pinchpatentdrawings.com/ai-patent-drawing-software/ [2025-09-24]
- **[competitor-written]** Patentext: figure generation is "functional, not feature-rich"; complex drawings "may require dedicated illustration services" (`competitor-profiles/raw/deepip/2026-09-14/reviews/patentext-comparison.md`).
- **[competitor-written]** PatentFig: "figure generation is not DeepIP's core product". https://patentfig.ai/patentfig-vs-deepip [2026, f. 2026-10-12]

### PatentFig AI (TopLocalAI, LLC)
- Inputs: "reference photos, sketches, CAD screenshots, or just describe your invention in text". Output: PNG, SVG, PDF, TIFF; filing sheets "PDF or TIFF", "black and white at 300 DPI", with office-specific figure labels ("FIG. 1", "图1") and sheet numbers ("1/3"). https://patentfig.ai/ [f. 2026-10-12]
- Numerals: "an editable layer, not baked into the image"; the editor reads existing numerals and leader lines, flags "duplicate numerals, empty labels, and crossing leaders"; on SVG "the numerals remain real text". No spec sync is claimed. Same URL.
- Editing: chat edits ("change line weight or add a cross-section view"), "slot-by-slot regeneration", version history. Same URL.
- Compliance: "checked against 37 CFR 1.84"; validates "margins, line weight, DPI, and numerals"; offices USPTO, CNIPA, EPO, JPO, KIPO, PCT. Disclaimers: no "legal review of whether the figures are sufficient for the claims"; does not guarantee acceptance. https://patentfig.ai/ai-patent-drawing-generator [2026]
- Standards page lists per-office margins and label heights but says checking is the user's job: "Recheck consistency before final export" and "always defer to the current official text". https://patentfig.ai/patent-drawing-standards [f. 2026-10-12]
- Tools: generator, Figure Checker, Convert, Vectorize (centerline SVG/DXF/PDF), DPI Enhance, CAD-view-to-drawing, exploded-view and block-diagram generators, "Fix a drawing rejection". https://patentfig.ai/tools [f. 2026-10-12]
- Examples: 27 fictional samples in 8 categories; 6 are "Source → Patent figure" pairs (product photo, hand sketch, whiteboard, CAD render); CC BY 4.0. https://patentfig.ai/patent-drawing-examples [f. 2026-10-12]
- Pricing page shows struck prices "$50$20/month" (500 credits ≈ 50 figures), "$100$40" (1500), "$200$80" (4000); free = 30 credits then 10 per day. Compliance report is gated to paid plans. https://patentfig.ai/pricing [f. 2026-10-12]
- Public reception: Product Hunt 1 upvote, "No reviews yet" (https://www.producthunt.com/products/patentfig [launched 2026]); AlternativeTo 0 reviews (https://alternativeto.net/software/patentfig/about [2026-03-12]).
- Admitted limitation of auto-tracing: generic vectorization gives "two parallel outlines around a filled band"; photo tracing gives "a posterized mess or thousands of micro-contours". https://patentfig.ai/blog/vectorize-patent-drawings-editable-svg-dxf [2026-07-29]

### PatentDrawingAI (TMHQ, LLC)
- Inputs "PNG, JPG, or WebP"; "Native CAD files (.dwg, .step, .stl) aren't accepted directly, so export a view as an image first." Six stages: Generate, Clean + Vectorize, "Edit in English", Auto-Label, Assemble ("Sheets formatted to §1.84"), Export ("A receipt, not a promise"). https://patentdrawingai.com/ [f. 2026-10-12]
- Numerals: auto-label "ring the figure in an orderly layout with short, non-crossing leader lines"; duplicates flagged; "Stray numerals" tucked inside the sheet; lettered figures (FIG. 6A); single-figure sets print no FIG. label "per USPTO single-view rules". https://patentdrawingai.com/changelog [2026-08-02 to 2026-08-06]
- Spec link: "Start from your application (beta)": upload the application, get a figure plan, "Each device figure is checked against your description." Same changelog [2026-10-06]. Cross-figure numeral sync is "Per-drawing" only (vendor's own comparison, https://patentdrawingai.com/patentdrawingai-vs-deepip [2026-05-11]).
- Views: "Isometric views, cross-sections, block diagrams, and flowcharts live in one project workspace"; multi-view sets are "built figure by figure from each figure's own source image". https://patentdrawingai.com/ [f. 2026-10-12]
- Price: new drawing 5 credits, AI edit 1 credit; Starter $19 (25 credits), Pro $79, Firm $199, Team $399; "≈ $2–$4" per figure. Same URL.
- Admitted limits: "not guaranteed to meet all requirements"; "works better with cleaner inputs than with vague hand sketches"; strongest on "mechanical/electronic/software"; no Word integration. https://patentdrawingai.com/patentdrawingai-vs-deepip [2026-05-11]
- Changelog shows the failure classes it had to fix: "ghost strokes and spurious borders", "subject drift" on design runs, "collapsed recessed areas, dark surfaces, and molded brand marks", "no components were identified on clear drawings", numbers "drawn into converted diagrams", generation returning no image. https://patentdrawingai.com/changelog [2026-04-16 to 2026-08-08]

### Solve Intelligence (Figure Builder)
- Inputs: "a PDF, an image, a Visio file, or one embedded in a Word or PowerPoint document"; "Upload a photograph, color diagram or rough sketch"; "Import 3D CAD files"; text-only ("built from scratch using words alone"). https://www.solveintelligence.com/blog/post/how-to-draft-patent-figures-with-figure-builder [2026-07-17]
- Numerals: "a single project-wide list of element labels and reference numerals"; "an edit to a reference numeral can be propagated across all figures and application documents"; the registry carries from provisional to non-provisional. Same URL.
- Lead lines placed "manually or with AI assistance via the Figure Builder AI Chat". Same URL. Export to Visio or PowerPoint, "Drawings remain editable", page size and file type configurable. https://www.solveintelligence.com/capabilities/figure-generation [f. 2026-10-12]
- Compliance: "does not automatically guarantee compliance with formal drawings rules"; "the attorney remains responsible for the final figure set". Blog URL above. The capability page still says "Create USPTO and EPO compliant drawings".
- Views: only cross-sections named; CAD viewer with hatching settings. No isometric, exploded or flowchart statement on the capability page.
- **[competitor-written]** Pinch: "No direct CAD upload", "less mature figure features", "it's not built for filing-ready patent drawings". https://pinchpatentdrawings.com/ai-patent-drawing-software/ [2025-09-24]
- G2 (page 403, search snippet only): a mechanical-patent reviewer said the AI "struggled with figure labels and legends" and needed much more manual work. https://www.g2.com/products/solve-intelligence-patent-copilot [snippet, 2026-10-12]

### Patlytics
- "Sketch to Figure Conversion tool": upload "hand-drawn sketches or photographs"; "Converts rough sketches into clean, structured drawings"; adds "automated lead lines" and numerals. https://www.patlytics.ai/blog/how-patlytics-transforms-patent-sketches-figures [2026-02-18]
- "shared reference numeral system": a change in one figure carries to every figure with that numeral; spec text is not said to update. Side-by-side figure viewer in the draft. No formats, no views, no sample images, no numbers. Same URL.

### Rowan Patents (Clarivate)
- Product page returned 403; the Clarivate snippet says part numbering is "kept in sync with the rest of the application". Help center: adding a figure "automatically populates corresponding brief and detailed figure description sections in the specification"; with automatic numbering "all reference numerals in your figures and application text will also be updated". https://intercom.help/rowanpatents/en/articles/7024932-add-a-new-figure [f. 2026-10-12]
- Drawing tool = stencils, connectors, flowchart steps "from the Claims Panel", import of Visio, PDF, patent publications, Mermaid markdown and background images. No article in the 66-item collection mentions AI generation or lead-line automation. https://intercom.help/rowanpatents/en/collections/2533010-drawing-figures [f. 2026-10-12]
- **[competitor-written]** Pinch: "steep learning curve", "standalone desktop suite with no CAD links". Patentext: switching "means leaving behind Word-based drafting". https://patentext.com/blog/a-complete-list-of-ai-patent-tools [2026-07-20]

### PatentPal, Patently Create, Edge, PowerPatent, Qatent, Specifio, Patentext
- PatentPal: input claims; "Flowcharts for methods", "Block diagrams for systems and devices", "Export draft into Word and Visio (or PowerPoint)". No numeral or editing statement. https://patentpal.com/ [f. 2026-10-12]
- Patently Create: "Drawings can be created from blank, can be generated automatically or can be imported"; drag-and-drop part referencing; "templating, computer vision and custom instructions" are roadmap. https://patently.com/blog/generative-ai-patent-drafting [2024-10-22, updated 2026]. **[competitor-written]** Pinch: from $125/user/month, "No CAD import, no jurisdiction compliance checks".
- Edge (Ingenia): "Use a patent-focused figure editor and AI to get more out of your figures"; directory listing adds "create flow charts", "edit figures with lead lines", "track element names". https://www.withedge.com/ [f. 2026-10-12]; https://www.legaltechnologyhub.com/vendors/edge/ [f. 2026-10-12]
- PowerPatent: drawings are inputs only ("upload the claims and the drawings"); it reads "the part list of each drawing". https://powerpatent.com/how-it-works [f. 2026-10-12]
- Qatent: own pages unreachable; rivals say "basic AI-assisted diagram rendering" (Patentext, 2026-07-20) and "simple diagrams, which the article says are not full patent drawings" (Pinch, 2025-09-24). Specifio: site unreachable; no drawing claim found anywhere. Patentext: no drawing feature on homepage or platform page; diagrams are attachments to a disclosure. https://www.patentext.com/platform [f. 2026-10-12]

### CAD-geometry route (no generative model)
- Pinch: upload "CAD/STP"; plugin formats .step/.stp, .igs/.iges, .x_t, .stl; ZIP with two PDF sets "FIGs. 1–14" and "28 vector DXF files"; "No reference numerals or call-out lines included"; "100% accuracy with USPTO standards"; U.S. design "require manual line shading"; exploded, cross-section and "AI-Verified Drawings" all "Coming Soon!"; $50 per set. https://pinchpatentdrawings.com/ [© 2025, f. 2026-10-12]. G2 page 403.
- ITRex case study (custom build for "a patent law firm"): U-Net image-to-image model trained on "tens of thousands of approved patent drawings from the USPTO, EPO, and WIPO"; outputs "top, side, sectional, and exploded views"; claims "95% first-time compliance" and 85% less processing time, with no method or sample size. https://itrexgroup.com/case-studies/ai-patent-drawing-automation/ [f. 2026-10-12]
- Zoo (ex-KittyCAD) Text-to-CAD: "Create fully editable 3D models in one prompt"; no 2D drawing export, no patent mention. https://zoo.dev/text-to-cad [f. 2026-10-12]. Develop3D: output is B-Rep exportable as STEP. https://develop3d.com/cad/zoo-ecosystem-lays-foundation-for-modern-hardware-design-toolkit/ [f. 2026-10-12]
- Autodesk, Onshape, SolidWorks: no patent-drawing or AI-figure feature found in 2026 release coverage. https://blog.cadsoftwaredirect.com/whats-new-in-solidworks-2026/ [f. 2026-10-12]

### General image models used for drawings
- RunDiffusion guide (ChatGPT Image 2.0): four-view sheets, exploded and sectional drafts from prompts; "Do not assume that an AI-generated drawing is compliant"; warns against "Adding New Features That Were Not Part of the Invention Disclosure". https://www.rundiffusion.com/ai-patent-illustrations [2026-07-10]
- Xole AI (press release): photo to line drawing via "intelligent edge detection", "built-in validation", PNG/PDF; savings claims conflict ("up to 80%" vs "90% or more"). https://markets.financialcontent.com/pennwell.pennenergy/article/worldnewswire-2025-9-30-best-ai-patent-drawing-tool-transform-photos-to-uspto-compliant-drawings [2025-09-30]
- Westinghouse AI: "AI-powered original patent drawings in seconds"; no inputs, formats, price or reviews. https://ai.g2.com/marketplace/tools/westinghouse [f. 2026-10-12]
- Independent test (Patentology, Mark Summerfield): Claude Sonnet 4 produced a usable SVG flowchart in one pass; Claude Opus 4.1 annotation needed a fix because a leader "ended on the bounding rectangle instead of the hexagon's diagonal edge"; ChatGPT-5 flowchart "I'm going to mark that as a fail!"; "Annotation still requires iteration more often than I'd like." https://blog.patentology.com.au/2025/08/can-you-turn-ai-chatbot-into-patent.html [2025-08-29]

### Checkers that read drawings but do not draw
- Patent Bots: figure-number and label reports with renumbering, from $594/practitioner/year [Pinch, 2025-09-24]; own site lists only "patent proofreading" with "A la carte pricing". https://www.patentbots.com/ [f. 2026-10-12]
- ClaimMaster: "Generate document sections and figures/flowcharts using natural language processing and customizable templates"; "tools for renumbering figures and parts". https://www.patentclaimmaster.com/ [f. 2026-10-12]
- IronCrow N-Spec: "part name/number consistency" and "figure consistency" checks; free for NAPP members. https://napp.org/ironcrowdiscount/ [f. 2026-10-12]
- Annotra: callout placement and annotated PDF export; "Placement still needs human review"; "does not automatically verify the written specification". https://annotra.com/how-to-add-reference-numbers-to-patent-drawings-a-complete-guide-for-illustrators/ [2026-10-08]
- Patsnap research: AI-generated patents show more "structural defects in figure-text alignment and cross-references" than human ones. https://arxiv.org/html/2510.25402v1 [f. 2026-10-12]

## 3. Published quality evidence
- Before/after pairs: only PatentFig (6 pairs, fictional) and PatentDrawingAI ("three before/after examples", changelog 2026-05-10) publish them. DeepIP shows three images with no alt text. Patlytics, Solve, Rowan show none.
- Objection rates: no vendor publishes one. ITRex claims "95% first-time compliance" without method. MaxVal (a drawing service) says "37%" of office actions include a drawing objection, with no source. https://www.maxval.com/blog/patent-drawing-rejection-reasons/ [2026-03-23]
- Third-party reviews: PatentFig 0 reviews on Product Hunt and AlternativeTo; Westinghouse 0; Solve one G2 snippet; no YouTube demo or demo-comment thread found for any product (searches 2026-10-12).
- Self-reported fix lists (PatentDrawingAI changelog) are the only public record of real failure classes: ghost strokes, subject drift, stray numerals off-sheet, numbers baked into converted diagrams.

## 4. What nobody does (as of 2026-10-12)
1. **Drawing from the claims and spec with a sufficiency check.** No product reads the claims, decides which views and which numerals are required, then proves every claimed element is shown. PatentFig says this "legal review" is out of scope; PatentDrawingAI's "Start from your application" is beta and checks device figures against the description only; Solve says the attorney "remains responsible for the final figure set".
2. **Two-way numeral sync with the written description in an open file.** DeepIP and Solve sync inside their own stores (Word add-in, project registry). Patlytics syncs across figures only. PatentFig and PatentDrawingAI are per-drawing. None works on a plain Markdown or DOCX file the user owns.
3. **True vector geometry from generative output.** Every generative tool emits raster, then traces it (PatentFig Vectorize, PatentDrawingAI "Clean + Vectorize"). Only Pinch and ITRex start from CAD geometry, and Pinch has no numerals, no exploded, no section views yet.
4. **Exploded and section views with correct hidden-line and hatching logic.** Section views are claimed by PatentFig, PatentDrawingAI and Solve as image edits; none states hatching rules per material or cut-plane indication. Pinch lists both as "Coming Soon".
5. **Local or BYOK operation.** All are hosted SaaS; Solve says "All data stored and processed locally" on its homepage but its figure blog says model providers run under zero-retention terms.
6. **An auditable compliance receipt tied to the rule text.** PatentDrawingAI comes closest ("A receipt, not a promise"); no vendor lists which 37 CFR 1.84 or EPO Rule 46 clauses are checked, and PatentFig's standards page tells users to recheck by hand.
7. **Objection-rate evidence.** No vendor publishes a drawing objection rate, a USPTO PTO-948 count or a before/after study.

## 5. What users complain about most (sources)
1. **Numerals and leader lines.** Leaders stop at bounding boxes, labels misplaced, numerals baked into pixels, candidate numerals that do not match the spec. Patentology [2025-08-29]; PatentFig homepage [f. 2026-10-12]; SNS Patent Drafting [2025-04-21, illustrator-written]; G2 Solve snippet [2026-10-12].
2. **Compliance that is claimed, not shown.** "Figures often appear clean but may still miss subtle requirements" [Pinch, 2025-09-24, competitor-written]; every vendor adds a "not guaranteed" disclaimer (PatentFig, PatentDrawingAI, Solve, RunDiffusion).
3. **Line quality.** Double outlines, white cores on reduction, inherited line weights, ghost strokes, added shading or gradients. PatentFig vectorize blog [2026-07-29]; PatentDrawingAI changelog [2026-04-16]; SNS [2025-04-21]; LexVu list of execution failures [2026-07-02].
4. **Geometry drift and invented parts.** "subject drift" fixed in design runs [PatentDrawingAI, 2026-04-16]; "Adding New Features That Were Not Part of the Invention Disclosure" [RunDiffusion, 2026-07-10]; proportions "could misrepresent the invention" [SNS, 2025-04-21].
5. **No CAD geometry path.** "Most tools interpret text well but cannot yet extract geometry directly from STEP or IGES files" [Pinch, 2025-09-24]; PatentDrawingAI refuses native CAD [f. 2026-10-12].
6. **Drawings as an add-on to drafting suites.** "drawing became an add-on later" [Pinch]; DeepIP figures "functional, not feature-rich" [Patentext]; Solve "less mature figure features" [Pinch]; Rowan "steep learning curve" [Pinch].
7. **Confidentiality.** Uploading disclosures to a hosted model; trade-secret and training-use worries [SNS, 2025-04-21]; YesChat "unclear policy on whether uploads train AI models" [Pinch].
8. **Spec and drawings drift after amendment.** "Reference number mismatches ... typically introduced during late-stage amendments" [LexVu, 2026-07-02]; MaxVal top-3 rejection reasons are margins, inconsistent numerals, numerals not described [2026-03-23].
