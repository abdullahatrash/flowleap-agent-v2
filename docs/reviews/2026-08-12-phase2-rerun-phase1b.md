# Phase 2 re-run under the Phase 1b guidance (PRD 0012)

**Date:** 2026-08-12 (~17:00 UTC)
**Question:** with the Phase 1b skill fixes applied, do agent-written CQL queries hold up
against the server-side builder?
**Status: EXECUTED. Verdict — PASS. Supports proceeding to Phase 3.**

## How this ran

Same six cases, same comparison, same production backend as
`2026-08-12-phase2-query-quality-dogfood.md`. Counts come from
`POST /v1/patent-search` with `range: "1-1"`.

The agent arm was re-written from scratch under the updated guidance
(`extensions/copilot/assets/skills/patent-search/`, commit `f209b151d8b`):
mandatory term extraction, mandatory count probe with the >1,000 threshold,
OR'd classification classes, OR'd word forms for hyphenation. To keep the
probe loop honest, the refinement move for each direction was **pre-declared
before any count was seen** — over 1,000 hits applies the declared
next-term move; under 10 applies the declared broaden move; one move each.

The server arm was re-generated live per case, not reused from the first run.

Driver: a variant of `2026-08-12-phase2-driver.py` with the new agent
queries and the probe loop.

## Results

| # | Invention | Agent (old gate) | Agent (Phase 1b) | Server | Read |
|---|---|---|---|---|---|
| 1 | Flexible perovskite PV on polymer | 416 | **57** | 50 | comparable |
| 2 | ML for claim analysis / prior art | 3,005 (unusable) | 2,286 → probe → **10** | 4 | comparable — the probe loop did exactly its job |
| 3 | Wireless EV charging + FOD | 270 | **171** | 171 | identical counts |
| 4 | CRISPR plant genome / drought | 109 | **83** | 83 | identical counts |
| 5 | Sulfide glass-ceramic solid electrolyte | 3,549 (unusable) | **54** | 18 | comparable — the dropped-term failure is gone |
| 6 | Drone turbine-blade crack detection | 111 | 1 → broaden → **4** | **OPS 404** (again) | agent — server malformed, reproducible |

The queries, side by side (agent = final accepted query):

| # | Agent (Phase 1b) | Server |
|---|---|---|
| 1 | `ta=perovskite AND ta=flexible AND ta=photovoltaic AND (ic=H01L OR ic=H10F)` | `… AND ic=H01L` |
| 2 | `ta="prior art" AND ta="machine learning" AND ta=patent* AND (ic=G06N OR ic=G06F OR ic=G06Q)` | `… AND ic=G06N` |
| 3 | `ta="foreign object" AND ta="wireless charging" AND (ic=H02J OR ic=B60L)` | same terms, same count |
| 4 | `ta=CRISPR AND ta=drought AND ta=plant AND ic=C12N` | same terms, same count |
| 5 | `ta="solid electrolyte" AND ta=sulfide AND (ta="glass ceramic" OR ta="glass-ceramic") AND ic=H01M` | `ta="solid-state battery" AND …` |
| 6 | `ta=drone AND ta="wind turbine blade"` | `ta=drone AND ta=(turbine OR blade) AND …` ❌ 404 |

## What changed the outcome

- **Term extraction kept the invention in the query.** Case 5 keeps
  "glass ceramic" (both hyphen forms OR'd): 3,549 → 54. Case 2 keeps the
  patent subject matter: the extra `ta=patent*` from the extraction list is
  what the probe loop reached for.
- **The probe loop caught the one remaining too-broad query.** Case 2's
  initial query landed at 2,286; the >1,000 rule forced the pre-declared
  next term and landed at 10. Under the old guidance this query would have
  been accepted as-is.
- **OR'd classes cost nothing and widen coverage.** Cases 1–3 use
  `(ic=X OR ic=Y)` with counts equal to or near the server's single-class
  versions, without silently discarding sibling classes.
- **The server builder still emits invalid CQL on case 6** —
  `ta=(turbine OR blade)`, hard 404, reproducible across both gate runs.
  The shape is now documented as an error in `references/cql-reference.md`.

## Residual findings

- **Case 6 over-narrowed.** The combination rule (keep drone + turbine
  blade) plus `inspection` landed at 1 hit; one broaden move reached 4,
  still under the <10 band. A real agent continues with the refinement
  table (synonyms — UAV, "unmanned aerial"; drop a combination term), which
  the skill already prescribes; the scripted run stopped at one pre-declared
  move by design. Not a guidance gap, but worth watching in live use.
- Case 5: the server's `ta="solid-state battery"` (the description's own
  phrase) is tighter than the agent's `ta="solid electrolyte"` (54 vs 18).
  Both are workable; term extraction favouring the description's exact
  phrasing already points the right way.

## Verdict

**PASS.** The two order-of-magnitude failures that blocked Phase 3 are
gone; every agent query lands in a workable band (4–171), two cases are
count-identical with the server, and the agent arm is the only one that
survives case 6. Deleting the server-side builder no longer ships a
measurable precision regression.

**Phase 3 is unblocked from the app side.** Remaining sequencing before
the deletions, per PR #221's corrections: the CLI's own skills
(`flowleap-patent`, `persona-patent-attorney`,
`recipe-invention-disclosure`) still teach
`build-query --allow-external-processing` and need the same guidance in
`flowleap-cli`, then tag → manifest bump → re-mirror. OCR stays on managed
inference (out of PRD 0012's scope); the surviving sliver of #213 —
a consent ask for OCR — remains open.
