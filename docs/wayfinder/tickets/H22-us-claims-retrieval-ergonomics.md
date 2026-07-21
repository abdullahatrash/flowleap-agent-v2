---
id: H22
title: US claims retrieval ergonomics — enrich=claims discoverability + readable claims offload
type: task
status: open
assignee:
blocked-by: []
---

## Question

R1 ("full text of the claims of US10958080B2") was the only acceptance-run-2 loss. The main
window DID deliver the claims verbatim (H18 working) but took a ~30-call detour: it first hit
the bare `grants/{n}` endpoint (bibliographic, no claims), spent ~10 calls parsing the
claims-less payload, consulted `uspto_api_guide`, discovered `?enrich=claims`, then had to run
terminal-python to extract claim text from the large offloaded JSON. Bench found FreePatentsOnline
cleanly. Two fixable rough edges: (1) `enrich=claims` is undiscoverable — the agent doesn't know
US claim full-text needs it; (2) H9's offload hands back the claims as a raw JSON blob requiring
python extraction, not readable claim text.

### What to change (from [H15 run-2 VERDICT](../assets/H15-acceptance-run-2/VERDICT.md) R1)

- **Discoverability**: surface `enrich=claims` where the agent will see it — the
  `get_patent_details` / grants tool description or the patent prompt/skill should state that US
  claim full-text requires `grants/{n}?enrich=claims` (or route "full claims" requests straight to
  a `get_claims`-style facade). Investigate whether the facade `get_claims` already covers US and
  should be preferred over raw `patent_api_request`.
- **Readable offload**: when H9 offloads oversized claims, the offloaded file (or a companion)
  should contain the claim text in readable form, not only a raw JSON the agent must parse with
  terminal-python. Coordinate with [[H9]] (offload shape) and [[H18]] (hand back the readable
  file as the complete answer).

### Not a destination blocker
The map's destination (win-or-tie a clear majority) is already met at 7/8; R1 is the residual
polish. Surfaces: the US-claims retrieval path (tool description + prompt/skill) and the
`patentResponseFormatter` offload (H9). One agent session, likely two small edits.
