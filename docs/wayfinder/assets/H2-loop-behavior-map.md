# H2 — Main-window agent loop vs Claude Code harness: behavior map

> Asset for ticket [Map the main-window agent loop vs the Claude Code loop](../tickets/H2-loop-behavior-map.md)
> (map 0002, harness-gap parity). Researched 2026-07-17 by four parallel codebase sweeps;
> every claim carries a file:line reference into this tree. Feeds
> [Root-cause attribution](../tickets/H3-root-cause-attribution.md).

## Headline

**The loop skeleton is NOT the divergence.** Both loops are mechanically persistent: tool
errors are returned to the model as tool results (neither side aborts the turn), and the
main window allows 200 tool-call rounds by default before pausing (the Claude harness is
unbounded, but real tasks never approach 200). The mechanical divergences that plausibly
explain give-up-early / die-on-error live in **three other layers**:

1. **What failure text the model reads** — the two flagship search tools return dead-end
   empty-result strings; generic backend errors carry no recovery hint; several field
   clips are silent.
2. **What the prompt/skills say about failure** — the patent overlay has *no* rule for
   zero results or search errors, and endorses stop-and-disclose as readily as retry. The
   Claude harness runs the `claude_code` system-prompt preset plus *different* skills (the
   bundled patent skills are deliberately excluded from Claude sessions).
3. **Transient model-request failures** — in the main window a non-success model fetch
   ends the turn (auto-retry exists only in autopilot modes); the Claude CLI retries API
   errors internally. This is the strongest "die-on-error" candidate.

---

## Side-by-side

| Axis | Main window (typed-tools agent) | Agents window (Claude Code harness) |
|---|---|---|
| Loop location | `ToolCallingLoop._runLoop`, extension-side (`extensions/copilot/src/extension/intents/node/toolCallingLoop.ts:1123-1290`); core VS Code imposes no loop policy | Vendored `@anthropic-ai/claude-agent-sdk` v0.2.112 CLI; fork drives it via `extensions/copilot/src/extension/chatSessions/claude/` |
| Continuation rule | Iterate again iff model emitted ≥1 tool call AND fetch succeeded (`toolCallingLoop.ts:1182`); tools execute lazily during *next* round's prompt render | CLI's internal agentic loop; runs until the model naturally stops, abort, or budget/rate limit |
| Turn/iteration cap | `chat.agent.maxRequests`, default **200** (`extension/intents/common/agentConfig.ts:9-13`); at limit → "Continue to iterate?" confirmation card, ×1.5 on accept (`toolCallingLoop.ts:1136-1147, 1376-1405`) | **None** — fork never sets `maxTurns`/`maxBudgetUsd`/`taskBudget` (options literal `claudeCodeAgent.ts:509-572`); SDK passes `undefined` through |
| Thrown tool error | Caught in prompt render; model receives `ERROR while calling tool: ${err.message}\nPlease check your input and try again.` (`prompts/node/panel/toolCalling.tsx:655-662, :218`); turn continues | `is_error: true` tool_result block returned to the model; loop persists. Fork only annotates UI/telemetry (`common/claudeMessageDispatch.ts:361-423`) |
| Patent-tool error (typical) | Tools catch everything → `handlePatentToolError` returns a `LanguageModelToolResult`, never re-throws (`tools/vscode-node/patentToolError.ts:25-46`). Typed 401/402/keys/429 errors carry actionable recovery hints; **generic backend errors and plain exceptions don't** (see below) | Same contract (is_error result); error text is whatever the CLI tool produced, passed verbatim |
| Transient model-fetch error | Ends the turn unless autopilot/auto-approve (auto-retry max 3, 1s backoff, `toolCallingLoop.ts:386, 682-699, 1189-1199`); user sees an error result (`defaultIntentRequestHandler.ts:485-580`) | CLI retries retryable API errors internally with backoff (`SDKAPIRetryMessage`, sdk.d.ts:2020-2033); fork ignores/TODOs the event (`claudeMessageDispatch.ts:108-109`) |
| Tool-result truncation | Multi-layer: structure-aware JSON budget with iteration-inviting marker; disk-offload >8KB → "use read_file at <path>" (`toolCalling.tsx:930-969`); middle-out clip at ~50% context with marker (`agentPrompt.tsx:92,150`; `toolCalling.tsx:983-990`); **but several silent inline clips** (see below) | No fork-side output caps on model I/O (only OTel attribute truncation); CLI manages its own context |
| Failure guidance in prompt | Count-driven refinement only (">10,000 → narrow, <10 → synonyms", `patentAIPrompt.tsx:550-553`); no zero-result or search-error rule; one 404-on-lookup fallback rule (`:249`); persistence language only via generic base line (`defaultAgentInstructions.tsx:126`) | `claude_code` system-prompt preset (`claudeCodeAgent.ts:558-561`) with Claude Code's native agentic/persistence framing |
| Skills | 25 bundled skills, breadth-first search recipes, **zero** empty/error branches (grep "no results\|zero\|empty" over all SKILL.md = 0 hits) | Different set: bundled patent skills **deliberately excluded** (`node/claudeSkills.ts:64-75` — they reference panel-only typed tool names); Claude sessions get CLI/plugin-dir skills via `IClaudePluginService.getPluginLocations` → SDK local plugins (`claudeCodeAgent.ts:491-504`) |
| Cancellation | Token checked each round + mid-round (`toolCallingLoop.ts:855-860, 1184-1186, 1508-1510`) | AbortController per session (`claudeCodeAgent.ts:147, :515`); resume-miss auto-recovers once (`:49, :563-570, :769-776`) |
| Auth/model path | BYOK via `PatentAIEndpointProvider` | Direct Claude credential chain — fork deliberately does *not* set `ANTHROPIC_BASE_URL`/`AUTH_TOKEN` (`claudeCodeAgent.ts:531-534`) |

