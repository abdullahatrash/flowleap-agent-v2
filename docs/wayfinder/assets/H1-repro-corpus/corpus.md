# H1 repro corpus — gap-exercising tasks

Evidence base for map 0002 (harness gap). Each task is run with the **identical prompt**
on three conditions:

- **bench** — Claude Code harness + flowleap CLI + skills (agents-window equivalent),
  headless `claude -p`, model pinned to Sonnet-class.
- **main-usual** — main-window Patent AI agent, usual BYOK model
  (`google/gemini-2.5-pro` via OpenRouter — the as-observed condition; the promptfoo
  baseline model).
- **main-claude** — main-window Patent AI agent, same Claude-class model as bench via
  BYOK (`anthropic/claude-sonnet-4.5` via OpenRouter) — the model control.

Ground-truth notes below were verified live against `api.flowleap.co` on 2026-07-17
(see `probes.md`). Transcripts land in `runs/<task-id>/<condition>/`.

## Tool strategy (first query plausibly fails or returns the wrong slice)

### S1 — obscure-term prior art, needs reformulation
**Prompt:** Find prior art for magnetocaloric refrigeration using layered La-Fe-Si
alloys. Give me the 5 closest patents with numbers and one-line relevance notes.

**Trap:** the literal full phrase as a text query returns zero hits on OPS (verified);
success requires decomposing into term combinations (magnetocaloric + La-Fe-Si,
CPC F25B21/00 pivot) and iterating.
**Grade on:** does the agent reformulate after the empty first hit, or give up / present
nothing / hallucinate?

### S2 — coined marketing term, needs vocabulary translation
**Prompt:** Is there any patent on a "piezoresistive smart bandage" — a hydrogel wound
dressing that senses strain? Find the 3 closest patents.

**Trap:** the coined phrase zero-hits (verified: OPS 404 "No results found", surfaced as
a raw XML fault). Success = translating to claim vocabulary (wound dressing, strain
sensor, hydrogel, piezoresistive) across retries.
**Grade on:** reformulation after zero-hit; whether the raw OPS 404 derails the run.

### S3 — multi-step cross-office chain
**Prompt:** For EP3564557A1: what does claim 1 cover, is the patent still in force, and
which prior-art references have been cited as novelty-destroying (X) against its family?

**Trap:** three different tools chained (claims → legal status → citations), and the
citation data is USPTO-side keyed by US application number — the agent must walk the
family to a US member first. Verified: claims + biblio resolve fine.
**Grade on:** completes the whole chain vs stops after the first hop; handles the
EP→US family pivot.

### S4 — US-specific routing + continuity chain
**Prompt:** Find recent US patent applications from DeepMind about protein structure
prediction, and show the continuity chain (parent/child applications) of the most
relevant one.

**Trap:** must route to USPTO ODP (not OPS), build a Lucene query (assignee + topic),
then chain into the continuity lookup with the right application number format.
**Grade on:** correct office routing; query iteration if the first assignee spelling
misses; completing the continuity hop.

## Execution reliability (known errors, empty results, truncation)

### R1 — US claim full text: every route 404s
**Prompt:** Get me the full text of the claims of US10958080B2.

**Trap:** no backend route serves US claims today (verified: `ops claims` and facade
`get_claims` both return NOT_FOUND with a coverage message — map 0001 finding F1).
**Grade on:** recovery and honesty — tries a route, reads the error, either finds a
legitimate fallback (USPTO/web) or clearly reports the coverage limit. Failure =
error-looping, silent give-up, or hallucinated claim text.

### R2 — nonexistent publication
**Prompt:** Pull the claims and current legal status of EP9876543A1.

**Trap:** the publication does not exist (EP numbering is far below 9.8M). Both hops
404.
**Grade on:** clean not-found handling — says it doesn't exist, suggests verifying the
number; no hallucinated bibliography, no infinite retry.

### R3 — huge description, truncation pressure
**Prompt:** Summarize the detailed description of EP2771468A1 in about 10 bullet
points, covering the main embodiments.

**Trap:** the description is ~222 KB (verified) — far beyond any single tool-result
window. Success = chunking/paging or working from structure; failure = truncated
context silently treated as the whole document, or a hard tool error.
**Grade on:** acknowledges/handles the size; summary covers material beyond the first
pages.

### R4 — broad landscape needing narrowing + analytics chain
**Prompt:** How many EP patent applications were filed between 2020 and 2024 for mRNA
lipid nanoparticle vaccines, who are the top assignees, and which 5 patents are the
most cited?

**Trap:** a naive text query is either too broad (result cap) or too narrow (zero
hits); a correct run narrows via CPC (e.g. A61K) + year range and chains into the
analytics/citation tools. Three sub-answers → partial completion is visible.
**Grade on:** query refinement; whether all three sub-questions get grounded answers vs
the run degrading to one generic search.
