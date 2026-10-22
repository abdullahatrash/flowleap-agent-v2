# Patent data connectors are one shared library with two hosts, and the self-hosted harness runs them with the firm's own keys

**Status:** proposed (2026-10-22)

Every patent lookup today passes through `api.flowleap.co`. The backend owns the office clients in
TypeScript (`src/lib/ops`, 6,181 lines with OAuth, throttling, XML decoding, register and family
extraction; `src/lib/uspto-odp`, 1,332 lines; `academic-search` over OpenAlex and Semantic Scholar),
the IDE's typed tools call it over HTTP, the Rust CLI carries its own copies of the clients, and the
new browser harness (a fork of DeepSeek Harness at `~/flowleap/deepseek-harness`, slices S1 and S2
done on 2026-10-21) reaches it through the CLI's MCP server: 54 tools, about 157K tokens per turn.
On 2026-10-22 the founder set the direction for that harness: a **self-hosted** product that a patent
firm runs on its own laptops or server, installed and configured by FlowLeap with 15 days of initial
support and a monthly retainer; the firm brings its own office keys and its own Mistral key for OCR;
FlowLeap provides no OCR for it; PATSTAT stays a paid FlowLeap service; the product is white-labelled
with FlowLeap as the default brand; the focus is patent workflows (PDFs, deliverables, the firm's own
tools), not chat. This ADR decides how the data path is built so that direction holds without a
second Patent Agent. White label, installers and the firm-tools recipes get their own records.

## The decisions

1. **One connector library, two hosts.** The office clients leave the backend's `src/lib` and become
   one TypeScript package (working name `@flowleap/connectors`, published from the backend repo) with
   a small host interface: `fetch`, credential lookup, an optional cache, a logger and a clock.
   Host one is the backend, which keeps serving the hosted MCP server, the IDE's typed tools and the
   CLI's users unchanged. Host two is a plugin in the harness that runs the same code in the user's
   process with the firm's keys. The package carries each tool's schema and result text, which ADR
   0018 decision 2 already made the owner of data knowledge, so the knowledge moves with the code.
   Rejected: a rewrite inside the harness (a third implementation beside the backend and the Rust
   CLI, and the CLI already shows what two copies cost); building on "official clients" (EPO OPS,
   USPTO ODP, Semantic Scholar and OpenAlex publish REST APIs and no official SDK; the community
   wrappers are thin HTTP, and the value is the shaping layer: OPS token refresh, the throttle driven
   by `X-Throttling-Control` from the September 2026 incident, XML to JSON with priority rules,
   publication-number normalisation, legal-status decoding, register hints; a wrapper may sit under
   the library where it is good, the shaping layer is ours either way).
2. **The connectors and their keys.** EPO OPS (consumer key and secret), USPTO ODP (API key),
   academic literature (Semantic Scholar key; OpenAlex needs none), OCR (the user's Mistral key),
   and DPMA when its API is covered. The harness never sends a firm's key to FlowLeap. Keys live in
   the harness credential store (write-only, like model keys), entered on one settings card per
   connector and in the first-run wizard, each with a test call that shows green or red. Rejected:
   keys forwarded to the backend for harness users (the backend is then in the data path, which is
   the thing a self-hosted firm pays to avoid); keys in configuration files or prompts.
3. **The paid boundary stays behind the backend and the FlowLeap token.** PATSTAT (the database and
   the graph verbs), US full text from BigQuery, enriched citations and the examiner baseline,
   patent images, and the hosted MCP server itself. The harness reaches them through its MCP row
   narrowed to that set. This is the subscription a self-hosted firm pays beside the install fee and
   the retainer, and it matches ADR 0005 (free app, bring-your-own patent-data keys) and the Pro
   ecosystem decision. Rejected: shipping PATSTAT or Google credentials to firms; providing OCR as a
   FlowLeap service in the harness (the founder's call: the Mistral key is the firm's).
4. **Quota, throttling and cache are per key and live in the library.** The OPS throttle control and
   the retry rules ship inside the connector so every host behaves the same under office
   backpressure; a firm's own OPS quota is its own, which is an improvement, not a loss. The harness
   host gets a per-user disk cache, optional and off by default; there is no shared cache across
   users and no central limiter. Rejected: a central rate limiter for self-hosted users (it would put
   FlowLeap back in the path).
5. **Tool names do not change.** The in-app connector tools keep the backend tool names
   (`search_patents`, `get_claims`, `get_legal_status`, and so on) and the paid tools keep their MCP
   names (`mcp__flowleap__patstat_query`, and so on). The prompt export (agent-v2 #847, #849) and the
   skill pack therefore keep working; the export's included-tool map is updated once. Rejected:
   renaming tools per host (every skill and the prompt would fork by host).
6. **Contract tests travel with the library.** The backend's recorded fixtures under
   `src/lib/ops/__fixtures__` and the ODP fixtures become the package's tests and run in both hosts'
   CI. The Rust CLI is not a host of this library; whether it converges on the same contract tests
   is a later decision, measured, not assumed.
7. **Every step is one PR behind the full bar** (ADR 0018 decision 7): the backend's tests stay
   green while it consumes the package, the harness live run passes with firm keys only, and tokens
   per task are reported next to pass counts. Rejected: a long-lived branch that swaps the backend's
   internals in one merge.

## Consequences

- The backend becomes thinner: a host of the library plus the paid services, identity and billing.
  Its public contract (the `/v1/tools` facade and the MCP server) does not change.
- The harness gains a `connectors` plugin, settings cards, a first-run wizard and a doctor command,
  because a firm admin who is not FlowLeap must be able to install it, check it and send a log bundle
  during the 15 days and the retainer.
- The harness's MCP row shrinks from 54 tools to the paid set, which is most of the way to ADR 0018
  decision 4 (at most 30 tools) without a backend profile parameter.
- Data residency becomes a true statement: office queries go from the firm's machine to the office;
  only paid lookups reach FlowLeap, and that is written on the data-handling page.
- Two hosts means two release trains that must pin the same library version; the drift gate is a
  version check in both repos, the same pattern as the bundled CLI skills.
- The IDE keeps its typed tools over HTTP for now. Running the library in the IDE's extension host
  is possible and is not decided here.

## The map

| Surface item | Today (2026-10-22) | Target | Step |
|---|---|---|---|
| Office clients | `flowleap-backend/src/lib/{ops,uspto-odp}`, `academic-search` | `@flowleap/connectors` with a host interface; backend consumes it, tests green | C1 |
| Harness data path | MCP row to the backend, 54 tools | `dsh-flowleap-connectors` plugin with the office tools under their backend names, firm keys | C2 |
| OCR | backend service | Mistral OCR connector on the firm's key; FlowLeap provides none | C3 |
| Paid tools | mixed into the 54 | MCP row narrowed to PATSTAT, US full text, citations, examiner baseline, images | C4 |
| Keys | model keys only | settings card per connector, first-run wizard, test call, doctor command, log bundle | C2, C5 |
| Prompt export | 15 MCP-twin tools | included-tool map covers the native connector names; gaps stay empty | C6 |
| Rust CLI clients | separate copies | unchanged; convergence decided later against the contract tests | later ADR |
| White label, installers, firm-tool recipes | not started | own ADRs | separate |
