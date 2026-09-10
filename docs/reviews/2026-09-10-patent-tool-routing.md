# Patent tool routing: integration changes and validation

The agent remains a patent intelligence agent with coding capabilities. This change preserves provider coding mechanics and tools, while making the domain role and the route for stored patent evidence survive prompt assembly and large-result offloading. It does not prove a model's scientific or claim-scope judgments.

## Confirmed integration failures

- The captured large `get_patent_details` response contained local evidence instructions, but the actual model-facing result was replaced by a generic `read_file` pointer. A regression through `AgentPrompt → ChatToolCalls → ToolResult` reproduced loss of both publication identity and local evidence navigation before the fix.
- Native evidence pages have an 8,000-character body budget plus headers and continuation instructions. They can cross the generic 8KB offload threshold, sending an already bounded page back through another offload. These native local pages now remain inline.
- `OmitBaseAgentInstructions` removed the patent domain block along with the optional provider coding prompt. The domain block is now independent of that switch and precedes the provider capabilities.
- `patent_api_request`, `search_citations` and `search_forward_citations` did not activate the patent identity when individually available. Focused red tests reproduced all three omissions; detection now includes them.
- Local evidence indexes omitted publication metadata already stored by detail retrieval. A live sample correctly sought a file fallback to recover the publication date. The native index now includes the recorded publication number, date and title without a backend call. Missing metadata is explicitly marked as unrecorded.

## Implementation

The main identity and provider reminders are scoped centrally when patent tools are available. Explicit coding requests and code for concrete gaps in tool capabilities remain permitted. Provider-specific coding implementations are retained. A gated or failed tool does not authorize bypassing access controls or evidence validation.

The offload boundary uses the original detail invocation to preserve a validated, kind-bearing publication identity and a local index/query/anchor route. It retains the complete offloaded text and a file-delivery route for explicit verbatim/full-text requests. If the invocation cannot supply a valid identity, the existing generic file route remains. No source identity is guessed from retrieved prose.

Large search results retain a bounded preview ending at a complete line, an explicit partial-results qualification, and the complete file path. This does not invent a local search index: reading more returned candidates with the file tool remains appropriate when needed. Results are still data, and previews do not establish claim scope or exhaustive coverage.

Existing structured report validation, exact quotations, evidence receipts and the completion guard remain in place. The source-review instructions explicitly distinguish the dependent-claim range, a qualified “essentially free” limitation, and actual photoinitiator evidence from a claim's broader “polymerization initiator” language. They permit a bounded review to conclude with qualified unresolved gaps rather than requiring uncertainty to disappear.

## Provider coverage

The new assembly matrix resolves and renders the real registered provider class and reminders for:

- Default/unknown families and common provider-prefixed identifiers.
- OpenAI default, GPT-5, 5.1, 5.2, 5.3 Codex, 5.4 and 5.5 variants, including Codex/mini branches.
- Anthropic Haiku, Sonnet and Opus variants, including the older user-message instruction path.
- Gemini 2.0, 3.5 and 3.8 Flash; xAI Grok; MiniMax; Zai/GLM; VSC A–D.
- Hidden H/M resolver paths: only the private-name matching predicate is forced; the registered provider class and assembly are real.

Resolver snapshots record the selected class rather than assuming a vendor prefix selects that vendor's prompt. Some prefixed identifiers currently resolve to the default provider prompt; they still receive the shared patent contract.

The matrix includes explicit coding and uncovered local-analysis requests. These assertions establish prompt assembly and capability availability, not a live model's choices.

The native conversion regression runs the actual `convertToApiChatMessage` followed by Gemini and Anthropic conversion on assembled messages for Gemini, the Google-prefixed fallback, Anthropic and OpenAI families. Every assembled System text block survives in these cases. Gemini's general converter overwrites earlier System entries if separately supplied multiple System messages; that was not reproduced in these assembled main-family paths. OpenRouter live samples are not native-Gemini wire validation.

## Evidence fixture and behavior evaluation

`patentToolRouting.json` retains the public claims and description of EP0983762A1 from the captured 2026-09-10 detail result. It excludes execution identifiers, application paths, bibliography personal names, user attachments, credentials and private context. The offloaded response and local evidence store use the same source text. It is a retrieval fixture, not an independently verified patent transcription or semantic truth oracle.

The opt-in live evaluation renders the complete `AgentPrompt` on every round, retains actual role/tool-call serialization, uses contributed tool definitions, invokes native local evidence lookup, and runs the real structured writer against an isolated in-memory filesystem. Receipt checks read those files. Shell commands are never executed. The evaluation's round allowance is a cost/time bound; production adds no tool-call cap.

Run from `extensions/copilot` after compilation:

```sh
PATENT_ROUTING_LIVE_EVAL=1 EVAL_MODEL=anthropic/claude-sonnet-4.6 PATENT_ROUTING_EVAL_OUTPUT=/private/tmp/patent-routing-report.md ./node_modules/.bin/vitest run src/extension/prompts/node/agent/test/patentToolRouting.live.spec.ts --no-cache
```

Use `EVAL_API_KEY` or the existing `OPENROUTER_API_KEY`; optionally set `EVAL_BASE_URL` and `EVAL_PROMPT_FAMILY`. No key is printed. Provider inference is metered. The report is saved outside the repository only when `PATENT_ROUTING_EVAL_OUTPUT` is explicitly set.

Earlier exploratory samples are not successful completion evidence: a synthetic fixture was inconsistent across its two data surfaces; later captured-source samples used native lookups but hit the evaluation allowance or sought missing publication metadata. These observations motivated the native-index metadata regression. Absence of a shell call alone does not establish timely completion or source fidelity.

## Validation record

- `npm run gulp compile-extensions`: passed. The worktree uses existing dependency trees; initial missing nested dependency links were resolved without modifying the owner's checkout.
- `extensions/copilot/node_modules/.bin/tsgo --noEmit --project tsconfig.json` from the extension: passed.
- Focused prompt/tool-result, lookup, writer and completion tests: final result recorded in the commit handoff.
- Existing `agentPrompt.spec.tsx`: the exact base production source and the changed source both report the same 165 snapshot failures and 15 passes. The old snapshots contain stale patent instructions and whitespace differences. They were not blindly refreshed. New focused snapshots cover this change.

The real attached-IDF end-to-end rehearsal has not been rerun, and the owner's app has not been launched or restarted. No deployment, merge or external message is part of this change. Live sample results and remaining semantic limits are recorded in the handoff; do not present mechanical receipt validation as semantic proof.
