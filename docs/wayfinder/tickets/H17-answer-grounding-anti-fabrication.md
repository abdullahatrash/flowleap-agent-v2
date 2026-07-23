---
id: H17
title: Prompt — answer-grounding: every patent number / quote must trace to a tool result
type: task
status: closed
assignee: abdullahatrash
blocked-by: []
---

## Question

Across the H15 run the main window repeatedly asserted data not traceable to any tool result:
S1's #5 patent (US12168819B2) + a cited "family member" appeared in no summary/result call; R1's
answer paraphrased claim text of uncertain provenance; R4's top-5 citation counts rested on a
single suspect `fetch_webpage`. What prompt rule enforces that every patent number, claim quote,
and figure in the final answer traces to a specific tool result — and that unverified items are
explicitly marked as such rather than stated flat?

### Evidence
[H15 VERDICT](../assets/H15-acceptance-run/VERDICT.md) fabrication notes on S1/R1/R4 (bench was
consistently cleaner — grounded picks in retrieved claims). This is the highest-trust-risk
finding: a filing-adjacent tool that fabricates patent numbers is worse than one that grinds.
Surface: `patentAIPrompt.tsx` (an evidence/citation-discipline rule; the existing EvidenceRules
element is the natural home). Pairs with [[H16]] (grind) and [[H18]] (completeness).

## Resolution (2026-07-20)

Added one final-answer grounding bullet to the existing `PatentEvidenceRules` element
(the ticket's designated home) in
`extensions/copilot/src/extension/prompts/node/agent/patentAIPrompt.tsx`, immediately after
the "every factual claim … must trace to a tool result" bullet (renders at fixture line 319):

> • FINAL-ANSWER GROUNDING: before you send the final answer, sweep it and confirm that every
> patent / publication / application number, claim quote, citation, citation count, and figure
> reference in it traces to a specific tool result you actually received in this conversation —
> not to model recollection, and not to a single unverified web fetch you could not cross-check
> (a lone fetch_webpage count is unverified until a second route confirms it). Any item you
> cannot tie to a retrieved result must be either omitted or explicitly marked unverified / from
> model recollection (e.g. "unverified — not retrieved"), never stated as established fact.
> Persist to RETRIEVE per the escalation ladder, then assert only what you retrieved: a
> fabricated number in a filing-adjacent answer is worse than an incomplete one.

**Why extend rather than add a new element.** `PatentEvidenceRules` and `PatentCriticalRules`
already forbid citing unfetched numbers / claim text; the H15 fabrication (S1's #5 patent +
"family member", R1's paraphrased claims, R4's citation counts on a lone `fetch_webpage`)
slipped past because those rules never (a) scoped a final-answer self-audit, (b) named citation
**counts**, figures, or the single-suspect-fetch case, or (c) offered the "mark unverified"
escape as an alternative to a bare omit. The new bullet closes exactly those three gaps as one
outcome-spec, keeping the change scoped to a single element.

**Coordination with H5 (persistence).** The rule ends with "Persist to RETRIEVE per the
escalation ladder, then assert only what you retrieved" — grounding constrains only what the
FINAL ANSWER *asserts*, and does not touch H5's ladder, web-fallback, search-error rule, or the
jurisdiction gate. Persistence still drives maximal retrieval; grounding just forbids over-claiming
what retrieval didn't return. No H5 line was weakened.

**Verification.**
- Typecheck: `npx tsgo --noEmit -p extensions/copilot/tsconfig.json` → no errors in
  patentAIPrompt.tsx (sibling errors, if any, are out of scope for this slice).
- Fixture: regenerated `evals/prompts/system-prompt.txt` offline via
  `npx tsx evals/prompts/render-system-prompt.tsx` (465 → 466 lines; new block confirmed at
  line 319); `npx tsx evals/scripts/check-prompt-drift.ts` → "no drift detected".
- **Re-grade note:** the 51/52 model-graded baseline was NOT re-run (paid model-graded evals were
  deliberately not run here). It needs a re-grade after this change before release.

**Deliberately NOT done** (to avoid colliding with H16/H18/H19's future edits to this same file):
did not touch `PatentPersistenceRules` (H16 grind), the verbatim-completeness / OCR-offload path
(H18), or target-selection wording (H19); did not restructure or renumber `PatentCriticalRules`
rules 1–2 despite their topical overlap — left them intact so the change stays a single additive
bullet; no new prompt element, no priority changes.
