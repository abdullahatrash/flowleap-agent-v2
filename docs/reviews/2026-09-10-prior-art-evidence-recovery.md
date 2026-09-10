# Prior-art evidence recovery after PR #313

The failed Dental Composites take exposed three disconnected contracts: anchor IDs appeared after the retrieved text, the writer accepted a separate narrative alongside validated coverage, and the generic prompt path service deliberately did not resolve relative paths. A real-service writer regression reproduced the relative save failure before the fix.

## Implemented boundary

- Detail responses put stable source IDs beside claims and each description line. Returned text is persisted with the existing session execution ledger. `get_patent_details` with `evidenceLookup: {}` lists local IDs; `query` searches literal text across every stored line; `anchor` and one-based `start` return 30 source lines at a time. Lookup performs no backend call and does not increment search/detail invocation counts.
- Candidate reports require empty legacy `content`/`relevanceAssessment`. The writer renders one assessment from coverage, with an explicit essential combination row, exact source quotations, source review notes, remaining gaps, and a generated retrieved-candidate title/date table. Freeform saves and formal templates retain their content behavior; updates still replace the report and retain evidence revisions.
- Supported/partial rows require source review fields and quotations matching stored returned text. Numbered-claim quotations must preserve the whole claim, including dependency language and every constituent. Description quotations must match retrieved text. Source review fields explicitly retain scope, qualifiers, and original quantity basis.
- The writer resolves relative paths only when there is one workspace folder and checks workspace containment before writing. Absolute paths remain supported. Spaces are retained. The generic prompt-path service contract is unchanged.

## Guarantees and limits

Anchor and quotation identity, required structure, full numbered-claim quotation, local-only recovery, and workspace path resolution are code checks. The writer cannot keep an independent positive matrix after all coverage rows are downgraded. It does not verify the truth of arbitrary prose in model-authored source notes, gaps, objective, strategy, limitations, or stopping rationale. It does not independently establish the invention's complete feature set, dependencies' legal scope, numerical entailment, or semantic consistency of every sentence.

Full original claim text makes the initiator and Claim 8 dependency visible; the implementation does not compute arbitrary normalized percentages or prove that the model interpreted them correctly. Literal lookup makes later sieve passages recoverable; it does not prove every relevant passage was reviewed, and no match is not publication-wide absence. Current audit still covers instrumented search/detail outcomes only. No exhaustive file-read tracking is claimed.

Older ledger records retain known IDs but may lack recoverable text. The local index explains this. The original offload remains readable; quotation validation for such records needs one new detail retrieval. Storage failure remains an explicit audit gap. Fixtures with English minimal excerpts are regression cases, not authoritative translations; the tool-path test separately uses the existing actual WO claim fixture.

## Live-replay acceptance (pending)

Use the owner-prepared development app; this implementation task did not launch, restart, deploy, or replay it.

1. Repeat the same IDF task using Gemini 3.8 Flash Medium, EP/WO publications strictly before 2002-02-21, and the same workspace. Preserve approval settings.
2. Observe source IDs alongside WO Claim 10 and EP Claim 8. Recover an ID with local evidence lookup, and confirm no additional backend search/detail invocation is recorded for that lookup.
3. Search stored WO description text for the source-language sieve/mesh wording and inspect the later matching passage. The review must distinguish disclosed sieve processing from the unresolved exact IDF threshold, rather than claim classification is silent.
4. Keep WO Claim 10 as 100 monomer + 0.01–10 initiator + 40–400 composite filler parts. If a separate calculation is supplied, inspect every denominator constituent and assumption. Confirm EP's 1–20 wt% remains scoped to dependent Claim 8 and range overlap remains partial.
5. Save to `outputs/prior-art-review.md` without an absolute-path retry. Confirm one generated assessment, an explicit combination row, usable source links, accurate instrumented query/detail counts, and honest gaps.
6. Intentionally submit unresolved coverage with a retained firm legacy body: confirm rejection and no file replacement. Save an honest unresolved structured report and then update it, checking the new evidence companion and absence of duplicate wrappers.
7. Open the exact WO/EP claim links and the saved report. Review model-authored notes and summary for unsupported conclusions. Mechanical test success alone does not accept the report for recording or publication.

## Validation

- `npm run gulp compile-extensions`: passed.
- Copilot extension `npm run typecheck` (all four configured projects): passed.
- Seven focused Vitest suites: 85 tests passed (writer, evidence recovery, ledger, facade path, report templates, agent prompt, tool references).
- Staged hygiene and diff whitespace checks: passed. Focused ESLint check: passed.
- Prompt drift: passed. Skill drift with the explicit local canonical checkout: all 25 mirrored skill directories passed.
- Relative path regression was observed failing before the fix with the actual PromptPathRepresentationService (`ENOENT` at the expected workspace output).
