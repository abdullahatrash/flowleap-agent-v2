# H4 — Trajectory eval gate design

> Asset for ticket [Design the trajectory eval gate](../tickets/H4-trajectory-eval-gate-design.md)
> (map 0002, harness-gap parity). Design only — no CI wiring, no implementation. Every case is
> grounded in a row of the [H3 attribution table](H3-attribution.md) and cites the corpus task
> it would have caught. Coordinates with (does not merge into) the CLI-skill regression gate
> [W7](../tickets/W7-regression-gate-design.md). Built 2026-07-17.

## Headline decision

**Harness:** extend the #27 promptfoo setup with a *new multi-turn replay provider*
(`trajectory-provider.ts`) that runs the agent loop locally against a **scripted mock tool
table** — reusing the existing prompt renderer, `tool-definitions.json`, BYOK provider auth,
model pin, and baseline-compare machinery, adding only the loop driver + fixture executor.
**Assertion style:** primarily **trajectory-structural** (assert over the ordered tool-call
sequence: did call N+1 of a *different* tool happen after mock-result N was tagged EMPTY / 5xx /
TRUNCATED, before any give-up narration), with a thin **LLM-judge** layer for the one thing
structure can't see — whether the final text *narrates a give-up / coverage limitation*. The
failure conditions (504s, zero-hits, truncation drops) are **scripted fixtures, never live**, so
every case is deterministic at temperature 0.

---

## 1. Why the current harness is blind (the gap this gate fills)

The #27 provider (`evals/providers/patent-ai-provider.ts`) does **one** round-trip: system
prompt + user message → model → return `{text, tool_calls}`. It **never executes a tool, never
feeds a result back, never runs a second round.** Its assertions grade one-shot tool *selection*.
Loop behavior — retry after a 504, reformulate after an empty hit, route to a sibling tool, keep
going past step 1 — is structurally invisible to it. That is exactly why the suite stayed 40/40
green while the corpus gap (H1) was real. The trajectory gate is the multi-turn axis the one-shot
suite cannot have.

---

## 2. Harness (decision + rejected alternatives)

### Chosen: a multi-turn replay provider inside the existing `evals/` tree

A new `evals/providers/trajectory-provider.ts` implements promptfoo's `ApiProvider`, but
`callApi` runs the **whole loop** internally:

1. Build messages: system prompt (rendered by the existing `prompts/render-system-prompt.tsx`) +
   user prompt from the case.
2. Call the BYOK chat endpoint (same OpenRouter path, same `tool-definitions.json`, `tool_choice:
   auto`, `temperature: 0`).
3. If the response has `tool_calls`, resolve each against the **case's mock tool table** (see §3),
   append the canned tool result as a `role: tool` message (tagged internally with EMPTY / OK /
   HTTP_5XX / TRUNCATED), and loop.
4. Stop at no-more-tool-calls or a `maxRounds` cap (default 8 — well above the 6-retry grinds seen
   in H3, below a runaway).
5. Return a JSON-serialized **trajectory object**:
   ```
   { rounds: [ { toolCalls: [ { name, args, mockTag } ] } ... ], finalText }
   ```
   Assertions `JSON.parse` it — same contract shape the existing provider already uses so the
   `no_invented_tool_names` global guard and `compare-baseline.ts` carry over unchanged.

The mock table per case is supplied in the dataset `vars` (a `mockScript` id resolving to a
fixture under `evals/fixtures/trajectory/`), so the config file, datasets, and providers stay in
the promptfoo idiom. New config file: `promptfooconfig.trajectory.yaml`; new dataset dir
`datasets/trajectory/`; new fixture dir. Nothing in the #27 suite changes.

