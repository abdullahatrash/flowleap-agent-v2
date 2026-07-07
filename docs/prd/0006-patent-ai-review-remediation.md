# PRD 0006: Patent AI Review Remediation — Defects, Rich Markdown Output, Cheap Full-Corpus Analytics

## Problem Statement

Patent professionals using FlowLeap Patent AI hit a string of quality problems that undermine trust in an otherwise working research engine:

- The very first screen (getting-started walkthrough) offers three patent buttons that do nothing when clicked.
- OCR of scanned patent PDFs silently fails in production because the OCR bridge points at a localhost development URL by default.
- The patent research subagent plans USPTO, citation, and legal searches but cannot execute them — it can only actually retrieve EPO and academic results.
- Every research result arrives as a wall of plain text: prior-art hits as indented lists, claim comparisons as raw claim dumps, citations as flat text, and raw API responses as up to 50,000 characters of pretty-printed JSON that gets cut mid-structure into invalid JSON.
- The "patent analytics viz" capability produces no visualization and only aggregates a 100-document sample, because the full-corpus BigQuery analytics endpoint was disabled for cost (each query scanned multi-terabyte full-text columns with LIKE, costing dollars per call).
- Transient backend failures are never retried, rate limits are not handled, and the team has zero telemetry on the patent request path — no latency, error-rate, or failure visibility.
- Branding remnants break the product identity: the panel chat participant still says "GitHub Copilot", the sessions welcome dialog uses a generic codicon instead of the FlowLeap logo, and a "Set up Copilot" prompt leaks into the FlowLeap mobile account sheet.
- Patent workflow logic exists in four hand-synced copies (system prompt decision tree, 17 typed skills, custom agent body, CLI/sessions skills) with the CPC lookup table duplicated three times; the custom agent body already drifted (four dead `#tool:` references).

## Solution

Fix all eight confirmed defects, and land the near-term quality themes behind the fewest possible seams:

1. **One new seam — a shared, budget-aware tool-response formatter** that all patent backend tools route through. It owns truncation (structure-aware, never emitting invalid JSON), consistent "truncated — refine your query" notices, and rich **markdown** rendering: sortable-feel result tables for search and citations, an element-by-element claim chart for claim comparison, and table-formatted analytics aggregates. Markdown-first; no webviews in this PRD.
2. **Harden the existing backend-client seam** with retry/backoff for transient failures, 429 handling, and request telemetry (per-tool status, latency, response size) — implemented once, inherited by every tool.
3. **Re-enable full-corpus analytics at near-zero marginal cost**: replace live BigQuery queries with **DuckDB over a Parquet slice** hosted by the existing Node backend. A quarterly ETL exports a slim column set (bibliographic fields, CPC/IPC, harmonized assignee/inventor, citation counts, English title + abstract — no claims/description text) from the Google Patents public dataset. The `/v1/patent-analytics` route is re-mounted on DuckDB, and the agent tool is repointed from the 100-document OPS sample to it.
4. **Deduplicate** the copy-paste tool layer (one base guide tool, one shared error handler, one CitationDoc type, one CPC reference source) and add a cheap validation test that would have caught the drift bugs.
5. **Finish the rebrand** at the touchpoints users actually see: participant names, sessions welcome logo, mobile sheet, walkthrough entries, and patent-voice starter prompts in panel chat.

## User Stories

