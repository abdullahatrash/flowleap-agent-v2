# Prior-art quotation and evidence reuse follow-up

Base: `851096e54e8` (PR #316). The owner-driven dental-composites run completed after one Continue, but made 95 local evidence-lookup attempts for seven retrieved publications. Its saved report also rendered claim 7 as list item 6 and retained a source-scope error: the 1–20 wt% range in dependent claim 8 was attributed to independent claim 1.

## Implemented scope

- Source quotations render as escaped literal HTML inside a blockquote, with wrapping and preserved source indentation. Markdown cannot renumber claims, format source text as instructions, or absorb subsequent source-review prose. Missing formula-image placeholders become explicit omission notices. Citation links stay outside the quotation.
- For numbered claims, the writer can fill an omitted quote directly from the latest recorded anchor. It still validates supplied quotations and requires exact description excerpts. This removes transcription work without omitting claim dependencies or constituents.
- The shared provider prompt receives a bounded memo of recent successful local lookup responses and repeat counts. It includes results deferred across Continue boundaries, deduplicates replayed call IDs, and explicitly avoids treating retrieval as a review certificate. Re-reading remains available when text is missing, changed or needs verification.
- Blank source lines retain their original line positions but do not consume the useful-row allowance. Invalid anchors explain how to obtain the source index. No research call cap, terminal restriction or backend change was added.

## Remaining source-interpretation work

The free-form scope and quantity notes remain model judgments. These changes do not establish that the independent/dependent-claim error or final-summary overconfidence is fixed.

A proposed separate check would send the draft report and cited source passages to the user's configured BYOK utility model, and check the final summary against the saved report. Automatic approval review rejected adding that network call without explicit authorization for the payload and destination. The owner was asked to approve this behavior; no such call or implementation is included here while approval is pending. This matters for private invention reports, even though the captured demo uses public source material.

## Validation

The initial rendering regression reproduced the original bug through `renderCandidateReview` and Markdown-It: numbered lists were generated, literal claim labels disappeared, and review prose remained inside the blockquote. The final fixtures also cover indented source paragraphs, missing formulas, literal HTML/Markdown, complete claim copying through the real writer, continuation results, and real provider prompt assembly.

Extension compilation, extension TypeScript checks and prompt-drift checks passed. Focused suite results and reviewer follow-up are recorded in the PR. No new live model evaluation or owner-app rehearsal was performed. Reduced model lookup counts remain a live acceptance check; deterministic tests establish the available navigation and reuse context, not model compliance.

The owner's running checkout and report were not modified by this fix branch. The branch is not an accepted website-demo result.
