# PRD 0020 — Application Drafting

**Status:** READY 2026-10-07 — ADR 0012 accepted; spec issue #556 `ready-for-agent`; tickets D1 #557, D2 #558, D3 #559, D4 #560, D5 #561; follow-ups #564 #565 #566 (EPO Front Office research)
**Date:** 2026-10-07
**Base:** main after v0.6.0 and #555 (`1b9d571779b`)
**Decides:** nothing new — executes ADR 0012 (traced application drafting).
**Glossary:** `CONTEXT.md` → Application Drafting, Feature List, Approved Claims, Draft
Application, Model-Proposed, Inventor Question, Finding.
**Evidence:** `docs/research/ai-patent-drafting-best-practices.md` (2026-10-07); competitor
profile `competitor-profiles/deepip.md`; grilling session 2026-10-07 (33 questions, all
recommendations accepted).

## Why

Drafting is the natural end of the chain we already ship: invention disclosure, prior-art
search, claim drafting. Every competitor sells a one-shot generator with a review pass and puts
the hallucination risk on the user in a FAQ. The primary sources say the signer owns every
sentence. Our doctrine (work record, cited sources, unsupported stays marked) applies to prose
as well as it applies to data. That is the only reason to build it: not parity with DeepIP, but
a draft an attorney can sign with a record of what the model added.

First user: a solo or small-firm patent attorney drafting for clients, in the editor Patent
Agent on BYOK, with local files. Office chosen per draft, US or EPO.

## The pipeline

```
style/                      ← workspace-level exemplars (.md, .docx, .pdf), per client by construction
drafting/<matter>/
  feature-list.md           ← intake contract; frontmatter: office, confirmed
  figures.md                ← figure list with parts and numerals; confirmed with the feature list
  claims.md                 ← from claim-drafting; frontmatter: approved
  draft-application.md      ← the deliverable; frontmatter: office, model, provider, version
  draft-application.generated.md   ← snapshot at generation, diffed at export
  draft-application.working-record.md
  findings.md               ← Error / Note / Advisory items, waivers with reasons, open Inventor Questions
  draft-application.docx    ← export, markers stripped
```

Gates, read by code: `confirmed` on the feature list before drafting starts; `approved` on the
claims before the specification is generated; no unwaived Error and no open Inventor Question
before export.

## Slices

### D1 — Folder contract, frontmatter and validators (extensions/copilot, common layer)
Pure code, no VS Code API. Parse and write the YAML frontmatter of drafting artifacts (`office`,
`confirmed`, `approved`, `model`, `provider`, `version`). Resolve the per-draft folder. The
validator set, each returning Findings with a line reference and a severity:
antecedent basis ("a X" before "the X", per claim chain); dependency targets exist and precede;
claim numbering contiguous; EPO: one independent claim per category (Rule 43(2)); US: no multiple
dependent claim depending on another multiple dependent claim; abstract at most 150 words;
defined-term consistency (a term defined once is used with that spelling); reference numerals:
every numeral in the text is in `figures.md` and every `figures.md` numeral appears in the text,
one numeral per part; literal basis: every claim term appears in the specification. Notes:
claim count over 20 total or 3 independent (US), over 15 (EPO); relative terms present
("about", "substantially"). Source-marker parsing: paragraph markers for Feature, Disclosure,
Instruction, Template, Model-Proposed; Inventor Question blocks. Diff of edited draft against the
generated snapshot at paragraph level. Guardrail: no model call anywhere in this layer.
Acceptance: unit tests over synthetic claim sets and specs, one snapshot-style assertion per
validator, both offices.

### D2 — Typed tools and the save template (extensions/copilot, vscode-node)
Three tools beside `write_patent_results`:
`start_application_draft` reads the gate flags and returns the Feature List, figures, Approved
Claims and up to five style exemplars as text (docx via mammoth, pdf via the existing reader),
or refuses naming the missing flag; `validate_draft` runs D1 over the folder, merges advisory
items the model passes in, writes `findings.md` preserving existing waivers; `export_draft_docx`
re-runs validators, refuses on unwaived Errors or open Inventor Questions, diffs against the
snapshot into the Working Record, strips markers, writes the .docx with the `docx` package in
the office section order. The save tool gains a `draft-application` template that writes
frontmatter, the generated snapshot and the Working Record header (disclosure version, model,
provider, prompts summary). Guardrail: the gate is read from the file by the tool, never from
the chat; saving a draft is never blocked by findings. Acceptance: tool tests with the in-memory
filesystem pattern of the save-tool tests, including each refusal.

### D3 — `application-drafting` skill (extensions/copilot/assets/skills)
About five steps with reference files (founder rule): intake (build the Feature List and
figures list from the disclosure or the `invention-disclosure` output, stop and ask the attorney
to confirm); claims (hand off to `claim-drafting`, stop and ask for `approved`); state model and
provider in chat, call `start_application_draft`, generate the specification per office template
with paragraph source markers, technical gaps become Inventor Questions, no past-tense results
for unrun experiments; save with the template, call `validate_draft`, then run the advisory
review citing passages and pass it to `validate_draft`; report findings, never say "passed".
Reference files: the US section order (37 CFR 1.77), the EPO section order (Rule 42 EPC), the
marker syntax, the exemplar rule (voice only, never a source). Registered in `chatSkills`.
Guardrail: the skill does not describe a time saving. Acceptance: the live run in D5.

### D4 — Project Type (extensions/flowleap)
Add **Application Drafting** as the seventh Project Type: label, notes template seeded with the
folder contract and the three gates, no behavior switch. Acceptance: tree-provider test lists
seven types; a new project of this type shows the seeded notes.

### D5 — Acceptance (founder + verify)
One real disclosure through the whole pipeline on one office, reviewed by a patent
professional. Pass: the reviewer finds no sentence with technical content that has no source;
every Error finding is true; the export refused at least once for a real reason during the run;
the Working Record shows the attorney's edits as a diff. Fail on any fabricated technical
content. Record the run under `docs/reviews/`. No time-saved figure is published.

## Explicit non-goals

- Figure generation (sketch to line art, flowcharts). The user supplies figures; we manage
  numerals.
- Office-action amendments and tracked changes into an existing .docx.
- Word comments carrying the source markers; editor diagnostics (squiggles) for findings.
- A single transatlantic draft; CN/JP/KR templates.
- The Agents window (vendored `recipe-*` copy follows after D5 through the normal skill sync).
- Any Pro gate on drafting; inference stays on the Model Path.
- Benchmarks on academic datasets.

## Execution

D1 first, D2 after D1, D3 and D4 in parallel with D2, D5 after all. One worktree per agent,
stage only your own files, base every PR on main.

## Outcome

(filled at completion)