1. As a new user, I want every button on the getting-started walkthrough to do something useful, so that my first impression is of a working product.
2. As a new user, I want "Search Prior Art…" on the walkthrough to open chat pre-seeded with a prior-art prompt, so that I reach the core value in one click.
3. As a patent attorney, I want OCR of scanned patent PDFs to work out of the box in production, so that I can read old prior art without configuring backend URLs.
4. As a researcher, I want the patent research subagent to actually retrieve USPTO results, citations, legal references, and patent details — not just plan those searches — so that delegated research is complete.
5. As a user of the PatentResearch custom agent, I want every tool link in its instructions to resolve to a real tool, so that the agent can follow its own playbook.
6. As a self-hosting developer, I want the backend URL setting to work from the settings UI (not only an environment variable), so that I can point the product at my own backend.
7. As a mobile user, I want the FlowLeap account sheet to show only FlowLeap content, so that I am not prompted to "Set up Copilot" inside a patent product.
8. As an agent user, I want large raw API responses to stay valid JSON within a token budget, so that the model can always parse what it receives.
9. As an IP analyst, I want prior-art search results rendered as a markdown table (publication number, title, date, assignee, relevance), so that I can scan and compare hits at a glance.
10. As a patent attorney, I want claim comparisons rendered as an element-by-element claim chart, so that I get the artifact I would otherwise build by hand for validity and FTO work.
11. As a patent attorney, I want citation results rendered as a structured table with X/Y/A relevance categories, so that novelty risk is legible.
12. As an analyst, I want forward citations to include cited passages just like backward citations, so that both directions are equally useful.
13. As a startup founder, I want a landscape question answered with full-corpus filing trends and top-assignee breakdowns in clean tables, so that I understand the competitive space, not a 100-document sample.
14. As a FlowLeap operator, I want analytics queries to cost effectively nothing to serve, so that the feature can stay enabled.
15. As a FlowLeap operator, I want a repeatable quarterly refresh job for the analytics dataset, so that data stays as fresh as the upstream source without manual work.
16. As a user, I want transient backend failures retried automatically, so that a single network blip does not fail my research step.
17. As a user, I want rate-limited requests handled gracefully with a clear message, so that I know to wait rather than assume the product is broken.
18. As a FlowLeap operator, I want telemetry on every patent backend request (tool, status, latency, size), so that I can see failure rates and slow endpoints before users report them.
19. As a user, I want truncated results to say explicitly that they were truncated and how to narrow the query, so that I never mistake a partial answer for a complete one.
20. As a patent attorney, I want saved research results written from a report template (prior-art report, FTO memo, office-action scaffold) and opened automatically, so that the output is a deliverable, not a raw text file.
21. As a user, I want figure page limits enforced as documented, so that requests behave as the tool description promises.
22. As an agent user, I want the analytics tool schema free of deprecated parameters, so that the model never wastes tokens or calls a dead path.
23. As a user, I want search result counts to never read "Found undefined patents", so that summaries are trustworthy.
24. As a user, I want repeated identical queries served from cache, so that iterative research is fast and does not re-bill data providers.
25. As a panel-chat user, I want the chat participant to identify as FlowLeap Patent AI with patent-flavored descriptions, so that the product speaks with one voice.
26. As a sessions-window user, I want the welcome dialog to show the FlowLeap logo, so that the first brand moment is FlowLeap's.
27. As a new panel-chat user, I want patent-voice starter prompts and followups, so that I know what the product can do without reading docs.
28. As a sessions user, I want a template chip for the academic-literature-review recipe, so that all shipped recipes are reachable from the composer.
29. As a maintainer, I want the CPC technology-area reference data in exactly one place, so that classifications cannot drift between prompt, skills, and references.
30. As a maintainer, I want the four API guide tools to share one implementation, so that a fix in one applies to all.
31. As a maintainer, I want a CI test asserting every tool reference in skills and agent bodies resolves against the tool-name registry, so that dead links are caught before shipping.
32. As a maintainer, I want the duplicated per-tool error-handling block extracted into one helper, so that error UX changes in one place.

## Implementation Decisions

