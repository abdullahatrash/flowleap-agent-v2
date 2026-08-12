# PRD 0012: Move query building and claim analysis to the user's own model

Thesis: three backend routes run a **static prompt plus a parse** on FlowLeap's Anthropic
account, and what they receive is the unfiled **Invention Disclosure** and claim text — the
material a patent attorney is obliged to protect. The client is already running a model on
the user's own key. So the knowledge moves into the Patent Skills and the routes die. This
PRD executes ADR 0012 (`flowleap-backend`) across four repos, with a dogfooding gate in the
middle that decides whether the removals happen at all.

## Problem Statement

`/build-patent-query`, `/build-uspto-query` and `/analyze-claim` send user-authored text to
FlowLeap-managed models. `CQL_BUILDER_SYSTEM_PROMPT` is a 360-line string; the other two are
the same shape. No proprietary model, no index, no data the client lacks — FlowLeap pays
Anthropic to run a prompt that could ship to the client.

ADR 0004 absorbed these deliberately, on **cost** grounds, and on cost it was right.
Confidentiality was never weighed. A consent gate was built and rejected before merge
(#217): asking permission to do something that should not happen server-side is the wrong
fix, and it leaves the material exposed for everyone who says yes.

`/v1/code-mapper` is worse and simpler: it sends the user's **source code** to `gpt-4o` on
FlowLeap's key and no client calls it.

## Solution

The agent writes its own CQL, on the user's own key, guided by a skill. `patent-search`
becomes the single source of truth for query construction; the other nine skills that
currently restate "call `build_patent_query`" point at it instead. The Invention Disclosure
stops leaving the machine.

The CLI needs its own version of this. Its harness agent is the LLM, but it reads a
**different skill family** (`flowleap-cli/skills/flowleap-*`), not the app's bundled Patent
Skills — the drift manifest mirrors `src/vs/sessions/skills/*` from the CLI and never touches
`assets/skills`. So the CLI is a separate change in a separate repo, with a release chain:
CLI edit -> tag -> bump `skills-drift-manifest.json` -> re-mirror. Phase 1b below.

Sequencing is deliberately **additive first**. Skills land while the old tools still work,
so both paths can be compared directly on real searches. That comparison is the gate: it is
the only moment the two can be measured against each other, and it vanishes the instant
anything is deleted.

## User Stories

1. As a patent attorney, I want my invention description to stay on my machine, so that I never disclose pre-filing material to a third party I did not choose.
2. As a patent attorney, I want my draft claim text to stay on my machine, for the same reason.
3. As a user, I want query building to work when signed out or after my trial lapses, so that public knowledge about EPO's query language is not paywalled.
4. As a user, I want query building to work offline, so that a network blip does not stop me composing a search.
5. As an agent, I want one place to learn CQL, so that I do not guess field names.
6. As an agent, I want to know when a query is weak, so that I add a discriminating term instead of returning thousands of generic hits.
7. As an agent driving the CLI from another harness, I want the same guidance the IDE agent has, so that both surfaces search equally well.
8. As a maintainer, I want CQL strategy in one skill, so that improving it is a one-file edit rather than eleven.
9. As a maintainer, I want a rule that decides future routes, so that the next server-side LLM call is noticed before it ships.
10. As the founder, I want FlowLeap to stop paying for inference it does not need to run.
11. As the founder, I want a true confidentiality claim on the website.
12. As a reviewer, I want the prompt-snapshot guard working before the prompt changes, so that a real regression is visible rather than buried in pre-existing drift.

## Implementation Decisions

**Principle (ADR 0012, `flowleap-backend`)**
- *FlowLeap runs a model only where the client cannot.* Capability, not cost — a cost rule is what let these routes in. OCR (specialised model), embeddings (must match the index) and `/v1/analyst` (website visitors have no **Model Path**) pass the rule on their own merits and stay.

**Skills: `patent-search` owns query construction (canonical in `assets/skills`, synced to `flowleap-plugins`)**
- Information hierarchy, not a bigger skill. `SKILL.md` keeps the **step** (write the CQL yourself) and the load-bearing **rule**; the full field list, operators, recall/precision trade and worked examples are disclosed to `references/cql-reference.md`. `patent-search` is 56 lines today; folding 360 lines in would be sprawl.
- Branching decides the cut: a `pa=Samsung` lookup needs no strategy, a novelty search from an Invention Disclosure needs all of it. Inline what every branch needs; disclose what only some reach.
- **Leading word: `discriminating`.** The backend prompt states one idea three times ("SPECIFIC subject matter keywords" / "IPC codes alone are NOT enough" / "distinguish from the millions of generic ones"). Collapse to: *every query needs at least one discriminating term — one that separates this invention from the millions of generic patents in its technology area. A CPC code is never discriminating: it names a neighbourhood, not a house.* Use the word verbatim in the skill, the reference, the ODP section and the eval datasets so it accumulates a distributed definition.
- Pointer wording is imperative, not optional: *"Before writing any CQL beyond a single `pa=` or `ti=` term, read `references/cql-reference.md`. Do not guess field names."* A pointer's wording, not its target, decides whether the agent follows it.
- Completion criterion is checkable: *"Every field in your query must appear in `cql-reference.md`. If you cannot name the field's entry, you have guessed — go read it."*
- Keep broader/narrower as refinement rules (the Search Refinement section already does this job). Drop `focus` as a mode — it was a tool parameter, not a concept the agent thinks in; its content (recall vs precision) goes in the reference.

**Skills: the other nine point rather than restate**
- `prior-art`, `freedom-to-operate`, `patent-landscape`, `invention-disclosure`, `portfolio-analysis`, `audit-report`, `patent-translation`, `excess-claims-estimator`, `claim-analysis` currently each name `build_patent_query`. They gain a **context pointer** to `patent-search` and lose the restatement. Measured after the fact: this is roughly text-neutral (+42 lines across the SKILL.md files), not the reduction originally predicted — the restatements were one-liners and the pointers are the same length. The win is the single source of truth, not token count.
- `claim-analysis` already teaches preamble/transitional-phrase/body decomposition and element-by-element analysis. It gains the decomposition depth from `CLAIM_ANALYSIS_PROMPT` and loses its `analyze_claim` delegation.

**Phase 1b — CLI skills (`flowleap-cli`, separate repo and release chain)**
- `flowleap-patent`, `persona-patent-attorney` and `recipe-invention-disclosure` teach `flowleap patent build-query --allow-external-processing`. They need the same discriminating-term guidance and a CQL reference of their own.
- Blocked by the mirror pin: `scripts/skills-drift-manifest.json` pins `ref: v0.6.0`, so a CLI skill change requires a CLI tag and a manifest bump before `src/vs/sessions/skills/*` reflects it. Sequence this with the CLI command deletions in Phase 3 rather than separately — one CLI release, not two.

**Skills: USPTO is a different case**
- `uspto_api_guide` remains the single source of truth for ODP **request shapes** — that is server-owned and correctly stays on the backend. The skill gains only the Lucene *query-writing* strategy. Materially less new content than CQL, and the two halves can land independently.

**agent-v2: tool surface and prompt**
- Remove `BuildPatentQueryTool`, `BuildUSPTOQueryTool`, `AnalyzeClaimTool` and their registrations, `ToolName` entries, and `detectPatentTools` flags.
- `patentAIPrompt.tsx` decision tree: replace tool names with the skill name once. This content already exists and is already paid for in context — replacing `build_patent_query` with "load the `patent-search` skill" costs nothing extra, and deleting outright would leave a hole where the most common branch was.
- **Subagent**: `patentSearchSubagentToolCallingLoop.ts` has no skill access — it is a tool-only allowlist. The parent builds the CQL and passes it in; the subagent stops constructing queries and only executes and reads. Query strategy is a parent-level decision that benefits from the full conversation the subagent deliberately lacks.

**Backend (`flowleap-backend`)**
- Retire `/v1/build-patent-query`, `/v1/build-uspto-query`, `/v1/analyze-claim` via the existing `retired.ts` 410 handler. Delete `/v1/code-mapper` outright.
- The three system prompts are the deliverable, not the code — they are extracted into the skill and reference files before the routes go.

**CLI (`flowleap-cli`)**
- Delete `patent build-query`, `uspto build-query`, `analyze-claim`, and `--allow-external-processing` (`src/commands/query_privacy.rs`). They cannot be reimplemented: the CLI is not a model. The changelog must say so plainly — "three commands removed, replaced by nothing" needs its explanation.

**`CONTEXT.md`**
- **FlowLeap-Managed Inference** — the routes where FlowLeap runs a model on its own account. Redefined as an *exception list* whose target size is zero; additions require a decision. Its job is making the category visible, which is exactly what failed before.
- **Discriminating term** — now load-bearing across a skill, a reference file and seven eval datasets.

## Testing Decisions

- **Phase 0 is a prerequisite, not cleanup.** The 30 `agentPrompt` snapshots already fail on `main`; the patent prompt was never baselined into them. Regenerate them as their own verified-green commit *before* touching `patentAIPrompt.tsx`. Otherwise a genuine prompt regression and ~10,000 lines of pre-existing drift land in one diff and nobody can separate them.
- **Verify the feedback loop before deleting anything.** Once the builder is gone, EPO's CQL errors are the agent's only signal that a query is malformed. `handlePatentToolError` surfaces `PatentBackendError` text, but confirm EPO's own error body survives the backend rather than being replaced by a generic message. Clear errors let the agent self-correct; swallowed ones make it flail.
- **The dogfood gate.** With both paths alive, run known searches: agent-written CQL vs `build_patent_query` output, same descriptions, compare hits by eye. This is same-day and catches a gross regression immediately.
- **The seven eval datasets are the lock-in, not overhead.** `frontier`, `source-attribution`, `search-strategy`, `anti-hallucination`, `jurisdiction-gating`, `active-behavior`, `tool-selection` all assert tool selection and become wrong. Update them to assert the new behaviour — do not delete cases. A deleted case is a guard silently given up, and these are the regression guard for the exact risk this PRD carries.
- Existing unit tests: the three tool spec files go with their tools; `patentAIPrompt.spec.tsx` gains coverage that the decision tree names the skill.

## Out of Scope

- **OCR, embeddings, `/v1/analyst`.** All three pass the ADR 0012 rule. `/analyst` in particular is the website's analytics page, where the visitor has no BYOK key at all.
- **`/analyst`'s cost bound.** It is an unmetered agent loop — a different cost class from the single calls ADR 0004 reasoned about. Deserves its own look; folding it in would double a clean change.
- **The consent gate.** Built as #217 and closed unmerged. Its branch is kept because the fallback below may need it.
- **#216** (routing the OCR call through `IPatentBackendClient`) — still valid, unaffected, independent.
- **Building a patent-recall eval corpus.** Considered and rejected as a blocker: it is a project in its own right and would stall a privacy fix indefinitely.

## Further Notes

**The fallback is real and must not be quietly skipped.** If dogfooding shows agent-built
queries are materially worse, the answer is not to ship anyway. It is to keep the routes as
an opt-in — in which case #217's consent gate becomes necessary after all, and ADR 0012
needs revisiting rather than abandoning. The honest comparison is not "Sonnet vs a weak
model" but "Sonnet with a prompt vs the model already driving the whole session": a model
too weak to write CQL is too weak to run the patent workflow at all.

**Execution splits by kind, not by repo.** The skill and reference writing is one pass in
one place — consistency of the `discriminating` language across eleven skills is exactly
what fragments when parallel agents each choose their own phrasing. The mechanical work
(delete `code-mapper`, delete three CLI commands, remove tool registrations) delegates
cleanly to separate agents in separate worktrees, where there is no voice to keep and the
shared-index hazard does not apply.

**The website copy is independent and should not wait.** The current confidentiality claim
is untrue today and stays untrue for the whole of this PRD. It needs no code — ship the
accurate paragraph now (website wayfinder #230 / map #216) and improve it when this lands.