**Model pin:** default to the same `google/gemini-2.5-pro` as #27 (per the provider's own
comment: pro obeys the skip rules; flash's model weakness would fire the gate on the wrong axis).
Holding the model fixed is the point — the gate must fire on **prompt / tool-string / skill
drift**, not on model choice (H10 is a separate real-world lever, not this gate's variable). Keep
an optional `anthropic/claude-sonnet-4` column available for a floor check, since H5–H9 target the
weaker-model floor, but CI runs the pinned pro column for determinism and cost.

**What stays shared with W7 / #27:** the `evals/` tree, BYOK provider auth + `EVAL_*` env
resolution, `render-system-prompt.tsx` + `check-prompt-drift.ts` (both gates must assert against
the *same* rendered prompt or they diverge), `tool-definitions.json`, `compare-baseline.ts`, the
`no_invented_tool_names` global guard, and `run-evals.sh` as the entry point.
**What stays separate:** the loop driver + mock tool executor + `fixtures/trajectory/` are
H4-only; W7 grades **deliverable structure** (X/Y/A tags, family dedup, FTO columns) on a single
output/artifact, H4 grades **tool-call ordering under scripted failure**. Different datasets,
different config, different assertion vocabulary. Two axes, one machine.

### Rejected alternatives

- **Drive the real main-window workbench headless** (the H1 `/launch` approach). Rejected for the
  *gate*: needs a live backend, is slow and flaky in CI, and — fatally — can't script a 504 or a
  truncation-drop on demand (H1 had to *wait for an outage*). That end-to-end run is the
  acceptance head-to-head's job, not the per-commit gate's.
- **LLM-judge on the raw transcript as the primary assertion.** Rejected as primary:
  non-deterministic, token-costly, and can't pin the exact structural fact ("a second distinct
  tool call occurred after the empty result"). Kept only as a thin secondary layer for give-up
  *narration* detection (§3), where the fact is genuinely linguistic.
- **A brand-new runner outside promptfoo.** Rejected: throws away the drift check, baseline
  compare, the invented-tool guard, and the shared prompt renderer — and would let H4 and W7
  silently render different system prompts. Extend, don't fork.
- **Bolt multi-turn onto the existing single-turn provider.** Rejected: the #27 provider's
  one-shot contract is load-bearing for its 40/40 selection cases; a sibling provider keeps both
  axes clean.

---

## 3. Assertion style + how tools are mocked

**Structural (primary).** Assertions are `javascript` predicates over the trajectory object.
Two reusable helpers cover almost everything:

- `reactedAfter(traj, mockTag, {differentTool})` — was there a subsequent tool call (of a
  *different* name/args when `differentTool`) after the first round whose result carried `mockTag`
  (EMPTY / HTTP_5XX / TRUNCATED), *before* `finalText`? This is the core "did call N+1 happen after
  empty result N" check.
- `reachedTool(traj, name, {argMatch})` — did the trajectory ever reach a given tool (optionally
  with matching args, e.g. `search_citations` keyed on an `applicationNumber`)?

**LLM-judge (secondary, thin).** One `llm-rubric` per give-up case: *"Does the final message
disclose a coverage/capability limitation or hand back to the user (e.g. 'no web search
capability', 'use commercial databases', 'backend connectivity issues', 'consult counsel')
**without** having exhausted reformulation, an alternate tool, and the web fallback?"* Structure
proves the mechanical fact; the judge catches the *narration* of surrender, which is linguistic.
A case fails red if **either** the structural assert or the judge fires — the give-up cases from
H3 fail on both, which is the belt-and-suspenders we want.

**Mocking / determinism.** Each case names a `mockScript` fixture: a table of
`(toolName [, argMatch]) → response`, with **failure scripts** expressed as per-call sequences,
e.g. `search_patents: [HTTP_5XX, HTTP_5XX, OK(hits)]` (transient-then-recovers) or
`search_forward_citations: EMPTY; search_citations(applicationNumber:*): OK(4 X-citations)`. Every
504, zero-hit, and truncation-drop body is a canned fixture string (real shapes copied from the
H3 transcripts — the nginx 504 HTML, the `patentFileWrapperDataBag: []` + "refine your query"
note, the empty forward-citation payload). No network, no backend, no live model tools. Temperature
0 + fixed model + fixed fixtures ⇒ reproducible. The only non-determinism is the LLM-judge, which
is why it's secondary and scoped to a yes/no give-up rubric.

---

## 4. Case classes (grounded in the H3 attribution table)

Each case = a user prompt + a `mockScript` + trajectory assertions. Confidence mirrors H3's row
confidence. IDs are `T1..`. The negative controls (T7) are load-bearing: they stop the gate from
rewarding infinite grinding, which the 25-min-cap artifacts warn against.

| Case | Class | Scripted environment | Pass requires (structural) | Give-up judge | Caught corpus task | Conf. |
|---|---|---|---|---|---|---|
| **T1** | backend-route-exhausted → web fallback | `patent_api_request(enrich=claims)` for a single US patent → EMPTY-drop (`[]` + "refine your query") | `reachedTool(fetch_webpage OR web_search)` **or** an alternate-tool attempt, before finalText | must NOT narrate "no web capability" / "use commercial databases" | **R1** (Sonnet 4 quit; Sonnet 5 used `fetch_webpage`) | High |
| **T2** | empty citation → sibling tool + key chain | `search_forward_citations` → EMPTY; `search_citations(applicationNumber:16473445, category:X)` → 4 X-citations (reachable via `get_patent_family`→`get_continuity`) | `reachedTool(search_citations, argMatch: applicationNumber)` after the empty forward result | must NOT conclude "no X-category references found" | **S3** (H7) | High |
| **T3a** | transient 5xx → retry, then recover | `search_patents: [HTTP_5XX, HTTP_5XX, OK(hits)]` | ≥2 `search_patents` attempts **and** trajectory continues past the 5xx to use the OK hits | must NOT narrate "backend connectivity issues" as terminal | **R4** / R1 round-2 502 (H8) | Med (outage-confounded, mechanism real) |
| **T3b** | transient 5xx → retry, persistent | `search_patents: [HTTP_5XX × 4]` | ≥3 attempts (retry/backoff/broaden) before any hand-back; a hand-back *after* exhaustion is allowed | must NOT disclose a **coverage** limit (transient ≠ "not covered") | **R4** / **S2** | Med |
| **T4** | multi-step chain → don't stop at step 1 | EP hit → `get_patent_family` → `get_continuity` → app number → `search_citations` all scripted OK | trajectory reaches the **terminal** tool of the chain (≥4 distinct steps), not a stop after step 1 | n/a | **S3** chain / **S4** continuity | High |
| **T5** | single-record truncation-drop ≠ no-data | `patent_api_request` single-ID → TRUNCATED (empty item dropped at 50k + "refine your query" note) | model must NOT treat `[]` as a true zero-and-stop: it must offload/paginate (`read_file` path), retry a narrower field, **or** fall back — a give-up is a fail | reads the drop as "no data exists" and stops → fail | **R1** backend route (H9) | High (mechanism) |
| **T6** | true zero-hit → reformulate/broaden | `search_patents` (valid query) → EMPTY (clean 0 hits) | a 2nd `search_patents`/`build_patent_query` with broadened/reformulated args before any give-up | must NOT stop at first zero | H2 #2 (masked in corpus by outage) | Low (rule verified-absent, not observed) |
| **T7** | negative control: correct-null, no infinite retry | a genuinely empty space; correct answer *is* "nothing found" after bounded effort | trajectory reformulates a **bounded** number of times (≤ maxRounds) then reports the null; **no** fabricated hits; **no** runaway | must report the null honestly, not fabricate | **R2 / R3 / S4** ("no gap" — mechanism must stay green) | High |
| **T8** | (optional) jurisdiction gate non-block on comprehensive req | prompt clearly asks "search all databases / worldwide" | must NOT stall asking a jurisdiction question before any search tool call | n/a | **S1** (H5e; confound-heavy) | Low |

Notes: T7 and T8 are guards against over-correction — the fixes (H5–H9) push for persistence, and
the gate must *not* reward infinite grinding (T7) or re-introduce a stall the comprehensive path
shouldn't have (T8). T6/T8 are marked low-confidence because H3 could not observe the mechanism
directly (outage-masked / confound-dominated); they encode the *rule* H3 verified absent, flagged
so a red there is read as "rule regressed," not "corpus-proven failure."

---

## 5. "Would it have caught this?" — walking H1's Sonnet-4 failures through the gate

| H1 observed failure (Sonnet 4, main-usual) | Gate case | Why it fails RED |
|---|---|---|
| **R1** — quit at round 12: *"since we don't have web search capabilities … use commercial databases"*, `fetch_webpage` never called | **T1** (+ T5) | Structural: `reachedTool(fetch_webpage OR web_search)` = **false** → fail. Judge: final text narrates "no web capability / use commercial databases" → fail. Double-red. |
| **S3** — used `search_forward_citations` (0 hits), diagnosed the mismatch, but never reached `search_citations` on the app number; concluded *"No X-category prior art references were found."* | **T2** (+ T4) | Structural: `reachedTool(search_citations, applicationNumber)` after EMPTY forward = **false** → fail. Judge: concludes "no X-category references" → fail. |
| **R4** — most-cited leg 504'd; gave up: *"backend connectivity issues preventing the forward citation analysis."* | **T3a/T3b** | Structural: only one search attempt before give-up (< the ≥2/≥3 threshold) → fail. Judge: narrates "backend connectivity issues" as terminal → fail. |
| **S2** — truncation stall (*"The response was truncated…"*), grind cut off by the 25-min cap | **T5** (mechanism) | If the truncation-`[]` were read as no-data-and-stop, T5 fires red. **Honest caveat:** S2's actual end was a *cap cutoff during a legitimate grind* (H3: X/confound), which the gate deliberately does **not** red — T7 protects that bounded-grind case. The gate targets the *truncation-shape* mechanism (H9), not the cap artifact. |

Result: the three clean/decisive Sonnet-4 give-ups (R1, S3, R4-leg) each fail red on the designed
gate; the confounded S2 is correctly **not** forced red (its loss was a cap artifact, per H3),
which is the honest outcome — a gate that red-flagged S2 would be asserting a failure H3 showed was
not a product-loop deficiency.

---

## 6. Design risks

1. **LLM-judge non-determinism on the give-up rubric.** Mitigated by keeping it secondary (a case
   already fails on the structural assert in every H3 give-up) and scoping the rubric to a single
   yes/no. Risk: a flaky judge could flip a *pass* to fail on a borderline final text. Watch the
   judge's own agreement rate; if it flakes, tighten to a keyword-list structural check on
   `finalText`.
2. **Model pin vs. the floor the fixes target.** The gate runs pinned pro for determinism, but
   H5–H9 target the *weaker-model* floor. A fix could pass on pro yet still fail Sonnet-4. Mitigate
   with the optional Sonnet-4 column as a non-blocking advisory lane; keep pro as the CI gate.
3. **Fixture drift.** The mock bodies are copied from H3 transcripts; if the backend error shapes
   change (H8 *reshapes* the transient error deliberately), the fixtures must be updated in lockstep
   or the gate asserts against a stale shape. Tie fixture updates to the H8 slice.
4. **T6/T8 assert rules the corpus never observed** (outage-masked / confound-dominated). They
   guard verified-absent rules, not proven failures — a red there means "rule regressed," and
   should be triaged as lower-severity than a T1/T2/T4 red.
5. **Over-fitting to eight cases.** The gate locks the *diagnosed* modes; it won't catch a novel
   give-up class. That's acceptable for a regression gate (its job is "this class can't ship green
   again"), but the acceptance head-to-head (map's Not-yet-specified) remains the open-ended check.
