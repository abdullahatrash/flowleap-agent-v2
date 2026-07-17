---
id: W3
title: Zero-hit EPO search returns an empty-result contract, not a raw 404
type: task
status: open
assignee:
blocked-by: []
---

## Question

Define and implement the empty-result contract for a zero-hit EPO search so an agent can tell
"no prior art exists" (a substantive novelty signal) from "the backend is down."

Today (finding F3) a zero-hit EPO search surfaces the raw OPS `SERVER.EntityNotFound` 404: the
CLI exits 5 with an OPS-XML dump; MCP `search_patents` returns `isError:true` wrapping the same
XML. The USPTO leg already does this right — exit 0, `No results found`, plus an actionable
"broaden" note. The FTO run hit this on features F3/F4 and only survived because the skill tips
happened to warn about over-narrowing.

### Definition of done
A zero-hit EPO search mirrors the USPTO leg: exit 0 + an empty `results: []` contract on the CLI,
a non-error empty result over MCP, and a short broaden hint. Translate OPS `EntityNotFound` at
the backend facade so all surfaces inherit it. Small decision to settle first: exact exit-code /
JSON shape — mirror the USPTO leg exactly for consistency (recommended) unless there's a reason not to.
