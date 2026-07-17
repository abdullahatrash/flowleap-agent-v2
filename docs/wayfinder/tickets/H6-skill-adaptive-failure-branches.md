---
id: H6
title: Skills — adaptive failure branches (zero-result / search-error / web-fallback) + citation routing
type: task
status: closed
assignee: abdullahatrash
blocked-by: [H5]
---

## Question

All 25 bundled panel skills prescribe up-front breadth and carry **zero** adaptive failure
branches (grep for "no results|zero|empty" over every SKILL.md = 0 hits). When the first
query fails or a route dead-ends, the skills give the model nothing to fall back to — the
recovery policy lives only in the prompt. What failure-branch content brings the skills in
line with the H5 prompt policy?

### What to change (from [H3 attribution](../assets/H3-attribution.md), fix slice 2)

- Add **zero-result / search-error / web-fallback** branches to the search-recipe skills
  (prior-art, freedom-to-operate, invalidity, landscape, office-action) so skill guidance
  matches the [H5](H5-prompt-persistence-escalation-ladder.md) escalation ladder rather than
  prescribing only initial breadth.
- Add a **forward-vs-backward citation routing** note (mirror of [H7](H7-citation-tool-routing-strings.md)):
  "cited AGAINST" = backward = `search_citations` on the US application number (resolve via
  family → continuity); "who cites this" = forward = `search_forward_citations`.
- Surfaces: the bundled skills under `extensions/copilot/assets/skills`, mindful of the
  Claude-session skill filter (`node/claudeSkills.ts`) that already excludes panel skills
  naming typed tools — keep the wording pack-safe.

### Why blocked-by H5

The skills should echo the prompt's persistence/fallback policy verbatim; land the policy in
the prompt first so the skill wording matches instead of drifting. One agent session.

### Expected effect on corpus

Reinforces R1 / S3 / R4 recovery on the skill surface; lowers model-dependence of the good
trajectory. Confidence medium (skills could not be isolated from model effect in the corpus,
but the total absence of failure branches is verified).

## Resolution (2026-07-17)

All five named search-recipe skills under `extensions/copilot/assets/skills` now carry an
adaptive failure-branch section that echoes the H5 escalation ladder (they had zero before —
verified: only prior indexed hit was a `references/` file, no SKILL.md failure branch). No
frontmatter `description` changed on any skill; additions are compact, use typed tool names
the skills already reference, and carry no curl/raw-endpoint examples or hard paths.

**Skills touched (5):** `prior-art`, `freedom-to-operate`, `invalidity-analysis`,
`patent-landscape`, `office-action-response`.

**Section added — "When a search fails"** (titled "When retrieval fails" in office-action-response,
where the failing operation is retrieving a cited reference rather than a search). Placed in the
search phase of each skill (before Relevance/Claim-Mapping/Chart/Analysis/Test steps). Each is a
3-rung ladder matching H5 exactly: (1) clean zero-result → reformulate (synonyms, broader/narrower
CPC/IPC, drop a filter, other number format) then alternate office/route, incl. `get_patent_summary`
when `get_patent_details` is empty; (2) transient search error (5xx/gateway timeout/connection
reset/truncated) → back off and retry, then switch office, NEVER report a coverage limit from an
errored call; (3) route exhausted → `fetch_webpage` (named as ALWAYS available, even when
`web_search` is not) against `patents.google.com/patent/NUMBER` or `freepatentsonline.com`, quoting
only returned text and spot-checking number/title. Disclose the gap only after all three, naming
what was tried. Per-skill the rung wording is voiced to the skill's own stakes (FTO: a clean zero is
not an FTO clearance until searched both ways; invalidity: an element is un-anticipated only after
exhaustion; landscape: a failed slice is retry-pending, not white space; OA: can't argue a reference
you couldn't read).

Verbatim sample (`prior-art/SKILL.md`, inserted before Phase 3):

> ## When a search fails
>
> Before handing back or recording a coverage gap in the audit trail, work the ladder in order:
> 1. **Clean zero result** (call succeeded, no hits): reformulate before concluding — swap synonyms from the concept table, broaden or narrow the CPC/IPC, drop a filter, try a different number format — then try the alternate office/route (`search_patents` ↔ `patent_api_request`, `get_patent_summary` when `get_patent_details` is empty).
> 2. **Search error** (5xx, gateway timeout, connection reset, truncated response): transient outage, not a coverage limit — back off and retry the same call, then switch office. NEVER record "no results" or "doesn't exist" from an errored call.
> 3. **Route exhausted** (both offices genuinely dry): fall back to the web — `fetch_webpage` is always available (even when `web_search` is not) against `patents.google.com/patent/NUMBER` or `freepatentsonline.com`; quote only text the page returned and spot-check the number and title.
>
> Log a gap in the audit trail only after all three, naming what you tried.

**Citation forward-vs-backward routing note (mirror of H7)** added to the four skills that discuss
citations (not freedom-to-operate, which does not): `prior-art` (Phase 2f), `invalidity-analysis`
(Phase 1.4), `patent-landscape` (Phase 4 key-patents), `office-action-response` (Step 1). Wording
matches H7's tool strings: "who cites this" = forward = `search_forward_citations` on the publication
number; "cited AGAINST" = backward = `search_citations` keyed on the US **application** number,
resolved via `get_patent_family` → `get_continuity`.

**Deviation from H5 wording:** none in policy. Two presentation-only differences, both to fit the
skill surface: (a) office-action-response's section is titled "When retrieval fails" and its rung-1
alternate-route example is number-format/sibling-tool rather than office-swap, because that skill
retrieves a named cited reference rather than running a fresh multi-office search; (b) each skill's
"disclose only after exhaustion" closing line is voiced to that skill's deliverable (audit trail /
FTO finding / invalidity strength / methodology / attorney note) instead of a generic "disclose a
gap". The 3-rung ladder, the transient-error-vs-clean-zero distinction, the always-available
`fetch_webpage` framing, and the named fallback sources are identical to H5.

**Verified:** frontmatter intact on all five (name/description/user-invocable unchanged, `---`
fences present); each file has exactly one failure section and one web-fallback line; citation
routing present in the four intended skills. Markdown assets — no typecheck needed.

### Other skills recommended for the same treatment later (report only — not touched)

Scanned the remaining ~20 skills for live-search tool calls. Recommend, in priority order:

- **`patent-search`** (uses `search_patents` + `patent_api_request`) — the core lookup skill; the
  exact R1 shape (a single-document lookup that dead-ends). Highest-value follow-up.
- **`citation-analysis`** (uses both `search_citations` + `search_forward_citations`) — H7's own
  resolution explicitly flagged "mirror the routing note into the citation skill via H6"; it was
  out of my named-five scope but is the natural home for the forward/backward routing note and a
  zero-result branch. Strong follow-up.
- **`portfolio-analysis`** (`patent_analytics_viz` + `search_patents` + `search_forward_citations`)
  — landscape sibling, same R4-style transient-outage exposure; deserves the full ladder + the
  citation routing note.
- **`patent-translation`** (multi-language CN/JP/KR `search_patents`) — web fallback is especially
  load-bearing here (no dedicated Asian-office tool); the ladder's rung 3 maps directly.
- **`invention-disclosure`** (`search_academic` novelty pre-check) and **`infringement-charting`**
  (`search_citations`) — lower priority; would benefit from the ladder + (for charting) the
  citation routing note.

Lower value / skip: `audit-report` (reporting, not searching), `legal-research` /
`patent-examination` / `claim-analysis` (guide-backed or analysis-over-supplied-text, little live
search-and-dead-end risk).
