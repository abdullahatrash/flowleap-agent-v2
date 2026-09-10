---
name: invention-disclosure
description: Process an Invention Disclosure Form (IDF) end to end — parse the disclosure, triage bar dates, run a prior art search, assess patentability, and hand off to claim drafting. Use when the user provides an IDF or invention disclosure (PDF, Word, or pasted text), or asks to evaluate a new invention submission ("here's our IDF", "evaluate this invention disclosure", "take this from disclosure to claims"). For a search without an IDF use prior-art; for drafting claims directly use claim-drafting.
user-invocable: true
---

# Invention Disclosure (IDF) Processing

Route the disclosure to the user-requested deliverable. For an IDF-based candidate search, perform intake and the scoped search/report; patentability assessment, filing advice and claim drafting are separate stages only when requested. For a full intake-to-drafting task, follow the remaining phases. Output is preparatory work for review.

## Phase 0: Intake

Read the disclosure content available in the conversation. For a PDF supplied as native document input, inspect its text, tables, figures, and captions directly. A visible attachment name or a PDF-capable model alone does not establish that the document content was delivered.

Use `read_pdf` with the local file path when PDF text is unavailable or a passage needs exact extraction. Its text output does not establish that figures were inspected: use native document content or accessible page images for visual evidence, and identify any figures that remain unavailable. Report an attachment or extraction failure precisely; request missing content before relying on it. For Word/text, read the document or supplied text.

Extract a **structured invention record**:

| Field | What to capture |
|-------|-----------------|
| Title & technical field | One line each |
| Problem | What existing solutions fail to do |
| Solution | How the invention solves it — the mechanism, not the benefit |
| Essential features and interactions | Required components, process steps, and relationships; distinguish individual features from their combination |
| Novel features | Ranked inventor assertions; not established novelty |
| Embodiments & variations | Alternatives, ranges, optional features (future dependent claims) |
| Figures & supporting evidence | Page/figure references, observed structures and labels; distinguish illustrative drawings from measured results and flag unreadable evidence |
| Inventors | Names/roles as given — flag inventorship questions for the attorney |
| Known prior art | Every reference the inventors cite |
| Disclosure events | EVERY date: papers, talks, posters, demos, sales, offers, websites, theses |

Resolve missing information that affects the requested deliverable. For a candidate search with an agreed scope/cutoff, proceed with disclosed assumptions and gaps; do not require unrelated filing-intake details. For filing-related work, clarify missing disclosure events and known prior art before the relevant assessment.

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
2. Search the confirmed jurisdictions, sources and cutoff basis per that skill. Track essential features, optional embodiments and important combinations; use additional tracks only for unresolved evidence. Record excluded sources rather than silently expanding scope.
3. Retrieve and assess inventor-cited references when relevant to the requested task; distinguish post-cutoff concept examples from qualifying earlier publications. Record unavailable evidence and do not assume relevance from citation alone.

For a candidate-review request, save the `prior-art-report` with structured coverage, limitations, semantic-review observations/concerns and stop reason, then finish after checking the saved report, generated audit and sources. Do not proceed to a legal opinion or drafting without that scope.

## Phase 3: Patentability Assessment (when requested)

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
- For filing-related work, complete relevant bar-date triage before offering filing advice; a demonstration publication cutoff is not a legal priority date
- NEVER skip the inventor-cited references; they carry duty-of-candor weight
- No novelty gap → no claim drafting; report the negative result honestly
- Close every deliverable with: "AI-assisted analysis for review by a registered patent attorney — not legal advice."
