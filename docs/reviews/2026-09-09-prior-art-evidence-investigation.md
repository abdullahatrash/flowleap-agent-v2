# Prior-art demo evidence investigation — 9 September 2026

## Scope and evidence

Investigated the saved Dental Composites prior-art report against the actual local session transcript, model-visible tool responses, offloaded patent documents, and both repositories. Session: `b1e318ac-d161-4029-8ac7-245076f5c33c`, workspace storage `6cb76ce5233886908cdd8173fb5dd717` under `code-oss-dev`. The report was left untouched. The [sanitized audit](fixtures/2026-09-09-prior-art-search-audit.json) retains all 14 actual queries, parameters, totals and response summaries. Raw model reasoning and request payloads are deliberately excluded.

## Verified findings

### Country filtering worked; approval visibility was incomplete

Every one of the 14 calls passed `countries: "EP,WO"`. The app splits this into an array and posts to `/tools/search_patents`. Backend `src/tools/search-parity.ts` forwards the scope into `src/lib/ops/direct.ts`: `buildEffectiveQuery` appends `and pn any "EP WO"` before OPS executes the query. Nonzero model-visible responses echoed this exact effective query and explicitly labeled totals as office-filtered. This disproves the initial suspicion that the report invented automatic country filtering.

The approval/progress card showed only the input CQL, hiding separate country and range parameters. Fixed the card to show the requested parameters without pretending the backend has already applied them. A related verified defect: the zero-hit formatter discarded the effective query and reported only the original CQL. Fixed it to preserve the backend's effective query when available. Legacy responses retain their existing fallback.

### All 14 final report counts are supported

All input query strings match, and all numbers match their actual tool responses: **589, 20272, 6, 1, 6, 30, 44, 9, 2, 0, 8, 0, 1, 1**. No fabricated number was found. The initial report omitted seven executed queries; the refinement restored them. The final heading “Returned Count” remains misleading: these are total matches. For example, query 2 matched 20,272 but requested only range 1–25. The report also omits each requested range and separate country parameter from its execution table. These are audit labeling/completeness errors, not a backend counting defect.

### Scope of the evidence was overstated

- EP0983762A1 independent claim 1 really does require a component with mean particle size at most 20 nm. Its **1–20 wt% amount** comes from dependent claim 8; the summary collapses that narrower restriction into an unqualified publication-wide requirement. The independent-claim small-filler contradiction itself is supported.
- WO9951190A1 description paragraph [0027] lists alternative inorganic fillers and describes silica size ranges using “preferred” language. The report turns this into required silica. The source is Japanese with OCR artifacts; translated propositions need to preserve that qualification.
- Only lines 1–120 of that WO document were read. The report says no classification is disclosed, but later [0057] (line 162) discusses different mesh sieves and later examples use sieved granules. This does **not** establish the exact F4 mass-fraction threshold; it does disprove a sweeping claim that the document never uses sieving.
- “Pre-2002 practice relied primarily on…” and “predominantly taught mandatory inclusion…” are conclusions about a field drawn from a limited candidate sample. The search established neither exhaustive coverage nor that prevalence.
- The WO result bundles its printed claims into one tool claim numbered 1. The report produces claim-specific links 6, 8 and 10 that were not supplied by the tool. This reveals a separate backend/source segmentation gap; it is not repaired by the report instruction changes in this branch. Use the returned claims-section link until individually addressed claims are available.

The failure is largely at synthesis: available text qualifications and review boundaries were dropped. Current source instructions stress retrieving factual support but did not explicitly require claim/embodiment scope, numerical denominators, or an execution ledger. The actual transcript contains no skill invocation or skill-file read during this take. Its captured system prompt contains the always-loaded evidence rules but not the full prior-art skill. Therefore skill edits alone would not cover the demonstrated path.

### Long search and stale progress

There were 14 distinct queries, not a retry loop. Five patent-detail reads began at 12:07 UTC, but the todo remained in the searching phase from 12:01:24 to 12:16:19 UTC. The model did not update it during analysis; no evidence implicates the todo renderer. The generic instruction “under 10 broaden,” combined with multiple-search and persistence instructions, encourages continued variants even after a small relevant set is found. The revised instruction calls for relevance review before broadening and asks the next query to test a distinct unresolved feature; repeated reviewed results trigger synthesis with stated limitations. This is a behavioral mitigation, not a proven latency fix or a hard query cap.

### Wide candidate table

The saved report puts nine columns, including five long feature assessments, into its summary table. This is generated content layout, not evidence of a markdown renderer bug. Instructions now separate a four-column candidate summary from detailed per-candidate mappings.

## Changes

- Search approval/progress includes requested countries and range; zero-hit response preserves effective query.
- Always-loaded patent instructions require an execution ledger, total/page/review distinctions, exact claim/embodiment scope, preservation of amounts/qualifiers, review-limited absence statements, and the same grounding in saved files as final answers.
- Prior-art and patent-search skills align with these rules, preserve confirmed jurisdiction/date constraints, use a saturation check, and separate compact summaries from detailed mappings.

## Validation and limits

Two new tool regressions were observed failing before the fix. Copilot TypeScript checking passed before tests; the tool and existing prompt suites then passed (50 tests). Full `npm run gulp compile-extensions` passed after connecting the isolated worktree to the already-installed extension dependencies. ESLint passed for changed TypeScript; the bundled-skill drift check passed for all 25 mirrored skills (these edited app skills are classified as adaptations). `git diff --check` passed.

These deterministic tests cover tool presentation/provenance. They do not prove that Gemini will obey the revised synthesis instructions. A live replay is still needed before accepting a new report: verify actual execution accounting, label dependent claims/examples accurately, review the source coverage, and test every displayed claim link. No app restart, recording change, demo report rewrite, backend deployment, or merge was performed.