- **Single new seam: shared tool-response formatter.** A budget-aware formatting module in the tools layer that every patent backend tool routes its result through. Responsibilities: (a) markdown table rendering for list-shaped results (search, citations, analytics aggregates); (b) claim-chart rendering for claim comparison; (c) structure-aware truncation of JSON (drop whole array items with an explicit omitted-count note; never slice mid-structure); (d) uniform truncation notices with refine-query guidance; (e) per-tool character budgets defined as named constants in one table rather than scattered magic numbers. Existing tools keep their curated text where it already works; they delegate sizing and tables to the formatter.
- **Backend-client hardening happens at the existing client seam only.** Retry with exponential backoff for network errors and 5xx (all patent endpoints are read-only, so POST retries are safe); respect Retry-After on 429 with a typed, user-visible rate-limit message; emit telemetry events (tool/endpoint, status class, latency, response bytes) through the existing telemetry service. No per-tool changes required.
- **OCR bridge config unification.** The PDF preview extension reads the same configuration key and production default as the main backend client (mirrored by hand, per the established guard-mirroring convention for that extension), and derives the OCR path from the same base URL shape. Its logging moves off the console onto the extension logger.
- **Analytics: DuckDB + Parquet in the backend, replacing live BigQuery.** A quarterly ETL job exports a slim slice of the Google Patents public dataset (publication/family identifiers, country, dates, CPC/IPC codes, harmonized assignee and inventor names, citation counts, English title and abstract — explicitly excluding claims and description text) to Parquet in object storage. The backend queries it with an embedded DuckDB instance. The existing structured request contract of the redesigned analytics route (keywords, phrases, assignee, cpc, ipc, country, date range) is preserved; the legacy free-form query parameter is dropped rather than ported. The route is mounted and protected by the same access middleware as other patent routes. The agent tool is repointed from the OPS sample to this route, its deprecated schema parameters removed, and its output rendered as tables by the shared formatter.
- **Subagent allowlist completed** with the executor tools (raw API request, backward/forward citations, legal search, patent details) so every guide tool it may read has its executor available.
- **Custom agent body references fixed** to the registered snake_case tool names, and the body's workflow prose trimmed to defer to the skills rather than restate them.
- **Dedup decisions:** one base API-guide tool parameterized by route/reference sections/deferral banner; one shared patent-tool error handler; one shared citation document type; the CPC technology-area table lives only in the skills reference layer, and the system prompt and skills point to it instead of inlining copies. Hardcoded backend route paths and company-subsidiary lists come out of the system prompt.
- **Branding decisions:** participant full names and descriptions become FlowLeap Patent AI voice; the sessions welcome dialog uses the shipped FlowLeap logo; the mobile account sheet drops the Copilot dashboard and setup prompt; walkthrough entries either gain real commands ("Search Prior Art" opens chat with a seeded prompt) or are removed ("New/Open Patent Project" is removed until a matter concept exists); panel chat gains patent-voice suggested prompts consistent with the sessions composer placeholders; the missing recipe chip is added.
- **Settings declaration:** the backend URL setting is declared in the extension manifest so the settings UI path works; environment variable override keeps precedence.
- **Caching:** the client seam gains a small in-memory TTL cache keyed by endpoint + request body for identical repeated reads within a session; the backend's cached flag is surfaced in telemetry.
- **Validation test:** a unit test cross-checks every tool token referenced in bundled skill bodies and generated agent bodies against the tool-name registry, and asserts figure page limits and analytics schema stay consistent between manifest schema and implementation.

## Testing Decisions

- Test external behavior at the highest seam: invoke tools with a stubbed backend client and assert on the final formatted string/result parts, not on internal helpers. Prior art: the existing tool specs alongside the tools and the curl-conversion helper spec.
- The shared formatter gets focused unit tests (table rendering, structure-aware JSON truncation, budget enforcement, truncation notices) using snapshot-style single deep-equality assertions per repo convention.
- Retry/429/telemetry behavior is tested at the client seam with a fake fetcher (timeout, transient failure then success, Retry-After); no live backend in tests.
- Backend analytics route is tested against a small fixture Parquet file: contract tests on the structured request/response shape, plus one ETL-schema test asserting the slim column set.
- The tool-reference validation test runs in the normal unit suite so drift fails CI.
- When running vitest in the shared working tree, use bare substring filters and never rewrite sibling snapshots (established hazard).

## Out of Scope

- Patent matter/case/project workspace, saved searches, and report-export pipeline (future PRD; the walkthrough's project buttons are removed, not implemented).
- Webview renderers: interactive claim-chart viewer, citation graph, chart images. This PRD is markdown-only output.
- Persona picker UI and any new attorney-grade skills (patent family/INPADOC, term/PTA/PTE expiry, chain-of-title, SEP/FRAND, design patents, PCT docketing, examiner analytics).
- Eval harness and model-trace observability rework (parked #26/#27).
- Dedicated CN/JP/KR jurisdiction path beyond the existing web-search fallback.
- Unifying the two skill libraries (typed-tool vs CLI) into one source — only the CPC reference data is deduplicated here.
- Any change to auth flows, BYOK model management, or the trial/subscription gating (ADR 0002/0003/0008 behavior unchanged).

## Further Notes

- Cross-repo: the analytics ETL, DuckDB integration, and route re-mount live in `flowleap-backend`; everything else is in `flowleap-agent-v2`. Slice backend work into separate issues so agents don't straddle repos.
- Cost rationale for the analytics decision: the disabled implementation scanned multi-TB full-text columns per query (LIKE over abstract/claims/description in the public dataset). The slim Parquet slice removes the text-heavy columns, and DuckDB makes the marginal query cost zero; refresh cadence matches the upstream dataset's quarterly updates.
- The subagent's search behavior and model selection (BYOK, ADR 0004) are unchanged; only its tool allowlist grows.
- Review provenance: four-agent survey of 2026-07-07 (tools, prompt/skills, infra, UX); findings index in the project memory note `patent-ai-full-review-2026-07-07`.
