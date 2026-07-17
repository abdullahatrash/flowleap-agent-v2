---
id: H9
title: Truncation — offload/paginate single-record document lookups instead of dropping the whole item
type: task
status: closed
assignee: abdullahatrash
blocked-by: []
---

## Question

The `patent_api_request` response formatter drops whole array items to fit the
`PatentApiRequest: 50_000`-character budget (`patentResponseFormatter.ts`, `dropArrayItemsToFit`).
For a **single-record** document lookup (`enrich=claims`/`description`, `grants/{n}`) that one
record can itself exceed 50k, so the entire item is omitted and the model reads
`patentFileWrapperDataBag: []` plus a "Refine your query — add filters, narrow the date
range, or request fewer results" note that is meaningless for a one-ID lookup. In R1 this
made the flowleap route for US claims look genuinely dead even when the data was there. What
formatter change lets full-text reach the model?

### What to change (from [H3 attribution](../assets/H3-attribution.md), fix slice 5)

- For single-record document lookups, stop dropping the whole item. Instead offload the
  oversized field to a disk path (the `read_file`-at-`<path>` pattern the harness already
  uses for >8KB tool results) or paginate the field, so the model can read claims/description
  in full.
- Fix the truncation note for the single-record case so it does not tell the model to "narrow
  the date range" on a by-number lookup.
- Surface: `extensions/copilot/src/extension/tools/vscode-node/patentResponseFormatter.ts`
  (`ToolResponseBudgets.PatentApiRequest`, `truncationNotice`, `dropArrayItemsToFit`).

### Expected effect on corpus

Makes the flowleap route for R1 viable without the web fallback; reduces truncation friction
on S2's USPTO grind.

### Coordination

This fixes the truncation **shape**, not the data **coverage**. US-claims *availability* is
map 0001 F1 ([W1](W1-us-de-claim-text-source.md)/[W8](W8-bq-slice-us-claim-text.md)) — a
single record that has no claims field is a different failure from one clipped by the budget.
Coordinate so the two don't collide. One agent session.

## Resolution (2026-07-17)

**Mechanism: don't-drop + reuse the harness disk offload (no new offload helper invented).**

The bug was that `formatJsonForModel` (`patentResponseFormatter.ts`) treats every over-budget
response the same way — `dropArrayItemsToFit` drains the largest array. For a by-number
document lookup that array is the sole-record wrapper (`patentFileWrapperDataBag`, length 1),
so it drops to `[]` and the full-text never reaches the model. Meanwhile the harness already
offloads any tool result over 8 KB to disk with a `read_file` pointer
(`ConfigKey.Advanced.LargeToolResultsToDiskEnabled`, **default on**, threshold `8 * 1024`, in
`prompts/node/panel/toolCalling.tsx` `onText`). The formatter's pre-emptive drop shrank the
single-record response to ~600 chars, so it never reached that offload.

Changes:
- `patentResponseFormatter.ts`:
  - `formatJsonForModel(value, budget, options?)` gained an `IFormatJsonOptions.singleRecord`
    flag. In single-record mode an over-budget response is **not** dropped — the full record is
    returned intact (deliberately over the inline budget) so the existing harness disk offload
    writes it to a file and hands the model the `read_file` pointer. Nothing is omitted
    (`omittedItems: 0`). Multi-record behavior is byte-for-byte unchanged (extracted the shared
    note-attachment into `annotateWithTruncationNote`, no output change).
  - `truncationNotice(omittedItems, budget, singleRecord=false)` gained the single-record branch.
  - New exported pure predicate `isSingleRecordDocumentLookup(path)` — true for
    `…/grants/{n}`, `…/fulltext/claims|description`, and `…enrich=claims|description`; false for
    `…/search`, `…/docs`, CQL, and plain `?doc=` biblio (kept narrow to the ticket's named cases
    so multi-record behavior is untouched).
- `patentApiRequestTool.ts`: detects the path via the predicate and passes `{ singleRecord }`.

**New single-record notice (verbatim):**
> This by-number document lookup returned a single record larger than this tool's {budget}-character inline budget. No data was dropped: the full record — including the complete claims/description text — is returned intact and offloaded to a file, so read it with the read_file tool at the path this result reports. Do not refine the query or narrow the date range; a by-number lookup has exactly one matching record.

The multi-record "Refine your query — add filters, narrow the date range…" notice is unchanged.

**Scope boundary honored (F1/W8):** the single-record branch only engages when the record is
over budget. A single record with no claims field is small, fits the budget, and passes through
unchanged — this change does not mask or alter the missing-field path (covered by a test).

**Verification:** `npx tsgo --noEmit -p extensions/copilot/tsconfig.json` → 0 errors.
`npx vitest run patentResponseFormatter` → 12/12 pass (added: single-record intact + note,
missing-field passthrough, predicate classification). Multi-record path untouched.