---

## Layer detail

### 1. The main-window loop (persistent by design)

Architectural key: tools are **not** invoked inside the loop — the loop collects tool
calls from the stream and the tools actually execute during the *next* iteration's
prompt-tsx render (`toolCalling.tsx:271-350`). A tool exception therefore physically
cannot abort the loop; it becomes result text (`toolCallErrorToResult`,
`toolCalling.tsx:655-662`). Only a **cancellation** result stops the loop
(`toolCallingLoop.ts:2044-2046 → 1262-1265`).

Stop conditions, exhaustively (`_runLoop`):
- Model returns no tool calls → normal completion (`:1182`).
- Fetch not `Success` → break after optional autopilot-only retry (`:1182, 1189-1199`).
- Cancellation / VS Code graceful-yield (`:1184-1186, 1151-1155`).
- Tool-call limit (200 default) → confirmation card, `maxToolCallsExceeded` metadata
  (`:1136-1147`). Autopilot below the cap silently raises ×1.5 up to 200.
- Empty prompt (`EmptyPromptError`, `:1560`) → swallowed into `{}`
  (`defaultIntentRequestHandler.ts:179-180`).
- Empty model response → "The model unexpectedly did not return a response."
  (`defaultIntentRequestHandler.ts:436-444`).

Autopilot-only early-stop hazards (relevant only when autopilot modes are in play):
- Advanced-autopilot goal classifier — a *small* utility model judges "satisfied?" and
  its `IMPOSSIBLE`/false-`YES` stops the loop (`toolCallingLoop.ts:483-596, 494-501`).
- Text-only response treated as done, no nudge (`:441-444`).
- Nudge caps `MAX_AUTOPILOT_ITERATIONS=3` / `MAX_AUTOPILOT_RETRIES=3` (`:386-387`) and
  the "prior nudge produced no tool calls → stop" rule (`:1455-1458, 1515-1518`).

Full history including all prior tool results is re-sent every round
(`createPromptContext`, `toolCallingLoop.ts:258-303`); trimming happens only in prompt
rendering (summarized-history metadata `:1472-1497`, per-result truncation).

### 2. Tool error surfaces (what the model reads)

