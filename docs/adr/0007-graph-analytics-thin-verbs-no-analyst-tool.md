# Graph Analytics reaches agents as thin verbs; the analyst is never an agent tool

The flowleap-backend PATSTAT graph engine ships two consumer tiers: six graph operations
(`resolve`, `patent_view`, `applicant_view`, `neighborhood`, `path`, `explain` — the last three
returning token-budgeted, provenance-tagged text built for LLM consumption) and `/v1/analyst`,
an AI-SDK agent loop over those same six operations that narrates the website analytics page via
SSE. We decided that every agent surface — the flowleap-cli command family + `flowleap-patstat-graph`
skill (first), and the single six-operation `patstat_graph` typed tool in the Patent Agent
(follower) — wraps the six operations 1:1 and **never** wraps `/v1/analyst`. An agent calling the
analyst would be an agent invoking a strictly weaker agent: added latency, a second inference bill
on top of BYOK, and surrendered synthesis control, while the caller can reach the identical data
through the verbs directly. The analyst exists for the website, where there is no agent.

## Considered Options

- **Wrap `/v1/analyst` as a tool** — rejected for the nested-agent cost above; also couples agent
  deliverables to the analyst's memo shape, which is hard to unwind once skills depend on it.
- **Expose analyst reports read-only** (`GET /v1/analyst/report/:id`) — deferred; marginal value
  until a workflow actually needs to cite a website-authored memo.

## Consequences

- CLI and IDE stay in parity on what "Graph Analytics" means (all six operations, thin relay of
  backend `text`/envelopes, same three-way Topic/Portfolio/Graph routing rule as `CONTEXT.md`).
- Routing among the three analytics engines is taught by criteria shape (free text → Topic;
  structured aggregate → Portfolio; named node + relationships → Graph), not by endpoint lists.
