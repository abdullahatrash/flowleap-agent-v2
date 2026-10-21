# Patent law is read from the official page, and the legal reference search retires on every transport

**Status:** accepted (2026-10-20)

FlowLeap keeps a copy of patent law. A scrape pipeline (`scripts/legal-ingest`) reads the MPEP,
the EPC and the EPO Guidelines, chunks them, embeds each chunk with a gte-small model and stores
them in two Postgres tables behind the pgvector extension. The backend answers
`reference_search` (hybrid vector plus full-text search, reciprocal rank fusion) and
`get_legal_jurisdictions` (the filter list). The API process loads the ONNX model at start so it
can embed each query. The Patent Agent chat calls this through `search_legal` and a second tool,
`legal_search_guide`, that explains the first one. Nine bundled skills, six system-prompt lines
and seven eval cases point at it. The CLI has a `legal` command and the plugins name both tools.

The founder asked whether this is complexity FlowLeap needs (2026-10-20). The harness direction
decided for search (`skills-are-methods`, harness step 1) is that the agent is strong on its own
and the data knowledge rides the tool that owns it. For patent law the owner is not FlowLeap. The
official text is one public page per section, with a stable URL, written by the office and
updated by the office. A copy drifts from it from the day it is scraped, the scrape covers what
the pipeline reached, and a quote from the copy is a quote from FlowLeap, not from the office.
ADR 0013 already took this line for UPC guidance: public law from its public source. We decide
to take it for all patent law, and to retire the copy.

## The decisions

1. **Patent law is read from the official page at the moment of the question.** The agent
   fetches the MPEP section, the EPO Guidelines part, the EPC article or the PCT rule from the
   office's own site with `fetch_webpage`, quotes it, and cites the URL and the edition date the
   page shows. The `legal-research` skill becomes the method: which source answers which kind of
   question, how to name a section, how to quote, and when to say the page did not answer. The
   URL patterns of the offices are a reference file of that skill, not tool code. Rejected:
   keeping the copy and refreshing it more often (the drift is the design, not the schedule);
   adding a web-search tool now (a new dependency and key; the sections the agent needs have
   stable URLs, so fetch is enough until the gate in decision 5 says otherwise).
2. **The retirement is a facade retirement, on every transport.** `reference_search` and
   `get_legal_jurisdictions` join `RETIRED_TOOL_NAMES` in `tool-envelopes.ts` and answer
   `410 endpoint_gone` with a notice that names the official sources. The tools facade, the
   hosted MCP server and the CLI's `tools run` get that answer from one place. The docs catalog
   takes the MAJOR bump its own rule requires when a tool is removed. Rejected: deleting the
   tool names and letting stale clients see `unknown tool` (ADR 0014 made the loud 410 the
   contract for exactly this).
3. **Every client stops calling before the backend stops answering.** The app retires
   `search_legal` and `legal_search_guide`, rewrites the prompt lines and the nine skills to the
   fetch method, and re-points its seven eval cases. The CLI drops the `legal` command. The
   plugins drop the two names from `flowleap-legal`, `flowleap-shared` and `flowleap-tools`. The
   410 lands only after the app release that no longer calls is out, so no shipped version of
   the app ever sees it. Rejected: retiring the backend first and letting the app's tool show the
   410 text to attorneys.
4. **Code and data go one release after the 410.** `src/lib/legal-search`, `src/db/legal-schema.ts`,
   `scripts/legal-ingest`, the `@huggingface/transformers` dependency, the two tables and the
   `vector` extension (used by nothing else) go in one backend PR with a drizzle migration that
   drops `legal_chunks` and `legal_documents`. A database dump of the two tables is taken before
   the migration runs in production and kept with the release notes, because the scrape pipeline
   that could rebuild them goes in the same PR. Rejected: deleting code and tables in the same
   release as the 410 (one release of 410-only answers is the window in which a missed caller
   shows up in the logs).
5. **The eval gate decides whether fetch is enough, and a real-fetch check decides whether the
   pages answer.** The seven cases in `anti-hallucination`, `source-attribution`, `frontier` and
   `tool-selection` are re-pointed to the fetch path and must pass; they read one model turn, so
   they prove the model chooses an official page, not what the page returns. A trajectory case
   with a scripted fetch of a real section proves the answer quotes the fetched text. Whether the
   office's page returns quotable text over the app's fetch path is proven by a scripted
   real-fetch check kept as an artifact (one MPEP section, one statute section, one rule, one
   EPC article, one Guidelines part, one PCT rule, each with a known phrase of that section) and
   by the founder's laptop run; step 4 needs both. If the gate fails on fetch, the next step is a
   web-search tool, measured the same way, not the return of the copy.

## Consequences

- The API process no longer loads a model at start. The backend loses pgvector, so the local
  development database becomes the plain Postgres image and the dev compose work gets simpler.
- The Patent Agent loses two chat tools and six prompt lines; the tool surface shrinks for every
  attorney, which is the direction of the harness work. Nothing offline is lost: the copy needed
  the backend, which needed the network, as the fetch does.
- A law question now costs one page fetch per section instead of one backend call. The page is
  the office's, so the quote carries the office's authority, and the edition date is visible.
- `docs/LEGAL_RAG_SYSTEM.md` goes with the code. `docs/ACCESS.md` drops the pgvector note.
- The CLI loses one command and the plugins lose two tool names; both follow the usual sync.
- Claude.ai users of the hosted MCP server have no client release. At step 3 the two tools
  leave the MCP catalog (a retired name is not listed; it answers 410 only when a stale client
  calls it by name) and the 410 notice is their whole migration, so it names the official pages
  and says that the connected assistant's own web tools read them. This needs a new retirement
  notice; `CLIENT_SIDE_RETIREMENT` says "runs on the client's model", which is not this case.
- The public README of `flowleap-ai/flowleap-mcp` is the catalog those users read before they
  connect. It changes in the same release as the catalog, never before.

## The migration

| Step | Repo | Change | Gate | Rollback |
|---|---|---|---|---|
| 1 | flowleap-agent-v2 | retire the two chat tools, prompt lines, nine skills, seven eval cases re-pointed; `legal-research` becomes the fetch method with a URL reference file | main suite, trajectory repeat gate, full-stack laptop run, release | revert the app release |
| 2 | flowleap-cli, flowleap-plugins | drop the `legal` command and the two tool names; sync | CI, release | revert |
| 3 | flowleap-backend, flowleap-mcp | the two names join `RETIRED_TOOL_NAMES` with a new retirement notice naming the official pages; the MCP catalog drops them; docs catalog MAJOR bump with a changelog line; the public README of `flowleap-ai/flowleap-mcp` loses its "Patent-law reference search" section and its tool count goes from 51 to 49, in the same release | tools-facade and retired-tool tests; logs watched one release for 410 hits | remove the two names from the set |
| 4 | flowleap-backend | delete lib, schema, ingest scripts, dependency, docs; migration drops the two tables and the extension; dump taken first | vitest, eslint, deploy with the dump in hand | restore from the dump and revert the PR; the point of no return without the dump |

Step 3 ships only after the app release of step 1 is out. Step 4 ships only after step 3 ran
one release with no 410 hit in the logs. Each step is a draft PR in its own worktree and the
founder merges it after the laptop run, as the no-merge-without-full-confidence rule says.