The client seam (`patentai/vscode-node/patentBackendClient.ts`) maps HTTP → typed errors
(`_throwForErrorResponse` `:470-523`): `AuthRequiredError` (401), `SubscriptionRequiredError`
(402), `DataKeyInvalidError` / `DataKeysRequiredError` (400 variants), `RateLimitError`
(429 after inline Retry-After retry), generic `PatentBackendError` (raw body truncated to
500 chars). 5xx/network/short-429 are retried up to 2× in the client (`:389-438`).
Notifications (Sign In / Start Free Trial / key setup) fire in the **client**; the
**model-facing** text is assembled in the tool via `patentBackendErrorRecoveryHint`
(`:118-138`) — each typed error yields an actionable "…then retry this tool" sentence,
**but the generic `PatentBackendError` yields an empty hint** (`:137`), so a plain
4xx/5xx reads as a raw truncated backend body with no next step.

`handlePatentToolError` (`patentToolError.ts:25-46`) never re-throws; non-backend
exceptions become bare `Error: ${err.message}` (`:42-45`) — no retry hint.

Empty-result strings, verbatim:

| Tool | Zero-hit string | Reads as |
|---|---|---|
| `search_patents` | `No patents found for query: ${result.query}` (`searchPatentsTool.ts:107`) | **dead end** |
| `search_academic` | `No academic papers found for query: ${result.query}` (`searchAcademicTool.ts:99`) | **dead end** |
| `search_citations` | `No citations found matching the filters.` + pointer to `citation_api_guide` (`searchCitationsTool.ts:155-157`) | invites iteration |
| `search_legal` | `No legal results matched the query.` + pointer to `legal_search_guide` (`searchLegalTool.ts:161-163`) | invites iteration |
| `get_patent_details` | `Patent not found: ${n}` + USPTO-fallback hint (`getPatentDetailsTool.ts:101, :148`) | invites iteration |

### 3. Truncation

Iteration-inviting (marked): structure-aware JSON budgets (`patentResponseFormatter.ts:34-47`;
`patent_api_request` 50k chars etc.) drop whole array items and inject
`{"_truncation": …}` plus "Refine your query — add filters … to retrieve the omitted
items" (`:84-87, :103-126`); citation paging says "Showing first N of M. Re-call with a
larger size" (`searchCitationsTool.ts:188-190`); harness disk-offload replaces >8KB
results with "written to file… use read_file at <path>" (`toolCalling.tsx:930-969`,
threshold `configurationService.ts:709,714`); the final middle-out clip at ~50% of model
context inserts `[Tool response was too long and was truncated.]`
(`agentPrompt.tsx:92,150`; `toolCalling.tsx:983-990`).

**Silent** (unmarked `'...'` clips — the model believes content is complete):
`searchLegalTool.ts` chunk 800 / full_content 2000 / excerpts 400 (`:186, :215, :219,
:246-251`); `searchAcademicTool.ts` abstract 300 (`:129-131`); `truncatePreview`
abstracts/passages 200 (`patentResponseFormatter.ts:188-190`).

### 4. Prompt & skills

The patent overlay (`patentAIPrompt.tsx`) teaches breadth and count-tuned refinement
(2-3 CQL variations `:199`; >10,000/<10 table `:550-553`; synonyms `:555-558`) but:
- **No zero-result rule** — "<10 → too few" never addresses literal zero.
- **No search-error rule** — the only error rule is 404-on-known-number-lookup (`:249`,
  the strongest persistence line in the overlay). Nothing for 401/402/429/5xx/timeout on
  a search.
- **Stop-and-disclose is co-endorsed**: ":578 if not retrieved, say so and offer to
  search"; ":300-301 state that limitation explicitly … instead of guessing" — with no
  rule that reformulation must be exhausted first.
- The only reliable persistence cue is the generic base line: "Don't give up unless you
  are sure the request cannot be fulfilled…" (`defaultAgentInstructions.tsx:126`).
- The jurisdiction gate forces an `vscode_askQuestions` pause before any search
  (`patentAIPrompt.tsx:161-188`).

