# Patent AI Agent Evaluations

Automated behavioral evaluations for the Patent AI agent system prompt using [promptfoo](https://promptfoo.dev).

## What We're Testing

**We test the system prompt, not the model.** The eval suite verifies that `patentAIPrompt.tsx` correctly guides the LLM to:

- Pick the right tool for each query type (9 decision paths A-I)
- Ask for jurisdiction when ambiguous, skip when explicit
- Never hallucinate patent numbers, claims, or legal citations
- Use correct search API syntax (USPTO vs EPO CQL)
- Cite sources when referencing patent data
- Take active behavior (create files, save reports)

The model under test is whatever the provider is configured to call — no backend in
the loop. The eval infrastructure is model-agnostic — same tests work across gemini,
claude, gpt-5, etc. To compare models, pass a different `config.model` to the provider
(see [Multi-Model Comparison](#multi-model-comparison)) or set `EVAL_MODEL` and re-run.

## How It Works

```
┌──────────────┐    ┌────────────────────┐    ┌──────────────────────┐
│  promptfoo   │───>│  patent-ai-provider │───>│  OpenRouter (BYOK)   │
│  (test runner)│    │  (custom provider)  │    │  or any OpenAI-      │
└──────┬───────┘    └────────────────────┘    │  compatible endpoint │
       │                                       └───────────┬──────────┘
       │  Sends per test case:                              │
       │  - system prompt (system-prompt.txt)                │  Routes to the requested
       │  - tool definitions (tool-definitions.json)          │  model (gemini, claude, gpt, etc.)
       │  - user message from dataset                         │
       │  - temperature: 0                                    │
       │                                                       ▼
       ▼                                             ┌──────────────────┐
┌──────────────┐                                     │  LLM Response    │
│  Assertions  │  <──────────────────────────────────│  - text content  │
│  - javascript│                                      │  - tool_calls[]  │
│  - llm-rubric│                                      └──────────────────┘
└──────────────┘
```

1. **Custom provider** (`providers/patent-ai-provider.ts`) loads the static system prompt
   and tool schemas, and sends each test query directly to an OpenAI-compatible chat
   completions endpoint (OpenRouter by default) with `stream: false`, `temperature: 0`,
   and a bring-your-own API key. There is no backend hop — the retired
   `${PATENT_API_URL}/v1/chat/completions` proxy returned 410 Gone and inference moved
   client-side with the BYOK migration.
2. **Provider returns** a JSON string with `{ text, tool_calls }` — promptfoo requires
   `output` to be a string, so assertions call `JSON.parse(output)` to inspect structured
   data.
3. **JavaScript assertions** check tool selection, argument structure, and absence of
   hallucinated data.
4. **LLM-rubric assertions** use an OpenRouter model as a grading LLM to evaluate
   qualitative aspects (reasoning quality, source attribution) — see
   `defaultTest.options.provider` in `promptfooconfig.yaml`.

## Prerequisites

- **The pinned promptfoo** installed once: `npm run eval:setup` (from `extensions/copilot`)
  - Installs `evals/package.json` → `promptfoo` at the exact pinned version. See
    [promptfoo version policy](#promptfoo-version-policy) — never `npm i -g promptfoo`.
  - Needs **Node >= 22.22.0** (promptfoo 0.122.0 dropped Node 20). The repo's `.nvmrc` (24.15.0) satisfies this.
- **An OpenRouter API key** (or any OpenAI-compatible endpoint + key):
  - `OPENROUTER_API_KEY` — used both by the provider (fallback) and by every grader's `{{env.OPENROUTER_API_KEY}}` reference
  - Optionally override with `EVAL_API_KEY` / `EVAL_API_BASE_URL` to point the provider (not the graders) at a different endpoint
- **Tool definitions** generated: `npm run eval:extract-tools`

## Running Evals

```bash
# From project root — regenerates tool-definitions.json, checks for an API key,
# then runs the main suite (evals/scripts/run-evals.sh)
export OPENROUTER_API_KEY=sk-or-...
npm run eval

# Open browser dashboard to view results
npm run eval:view

# From evals/ directory directly — scripts/promptfoo.ts runs the PINNED promptfoo
cd evals
OPENROUTER_API_KEY=sk-or-... npx tsx scripts/promptfoo.ts eval -c promptfooconfig.yaml

# Run a single dataset
OPENROUTER_API_KEY=sk-or-... npx tsx scripts/promptfoo.ts eval -c promptfooconfig.yaml \
  -t datasets/tool-selection.yaml

# Skip cache (re-run all GRADER calls — the providers never cache; see Caching)
OPENROUTER_API_KEY=sk-or-... npx tsx scripts/promptfoo.ts eval -c promptfooconfig.yaml --no-cache

# Run against a specific model (single-model config reads EVAL_MODEL)
EVAL_MODEL=anthropic/claude-sonnet-5 OPENROUTER_API_KEY=sk-or-... npm run eval

# Regenerate tool definitions from package.json
npm run eval:extract-tools

# Check the static system-prompt.txt hasn't drifted from patentAIPrompt.tsx
npm run eval:check-drift

# Compare the last run against the committed pass-rate baseline
npm run eval:check-baseline
```

## promptfoo version policy

**The gate runs one pinned promptfoo version. A global install must never run it.** (#186)

`evals/package.json` pins `promptfoo` to an **exact** version (no `^`, no `~`), with
`evals/package-lock.json` committed beside it. `scripts/promptfoo.ts` resolves
`evals/node_modules/promptfoo` and nothing else: if the pinned install is missing it fails
with the fix instead of falling back to a different version. Every `eval:*` script and
`run-evals.sh` go through that launcher.

- **Install / update your copy:** `npm run eval:setup` (from `extensions/copilot`) — runs `npm ci` in `evals/`.
- **Bump the version:** edit `evals/package.json`, run `npm --prefix evals install`, re-run the
  regression set below, and record the changelog delta in
  [Upstream changelog review](#upstream-changelog-review). Commit `package.json` and
  `package-lock.json` together.
- **Regression set for any bump:** `npm run eval:check-drift` green, `npx vitest run evals` green,
  and one live `npm run eval:key-gate` at 6/6 on `google/gemini-2.5-pro`.

Why `evals/` has its own `package.json` instead of a devDependency on the extension: promptfoo
pulls **710 packages / ~1.6 GB** (Playwright Chromium, onnxruntime, sharp). `extensions/copilot`
is in `build/npm/dirs.ts`, so its dependencies install on **every** CI run and every fork build —
none of which run evals. A separate manifest keeps that weight, and promptfoo's zod 4 requirement
(the extension pins zod 3.25.76), out of the product's dependency tree entirely. `evals/` is not in
any `tsconfig` include and is excluded from the `.vscodeignore` allow-list, so nothing here reaches
a build artifact.

Historical note: this suite previously ran whatever `promptfoo` sat on `PATH` (a global 0.121.18
while upstream was 0.122.0). Gate results were not reproducible across machines. `npm exec --no --
promptfoo` is **not** a sufficient replacement — it still falls back to the global binary when the
local install is absent, which is why the launcher exists.

## Local dashboard (`promptfoo view`)

```bash
npm run eval:view              # from extensions/copilot; opens http://localhost:15500
npm run eval:view -- -n        # start the server, do not open a browser
npm run eval:view -- -p 15600  # different port
```

- **What it reads.** The SQLite store at `~/.promptfoo/promptfoo.db` (relocate with
  `PROMPTFOO_CONFIG_DIR`), which holds **every** eval this machine has run, newest first. It is a
  different dataset from `outputPath`: the JSON under `output/` is a point-in-time dump of one run,
  and it is what `compare-baseline.ts` and any pass-rate post-processing must parse. Ratings and
  comments you add in the dashboard live only in the DB.
- **Default port 15500.** The UI lists runs by description, so a suite's `description:` field is how
  you find it (for example "Patent AI — Key-Gate Doctrine Adherence (#176)").
- **Cache interplay.** `--no-cache` does not change what the dashboard shows; it only forces fresh
  API calls during the run. Because our providers bypass the promptfoo cache entirely (see
  [Caching](#caching)), `--no-cache` on our suites affects the **grader** calls only.
- **Export a run:** `npx tsx scripts/promptfoo.ts export eval latest -o run.json` (or an explicit eval
  id; `--include-media` embeds blobs). Import elsewhere with `promptfoo import <file>`.
- **Share:** `promptfoo share` uploads the run to promptfoo's hosted viewer. **Do not use it** — our
  runs carry the full system prompt and tool surface. Export the JSON and attach it instead.

## Baseline Gate

`output/baseline.json` is the committed, machine-readable pass-rate baseline for the
main suite. **It currently reflects the old backend-routed system (pre-BYOK migration)
and is stale** — the provider, model routing, and tool surface have all changed since
it was recorded. Treat it as a placeholder until the first live BYOK run regenerates it
from green results (see task: "Live eval run: regenerate baseline, gate green").

After any main-suite run, gate against it:

```bash
OPENROUTER_API_KEY=sk-or-... npm run eval    # writes output/latest.json
npm run eval:check-baseline                  # exit 1 if rate dropped > 2pp
```

`scripts/compare-baseline.ts` reads `output/latest.json`, computes the pass rate from
`results.stats` (falling back to per-result `success` flags), and fails when it drops
more than the 0.02 tolerance below `baseline.json`'s `passRate`.

**Re-baselining:** only deliberately, in its own commit, after an INTENTIONAL prompt
change — never to silence a regression. Update `totalTests`/`passing`/`passRate`/`updated`
from a green run.

## Eval Tool Surface (20 patent tools)

`prompts/tool-definitions.json` (generated by `prompts/extract-tools.ts`) mirrors the
tools enabled in production. The 20 patent-specific tools (`PATENT_TOOL_NAMES` in
`extract-tools.ts`, sourced from `src/extension/tools/common/toolNames.ts`) are the 15
tools from the original suite (`build_patent_query`, `build_uspto_query`,
`search_patents`, `patent_api_request`, `search_citations`, `search_forward_citations`,
`ops_api_guide`, `uspto_api_guide`, `citation_api_guide`, `search_legal`,
`legal_search_guide`, `search_academic`, `read_pdf`, `write_patent_results`,
`patent_search_subagent`) plus 5 added since: `get_patent_details`,
`get_patent_figures`, `analyze_claim`, `compare_claims`, `patent_analytics_viz`. On top
of those, the extracted definitions include the two core VS Code tools the prompt
references by name (`create_file`, `fetch_webpage`) and 3 synthetic tools with no
`package.json` contribution (`vscode_askQuestions`, `run_in_terminal`, and Anthropic's
native `web_search`). `extract-tools.ts` exits 1 if any expected patent/core tool name
is missing from `package.json` — the surface cannot silently shrink.

Typed tools are PRIMARY for standard citation/legal lookups per prompt branches F/G and
their `modelDescription`s (plans 008 + 012); the guide tools remain valid for advanced
paths only (statistics, date ranges, custom search modes). The five routing assertions
(`*_typed_first` metrics in `tool-selection.yaml` and `source-attribution.yaml`) require
the typed tool — a guide-first answer on a standard lookup now fails. A global
`no_invented_tool_names` assertion in all three configs fails any test where the model
calls a tool outside `tool-definitions.json`.

## Multi-Model Comparison

Run the same suite across all 9 OpenRouter-routed models simultaneously:

```bash
# Run all models (9 providers × 34 tests = 306 API calls)
OPENROUTER_API_KEY=sk-or-... npm run eval:multi

# View side-by-side comparison in browser
npm run eval:view
```

The dashboard shows a column per model so you can compare tool selection, reasoning quality, and pass rates across:

| Provider | Models |
|---|---|
| Google Gemini | `google/gemini-2.5-flash-lite`, `google/gemini-2.5-flash`, `google/gemini-2.5-pro` |
| Anthropic Claude | `anthropic/claude-haiku-4.5`, `anthropic/claude-sonnet-5`, `anthropic/claude-opus-4.8` |
| OpenAI | `openai/gpt-5-mini`, `openai/gpt-5.4-mini`, `openai/gpt-5.2` |

To test a subset, comment out providers in `promptfooconfig.multi.yaml`.

**Tool-surface divergence:** the synthetic `web_search` tool is, in production, an
Anthropic-native tool injected server-side for Claude models only. The provider
sends one shared tool list, so GPT and Gemini columns see `web_search` even though
they would not have it in production — interpret their `web_search` selections with
that caveat (also noted in `promptfooconfig.multi.yaml`).

**Prerequisites for multi-model:** a single `OPENROUTER_API_KEY` covers all 9 models —
OpenRouter is the routing layer, so there's no need for separate OpenAI/Anthropic/Google
keys.

## Caching

Promptfoo caches API responses by default (14-day TTL at `~/.promptfoo/cache`). This means re-running evals without changes is instant. Use `--no-cache` to force fresh API calls. To clear: `promptfoo cache clear`.

**Our providers are not in that path.** `patent-ai-provider.ts` and `trajectory-provider.ts` call the
endpoint with `fetch` and never use promptfoo's cache API, so the agent's own calls are always live
and `--no-cache` only re-runs the **graders**. See
[Techniques survey](#techniques-survey--what-we-use-and-what-we-do-not).

| Env Variable | Purpose | Default |
|---|---|---|
| `PROMPTFOO_CACHE_ENABLED` | Toggle caching | `true` |
| `PROMPTFOO_CACHE_PATH` | Cache directory | `~/.promptfoo/cache` |
| `PROMPTFOO_CACHE_TTL` | TTL in seconds | 14 days |

## Test Suite (34 cases across 6 datasets — gating)

The main suite is the gate: it must stay green. Suspected-but-unmeasured behaviors live in
the non-gating **Frontier suite** (see [Frontier suite](#frontier-suite-non-gating)), never
in the main config.

### `datasets/tool-selection.yaml` — 12 tests
Decision tree paths A-I, plus a number-lookup case and two gate-exemption cases
(EPC legal lookup, examiner-citation lookup — branches F/G never trigger the jurisdiction gate).
Verifies the agent picks the correct first tool:

| Path | Query Type | Expected Tool |
|---|---|---|
| A | Claim text for prior art | `build_patent_query` or `askQuestions` |
| B | General patent search (EP) | `build_patent_query` |
| C | Own invention/idea | `build_patent_query` or `askQuestions` |
| D | Detailed patent data | `ops_api_guide` |
| E | US patent search | `uspto_api_guide` or `build_uspto_query` |
| F | Office action citations | `search_citations` (typed-first; guide is advanced path) |
| G | Patent law research | `search_legal` (typed-first; guide is advanced path) |
| H | Coding task | NOT any patent search tool |
| I | CN/JP/KR patents | `web_search` or mentions patents.google.com |

### `datasets/jurisdiction-gating.yaml` — 9 tests
Verifies the jurisdiction gate behavior:
- Ambiguous query → must call `askQuestions`
- Company name only → must still ask (don't infer from company)
- Explicit "US patents" → skip ask, use USPTO tools
- Explicit "European patents" → skip ask, use EPO tools
- Explicit "worldwide" → skip ask
- Claim text without jurisdiction → must ask (branch A)
- Own-invention patentability without jurisdiction → must ask (branch D)
- Multiple offices named ("US and European") → skip ask, first tool is a search tool
- "All patent offices" Both-scope synonym → skip ask

### `datasets/anti-hallucination.yaml` — 4 tests
- No patent numbers without a search tool call
- Must search before citing specific patents
- No fabricated MPEP/legal quotes without `legal_search_guide`
- Famous-patent query → search/ask, or no patent-number pattern in text

### `datasets/active-behavior.yaml` — 2 tests
- Agent initiates search when asked for reports
- Agent intends to create files (limited by single-turn eval)

### `datasets/source-attribution.yaml` — 2 tests
- Calls search tools when asked to summarize patents
- Calls `legal_search_guide` or `search_legal` when asked about EPC

### `datasets/search-strategy.yaml` — 5 tests
- USPTO: uses correct tool for US patent searches
- EPO: uses `build_patent_query` with correct CQL concepts
- Date/CPC filtering: uses proper API parameters
- Pharma/EPO: assignee + technical terms reach the query
- Four-constraint query: assignee + topic + date + classification all reach the args

## Frontier suite (non-gating)

`promptfooconfig.frontier.yaml` + `datasets/frontier.yaml` are a **separate, non-gating**
probe set for behaviors we suspect are weak but haven't measured. **Failures here are
findings, not red builds.** The main suite is the build gate; the frontier suite never is.

**Run it:**

```bash
cd evals
OPENROUTER_API_KEY=sk-or-... npx tsx scripts/promptfoo.ts eval -c promptfooconfig.frontier.yaml --no-cache
```

(Always `--no-cache` — frontier probes are meant to be re-checked fresh, not served from cache.)

**Promotion rule:**
- A frontier case that passes **reliably** → promote it into the main suite (the behavior is now guaranteed).
- A frontier case that exposes a **real defect** → file it as a finding/plan and fix the prompt; once fixed and passing, promote it.
- **The main suite never carries known-failing cases.** When a main case starts failing because of a genuine prompt gap (not an assertion bug), demote it to the frontier set with a `# KNOWN GAP (plan NNN): ...` comment until the fix lands.

**Current frontier cases (4):**
1. Number-implies-jurisdiction (`EP1000000` → skip ask, use `ops_api_guide`)
2. Prompt-injection via pasted abstract (embedded SYSTEM NOTE must not be obeyed)
3. Memory-recitation pressure (no famous number recited without a search)
4. Mixed gate + constraint (worldwide claim → skip ask, date reaches either builder's args)

(The two plan-010 demotions — multi-office enumeration and the "all patent offices" synonym —
were promoted back to `jurisdiction-gating.yaml` when plan 010 landed.)

## Key-gate doctrine suite (#176)

`promptfooconfig.key-gate.yaml` + `datasets/key-gate/key-gate-cases.yaml` grade whether the
model **obeys** the key-gate doctrine (spec #173, shipped by #174/#175) — the prompt unit
tests only prove the doctrine text renders.

```bash
cd evals
OPENROUTER_API_KEY=sk-or-... npx tsx scripts/promptfoo.ts eval -c promptfooconfig.key-gate.yaml --no-cache
# or, from extensions/copilot:  npm run eval:key-gate
```

It reuses the trajectory provider (whole agent loop against scripted mock tools) with two
additions:

- **Key-state prompt variants.** The key blocks render from props, so a case about a gated
  office needs the prompt that user would actually get. `prompts/render-system-prompt.tsx`
  writes one snapshot per entry in its `KEY_STATE_VARIANTS` list to
  `prompts/key-state/<id>.txt`; a case picks one with the `systemPromptVariant` var.
  **Re-run `npx tsx evals/prompts/render-system-prompt.tsx` whenever `patentAIPrompt.tsx`
  changes** — it refreshes `system-prompt.txt` and every variant together.
- **A second user turn.** `followUpPrompt` sends a follow-up once the first turn settles (K5:
  "I added the key"). Its rounds carry `turn: 1`, so the resume rule can be graded on
  post-resume work alone.

Gated routes in `fixtures/key-gate/*.json` answer the real `data_keys_required` error text —
the exact string `patentBackendErrorRecoveryHint()` composes — so the model is graded against
what it would actually see. Every case runs the `active-epo-missing` state (active
subscription, EPO OPS key missing, USPTO ODP key live): the strictest single state, because
the forbid rule and the fallbacks it must not suppress are both in play.

| Case | Scenario | Graded on |
|---|---|---|
| K1 | Comprehensive US+EP search, EP gated | No web substitution for EP (arg-level), US office completed, no ask-first stall, gap named as a missing-key gap |
| K2 | Single EP document read, EP gated | No web route at all, refusal names the free key and the keys command, no claim text |
| K3a | **Control** — CN request under the same gate | Web fallback still fires; no key blamed for a CN request |
| K3b | **Control** — dead US routes with a working key | Backend ladder tried first, web fallback still fires, failure not misclassified as a key gate |
| K4 | EP-only novelty request, EP gated | Keyless pivot framed as different data, never as closing the gap; no web substitution |
| K5 | User adds the key mid-conversation | Only the gated office re-run, live office not redone, merged without a restart |

Assertion split follows the trajectory gate: the `javascript` predicates in
`assertions/key-gate-assertions.mjs` are the primary deterministic layer and grade **behavior**
(which office a call went to, whether a web route took the gated office's data, which turn a
call landed in); `llm-rubric` grades only how the agent *characterized* the gap, written
against the doctrine rather than the prompt's wording so paraphrases pass. The structural layer
is proven offline — no model, no judge — by `assertions/test/key-gate-assertions.spec.ts`,
which also red-checks each predicate against the failure it exists to catch.

**Baseline (2026-08-07, `google/gemini-2.5-pro`, `--no-cache`): 6/6 cases, 27/27 assertions.**

## File Structure

```
evals/
├── promptfooconfig.yaml          # Single-model eval config (gating, 34 cases)
├── promptfooconfig.frontier.yaml # Non-gating frontier probe config (4 cases)
├── promptfooconfig.multi.yaml    # Multi-model comparison (all 9 models)
├── promptfooconfig.key-gate.yaml # Key-gate doctrine adherence (6 cases, #176)
├── package.json                  # Pins promptfoo to an EXACT version (see version policy)
├── package-lock.json             # Committed — the pin covers transitive deps too
├── README.md                     # This file
├── providers/
│   ├── patent-ai-provider.ts     # Custom provider → OpenRouter (BYOK, no backend)
│   └── trajectory-provider.ts    # Multi-turn replay loop (trajectory + key-gate suites)
├── assertions/
│   ├── trajectory-assertions.mjs # Structural predicates, trajectory gate
│   └── key-gate-assertions.mjs   # Structural predicates, key-gate suite
├── prompts/
│   ├── system-prompt.txt         # Static render of patentAIPrompt.tsx
│   ├── key-state/                # Per-key-state prompt variants (same render script)
│   ├── tool-definitions.json     # 20 tools in OpenAI function format (generated)
│   └── extract-tools.ts          # Script to regenerate tool-definitions.json (fails on missing names)
├── datasets/
│   ├── tool-selection.yaml       # 12 tests — decision paths A-I + lookups + gate exemptions
│   ├── jurisdiction-gating.yaml  # 9 tests — jurisdiction gate logic
│   ├── anti-hallucination.yaml   # 4 tests — no fabricated data
│   ├── active-behavior.yaml      # 2 tests — file creation intent
│   ├── source-attribution.yaml   # 2 tests — source citing
│   ├── search-strategy.yaml      # 5 tests — API syntax correctness
│   ├── frontier.yaml             # 4 probes — NON-GATING (failures are findings)
│   └── key-gate/                 # 6 cases — key-gate doctrine adherence (K1–K5)
├── scripts/
│   ├── promptfoo.ts             # Launcher — runs the PINNED promptfoo, never a global one
│   ├── run-evals.sh              # Convenience wrapper: checks for an API key, regenerates tools, runs promptfoo
│   ├── check-prompt-drift.ts     # TSX ↔ system-prompt.txt drift checker
│   └── compare-baseline.ts       # Pass-rate baseline gate (npm run eval:check-baseline)
└── output/
    ├── baseline.json             # Committed pass-rate baseline (tracked in git)
    ├── latest.json               # Last main-suite results (git-ignored)
    └── frontier-latest.json      # Last frontier-suite results (git-ignored)
```

## Assertion Types

**`javascript`** — Deterministic checks on tool calls and output structure:
```yaml
- type: javascript
  value: |
    const parsed = JSON.parse(output);
    const firstTool = (parsed.tool_calls || [])[0]?.function?.name;
    return firstTool === 'build_patent_query';
```
- `output` is a string (JSON-stringified `{ text, tool_calls }`)
- Must `JSON.parse(output)` to access structured data
- Return `true`/`false`, a number (score), or `{ pass, score, reason }`
- Use YAML `|` (literal block) for multi-line code with `return` statements

**`llm-rubric`** — Qualitative checks using a grading LLM:
```yaml
- type: llm-rubric
  value: >
    The agent must NOT infer jurisdiction from company names.
```
- Grading LLM configured in `defaultTest.options.provider`
- Currently `openai:chat:google/gemini-2.5-flash` via OpenRouter (`{{env.OPENROUTER_API_KEY}}`), `stream: false`

**De-flake outcome (2026-06-12):** 5 of the 6 llm-rubric assertions were mechanical
(ask-before-search ordering, no-numbers-without-search, at-least-one-tool-call,
legal-tool-called) and were converted to deterministic `javascript` asserts. One
genuinely qualitative rubric survives (`patent_attribution_rubric` in
source-attribution.yaml) — the documented JSON-extraction flakiness of the grading
path now affects at most 1 of 34 cases.

## Upstream changelog review

Reviewed for the 0.121.18 → **0.122.0** pin (#186). Range: 0.121.19, 0.121.20, 0.122.0.
Verdicts are **adopt now**, **defer** (with the issue that owns it), or **not relevant**.

| Upstream change | Version | Relevance here | Verdict |
|---|---|---|---|
| Node 20 dropped, `engines` now `>=22.22.0` | 0.122.0 | The only breaking change in the range. This is why 0.122.0 is a minor bump — it ships no features, only that drop plus security dependency pins (Shai-Hulud npm compromise, undici, js-yaml). | **Adopt now** — `.nvmrc` (24.15.0) already satisfies it; recorded in Prerequisites. |
| Reserved grader vars now win over test vars (`output`, `rubric`, `input`, `completion`, `ideal`, `criteria`) | 0.121.19 | Before this, a test var with one of those names silently replaced the judge's view of the model output. Our datasets define exactly one var, `prompt` — verified by grep across `datasets/`. | **Not relevant** — no name collision. Do not introduce a var with a reserved name. |
| `getDbPath()` throws when a Vitest/Jest process would open the real DB | 0.121.19 | Guards `~/.promptfoo/promptfoo.db` against test runners. Our vitest specs test assertions and providers offline and never start promptfoo. | **Not relevant.** If that ever changes, set `IS_TESTING=true`. |
| `context-faithfulness` counts missing judge verdicts as unsupported (stricter) | 0.121.19 | We do not use `context-faithfulness` yet, but it is the assertion that grades output text against provider-returned context — the shape #185 needs. The strictness change works in that issue's favour. | **Defer to #185.** |
| No new assertion types; the type union is unchanged | whole range | `g-eval` (array of separately scored criteria), `is-json` with a schema, and `context-faithfulness` + `contextTransform` all already existed. They are still the right answers for #185's "grade the TEXT, not the tool trace", but nothing forced a change now. | **Defer to #185.** |
| No repeat aggregation anywhere; `--repeat` expands each case into independent rows | whole range | promptfoo has **no** "pass if k of n" semantic. `assert-set` `threshold` is k-of-n across assertions in one row, not across runs. The nearest native pieces are `PROMPTFOO_PASS_RATE_THRESHOLD` (suite-wide) and `--retry-errors` (ERROR rows only). Also: repeats are cached per repeat index, so `--repeat` without `--no-cache` replays instead of re-sampling. | **Defer to #184** — and note the issue must build the policy itself. No upstream shortcut appeared. |
| Judge JSON-parse failure is a FAIL, not an ERROR — but it is tagged | whole range | A judge that emits unparseable JSON yields `pass:false, score:0` with `metadata.graderError === true` on the component result. That flag is public and readable from the `outputPath` JSON, so #184's "never let grader flake fail a case" is implementable by post-processing. `--retry-errors` will not catch these, because they are not ERROR rows. | **Defer to #184.** |
| Provider errors are still classified by HTTP status only | whole range | The OpenAI-compatible provider errors on non-2xx only. A **200 carrying `finish_reason: "error"`** still yields an empty completion and a plain assertion FAIL, and — because there is no top-level `error` key — it is written to the disk cache and replayed for the 14-day TTL. | **Not relevant as an adoption; keep our fix.** The provider-side throw from #183 (`trajectory-provider.ts`) is not redundant. |
| Native `trajectory:*` assertions (`tool-used`, `tool-sequence`, `tool-args-match`, `step-count`, `goal-success`) | pre-existing | Real tool-trajectory grading exists, but it reads **OTEL spans**, not our returned JSON. Using it means emitting spans from `context.traceparent` and running a collector, and we would still write the agent loop ourselves. | **Not adopted.** Reconsider only if we ever want span-level grading in addition to the JSON string. |
| `simulated-user` provider, redteam multi-turn strategies (`goat`, `crescendo`, `goblin` new in 0.121.19) | 0.121.19 | `simulated-user` drives the **user** side of a conversation; it has no seat for our scripted mock tools. The redteam strategies generate jailbreaks, not capability cases. promptfoo has no "run this agent against these mock tools" provider. | **Not relevant.** Our custom provider stays the right design. |
| Conversation-history isolation and duplicate-provider index fixes | 0.121.20 | Both concern multi-provider or `_conversation` suites. Our gating suites run one provider and never use `_conversation` (multi-turn is internal to our provider). | **Not relevant.** |

**Compatibility verified locally after the bump**, not just read from notes: config schema, the
`ApiProvider` / `ProviderResponse` / `CallApiContextParams` signatures our providers implement, the
assertion context shape, the `outputPath` JSON schema (`results.stats` and per-result `success` —
the two fields `compare-baseline.ts` reads), and the `eval -c` / `--no-cache` / `view` flags are all
unchanged. The 0.122.0 output adds `vars` and `runtimeOptions` top-level keys, which is additive.

## Techniques survey — what we use and what we do not

**What we use.** File-based custom providers (both suites run their own agent loop, which promptfoo
has no primitive for); `javascript` assertions as the primary deterministic layer; `llm-rubric` for
the few genuinely qualitative checks; `defaultTest.options.provider` to pin the judge; `tests:
file://datasets/*.yaml` for case reuse; `outputPath` JSON as the machine-readable record the
baseline gate parses.

**Assertion scoring and weights** — *not used, deliberately*. Every assertion carries an implicit
`weight: 1` and each case is pass/fail on all of them. Weighted combined scores with a test-level
`threshold` would let a case pass while failing a doctrine check, which is the opposite of what a
gate is for. `assert-set` (k-of-n across assertions in one row) has the same problem here.

**Red-teaming and adversarial generation** — *not used*. `promptfoo redteam` is a separate subsystem
for jailbreak and harm-category probing, and its generation step normally calls promptfoo's hosted
service. Our risk is wrong patent work (fabricated claim text, wrong jurisdiction, a suppressed
fallback), not a jailbroken assistant. Adding it would mean a new gate with a different owner, not a
better version of this one.

**Dataset generation** (`promptfoo generate dataset` / `generate assertions`) — *not used*. Cases here
encode specific doctrine from specific issues (#173 key-gate, jurisdiction gating), and each one has
to be traceable to the rule it defends. Synthesised cases would need that review anyway, so they
save nothing. It stays an option for widening coverage once a rule is stable.

**Caching** — *effectively off for the model under test*. Both providers call the endpoint directly
with `fetch` and never touch promptfoo's cache API, so **nothing about the agent's behaviour is ever
cached**; only grader (`llm-rubric`) calls go through the 14-day disk cache at `~/.promptfoo/cache`.
`--no-cache` on our suites therefore re-runs the judges, not the agent. Clear it with `promptfoo
cache clear`. Two consequences worth remembering: an assertion-only edit can be re-graded cheaply,
and a provider response poisoned by an upstream error would be cached if we ever routed the agent
through promptfoo's own provider — an independent reason to keep the loop in our provider.

**Sharing** — *not used*. See [Local dashboard](#local-dashboard-promptfoo-view).

## Updating the System Prompt

When `patentAIPrompt.tsx` changes:
1. Update `prompts/system-prompt.txt` to match the rendered output
2. Run `npm run eval:extract-tools` if tool definitions changed
3. Run `npm run eval` to verify no regressions
4. Check results with `npm run eval:view`

## Comparing Models

Two approaches:

**A) Multi-model config (recommended):**
```bash
OPENROUTER_API_KEY=sk-or-... npm run eval:multi
npm run eval:view
```
Runs all 9 models in one eval. Dashboard shows side-by-side columns.

**B) Single-model sequential:**
```bash
# Run default model
OPENROUTER_API_KEY=sk-or-... npm run eval
# Point at a different model, re-run with --no-cache
EVAL_MODEL=openai/gpt-5.2 OPENROUTER_API_KEY=sk-or-... npm run eval -- --no-cache
```
Results are stored per eval run — compare in the promptfoo dashboard.

---

## Current Status

> **Historical results below predate the BYOK migration.** They were recorded against
> the retired backend-routed provider (`PATENT_API_URL` + `SKIP_AUTH=true` local
> backend), not the current OpenRouter/BYOK provider — model routing, the tool surface,
> and `output/baseline.json` have all changed since. Kept for historical trend context;
> the `PATENT_API_URL` repro commands below no longer work as written (see
> [Running Evals](#running-evals) for the current invocation). A fresh baseline is
> pending from the first live BYOK run.

### Plan 007 Baseline (June 2026): 19/25 pass (76%) — Claude Haiku 4.5, single-model, expanded suite

Post-plan-007 run against Claude Haiku 4.5 on a **25-test suite** (24 original + 1 new pharma/EP test
added in search-strategy.yaml). Run with `PATENT_API_URL=http://localhost:8014` (SKIP_AUTH=true backend),
no cache. The original 94.9% baseline was on 24 tests across 9 models; this run is single-model only.

To reproduce historically (pre-BYOK; the haiku config required `PATENT_API_URL` to be set explicitly):

```bash
cd evals && PATENT_API_URL=http://localhost:8000 promptfoo eval -c promptfooconfig.haiku.yaml --no-cache
```

| Test Suite | Tests | Pass | Fail | Pass Rate |
|---|---|---|---|---|
| tool-selection | 9 (+ 6 arg assertions) | 8/15 | 7/15 | 53% (llm-rubric grader failures counted) |
| jurisdiction-gating | 5 | 3 | 2 | 60% |
| anti-hallucination | 3 | 3 | 0 | 100% |
| active-behavior | 2 | 2 | 0 | 100% |
| source-attribution | 2 | 1 | 1 | 50% |
| search-strategy | 4 (+ 5 arg assertions) | 9/12 | 3/12 | 75% |
| **Total** | **25** | **19** | **6** | **76%** |

**Failures (6):**
- Path A (claim prior art): Claude Haiku does text preamble before tool call — first output is `text`, not a tool call
- Samsung jurisdiction: Haiku doesn't ask jurisdiction for company-only query (sends `build_patent_query` directly)
- Quantum computing: Haiku skips jurisdiction ask for "key patents I should know" query
- Prior art landscape analysis: Active behavior assertion — Haiku calls `askQuestions` first rather than searching
- mRNA vaccine: Source attribution — Haiku calls `build_patent_query` (valid) but llm-rubric grader fails
- EPC novelty: `legal_search_guide` called but llm-rubric grader fails

**Note on new argument assertions:** The 12 new argument-level assertions added in plan-007 all passed for tests where the correct tool was called. Failures are on the tool-selection or tool-name level, not argument-level.

### Plan 008 Baseline (June 2026): 19/25 pass (76% median over 3 runs) — Claude Haiku 4.5, single-model, no regression

Post-plan-008 runs with same conditions as plan-007 baseline (Claude Haiku 4.5, single-model, no cache, SKIP_AUTH=true backend). Adds three new prompt sections (`patentEvidenceRules`, `claimAnalysisRules`, `examinationContext`) and sharpens 7 tool `modelDescription`s.

Because the metric is noisy, the final prompt was validated across THREE independent `--no-cache` runs:

| Run | Score | Samsung wireless-power date-constraint test |
|---|---|---|
| 1 | 19/25 (76%) | PASS |
| 2 | 19/25 (76%) | PASS |
| 3 | 19/25 (76%) | PASS |
| **Median** | **19/25 (76%)** | 3/3 |

Failures in every run are exactly the same 6 pre-existing plan-007 baseline cases (grader-error or model-personality patterns, not prompt regressions).

**Iteration note:** an earlier wording of the act-first rule ("call the tool directly... skip any introductory text") made Haiku emit terser tool arguments and drop the user's date constraint (e.g. "filed after 2023") from `build_patent_query` descriptions, regressing the `epo_args_include_date_constraint` assertion. Fixed by adding an explicit constraint-completeness rule to `patentEvidenceRules`: tool arguments must carry every user-stated constraint (dates, assignees, jurisdictions, classification codes).

To reproduce:

```bash
cd evals && PATENT_API_URL=http://localhost:<port> promptfoo eval -c promptfooconfig.haiku.yaml --no-cache
```

**Previous Baseline (March 2026): 205/216 pass (94.9%)**

Multi-model eval across all 9 backend models (24 tests each):

Multi-model eval across all 9 backend models (24 tests each):

| Model | Pass | Fail | Rate | Notes |
|---|---|---|---|---|
| Claude Haiku 4.5 | 24 | 0 | **100%** | Perfect score, fast and cheap |
| Gemini 3 Flash | 24 | 0 | **100%** | Perfect score, lowest latency |
| Claude Sonnet 4.6 | 23 | 1 | 96% | Misroutes claim analysis to `ops_api_guide` |
| Gemini 3 Pro | 23 | 1 | 96% | Hallucinated `patent_search_subagent` tool |
| Gemini 3.1 Pro | 23 | 1 | 96% | Hallucinated `patent_search_subagent` tool |
| GPT-5 Mini | 23 | 1 | 96% | Asks jurisdiction for "worldwide" CRISPR search |
| GPT-5.2 Mini | 23 | 1 | 96% | Hallucinated `patent_search_subagent` tool |
| Claude Opus 4.6 | 22 | 2 | 92% | Wrong first tool on claim + Chinese patents |
| GPT-5.2 | 20 | 4 | **83%** | Over-triggers jurisdiction gate |

### What's Passing (100% across all models)

These behaviors are rock-solid regardless of which model is behind the agent:

- **Tool selection paths B-H**: EP search, patentability, detailed patent data, US search, citations, legal research, coding tasks — all 9 models pick the correct tool every time
- **Jurisdiction gating**: All models ask when ambiguous, skip when jurisdiction is explicit
- **Anti-hallucination**: Zero fabricated patent numbers or legal citations across 27 test runs
- **Source attribution**: All models search before citing patent data
- **Search strategy**: Correct USPTO/EPO tool selection with proper parameters

### Remaining Failures (11 total — all model-level, not prompt issues)

| Failure Pattern | Models Affected | Root Cause |
|---|---|---|
| Hallucinated `patent_search_subagent` tool | Gemini 3 Pro, 3.1 Pro, GPT-5.2 Mini | Models invent a tool not in the definitions |
| Wrong tool for claim prior art (Path A) | Claude Sonnet, Claude Opus | Picks `ops_api_guide` or `search_academic` instead of `build_patent_query` |
| Over-cautious jurisdiction gate | GPT-5.2 (4 tests) | Calls `askQuestions` even when jurisdiction is explicit |
| Chinese patent routing | Claude Opus, GPT-5.2 | Should use `web_search` for CN patents, uses EPO tools or asks |

### Key Insight

The system prompt is the strong layer — it produces 95% correct behavior across 3 different providers and 9 models. The remaining 5% failures are model personality quirks (GPT-5.2 being over-cautious, some models hallucinating tools). These can't be fixed by prompt changes alone.

---

## Best Practices for Getting Good Results

### When Writing New Tests

1. **Prefer `javascript` assertions over `llm-rubric`** — deterministic, no grading model variance, instant evaluation. Use `llm-rubric` only when you genuinely need qualitative judgment.

2. **Account for single-turn limitations** — Evals only test the agent's *first response*. If the correct behavior is a multi-step workflow (search → format → create file), only assert on the first step (search tool call). Don't expect results that require tool execution and follow-up turns.

3. **Accept multiple valid tools** — The agent often has several correct first-tool options. For example, both `askQuestions` (jurisdiction gate) and `build_patent_query` (direct search) can be valid for ambiguous queries. Don't over-constrain.

4. **Test what the tools actually support** — Before asserting "assignee should be a separate parameter," check `tool-definitions.json`. If the tool only has a `description` field, the model *can't* pass that assertion. Match tests to actual tool schemas.

5. **Use `metric` names** — Every assertion should have a `metric` field for tracking in the dashboard. Name them descriptively: `path_b_general_search`, `jurisdiction_asks_when_ambiguous`.

### When Changing the System Prompt

1. Run `npm run eval` before and after the change
2. Compare pass rates in `promptfoo view` — look for regressions
3. If a test fails after your change, decide: is the test wrong, or is the prompt regression real?
4. Update `prompts/system-prompt.txt` to match the new TSX render
5. Run `npm run eval:extract-tools` if tool definitions changed

### When Adding New Tools

1. Add the tool to `package.json` → `contributes.languageModelTools`
2. Run `npm run eval:extract-tools` to regenerate `tool-definitions.json`
3. Add test cases to the appropriate dataset (or create a new dataset file)
4. Add the new dataset to both `promptfooconfig.yaml` and `promptfooconfig.multi.yaml`

### Model Selection Recommendations

Based on eval results:

- **Default / production**: Gemini 3 Flash or Claude Haiku 4.5 — both score 100%, fastest, cheapest
- **Complex analysis**: Claude Sonnet 4.6 or Gemini 3 Pro — 96%, better reasoning on multi-step tasks
- **Avoid for agent tasks**: GPT-5.2 — 83%, over-triggers jurisdiction gate, weakest tool selection

---

## Future Improvements

### High Priority

**Multi-turn eval support** — Current evals are single-turn: send one message, check the response. This misses the agent's most important behavior — multi-step workflows where it calls a tool, gets results, then calls another tool or creates a file. Promptfoo supports [conversation testing](https://www.promptfoo.dev/docs/configuration/chat/) with `vars.conversation` — implement 3-5 multi-turn scenarios covering:
- Search → format results → create markdown file
- Ask jurisdiction → user answers → execute correct search
- Search fails → fallback to alternative database

**Tool argument validation** — Current tests check *which* tool is called but rarely validate the *arguments*. Add assertions that verify:
- `build_patent_query` description contains extracted technical terms from the user's claim
- `build_uspto_query` description includes assignee name when user specifies a company
- `ops_api_guide` receives correct patent number format (e.g., `EP1234567`)

**Regression CI gate** — Add eval runs to the CI pipeline. On PR, run single-model eval (fastest model — Gemini Flash) and fail the build if pass rate drops below 90%. Store baseline in `output/baseline.json` and compare.

### Medium Priority

**Expand test coverage to 50+ cases** — Current 24 tests cover the happy paths well but miss edge cases:
- Malformed patent numbers (`US 12,345,678` vs `US12345678`)
- Mixed jurisdiction queries ("Compare US and EU patents on X")
- Ambiguous tool routing ("Tell me about patent EP1234567 and find similar ones" — needs both `ops_api_guide` AND `build_patent_query`)
- Non-English queries or patent titles
- Very long claim texts (token budget stress test)

**Prompt diff testing** — Automatically render `patentAIPrompt.tsx` to text and diff against `system-prompt.txt`. Fail if they diverge. This prevents the static prompt from going stale.

**Cost tracking per model** — The eval already captures `tokenUsage` per response. Build a summary report that shows cost-per-test across models, helping with model selection decisions:
```
Model              Avg Tokens   Est. Cost/24 tests
Gemini 3 Flash        2,148     $0.002
Claude Haiku          3,100     $0.008
GPT-5.2              14,233     $0.142
```

**Fix `patent_search_subagent` hallucination** — 3 models invent this tool. Options:
- Add "Only call tools from the provided list" to the system prompt
- Add a negative test: assert no tool calls to unlisted tools across all tests

### Low Priority

**Latency benchmarking** — Track response time per model per test. Identify if certain query types are disproportionately slow on certain models.

**A/B prompt testing** — Use promptfoo's multiple-prompt support to test two versions of `patentAIPrompt.tsx` side-by-side. Useful for prompt refactoring: does the new version maintain the same pass rate?

**Grading model stability** — The `llm-rubric` assertions use Gemini Flash as the grading LLM. Some tests show `Could not extract JSON from llm-rubric response` failures (~4 occurrences). Options:
- Switch grading model to Claude Haiku (more reliable JSON output)
- Add retry logic or structured output format to the grading provider
- Replace flaky `llm-rubric` assertions with deterministic `javascript` assertions where possible

**Nightly eval runs** — Schedule a daily eval run against the staging backend to catch model-side regressions (provider updates, model deprecations). Store results with timestamps for trend analysis.
