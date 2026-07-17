---
id: H7
title: Citation tools — empty-result strings that route forward↔backward + name the US-app-number chain
type: task
status: closed
assignee: abdullahatrash
blocked-by: []
---

## Question

On the clean task S3 ("which prior-art references were cited as novelty-destroying (X)
AGAINST this family"), Sonnet 4 reached for `search_forward_citations` (who-cites-this),
got a clean zero on the EP number and the US family member, correctly diagnosed the mismatch
— "the user asked for references cited AGAINST … not patents that cite this family" — and
then never found `search_citations` keyed on the US **application** number. Sonnet 5 found
that route (family → continuity → app number 16473445 → `search_citations`) and delivered 4
X-citations. The empty-result strings today point only to `citation_api_guide`, which the
model never opened. Can the empty strings themselves route the weaker model to the sibling
tool?

### What to change (from [H3 attribution](../assets/H3-attribution.md), fix slice 3)

- `searchForwardCitationsTool.ts:143` zero-result → add: "For prior art cited AGAINST this
  patent (examiner X/Y/A references), use `search_citations` with the US **application**
  number — resolve it via `get_patent_family` → `get_continuity`."
- `searchCitationsTool.ts:155` zero-result → the symmetric pointer to
  `search_forward_citations`, and a reminder that backward citations are keyed on the US
  application number, not the publication number.
- Keep the existing `citation_api_guide` pointer but make the sibling-tool + key-chain hint
  the first line, since the guide pointer alone did not steer the model.

### Expected effect on corpus

Flips S3 at the weaker model (the route Sonnet 4 never found). Clean task, exact mechanism
identified — high confidence. One agent session; two tool files. Mirror the routing note into
the citation skill via [H6](H6-skill-adaptive-failure-branches.md).

## Resolution (2026-07-17)

Both zero-result strings now lead with the sibling-tool + key-chain routing hint and demote
the `citation_api_guide` pointer below it. Surfaces:
`extensions/copilot/src/extension/tools/vscode-node/searchForwardCitationsTool.ts` and
`searchCitationsTool.ts`. The `citation_api_guide` line is unchanged and untouched in each
tool's non-empty branch.

### `searchForwardCitationsTool.ts` — zero-result

Before (two lines):

```
No forward citations found matching the filters.

For citation statistics or date-range filtering, use citation_api_guide.
```

After (new first hint, guide demoted below it):

```
No forward citations found matching the filters.

For prior art cited AGAINST this patent (the examiner X/Y/A references), use search_citations with the US application number — this tool only finds patents that cite this document, not the references cited against it. Resolve the application number via get_patent_family (find the US member) then get_continuity (read its application number).

For citation statistics or date-range filtering, use citation_api_guide.
```

### `searchCitationsTool.ts` — zero-result

Before (two lines):

```
No citations found matching the filters.

For forward citations, citation statistics, or date-range filtering, use citation_api_guide.
```

After (new first hint, guide demoted below it):

```
No citations found matching the filters.

Backward citations key on the US application number, not the publication number — if you passed a publication number, resolve the application number via get_patent_family (find the US member) then get_continuity (read its application number) and retry. To instead find patents that cite this document forward, use search_forward_citations with the publication number.

For forward citations, citation statistics, or date-range filtering, use citation_api_guide.
```

### Verification

- Tool name strings (`search_citations`, `search_forward_citations`, `get_patent_family`,
  `get_continuity`, `citation_api_guide`) confirmed against `toolNames.ts` before use.
- Typecheck of the copilot extension slice (`npx tsgo --noEmit -p tsconfig.json`) — no errors
  in either citation tool file.
- `searchCitationsTool.spec.ts` has one inline snapshot on the backward-citation empty case;
  updated it by hand (no `vitest -u`) and ran `vitest run -t "citation"` → 4 passed. The
  non-empty snapshots and the forward-citation snapshot were unaffected (only the zero-result
  branch changed; the forward empty case has no test).

### Other citation-family zero-result strings

No other citation-proper tool needs the same treatment: `citationApiGuideTool.ts` returns a
static guide (no result set). The adjacent chain tools `getContinuityTool.ts:137` ("No
continuity relationships found…") and `getProsecutionTimelineTool.ts:110` ("No prosecution or
legal-status events…") are terminal correct-null messages, not forward/backward mis-routes —
left unchanged (report only, per scope).