All 25 bundled skills prescribe up-front breadth (e.g. `prior-art/SKILL.md:35-52` "at
least 3 query variations") with **zero** adaptive failure branches. Tool
`modelDescription`s carry no broaden-on-empty advice (`package.json:1210, :1763`), and
`build_patent_query`'s "Call ONCE per search intent" actively discourages re-planning.
The subagent prompt forces a final `<patent_results>` emission on its last iteration even
when empty (`patentSearchSubagentPrompt.tsx:67-70`).

### 5. Claude harness contrast (facts from tree)

- Fork's SDK options (`claudeCodeAgent.ts:509-572`) set no `maxTurns`/budget; the loop is
  bounded only by natural stop, abort, or CLI-internal budget/rate limits.
- Tool errors are `is_error` result blocks fed back to the model; the fork merely
  annotates telemetry (`claudeMessageDispatch.ts:361-423`). Denials come back as
  `DENY_TOOL_MESSAGE` content, not throws.
- API-level retries happen inside the CLI (`SDKAPIRetryMessage`); the fork currently
  ignores the event (TODO at `claudeMessageDispatch.ts:108-109`).
- Recovery affordances the main window lacks: resume-miss single auto-restart
  (`claudeCodeAgent.ts:769-776`), tools-changed graceful restart (`:752-759`).
- **The skills differ**: bundled patent skills are filtered out of Claude sessions
  because they name panel-only typed tools (`claudeSkills.ts:64-75`); Claude gets the
  CLI/plugin-dir skill pack. The head-to-head is therefore *not* comparing the same
  skill content, only sibling packs.
- Auth: sessions run on the user's Claude credentials, not the BYOK proxy
  (`claudeCodeAgent.ts:531-534`) — a reliability variable independent of the loop.
- Could not confirm in-tree: the CLI's internal retry count/backoff defaults (13.7 MB
  minified bundle); whether a claude.ai rate-limit rejection hard-stops the loop.

---

## Divergence flags for H3 (ranked by likelihood to explain the observed gap)

1. **Transient fetch failure ends the main-window turn** (no auto-retry outside
   autopilot; `toolCallingLoop.ts:682-699`) vs CLI-internal API retry. Prime
   "die-on-error" candidate — check repro transcripts for turns ending on
   `NetworkError/Failed/RateLimited/Length`.
2. **Dead-end empty-result strings on the two flagship search tools**
   (`searchPatentsTool.ts:107`, `searchAcademicTool.ts:99`) + **no zero-result rule in
   prompt or any skill**. Prime "give-up-early" candidate — a zero-hit first query has no
   mechanical or textual nudge toward reformulation.
3. **Generic backend errors carry no recovery hint** (empty hint at
   `patentBackendClient.ts:137`; bare `Error: <msg>` at `patentToolError.ts:44`) — a 500
   or unexpected exception reads as a dead end.
4. **Stop-and-disclose co-endorsed with retry in the prompt** (`patentAIPrompt.tsx:578,
   :300-301`) with only a generic persistence line inherited from the coding base.
5. **Skill-pack mismatch between surfaces** (`claudeSkills.ts:64-75`): the benchmark runs
   different skill content; some of the observed gap may be skill wording, not harness.
6. **Silent field clips** (`searchLegalTool.ts`, `searchAcademicTool.ts`) — model treats
   clipped statutes/abstracts as complete; degrades strategy quality invisibly.
7. **Autopilot-only bail heuristics** (small-model goal classifier, text-only bail,
   nudge caps ≤3) — only relevant if repro runs use autopilot modes.
8. **Subagent forced final emission** even when empty
   (`patentSearchSubagentPrompt.tsx:67-70`).
9. **Jurisdiction-gate pause before first search** (`patentAIPrompt.tsx:161-188`) — a
   stall/hand-back the Claude side doesn't have.
10. **200-round cap** — unlikely to bite (real tasks are ~10s of rounds), but its
    confirmation card would read as a stop if `confirmOnMaxToolIterations` were disabled.

**Not divergent (rule out in H3):** turn-abort-on-tool-error (neither side does it);
core-harness truncation (marked, iteration-inviting on both sides); loop-level history
handling (full re-send both sides).
