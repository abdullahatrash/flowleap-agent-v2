---
name: office-action-response
description: Analyze an office action or examination report and build the response — parse rejected claims and grounds (102/103/101/112, EPC novelty/inventive step), test the examiner's citation mapping, and recommend argue vs amend with drafted amendments. Use when the user receives, pastes, or attaches an office action or rejection ("we got a 103 rejection", "respond to this office action", "examiner cited D1 against claim 1"). For fresh claims use claim-drafting; for raw citation data use citation-analysis.
user-invocable: true
---

# Office Action Response

Turn a rejection into a response strategy. Never argue against a reference you haven't read, and never draft an amendment without support in the application as filed.

## Step 0: Intake & Deadline (FIRST)

Read the office action (`read_pdf` for PDFs, or pasted text). Extract:
- Application number, examiner, mailing date, and the **response deadline** — flag it immediately (US: typically 3 months shortened statutory, extendable to 6 with fees; EPO: usually 4 months). Verify current periods with `search_legal` if the user's deadline math matters.
- Per claim: which ground (35 USC 102/103/101/112, obviousness-type double patenting, or EPC Art. 54/56/84/123(2)) and which cited references
- The examiner's actual reasoning — quote it, don't summarize from memory

## Step 1: Retrieve the Cited Art

- `search_citations` keyed on the application number → the X/Y/A record of art cited AGAINST it (backward citations; if you only have a publication number, resolve the application number via `get_patent_family` → `get_continuity`). To find who cites a reference forward, that's `search_forward_citations` instead.
- `get_patent_details` for EACH cited reference → the actual claims/description text the examiner relies on
- If the examiner cites specific paragraphs/figures, read those exact passages; pull drawings with `get_patent_figures` when the rejection leans on structure
- If any rejection is obviousness-type double patenting (or you need the file history), use the typed tools rather than raw ODP paths: `get_continuity` on the application → the parent/child chain identifying the commonly-owned earlier application the ODP runs over; `get_prosecution_timeline` on the publication number → the dated legal-event history. Fall back to `uspto_api_guide` (continuity / file-wrapper endpoints) → `patent_api_request` only for fields those typed tools do not return.

### When retrieval fails

You cannot argue against a reference you couldn't read — before flagging a cited reference as unavailable, work the ladder in order:
1. **Clean zero result** (call succeeded, no hits/empty text): reformulate before concluding — try a different number format (publication ↔ application), the alternate route (`get_patent_summary` when `get_patent_details` is empty, `search_patents` ↔ `patent_api_request`), or the sibling citation tool.
2. **Search error** (5xx, gateway timeout, connection reset, truncated response): transient outage, not a missing reference — back off and retry the same call, then switch office/route. NEVER report a reference as unretrievable or the citation record as empty from an errored call.
3. **Route exhausted** (the reference genuinely won't load from any route): fall back to the web — `fetch_webpage` is always available (even when `web_search` is not) against `patents.google.com/patent/NUMBER` or `freepatentsonline.com`; quote only text the page returned and spot-check the number and title before relying on it.

Tell the attorney a reference couldn't be retrieved only after all three, and name what you tried.

## Step 2: Test the Rejection (patent-examination discipline)

Decompose each rejected claim into features and map the examiner's citation(s) against it, exactly as the **patent-examination** skill prescribes. Three outcomes:
- **Mapping fails** — a claim element is missing from the reference, or the examiner mischaracterized a teaching → **argue** (quote the reference's actual text against the assertion)
- **Mapping holds** — the reference genuinely teaches every element → **amend** (or cancel)
- **103/Art. 56 combination is weak** — elements are scattered across references but the motivation to combine is conclusory, hindsight-driven, or the references teach away → **argue non-obviousness**
- **Obviousness-type double patenting (ODP)** over the applicant's own earlier patent/application is different: it is usually resolved by filing a TERMINAL DISCLAIMER (37 CFR 1.321), not by argue/amend — flag it as its own strategy row and note the common-ownership requirement and patent-term consequence for the attorney

## Step 3: Ground the Arguments in Law

`search_legal` per rejection type (use `comprehensive=true`, quote exact sections):
- **103**: MPEP 2141-2145 — motivation to combine, hindsight, teaching away, unexpected results
- **102**: MPEP 2131 — every element "arranged as in the claim" in a single reference
- **101**: MPEP 2106 — eligibility two-step analysis
- **112**: MPEP 2161-2164 — written description / enablement responses
- **EPO**: problem-solution approach (Art. 56, Guidelines G-VII) — reformulate the objective technical problem

## Step 4: Strategy Table

| Claim | Ground | Cited Art | Verdict on Mapping | Strategy | Basis |
|-------|--------|-----------|--------------------|----------|-------|
| 1 | 103 over D1+D2 | D1, D2 | D2 lacks F4; motivation conclusory | Argue | MPEP 2143 |
| 5 | 102 over D1 | D1 | Mapping holds | Amend: add [feature from spec ¶x] | — |

## Step 5: Draft Amendments (claim-drafting discipline)

For every "amend" verdict:
- The added feature MUST have basis in the application **as filed** — no new matter (35 USC 112(a); EPO Art. 123(2) added-matter is applied strictly). Cite the supporting paragraph for each amendment.
- Prefer features from existing dependent claims (already searched, already supported)
- Re-run the amended claim through the **patent-examination** mapping against ALL cited references — an amendment that doesn't clear the art is wasted prosecution

## Step 6: Estoppel Warning

Every argument and amendment narrows how the claims will be construed later (prosecution history estoppel). Note in the output which arguments concede scope, so the attorney can weigh them.

## Output

Save via `write_patent_results`:
1. **OA summary** — application, deadline (prominent), rejections per claim
2. **Per-rejection analysis** — feature mapping vs the examiner's assertion, with quoted reference text
3. **Strategy table** (Step 4)
4. **Draft amendments** with support citations + **draft argument skeletons** with legal basis
5. **Estoppel notes**

## Rules
- NEVER characterize a cited reference without retrieving its text first
- NEVER propose an amendment without citing its support in the application as filed
- Quote the examiner and the references verbatim where the argument turns on wording
- Close every deliverable with: "AI-assisted analysis for review by a registered patent attorney — not legal advice. Response deadlines are statutory; confirm them independently."
