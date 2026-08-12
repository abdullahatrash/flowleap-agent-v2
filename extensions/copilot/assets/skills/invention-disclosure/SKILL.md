---
name: invention-disclosure
description: Process an Invention Disclosure Form (IDF) end to end — parse the disclosure, triage bar dates, run a prior art search, assess patentability, and hand off to claim drafting. Use when the user provides an IDF or invention disclosure (PDF, Word, or pasted text), or asks to evaluate a new invention submission ("here's our IDF", "evaluate this invention disclosure", "take this from disclosure to claims"). For a search without an IDF use prior-art; for drafting claims directly use claim-drafting.
user-invocable: true
---

# Invention Disclosure (IDF) Processing

Orchestrates the full path from a raw invention disclosure to a patentability assessment and draft claims. Output is preparatory work for a patent attorney — always say so.

## Phase 0: Intake

Read the disclosure: `read_pdf` for PDF IDFs, the editor for Word/text, or take pasted text. Extract a **structured invention record**:

| Field | What to capture |
|-------|-----------------|
| Title & technical field | One line each |
| Problem | What existing solutions fail to do |
| Solution | How the invention solves it — the mechanism, not the benefit |
| Novel features | Ranked list; what the inventors believe is new |
| Embodiments & variations | Alternatives, ranges, optional features (future dependent claims) |
| Inventors | Names/roles as given — flag inventorship questions for the attorney |
| Known prior art | Every reference the inventors cite |
| Disclosure events | EVERY date: papers, talks, posters, demos, sales, offers, websites, theses |

If fields are missing (especially disclosure events and known prior art), ask the user (via the `vscode_askQuestions` tool) before proceeding.

## Phase 1: Bar-Date Triage (FIRST — can moot everything else)

For the earliest public disclosure or sale/offer date found:
- **EPO (and most of the world): absolute novelty** — the inventors' own pre-filing disclosure is prior art against them. Any public disclosure before filing likely bars EP protection.
- **US: 35 USC 102(b)(1) grace period** — the inventors' own disclosure within 1 year of filing is excepted. Disclosure more than 1 year ago bars US protection too.
- Verify the current rules with `search_legal` (e.g. query="grace period inventor disclosure 102(b)(1)", jurisdiction="USPTO") — never state bar conclusions from memory.

Report urgency explicitly: "disclosed [date] → EP likely barred; US grace period runs out [date+1y]". If everything is barred, stop and say so before spending effort on search.

Also note: the inventor-known prior art has a **duty-of-candor consequence** (IDS disclosure in the US) — list it prominently for the attorney and make sure the search covers it.

## Phase 2: Prior Art Search

Run the **prior-art** skill using the invention record as input:
1. Decompose the solution + novel features yourself (see `claim-analysis` Step 3b) → keywords, synonyms, CPC codes
2. Full broad-to-narrow search per that skill (EPO, USPTO, Google Patents/WIPO, NPL via `search_academic`)
3. Explicitly retrieve and assess every inventor-cited reference — these are guaranteed-relevant and will be in front of the examiner

## Phase 3: Patentability Assessment

Map the top references against the **novel features list** (not claims — none exist yet) using the **patent-examination** skill's feature-mapping discipline:
- Any single reference teaching all novel features → novelty problem (X)
- Combinations covering all features with plausible motivation → obviousness risk (Y)

Conclude with a **novelty gap statement**: which feature or combination of features was NOT found in the art. This sentence is the input to claim drafting — if there is no gap, say so and stop; do not draft claims around nothing.

## Phase 4: Claim Drafting

Hand the invention record + novelty gap + top references to the **claim-drafting** skill. Its self-examination loop needs the references from Phase 2 — pass them explicitly.

## Phase 5: Deliverables

Save via `write_patent_results`, as separate files:
1. **Invention record** (Phase 0 table)
2. **Bar-date memo** (Phase 1 — dates, jurisdictions affected, deadlines)
3. **Prior art search report** (per the prior-art skill's report format)
4. **Patentability assessment** with the novelty gap statement (`template: 'patentability-opinion'`)
5. **Draft claim set** (from claim-drafting)
6. **Audit trail** (run the audit-report skill — mandatory for IDF work relied on for filing decisions)

## Rules
- Bar-date triage comes BEFORE searching — a barred invention changes everything
- NEVER skip the inventor-cited references; they carry duty-of-candor weight
- No novelty gap → no claim drafting; report the negative result honestly
- Close every deliverable with: "AI-assisted analysis for review by a registered patent attorney — not legal advice."
